/**
 * 公式 LINE Flex Message の業務ロジック（サーバー専用）
 * - 入力の検証 → 送信用 payload（計測リンク入り）の生成 → 保存
 * - Webhook / 差し込み用の取り出し
 */
import { randomBytes } from 'crypto';
import type { LineFlexBranch, LineFlexMessage, LineFlexMessageInput, LineFlexTemplate, ScenarioData } from '@/types/line-flex';
import { instrumentFlexBranches, parsePostbackData } from '@/lib/line-flex-branch';
import { buildScenarioNodeFlex, collectScenarioChoices, listScenarioNodes, validateScenario } from '@/lib/line-flex-scenario';
import { recordLineFlexAnswer } from '@/lib/line-flex-answers';
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
  lineFlexSendMessages,
  listEnabledLineFlexMessages,
  listLineFlexMessages,
  updateLineFlexMessage,
} from '@/lib/line-flex-repository';
import { buildLineFlexPayloads, lineFlexItemsReference, LINE_FLEX_ATTACH_MAX, normalizeLineFlexItems, validateLineFlexItems } from '@/lib/line-flex-items';
import { getBroadcastSettings } from '@/lib/broadcast-repository';
import { DEFAULT_OPT_IN_KEYWORD, DEFAULT_OPT_OUT_KEYWORD } from '@/lib/broadcast-quota';

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

/** 追加メッセージ（ref）の参照先 ID → Flex 本体の payload */
export type RefPayloads = Record<string, Record<string, unknown> | null | undefined>;

/**
 * 入力を検証して保存用の行を組み立てる（既存行があれば統計などを引き継ぐ）
 * `refs` = 同じ店舗の他のメッセージ（ref の参照先の存在確認と payload の展開に使う。省略時は ref の存在を検証しない）
 */
