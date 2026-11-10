/**
 * 配信機能の業務ロジック（サーバー専用）
 * 仕様: docs/LINE配信機能_仕様書.md
 *
 * - 保存: 入力の検証 → 送信用メッセージ（payloads）の組み立て（下書き）
 * - 見積り: 条件に合う人数・除外した人数・今月の通数
 * - 予約 / 今すぐ送る: 対象者を確定（broadcast_recipients）→ 上限ガード → status = scheduled
 *   実際の送信は Edge Function `send-broadcasts`（pg_cron 5 分おき。今すぐ送るときは API からも起こす）
 * - 取り消し（下書きに戻す）/ 複製 / テスト送信
 */
import type { AudienceCustomer, Broadcast, BroadcastAudience, BroadcastInput, BroadcastSettings, BroadcastSticker } from '@/types/broadcast';
import type { LineFlexMessage } from '@/types/line-flex';
import { buildCustomerFacts, isAudienceUnfiltered, jstDateOf, normalizeAudience, selectAudience, type AudienceSelection } from '@/lib/broadcast-audience';
import { BROADCAST_NAME_MAX, buildBroadcastPayloads, normalizeBroadcastItems, personalizePayloads, resolveRecipientName, validateBroadcastItems } from '@/lib/broadcast-items';
import { canSendBroadcast, evaluateQuota, type QuotaEvaluation } from '@/lib/broadcast-quota';
import {
  clearBroadcastRecipients,
  countMonthlySent,
  countOptedOutCustomers,
  deleteBroadcast,
  getBroadcast,
  getBroadcastSettings,
  getStoreLineToken,
  insertBroadcast,
  listBroadcastStickers,
  loadAudienceSource,
  newBroadcastId,
  replaceBroadcastRecipients,
  updateBroadcast,
  updateLineFriendStatus,
} from '@/lib/broadcast-repository';
import { verifyLineFriends } from '@/lib/line-friend-customers';
import { lineFlexSendMessages, listLineFlexMessages } from '@/lib/line-flex-repository';
import { pushLineMessages } from '@/lib/line-push';
import { getAppEnvironment } from '@/lib/env';

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };

/** 送信前の友だち確認に使える時間（これを過ぎたら残りは未確認のまま送る） */
const FRIEND_VERIFY_BUDGET_MS = 10 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isBroadcastId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

interface BuildContext {
  messages: LineFlexMessage[];
  stickers: BroadcastSticker[];
}

async function loadBuildContext(storeId: string): Promise<BuildContext> {
  const [messages, stickers] = await Promise.all([listLineFlexMessages(storeId), listBroadcastStickers(storeId)]);
  return { messages, stickers };
}

/** 並びから送信用メッセージを作る（保存時・予約時の両方で使う） */
function buildPayloads(items: Broadcast['items'], ctx: BuildContext, origin: string, broadcastId: string, trackTaps: boolean, requireContent: boolean) {
  const err = validateBroadcastItems(items, {
    messageIds: new Set(ctx.messages.map((m) => m.id)),
    stickerIds: new Set(ctx.stickers.map((s) => s.id)),
    requireContent,
  });
  if (err) return { payloads: [], links: {}, has_personalization: false, error: err };
  const refMessages: Record<string, Record<string, unknown>[]> = {};
  for (const m of ctx.messages) refMessages[m.id] = lineFlexSendMessages(m);
  const stickers: Record<string, { url: string; preview_url: string }> = {};
  for (const s of ctx.stickers) stickers[s.id] = { url: s.url, preview_url: s.preview_url };
  return buildBroadcastPayloads({ items, refMessages, stickers, origin, broadcastId, trackTaps });
}

/** 入力を検証して保存用の行（下書き）を組み立てる */
export function prepareBroadcast(storeId: string, input: BroadcastInput, origin: string, existing: Broadcast | null, ctx: BuildContext, createdBy: string | null = null): ServiceResult<Broadcast> {
  const name = (input.name ?? '').trim().slice(0, BROADCAST_NAME_MAX);
  if (!name) return { ok: false, status: 400, error: '配信の名前を入力してください' };
  const id = existing?.id ?? newBroadcastId();
  const audience = normalizeAudience(input.audience ?? existing?.audience ?? {});
  const items = normalizeBroadcastItems(input.items ?? existing?.items ?? []);
  const trackTaps = input.track_taps ?? existing?.track_taps ?? true;
  const built = buildPayloads(items, ctx, origin, id, trackTaps, false);
  if (built.error) return { ok: false, status: 400, error: built.error };
  const now = new Date().toISOString();
  return {
    ok: true,
    value: {
      id,
      store_id: storeId,
      name,
      status: 'draft',
      audience,
      items,
      payloads: built.payloads,
      has_personalization: built.has_personalization,
      track_taps: trackTaps,
      links: built.links,
      tap_counts: existing?.tap_counts ?? {},
      scheduled_at: null,
      claimed_at: null,
      started_at: null,
      finished_at: null,
      recipient_count: 0,
      sent_count: 0,
      failed_count: 0,
      error: null,
      automation_id: null,
      created_by: existing?.created_by ?? createdBy,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    },
  };
}

