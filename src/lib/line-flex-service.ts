/**
 * 公式 LINE Flex Message の業務ロジック（サーバー専用）
 * - 入力の検証 → 送信用 payload（計測リンク入り）の生成 → 保存
 * - Webhook / 差し込み用の取り出し
 */
import { randomBytes } from 'crypto';
import type { LineFlexMessage, LineFlexMessageInput, LineFlexTemplate } from '@/types/line-flex';
import {
  buildLinePayload,
  instrumentFlexLinks,
  LINE_FLEX_ALT_TEXT_MAX,
  LINE_FLEX_ID_PATTERN,
  LINE_FLEX_MAX_JSON_BYTES,
  LINE_FLEX_NAME_MAX,
  LINE_FLEX_TEMPLATES,
  matchesKeyword,
  normalizeKeywords,
  payloadBytes,
  resolveFlexContents,
  validateFlexContents,
} from '@/lib/line-flex-templates';
import {
  deleteLineFlexMessage,
  getLineFlexMessage,
  incrementLineFlexReply,
  insertLineFlexMessage,
  listEnabledLineFlexMessages,
  listLineFlexMessages,
  updateLineFlexMessage,
} from '@/lib/line-flex-repository';

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export function generateLineFlexId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function isTemplate(v: unknown): v is LineFlexTemplate {
  return typeof v === 'string' && LINE_FLEX_TEMPLATES.some((t) => t.id === v);
}

/** 入力を検証して保存用の行を組み立てる（既存行があれば統計などを引き継ぐ） */
export function prepareLineFlexMessage(
  storeId: string,
  input: LineFlexMessageInput,
  origin: string,
  existing: LineFlexMessage | null
): ServiceResult<LineFlexMessage> {
  const name = (input.name ?? '').trim().slice(0, LINE_FLEX_NAME_MAX);
  if (!name) return { ok: false, status: 400, error: 'メッセージの名前を入力してください' };
  if (!isTemplate(input.template)) return { ok: false, status: 400, error: 'テンプレートの種類が不正です' };
  const altText = (input.alt_text ?? '').trim();
  if (!altText) return { ok: false, status: 400, error: '通知に表示される文（代替テキスト）を入力してください' };
  if (altText.length > LINE_FLEX_ALT_TEXT_MAX) return { ok: false, status: 400, error: `代替テキストは ${LINE_FLEX_ALT_TEXT_MAX} 文字までです` };

  const id = existing?.id ?? (typeof input.id === 'string' && LINE_FLEX_ID_PATTERN.test(input.id) ? input.id : generateLineFlexId());
  const data = input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data : ({} as LineFlexMessageInput['data']);
  const flexOverride = input.flex_override && typeof input.flex_override === 'object' && !Array.isArray(input.flex_override) ? input.flex_override : null;
  if (input.template === 'custom' && !flexOverride) return { ok: false, status: 400, error: 'JSON から作成するときは Flex の JSON を入力してください' };

  const contents = resolveFlexContents({ template: input.template, data, flex_override: flexOverride });
  const contentsError = validateFlexContents(contents);
  if (contentsError || !contents) return { ok: false, status: 400, error: contentsError ?? 'Flex の内容が空です' };

  const trackTaps = input.track_taps !== false;
  const instrumented = trackTaps ? instrumentFlexLinks(contents, origin, id) : { contents, links: {} as Record<string, string> };
  const payload = buildLinePayload(altText, instrumented.contents);
  const bytes = payloadBytes(payload);
  if (bytes > LINE_FLEX_MAX_JSON_BYTES) {
    return { ok: false, status: 400, error: `メッセージが大きすぎます（${Math.round(bytes / 1024)}KB。LINE の上限は 30KB）。カードや文章を減らしてください` };
  }

  const now = new Date().toISOString();
  return {
    ok: true,
    value: {
      id,
      store_id: storeId,
      name,
      template: input.template,
      data,
      flex_override: flexOverride,
      alt_text: altText,
      keywords: normalizeKeywords(input.keywords),
      attach_confirm: input.attach_confirm === true,
      attach_reminder: input.attach_reminder === true,
      attach_follow: input.attach_follow === true,
      enabled: input.enabled !== false,
      track_taps: trackTaps,
      payload,
      links: instrumented.links,
      reply_count: existing?.reply_count ?? 0,
      tap_counts: existing?.tap_counts ?? {},
      created_at: existing?.created_at ?? now,
      updated_at: now,
    },
  };
}