export function prepareLineFlexMessage(
  storeId: string,
  input: LineFlexMessageInput,
  origin: string,
  existing: LineFlexMessage | null,
  refs?: LineFlexMessage[]
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

  const existingIds = refs ? new Set(refs.map((r) => r.id)) : undefined;
  const scenario = input.template === 'scenario' ? (data as ScenarioData) : null;
  if (scenario) {
    const scenarioError = validateScenario(scenario, existingIds);
    if (scenarioError) return { ok: false, status: 400, error: scenarioError };
  }

  const rawContents = resolveFlexContents({ template: input.template, data, flex_override: flexOverride });
  const contentsError = validateFlexContents(rawContents);
  if (contentsError || !rawContents) return { ok: false, status: 400, error: contentsError ?? 'Flex の内容が空です' };

  // 分岐ボタン（`next:` / `choice:`）を postback に置き換え、対応表を作る
  const showChoiceText = input.show_choice_text !== false;
  const choices = scenario ? collectScenarioChoices(scenario) : undefined;
  const branched = instrumentFlexBranches(rawContents, id, { showText: showChoiceText, choices });
  const contents = branched.contents;
  const branches: Record<string, LineFlexBranch> = { ...branched.branches };

  const trackTaps = input.track_taps !== false;
  const instrumented = trackTaps ? instrumentFlexLinks(contents, origin, id) : { contents, links: {} as Record<string, string> };
  const payload = buildLinePayload(altText, instrumented.contents);
  const bytes = payloadBytes(payload);
  if (bytes > LINE_FLEX_MAX_JSON_BYTES) {
    return { ok: false, status: 400, error: `メッセージが大きすぎます（${Math.round(bytes / 1024)}KB。LINE の上限は 30KB）。カードや文章を減らしてください` };
  }

  // 追加のメッセージ（テキスト / 画像 / 動画 / Flex JSON / 保存済み）を並べて送信用の配列にする
  const items = normalizeLineFlexItems(input.items ?? existing?.items ?? []);
  const refRows = refs?.filter((r) => r.id !== id);
  const itemsError = validateLineFlexItems(items, { selfId: id, existingIds: refRows ? new Set(refRows.map((r) => r.id)) : undefined });
  if (itemsError) return { ok: false, status: 400, error: itemsError };
  const refPayloads: RefPayloads = {};
  for (const r of refRows ?? []) refPayloads[r.id] = r.payload;
  const built = buildLineFlexPayloads({ items, mainPayload: payload, mainLinks: instrumented.links, origin, messageId: id, trackTaps, refPayloads });
  if (built.error) return { ok: false, status: 400, error: built.error };

  // 分岐アンケートの 2 問目以降・結果のカードを、送信用メッセージとして作っておく（ボタンが押されたら Webhook が返す）
  const links: Record<string, string> = { ...built.links };
  const branchPayloads: Record<string, Record<string, unknown>> = {};
  if (scenario) {
    let branchIndex = branched.nextIndex;
    let linkKey = Object.keys(links).reduce((max, k) => Math.max(max, Number(k) || 0), 0);
    for (const node of listScenarioNodes(scenario).slice(1)) {
      const nodeContents = buildScenarioNodeFlex(scenario, node.key);
      if (!nodeContents) continue;
      const nb = instrumentFlexBranches(nodeContents, id, { showText: showChoiceText, choices, startIndex: branchIndex });
      branchIndex = nb.nextIndex;
      Object.assign(branches, nb.branches);
      const nl = trackTaps ? instrumentFlexLinks(nb.contents, origin, id, linkKey) : { contents: nb.contents, links: {} as Record<string, string> };
      Object.assign(links, nl.links);
      linkKey += Object.keys(nl.links).length;
      const title = node.kind === 'question' ? node.question.title : node.result.title || node.result.text || '';
      const nodePayload = buildLinePayload(title.trim() || altText, nl.contents);
      if (payloadBytes(nodePayload) > LINE_FLEX_MAX_JSON_BYTES) return { ok: false, status: 400, error: `「${title.trim() || '質問・結果'}」のカードが大きすぎます（LINE の上限は 30KB）。文章を減らしてください` };
      branchPayloads[node.key] = nodePayload;
    }
    // 選択肢の対応は、カードに出ていないもの（自由編集でボタンを消したなど）も含めておく
    for (const [key, def] of Object.entries(choices ?? {})) if (!branches[key]) branches[key] = def;
  }
  // 「次のメッセージ」の参照先が同じ店舗にあるか
  if (existingIds) {
    for (const b of Object.values(branches)) {
      if (b.next.type === 'message' && !existingIds.has(b.next.id)) return { ok: false, status: 400, error: `ボタン「${b.label || '（文言なし）'}」の次に送る LINE メッセージが見つかりません。選び直してください` };
    }
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
      items,
      payload,
      payloads: built.payloads,
      links,
      reply_count: existing?.reply_count ?? 0,
      tap_counts: existing?.tap_counts ?? {},
      branches,
      branch_payloads: branchPayloads,
      show_choice_text: showChoiceText,
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

/** 予約語 + その店舗の配信停止 / 再開キーワード（Webhook が先に処理するため、自動応答には使えない） */
async function reservedKeywordsFor(storeId: string): Promise<string[]> {
  try {
    const s = await getBroadcastSettings(storeId);
    return [...RESERVED_KEYWORDS, s.opt_out_keyword, s.opt_in_keyword];
  } catch {
    // 配信機能の列が未適用の環境でも LINE メッセージの保存は止めない
    return [...RESERVED_KEYWORDS, DEFAULT_OPT_OUT_KEYWORD, DEFAULT_OPT_IN_KEYWORD];
  }
}

/**
 * 参照先（ref）が変わった・消えたとき、それを含む同じ店舗のメッセージの payloads を作り直す
 * （payloads は展開済みなので、参照先の更新を送信内容に反映させるため）
 */
async function rebuildDependents(storeId: string, changedId: string, origin: string, rows: LineFlexMessage[]): Promise<void> {
  for (const row of rows) {
    if (row.id === changedId || !lineFlexItemsReference(row.items, changedId)) continue;
    const items = row.items.filter((x) => x.type !== 'ref' || rows.some((r) => r.id === x.message_id));
    const prepared = prepareLineFlexMessage(storeId, { ...row, items }, origin, row, rows);
    if (!prepared.ok) {
      console.warn('[line-flex] 参照元の作り直しに失敗:', row.id, prepared.error);
      continue;
    }
    try {
      await updateLineFlexMessage(prepared.value);
    } catch (e) {
      console.warn('[line-flex] 参照元の更新に失敗:', row.id, e);
    }
  }
}

export async function createLineFlexMessage(storeId: string, input: LineFlexMessageInput, origin: string): Promise<ServiceResult<LineFlexMessage>> {
  const rows = await listLineFlexMessages(storeId);
  const prepared = prepareLineFlexMessage(storeId, input, origin, null, rows);
  if (!prepared.ok) return prepared;
  if (rows.some((r) => r.id === prepared.value.id)) return { ok: false, status: 409, error: '同じ ID のメッセージがあります。もう一度お試しください' };
  const reservedList = await reservedKeywordsFor(storeId);
  const reserved = prepared.value.keywords.find((k) => reservedList.includes(k));
  if (reserved) return { ok: false, status: 400, error: `「${reserved}」はシステムが使う言葉のためキーワードにできません` };
  const conflict = findKeywordConflict(rows, prepared.value);
  if (conflict) return { ok: false, status: 400, error: conflict };
  return { ok: true, value: await insertLineFlexMessage(prepared.value) };
}

export async function saveLineFlexMessage(storeId: string, id: string, input: LineFlexMessageInput, origin: string): Promise<ServiceResult<LineFlexMessage>> {
  const existing = await getLineFlexMessage(storeId, id);
  if (!existing) return { ok: false, status: 404, error: 'メッセージが見つかりません' };
  const rows = await listLineFlexMessages(storeId);
  const prepared = prepareLineFlexMessage(storeId, input, origin, existing, rows);
  if (!prepared.ok) return prepared;
  const reservedList = await reservedKeywordsFor(storeId);
  const reserved = prepared.value.keywords.find((k) => reservedList.includes(k));
  if (reserved) return { ok: false, status: 400, error: `「${reserved}」はシステムが使う言葉のためキーワードにできません` };
  const conflict = findKeywordConflict(rows, prepared.value);
  if (conflict) return { ok: false, status: 400, error: conflict };
  const saved = await updateLineFlexMessage(prepared.value);
  // このメッセージを「保存済みの LINE メッセージ」として含んでいる他のメッセージの送信内容を更新
  await rebuildDependents(storeId, saved.id, origin, rows.map((r) => (r.id === saved.id ? saved : r)));
  return { ok: true, value: saved };
}

export async function removeLineFlexMessage(storeId: string, id: string, origin?: string): Promise<ServiceResult<true>> {
  const rows = await listLineFlexMessages(storeId);
  const ok = await deleteLineFlexMessage(storeId, id);
  if (!ok) return { ok: false, status: 404, error: 'メッセージが見つかりません' };
  // 参照していたメッセージからは外す（送信内容からも消す）
  if (origin) await rebuildDependents(storeId, id, origin, rows.filter((r) => r.id !== id));
  return { ok: true, value: true };
}

// ---------------------------------------------------------------------------
// Webhook / 差し込み
// ---------------------------------------------------------------------------

/** お客様の発言に一致するメッセージ（完全一致。見つかれば reply_count を増やす）。追加メッセージを含めた送信用の配列（最大 5 通）を返す */
export async function findLineFlexReplyForText(storeId: string, text: string): Promise<Record<string, unknown>[] | null> {
  try {
    const rows = await listEnabledLineFlexMessages(storeId);
    const hit = rows.find((r) => matchesKeyword(r.keywords, text));
    if (!hit) return null;
    const messages = lineFlexSendMessages(hit);
    if (messages.length === 0) return null;
    await incrementLineFlexReply([hit.id]);
    return messages;
  } catch (e) {
    console.error('[line-flex] キーワード検索エラー:', e);
    return null;
  }
}

/**
 * 分岐ボタンが押された（postback）。回答を記録し、タグを付け、次に返すメッセージ（最大 5 通）を返す。
 * 対象外の data・無効なメッセージ・次が無いときは null（何も返さない）
 */
export async function handleLineFlexPostback(storeId: string, lineUserId: string, data: string): Promise<Record<string, unknown>[] | null> {
  const parsed = parsePostbackData(data);
  if (!parsed) return null;
  try {
    const message = await getLineFlexMessage(storeId, parsed.messageId);
    if (!message || !message.enabled) return null;
    const branch = message.branches?.[parsed.key];
    if (!branch) return null;
    // 記録・タグ付けに失敗しても、次のメッセージは返す
    await recordLineFlexAnswer({ storeId, messageId: message.id, key: parsed.key, branch, lineUserId });
    if (branch.next.type === 'node') {
      const payload = message.branch_payloads?.[branch.next.key];
      return payload ? [payload] : null;
    }
    if (branch.next.type === 'message') {
      const target = await getLineFlexMessage(storeId, branch.next.id);
      if (!target || !target.enabled) return null;
      const messages = lineFlexSendMessages(target);
      if (messages.length === 0) return null;
      await incrementLineFlexReply([target.id]);
      return messages;
    }
    return null;
  } catch (e) {
    console.error('[line-flex] 分岐ボタンの処理エラー:', e);
    return null;
  }
}

export type AttachKind = 'confirm' | 'reminder' | 'follow';

/** 自動メッセージに添える送信用メッセージ（追加メッセージを含めて最大 4 通。本体 1 通と合わせて LINE の上限 5 通に収める） */
export async function listLineFlexAttachments(storeId: string, kind: AttachKind): Promise<Record<string, unknown>[]> {
  try {
    const rows = await listEnabledLineFlexMessages(storeId);
    const picked = rows.filter((r) => (kind === 'confirm' ? r.attach_confirm : kind === 'reminder' ? r.attach_reminder : r.attach_follow));
    const out: Record<string, unknown>[] = [];
    const usedIds: string[] = [];
    for (const r of picked) {
      if (out.length >= LINE_FLEX_ATTACH_MAX) break;
      const msgs = lineFlexSendMessages(r);
      if (msgs.length === 0) continue;
      usedIds.push(r.id);
      out.push(...msgs.slice(0, LINE_FLEX_ATTACH_MAX - out.length));
    }
    if (usedIds.length > 0) await incrementLineFlexReply(usedIds);
    return out;
  } catch (e) {
    console.error('[line-flex] 差し込みの取得エラー:', e);
    return [];
  }
}