export async function createBroadcast(storeId: string, input: BroadcastInput, origin: string, createdBy: string | null): Promise<ServiceResult<Broadcast>> {
  const prepared = prepareBroadcast(storeId, input, origin, null, await loadBuildContext(storeId), createdBy);
  if (!prepared.ok) return prepared;
  return { ok: true, value: await insertBroadcast(prepared.value) };
}

/** 下書きだけ編集できる（予約済みは取り消して下書きに戻してから） */
export async function saveBroadcast(storeId: string, id: string, input: BroadcastInput, origin: string): Promise<ServiceResult<Broadcast>> {
  const existing = await getBroadcast(storeId, id);
  if (!existing) return { ok: false, status: 404, error: '配信が見つかりません' };
  if (existing.status !== 'draft') return { ok: false, status: 409, error: '下書きの配信だけ編集できます（予約済みの配信は取り消してから編集してください）' };
  const prepared = prepareBroadcast(storeId, input, origin, existing, await loadBuildContext(storeId));
  if (!prepared.ok) return prepared;
  const { id: _id, store_id: _s, created_at: _c, ...patch } = prepared.value;
  void _id; void _s; void _c;
  const saved = await updateBroadcast(storeId, id, patch);
  return saved ? { ok: true, value: saved } : { ok: false, status: 404, error: '配信が見つかりません' };
}

export async function removeBroadcast(storeId: string, id: string): Promise<ServiceResult<true>> {
  const existing = await getBroadcast(storeId, id);
  if (!existing) return { ok: false, status: 404, error: '配信が見つかりません' };
  if (existing.status === 'scheduled' || existing.status === 'sending') return { ok: false, status: 409, error: '予約済み・送信中の配信は削除できません（先に予約を取り消してください）' };
  await deleteBroadcast(storeId, id);
  return { ok: true, value: true };
}

export async function duplicateBroadcast(storeId: string, id: string, origin: string, createdBy: string | null): Promise<ServiceResult<Broadcast>> {
  const src = await getBroadcast(storeId, id);
  if (!src) return { ok: false, status: 404, error: '配信が見つかりません' };
  const name = `${src.name}（コピー）`.slice(0, BROADCAST_NAME_MAX);
  return createBroadcast(storeId, { name, audience: src.audience, items: src.items, track_taps: src.track_taps }, origin, createdBy);
}

// ---------------------------------------------------------------------------
// 配信先の見積り
// ---------------------------------------------------------------------------

async function selectRecipients(storeId: string, audience: BroadcastAudience, now: Date): Promise<AudienceSelection> {
  const src = await loadAudienceSource(storeId, {
    reservations: !!audience.menus || !!audience.forms || audience.upcoming_reservation !== undefined,
    visits: !!audience.menus,
    surveys: !!audience.survey,
  });
  const facts = buildCustomerFacts({ ...src, today: jstDateOf(now) });
  return selectAudience(src.customers, facts, audience, now);
}

export interface AudienceEstimate {
  count: number;
  excluded_opt_out: number;
  excluded_blocked: number;
  excluded_no_line: number;
  /** count のうち、友だちかどうか未確認の人数（送信時に LINE へ確認し、友だちでない人は外す） */
  unverified: number;
  /** 先頭 20 人（確認用） */
  sample: Array<{ id: string; name: string }>;
  quota: QuotaEvaluation;
  unfiltered: boolean;
}

function displayName(c: AudienceCustomer): string {
  return resolveRecipientName(c);
}