/** 同じ店舗の別メッセージと同じキーワードを使っていないか */
function findKeywordConflict(rows: LineFlexMessage[], candidate: LineFlexMessage): string | null {
  for (const r of rows) {
    if (r.id === candidate.id) continue;
    for (const k of candidate.keywords) {
      if (r.keywords.some((x) => x.toLowerCase() === k.toLowerCase())) return `キーワード「${k}」は「${r.name}」で使われています`;
    }
  }
  return null;
}

/** このシステムが既に使っている言葉（予約確認・キャンセル）は登録できない */
const RESERVED_KEYWORDS = ['予約確認', 'キャンセル'];

export async function createLineFlexMessage(storeId: string, input: LineFlexMessageInput, origin: string): Promise<ServiceResult<LineFlexMessage>> {
  const prepared = prepareLineFlexMessage(storeId, input, origin, null);
  if (!prepared.ok) return prepared;
  const rows = await listLineFlexMessages(storeId);
  if (rows.some((r) => r.id === prepared.value.id)) return { ok: false, status: 409, error: '同じ ID のメッセージがあります。もう一度お試しください' };
  const reserved = prepared.value.keywords.find((k) => RESERVED_KEYWORDS.includes(k));
  if (reserved) return { ok: false, status: 400, error: `「${reserved}」はシステムが使う言葉のためキーワードにできません` };
  const conflict = findKeywordConflict(rows, prepared.value);
  if (conflict) return { ok: false, status: 400, error: conflict };
  return { ok: true, value: await insertLineFlexMessage(prepared.value) };
}

export async function saveLineFlexMessage(storeId: string, id: string, input: LineFlexMessageInput, origin: string): Promise<ServiceResult<LineFlexMessage>> {
  const existing = await getLineFlexMessage(storeId, id);
  if (!existing) return { ok: false, status: 404, error: 'メッセージが見つかりません' };
  const prepared = prepareLineFlexMessage(storeId, input, origin, existing);
  if (!prepared.ok) return prepared;
  const reserved = prepared.value.keywords.find((k) => RESERVED_KEYWORDS.includes(k));
  if (reserved) return { ok: false, status: 400, error: `「${reserved}」はシステムが使う言葉のためキーワードにできません` };
  const rows = await listLineFlexMessages(storeId);
  const conflict = findKeywordConflict(rows, prepared.value);
  if (conflict) return { ok: false, status: 400, error: conflict };
  return { ok: true, value: await updateLineFlexMessage(prepared.value) };
}

export async function removeLineFlexMessage(storeId: string, id: string): Promise<ServiceResult<true>> {
  const ok = await deleteLineFlexMessage(storeId, id);
  return ok ? { ok: true, value: true } : { ok: false, status: 404, error: 'メッセージが見つかりません' };
}

// ---------------------------------------------------------------------------
// Webhook / 差し込み
// ---------------------------------------------------------------------------

/** お客様の発言に一致するメッセージ（完全一致。見つかれば reply_count を増やす） */
export async function findLineFlexReplyForText(storeId: string, text: string): Promise<Record<string, unknown> | null> {
  try {
    const rows = await listEnabledLineFlexMessages(storeId);
    const hit = rows.find((r) => matchesKeyword(r.keywords, text));
    if (!hit || !hit.payload) return null;
    await incrementLineFlexReply([hit.id]);
    return hit.payload;
  } catch (e) {
    console.error('[line-flex] キーワード検索エラー:', e);
    return null;
  }
}

export type AttachKind = 'confirm' | 'reminder' | 'follow';

/** 自動メッセージに添える payload（最大 4 通。本体 1 通と合わせて LINE の上限 5 通に収める） */
export async function listLineFlexAttachments(storeId: string, kind: AttachKind): Promise<Record<string, unknown>[]> {
  try {
    const rows = await listEnabledLineFlexMessages(storeId);
    const picked = rows.filter((r) => (kind === 'confirm' ? r.attach_confirm : kind === 'reminder' ? r.attach_reminder : r.attach_follow)).slice(0, 4);
    if (picked.length > 0) await incrementLineFlexReply(picked.map((r) => r.id));
    return picked.map((r) => r.payload as Record<string, unknown>);
  } catch (e) {
    console.error('[line-flex] 差し込みの取得エラー:', e);
    return [];
  }
}