export async function estimateAudience(storeId: string, rawAudience: unknown, now: Date = new Date()): Promise<AudienceEstimate> {
  const audience = normalizeAudience(rawAudience);
  const [sel, settings, used] = await Promise.all([selectRecipients(storeId, audience, now), getBroadcastSettings(storeId), countMonthlySent(storeId, now)]);
  return {
    count: sel.recipients.length,
    excluded_opt_out: sel.excluded_opt_out,
    excluded_blocked: sel.excluded_blocked,
    excluded_no_line: sel.excluded_no_line,
    unverified: sel.unverified,
    sample: sel.recipients.slice(0, 20).map((c) => ({ id: c.id, name: displayName(c) })),
    quota: evaluateQuota({ limit: settings.monthly_limit, used, recipients: sel.recipients.length, over_limit: settings.over_limit }),
    unfiltered: isAudienceUnfiltered(audience) && !audience.customer_ids,
  };
}

/** 条件に合う人の一覧（ページング。「対象者を見る」用） */
export async function listAudience(storeId: string, rawAudience: unknown, offset = 0, limit = 50, now: Date = new Date()): Promise<{ total: number; customers: Array<{ id: string; name: string }> }> {
  const sel = await selectRecipients(storeId, normalizeAudience(rawAudience), now);
  const start = Math.max(0, offset);
  return { total: sel.recipients.length, customers: sel.recipients.slice(start, start + Math.min(Math.max(limit, 1), 200)).map((c) => ({ id: c.id, name: displayName(c) })) };
}

// ---------------------------------------------------------------------------
// 予約 / 今すぐ送る / 取り消し
// ---------------------------------------------------------------------------

export interface ScheduleOptions {
  /** 送信日時（ISO）。null / 未指定 = 今すぐ */
  scheduled_at?: string | null;
  /** 月間上限を超えることを確認済み */
  confirmed?: boolean;
  /** 100 人超の 2 段階確認済み */
  double_confirmed?: boolean;
}

export async function scheduleBroadcast(storeId: string, id: string, opts: ScheduleOptions, origin: string, now: Date = new Date()): Promise<ServiceResult<{ broadcast: Broadcast; immediate: boolean }>> {
  const existing = await getBroadcast(storeId, id);
  if (!existing) return { ok: false, status: 404, error: '配信が見つかりません' };
  if (existing.status !== 'draft') return { ok: false, status: 409, error: 'この配信はすでに予約済みか送信済みです' };

  let scheduledAt = now;
  let immediate = true;
  if (opts.scheduled_at) {
    const t = Date.parse(opts.scheduled_at);
    if (Number.isNaN(t)) return { ok: false, status: 400, error: '送信日時が正しくありません' };
    if (t < now.getTime() - 60 * 1000) return { ok: false, status: 400, error: '送信日時は現在より後にしてください' };
    if (t > now.getTime() + 90 * 24 * 60 * 60 * 1000) return { ok: false, status: 400, error: '送信日時は 90 日以内にしてください' };
    scheduledAt = new Date(Math.max(t, now.getTime()));
    immediate = t <= now.getTime() + 60 * 1000;
  }

  const token = await getStoreLineToken(storeId);
  if (!token) return { ok: false, status: 400, error: 'この店舗の LINE チャネルアクセストークンが未設定です（店舗編集で登録してください）' };

  // 送信用メッセージを作り直す（保存済み LINE メッセージ・スタンプが保存後に変わっていても最新で送る）
  const built = buildPayloads(existing.items, await loadBuildContext(storeId), origin, id, existing.track_taps, true);
  if (built.error) return { ok: false, status: 400, error: built.error };

  const [sel, settings, used] = await Promise.all([selectRecipients(storeId, existing.audience, now), getBroadcastSettings(storeId), countMonthlySent(storeId, now)]);
  if (sel.recipients.length === 0) return { ok: false, status: 400, error: '配信先が 0 人です。条件を見直してください' };

  // 友だちかどうか未確認の人を LINE に確認する（友だち → 記録を直す / 友だちでない → 記録して配信先から外す）。
  // 時間内に確認できなかった人はそのまま送る（友だちでなければ LINE 側で届かず、通数も消費しない）
  const unverified = sel.recipients.filter((c) => c.line_friend_flag !== true).map((c) => ({ id: c.id, line_user_id: c.line_user_id as string }));
  if (unverified.length > 0 && getAppEnvironment() !== 'local') {
    const verified = await verifyLineFriends(token, unverified, Date.now() + FRIEND_VERIFY_BUDGET_MS);
    await Promise.all([updateLineFriendStatus(storeId, verified.friends, true, now), updateLineFriendStatus(storeId, verified.notFriends, false, now)]);
    if (verified.notFriends.length > 0) {
      const drop = new Set(verified.notFriends);
      sel.recipients = sel.recipients.filter((c) => !drop.has(c.id));
      if (sel.recipients.length === 0) return { ok: false, status: 400, error: '配信先のお客様は、公式 LINE の友だちではありませんでした（友だち追加していないか、ブロックされています）' };
    }
  }

  const quota = evaluateQuota({ limit: settings.monthly_limit, used, recipients: sel.recipients.length, over_limit: settings.over_limit });
  const allowed = canSendBroadcast(quota, { confirmed: opts.confirmed, double_confirmed: opts.double_confirmed });
  if (!allowed.ok) return { ok: false, status: 409, error: allowed.error, code: allowed.code };

  await replaceBroadcastRecipients(storeId, id, sel.recipients.map((c) => ({ customer_id: c.id, line_user_id: c.line_user_id as string, display_name: displayName(c) })));
  const saved = await updateBroadcast(storeId, id, {
    status: 'scheduled',
    scheduled_at: scheduledAt.toISOString(),
    payloads: built.payloads,
    links: built.links,
    has_personalization: built.has_personalization,
    recipient_count: sel.recipients.length,
    sent_count: 0,
    failed_count: 0,
    error: null,
    claimed_at: null,
    started_at: null,
    finished_at: null,
  });
  if (!saved) return { ok: false, status: 404, error: '配信が見つかりません' };
  if (immediate) await triggerBroadcastSender();
  return { ok: true, value: { broadcast: saved, immediate } };
}

/** 予約を取り消して下書きに戻す（送信が始まる前だけ） */
export async function cancelBroadcast(storeId: string, id: string): Promise<ServiceResult<Broadcast>> {
  const existing = await getBroadcast(storeId, id);
  if (!existing) return { ok: false, status: 404, error: '配信が見つかりません' };
  if (existing.status !== 'scheduled') return { ok: false, status: 409, error: existing.status === 'sending' ? '送信が始まっているため取り消せません' : '予約済みの配信だけ取り消せます' };
  const saved = await updateBroadcast(storeId, id, { status: 'draft', scheduled_at: null, recipient_count: 0, claimed_at: null });
  await clearBroadcastRecipients(id);
  return saved ? { ok: true, value: saved } : { ok: false, status: 404, error: '配信が見つかりません' };
}

/**
 * 送信用 Edge Function を起こす（今すぐ送るとき。5 分おきの cron を待たずに始める）。
 * 失敗しても cron が拾うので、結果は見ない。local では何もしない
 */
export async function triggerBroadcastSender(): Promise<void> {
  if (getAppEnvironment() === 'local') return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(`${url.replace(/\/$/, '')}/functions/v1/send-broadcasts`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
  } catch {
    /* 起動だけできればよい（タイムアウトしても Edge Function 側は動き続ける） */
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// テスト送信・概要
// ---------------------------------------------------------------------------

/** 指定した LINE ユーザー 1 人へ、いまの内容を送る（push。無料通数を 1 通使う。配信の通数には数えない） */
export async function testSendBroadcast(storeId: string, id: string, lineUserId: string, name: string | null, origin: string): Promise<ServiceResult<true>> {
  if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) return { ok: false, status: 400, error: '送信先の LINE ユーザー ID が正しくありません（LINE 連携済みの顧客を選んでください）' };
  const b = await getBroadcast(storeId, id);
  if (!b) return { ok: false, status: 404, error: '配信が見つかりません' };
  const built = buildPayloads(b.items, await loadBuildContext(storeId), origin, id, b.track_taps, true);
  if (built.error) return { ok: false, status: 400, error: built.error };
  const token = await getStoreLineToken(storeId);
  if (!token) return { ok: false, status: 400, error: 'この店舗の LINE チャネルアクセストークンが未設定です（店舗編集で登録してください）' };
  const messages = personalizePayloads(built.payloads, { name: resolveRecipientName({ name }) });
  const result = await pushLineMessages(token, lineUserId, messages);
  if (!result.ok) return { ok: false, status: 502, error: `LINE への送信に失敗しました（${result.status}）: ${result.body.slice(0, 200)}` };
  return { ok: true, value: true };
}

export interface BroadcastOverview {
  settings: BroadcastSettings;
  /** 今月（JST）配信機能で送った通数 */
  used: number;
  opt_out_count: number;
  token_set: boolean;
}

export async function getBroadcastOverview(storeId: string, now: Date = new Date()): Promise<BroadcastOverview> {
  const [settings, used, optOut, token] = await Promise.all([getBroadcastSettings(storeId), countMonthlySent(storeId, now), countOptedOutCustomers(storeId), getStoreLineToken(storeId)]);
  return { settings, used, opt_out_count: optOut, token_set: !!token };
}
