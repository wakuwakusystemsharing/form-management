/**
 * 自動配信（ステップ配信）と配信設定の業務ロジック（サーバー専用）
 * 仕様: docs/LINE配信機能_仕様書.md §3-4 / §3-6 / §7-2
 *
 * - ルールの保存: きっかけ・追加の絞り込み・メッセージを検証（ON にするときはメッセージ必須）
 * - 実行（runDueAutomations）: pg_cron が毎時 `POST /api/cron/broadcast-automations` を呼ぶ。
 *   店舗の実行時刻（JST）を過ぎていて、今日まだ判定していないルールだけを処理する。
 *   該当者がいれば、その日の配信（broadcasts.automation_id 付き）を作って宛先を確定し、送信は Edge Function `send-broadcasts` に任せる
 * - 設定: 月間上限・超過時の扱い・配信停止 / 再開キーワード・自動配信の実行時刻、LINE の今月の通数
 */
import { randomUUID } from 'crypto';
import type { Broadcast, BroadcastAutomation, BroadcastAutomationInput, BroadcastSettings, BroadcastSticker, LineQuotaInfo } from '@/types/broadcast';
import type { LineFlexMessage } from '@/types/line-flex';
import { buildCustomerFacts, jstDateOf, normalizeAudience } from '@/lib/broadcast-audience';
import { describeAutomationTrigger, isAutomationTimeReached, normalizeAutomationTrigger, normalizeResendAfterDays, pickAutomationTargets, type AutomationTarget } from '@/lib/broadcast-automation';
import { BROADCAST_NAME_MAX, buildBroadcastPayloads, normalizeBroadcastItems, resolveRecipientName, validateBroadcastItems } from '@/lib/broadcast-items';
import { evaluateQuota, normalizeBroadcastSettings } from '@/lib/broadcast-quota';
import {
  claimAutomationRun,
  countMonthlySent,
  deleteBroadcastAutomation,
  getBroadcastAutomation,
  getBroadcastSettings,
  getStoreLineToken,
  insertAutomationSends,
  insertBroadcast,
  listAutomationSends,
  listBroadcastStickers,
  listEnabledAutomationsAllStores,
  loadAudienceSource,
  newBroadcastId,
  replaceBroadcastRecipients,
  updateBroadcast,
  updateBroadcastSettings,
  upsertBroadcastAutomation,
} from '@/lib/broadcast-repository';
import { lineFlexSendMessages, listLineFlexMessages } from '@/lib/line-flex-repository';
import { triggerBroadcastSender, type ServiceResult } from '@/lib/broadcast-service';
import { after } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import {
  CANCEL_OPENING_SKIP_LABELS,
  buildCancelOpeningFlex,
  checkCancelOpeningRule,
  formatOpeningSlot,
  pickCancelOpeningTargets,
  type CancelOpeningTrigger,
  type CancelSource,
} from '@/lib/broadcast-cancel-opening';
import { isWaitlistActive } from '@/lib/waitlist';
import { listActiveWaitlist } from '@/lib/waitlist-repository';
import { evaluateWaitlistSlot, loadWaitlistFormConfig, loadWaitlistStore } from '@/lib/waitlist-service';
import { reservationDurationMinutes } from '@/lib/reservation-change';
import { listBroadcastAutomations, listBroadcasts } from '@/lib/broadcast-repository';
import { isEventTrigger } from '@/lib/broadcast-automation';
import { BROADCAST_ITEMS_MAX } from '@/lib/broadcast-items';

interface BuildContext {
  messages: LineFlexMessage[];
  stickers: BroadcastSticker[];
}

async function loadBuildContext(storeId: string): Promise<BuildContext> {
  const [messages, stickers] = await Promise.all([listLineFlexMessages(storeId), listBroadcastStickers(storeId)]);
  return { messages, stickers };
}

function buildPayloads(items: BroadcastAutomation['items'], ctx: BuildContext, origin: string, broadcastId: string, requireContent: boolean) {
  const err = validateBroadcastItems(items, { messageIds: new Set(ctx.messages.map((m) => m.id)), stickerIds: new Set(ctx.stickers.map((s) => s.id)), requireContent });
  if (err) return { payloads: [], links: {}, has_personalization: false, error: err };
  const refMessages: Record<string, Record<string, unknown>[]> = {};
  for (const m of ctx.messages) refMessages[m.id] = lineFlexSendMessages(m);
  const stickers: Record<string, { url: string; preview_url: string }> = {};
  for (const s of ctx.stickers) stickers[s.id] = { url: s.url, preview_url: s.preview_url };
  return buildBroadcastPayloads({ items, refMessages, stickers, origin, broadcastId, trackTaps: true });
}

// ---------------------------------------------------------------------------
// ルールの保存
// ---------------------------------------------------------------------------

export function prepareAutomation(storeId: string, input: BroadcastAutomationInput, origin: string, existing: BroadcastAutomation | null, ctx: BuildContext): ServiceResult<BroadcastAutomation> {
  const name = (input.name ?? '').trim().slice(0, BROADCAST_NAME_MAX);
  if (!name) return { ok: false, status: 400, error: '自動配信の名前を入力してください' };
  const trigger = normalizeAutomationTrigger(input.trigger);
  if (!trigger) return { ok: false, status: 400, error: input.trigger && (input.trigger as { type?: string }).type === 'tag_added' ? 'タグを 1 つ以上選んでください' : 'きっかけの設定が正しくありません' };
  const enabled = input.enabled === true;
  const items = normalizeBroadcastItems(input.items ?? existing?.items ?? []);
  const id = existing?.id ?? randomUUID();
  // 送信用メッセージは実行のたびに作る（計測リンクがその日の配信 ID を使うため）。ここでは検証だけ
  const isCancelOpening = trigger.type === 'reservation_cancelled';
  if (isCancelOpening && items.length > BROADCAST_ITEMS_MAX - 1) {
    return { ok: false, status: 400, error: `追加のメッセージは ${BROADCAST_ITEMS_MAX - 1} 通までです（「空きが出ました」のカードと合わせて ${BROADCAST_ITEMS_MAX} 通）` };
  }
  const built = buildPayloads(items, ctx, origin, id, enabled && !isCancelOpening);
  if (built.error) return { ok: false, status: 400, error: enabled && items.length === 0 ? 'ON にするには、送るメッセージを 1 つ以上追加してください' : built.error };
  const now = new Date().toISOString();
  return {
    ok: true,
    value: {
      id,
      store_id: storeId,
      name,
      enabled,
      trigger,
      audience: normalizeAudience(input.audience ?? existing?.audience ?? {}),
      items,
      payloads: null,
      has_personalization: built.has_personalization,
      resend_after_days: normalizeResendAfterDays(input.resend_after_days),
      last_run_date: existing?.last_run_date ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    },
  };
}

export async function saveAutomation(storeId: string, id: string | null, input: BroadcastAutomationInput, origin: string): Promise<ServiceResult<BroadcastAutomation>> {
  const existing = id ? await getBroadcastAutomation(storeId, id) : null;
  if (id && !existing) return { ok: false, status: 404, error: '自動配信が見つかりません' };
  const prepared = prepareAutomation(storeId, input, origin, existing, await loadBuildContext(storeId));
  if (!prepared.ok) return prepared;
  return { ok: true, value: await upsertBroadcastAutomation(prepared.value) };
}

export async function removeAutomation(storeId: string, id: string): Promise<ServiceResult<true>> {
  const ok = await deleteBroadcastAutomation(storeId, id);
  return ok ? { ok: true, value: true } : { ok: false, status: 404, error: '自動配信が見つかりません' };
}

// ---------------------------------------------------------------------------
// 対象者
// ---------------------------------------------------------------------------

async function selectTargets(rule: Pick<BroadcastAutomation, 'id' | 'store_id' | 'trigger' | 'audience' | 'resend_after_days'>, now: Date, withSends: boolean): Promise<AutomationTarget[]> {
  const a = rule.audience;
  const [src, sends] = await Promise.all([
    loadAudienceSource(rule.store_id, { reservations: !!a.menus || !!a.forms || a.upcoming_reservation !== undefined, visits: !!a.menus, surveys: !!a.survey }),
    withSends ? listAutomationSends(rule.id) : Promise.resolve([]),
  ]);
  const facts = buildCustomerFacts({ ...src, today: jstDateOf(now) });
  return pickAutomationTargets({ trigger: rule.trigger, audience: a, resend_after_days: rule.resend_after_days, customers: src.customers, facts, sends, now });
}

/** いま ON にしたら、次の実行で何人に送られるか（編集画面の見積り。保存前の内容でも計算できる） */
export async function previewAutomation(storeId: string, id: string | null, input: Pick<BroadcastAutomationInput, 'trigger' | 'audience' | 'resend_after_days'>, now: Date = new Date()): Promise<ServiceResult<{ count: number; sample: string[]; trigger: string }>> {
  const trigger = normalizeAutomationTrigger(input.trigger);
  if (!trigger) return { ok: true, value: { count: 0, sample: [], trigger: '' } };
  if (trigger.type === 'reservation_cancelled') {
    const audience = normalizeAudience(input.audience ?? {});
    const src = await loadAudienceSource(storeId, { reservations: !!audience.menus || !!audience.forms || audience.upcoming_reservation !== undefined, visits: !!audience.menus, surveys: !!audience.survey });
    const facts = buildCustomerFacts({ ...src, today: jstDateOf(now) });
    const list = pickCancelOpeningTargets({ customers: src.customers, facts, audience, excludeLineUserId: null, marker: 'preview', resend_after_days: null, sends: [], now });
    return { ok: true, value: { count: list.length, sample: list.slice(0, 8).map((c) => resolveRecipientName(c)), trigger: describeAutomationTrigger(trigger) } };
  }
  const targets = await selectTargets({ id: id ?? '', store_id: storeId, trigger, audience: normalizeAudience(input.audience ?? {}), resend_after_days: normalizeResendAfterDays(input.resend_after_days) }, now, !!id);
  return { ok: true, value: { count: targets.length, sample: targets.slice(0, 8).map((t) => resolveRecipientName(t.customer)), trigger: describeAutomationTrigger(trigger) } };
}

// ---------------------------------------------------------------------------
// 実行（cron）
// ---------------------------------------------------------------------------

export interface AutomationRunSummary {
  /** 判定したルール数 */
  checked: number;
  /** 配信を作ったルール数と人数 */
  created: number;
  recipients: number;
  /** 見送ったルール（理由つき） */
  skipped: Array<{ automation_id: string; reason: string }>;
  /** 時間切れで次の回に回したルール数 */
  deferred: number;
}

function automationBroadcast(rule: BroadcastAutomation, id: string, now: Date): Broadcast {
  const iso = now.toISOString();
  return {
    id,
    store_id: rule.store_id,
    name: `【自動】${rule.name}`.slice(0, BROADCAST_NAME_MAX),
    status: 'draft',
    audience: rule.audience,
    items: rule.items,
    payloads: null,
    has_personalization: false,
    track_taps: true,
    links: {},
    tap_counts: {},
    scheduled_at: null,
    claimed_at: null,
    started_at: null,
    finished_at: null,
    recipient_count: 0,
    sent_count: 0,
    failed_count: 0,
    error: null,
    automation_id: rule.id,
    created_by: null,
    created_at: iso,
    updated_at: iso,
  };
}

/**
 * 実行時刻を過ぎた ON のルールを 1 日 1 回ずつ処理する。
 * `deadline`（ms）を過ぎたら残りは次の回（1 時間後）に回す。ルールは last_run_date で確保するので二重に実行しない。
 * `opts.storeId` = その店舗のルールだけ / `opts.ignoreTime` = 実行時刻を待たない（管理画面の「今日の判定を今すぐ実行」。1 日 1 回の制限はそのまま）
 */
export async function runDueAutomations(now: Date, origin: string, deadline: number, opts: { storeId?: string; ignoreTime?: boolean } = {}): Promise<AutomationRunSummary> {
  const summary: AutomationRunSummary = { checked: 0, created: 0, recipients: 0, skipped: [], deferred: 0 };
  const today = jstDateOf(now);
  // 「予約フォームでキャンセルが出た時」はキャンセルのその場で動くので、ここ（1 日 1 回の判定）では扱わない
  const rules = (await listEnabledAutomationsAllStores()).filter((r) => !isEventTrigger(r.trigger) && (!opts.storeId || r.store_id === opts.storeId) && (!r.last_run_date || r.last_run_date < today));
  const settingsCache = new Map<string, BroadcastSettings>();
  let anyCreated = false;

  for (const rule of rules) {
    if (Date.now() >= deadline) {
      summary.deferred += 1;
      continue;
    }
    try {
      let settings = settingsCache.get(rule.store_id);
      if (!settings) {
        settings = await getBroadcastSettings(rule.store_id);
        settingsCache.set(rule.store_id, settings);
      }
      if (!opts.ignoreTime && !isAutomationTimeReached(settings.automation_time, now)) continue;
      // 今日の実行を確保（他の実行と重ならない）。以降で失敗しても今日はもう実行しない（二重送信を避ける方を優先）
      if (!(await claimAutomationRun(rule.id, today))) continue;
      summary.checked += 1;

      if (!(await getStoreLineToken(rule.store_id))) {
        summary.skipped.push({ automation_id: rule.id, reason: 'LINE チャネルアクセストークンが未設定' });
        continue;
      }
      const targets = await selectTargets(rule, now, true);
      if (targets.length === 0) continue;

      const broadcastId = newBroadcastId();
      const built = buildPayloads(rule.items, await loadBuildContext(rule.store_id), origin, broadcastId, true);
      const base = automationBroadcast(rule, broadcastId, now);
      if (built.error) {
        await insertBroadcast({ ...base, status: 'cancelled', recipient_count: targets.length, error: `自動配信を見送りました: ${built.error}` });
        summary.skipped.push({ automation_id: rule.id, reason: built.error });
        continue;
      }
      const used = await countMonthlySent(rule.store_id, now);
      const quota = evaluateQuota({ limit: settings.monthly_limit, used, recipients: targets.length, over_limit: settings.over_limit });
      if (quota.exceeds) {
        // 上限を超える自動配信は送らない（確認する人がいないため）。送信記録を残さないので、上限に余裕ができた日に送られる
        await insertBroadcast({ ...base, status: 'cancelled', recipient_count: targets.length, error: `今月の配信上限（${quota.limit} 通）を超えるため見送りました（対象 ${targets.length} 人）` });
        summary.skipped.push({ automation_id: rule.id, reason: '月間上限' });
        continue;
      }

      // 下書きで作る → 宛先 → 送信記録 → 予約済み（この順なら、途中で止まっても二重には送られない）
      await insertBroadcast({ ...base, payloads: built.payloads, links: built.links, has_personalization: built.has_personalization, recipient_count: targets.length });
      await replaceBroadcastRecipients(rule.store_id, broadcastId, targets.map((t) => ({ customer_id: t.customer.id, line_user_id: t.customer.line_user_id as string, display_name: resolveRecipientName(t.customer) })));
      await insertAutomationSends(rule.id, targets.map((t) => ({ customer_id: t.customer.id, marker: t.marker })), now);
      await updateBroadcast(rule.store_id, broadcastId, { status: 'scheduled', scheduled_at: now.toISOString() });
      summary.created += 1;
      summary.recipients += targets.length;
      anyCreated = true;
    } catch (e) {
      console.error(`[broadcast-automation] ルール ${rule.id} の実行エラー:`, e);
      summary.skipped.push({ automation_id: rule.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (anyCreated) await triggerBroadcastSender();
  return summary;
}

// ---------------------------------------------------------------------------
// 予約フォームでキャンセルが出た時（キャンセルのその場で動く）
// ---------------------------------------------------------------------------

/** キャンセルされた予約（判定に使う列だけ） */
export interface CancelledReservation {
  id: string;
  store_id?: string | null;
  form_id?: string | null;
  line_user_id?: string | null;
  reservation_date: string;
  reservation_time?: string | null;
  checkout_date?: string | null;
  staff_id?: string | null;
  staff_calendar_id?: string | null;
  staff_no_preference?: boolean | null;
  selected_menus?: unknown;
  selected_options?: unknown;
  customer_info?: unknown;
}

export interface CancelOpeningRunSummary {
  /** 配信を作ったルール数と人数 */
  created: number;
  recipients: number;
  /** 送らなかったルール（理由つき） */
  skipped: Array<{ automation_id: string; reason: string }>;
}

/** キャンセル直後に空きを確認するまでの待ち時間（カレンダーの予定が消え、すぐの取り直しが落ち着くのを待つ） */
export const CANCEL_OPENING_DELAY_MS = 10 * 1000;

const jstDayRange = (now: Date) => {
  const j = new Date(now.getTime() + 9 * 3600000);
  const start = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - 9 * 3600000;
  return { start, end: start + 86400000 };
};

/**
 * 予約がキャンセルされたとき、ON の「予約フォームでキャンセルが出た時」ルールごとに、
 * キャンセルした本人以外へ「空きが出ました」の配信を作って送信を始める。
 * 送らない場合: 対象外のキャンセル元・直前・夜間・1 日の上限・空き待ちの人がいる枠（そちらを優先）・
 * 実際には空いていない（only_if_open）・月間上限を超える。ルールが無い店舗では何もしない
 */
export async function runCancelOpeningAutomations(input: { storeId: string; reservation: CancelledReservation; source: CancelSource; origin: string; now?: Date }): Promise<CancelOpeningRunSummary> {
  const now = input.now ?? new Date();
  const summary: CancelOpeningRunSummary = { created: 0, recipients: 0, skipped: [] };
  const r = input.reservation;
  const date = String(r.reservation_date || '').slice(0, 10);
  const time = String(r.reservation_time || '').slice(0, 5);
  // 宿泊の予約・時刻の無い予約（第三希望日時など）は対象外
  if (!r.id || r.checkout_date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return summary;

  const rules = (await listBroadcastAutomations(input.storeId)).filter((x) => x.enabled && x.trigger.type === 'reservation_cancelled');
  if (rules.length === 0) return summary;
  const skipAll = (reason: string) => {
    for (const rule of rules) summary.skipped.push({ automation_id: rule.id, reason });
    return summary;
  };
  if (!(await getStoreLineToken(input.storeId))) return skipAll('LINE チャネルアクセストークンが未設定');

  const config = r.form_id ? await loadWaitlistFormConfig(input.storeId, r.form_id) : null;
  if (!config || (config.calendar_settings?.booking_mode || 'calendar') !== 'calendar') return skipAll('カレンダー表示モードの予約フォームではない');

  // 空き待ち（キャンセル待ち）の人がいる枠は、空き待ちの人に先に知らせる（一斉配信はしない）
  if (isWaitlistActive(config)) {
    const waiting = (await listActiveWaitlist(input.storeId)).some((e) => e.reservation_date === date && e.reservation_time === time);
    if (waiting) return skipAll('空き待ちの人がいる枠（空き待ちの人を優先）');
  }

  const slotStartMs = Date.parse(`${date}T${time}:00+09:00`);
  const day = jstDayRange(now);
  const liffId = ((config as { form_type?: string }).form_type === 'web' ? '' : config.basic_info?.liff_id || '').trim();
  const bookingUrl = liffId.length >= 10 ? `https://liff.line.me/${liffId}` : null;
  const store = await loadWaitlistStore(input.storeId);
  let openState: boolean | null = null;
  const isOpen = async (): Promise<boolean> => {
    if (openState !== null) return openState;
    if (getAppEnvironment() === 'local') return (openState = true);
    if (!store) return (openState = false);
    const state = await evaluateWaitlistSlot(
      store,
      config,
      {
        reservation_date: date,
        reservation_time: time,
        duration_minutes: reservationDurationMinutes({ reservation_date: date, selected_menus: r.selected_menus, selected_options: r.selected_options, customer_info: r.customer_info }),
        // 指名なしで割り当てられた予約は「誰かが空いていれば空き」、指名ありはそのスタッフが空いたか
        staff_id: r.staff_no_preference ? null : r.staff_id || null,
        selected_menus: Array.isArray(r.selected_menus) ? r.selected_menus : [],
        selected_options: Array.isArray(r.selected_options) ? r.selected_options : [],
      },
      now
    );
    return (openState = state === 'open');
  };

  let todays: Broadcast[] | null = null;
  let ctx: BuildContext | null = null;
  let settings: BroadcastSettings | null = null;
  let anyCreated = false;
  const marker = `cancel:${r.id}`;

  for (const rule of rules) {
    try {
      const trigger = rule.trigger as CancelOpeningTrigger;
      if (!todays) {
        todays = (await listBroadcasts(input.storeId)).filter((b) => {
          const t = Date.parse(b.created_at);
          return t >= day.start && t < day.end && b.status !== 'cancelled';
        });
      }
      const sentToday = todays.filter((b) => b.automation_id === rule.id).length;
      const check = checkCancelOpeningRule(trigger, { source: input.source, slotStartMs, now, sentToday });
      if (!check.ok) {
        summary.skipped.push({ automation_id: rule.id, reason: CANCEL_OPENING_SKIP_LABELS[check.reason] });
        continue;
      }
      if (trigger.only_if_open && !(await isOpen())) {
        summary.skipped.push({ automation_id: rule.id, reason: 'その日時は予約できる状態ではない' });
        continue;
      }

      const a = rule.audience;
      const [src, sends] = await Promise.all([
        loadAudienceSource(rule.store_id, { reservations: !!a.menus || !!a.forms || a.upcoming_reservation !== undefined, visits: !!a.menus, surveys: !!a.survey }),
        listAutomationSends(rule.id),
      ]);
      const facts = buildCustomerFacts({ ...src, today: jstDateOf(now) });
      const targets = pickCancelOpeningTargets({ customers: src.customers, facts, audience: a, excludeLineUserId: r.line_user_id || null, marker, resend_after_days: rule.resend_after_days, sends, now });
      if (targets.length === 0) {
        summary.skipped.push({ automation_id: rule.id, reason: '送る相手がいない' });
        continue;
      }

      const broadcastId = newBroadcastId();
      const card = buildCancelOpeningFlex(trigger.card, { storeName: store?.name, date, time, bookingUrl });
      const items: BroadcastAutomation['items'] = [{ key: 'opening', type: 'flex', alt_text: card.alt_text, contents: card.contents as never }, ...rule.items];
      if (!ctx) ctx = await loadBuildContext(rule.store_id);
      const built = buildPayloads(items, ctx, input.origin, broadcastId, true);
      const base: Broadcast = { ...automationBroadcast(rule, broadcastId, now), name: `【自動】${rule.name}（${formatOpeningSlot(date, time)}）`.slice(0, BROADCAST_NAME_MAX), items };
      if (built.error) {
        await insertBroadcast({ ...base, status: 'cancelled', recipient_count: targets.length, error: `自動配信を見送りました: ${built.error}` });
        summary.skipped.push({ automation_id: rule.id, reason: built.error });
        continue;
      }
      if (!settings) settings = await getBroadcastSettings(rule.store_id);
      const used = await countMonthlySent(rule.store_id, now);
      const quota = evaluateQuota({ limit: settings.monthly_limit, used, recipients: targets.length, over_limit: settings.over_limit });
      if (quota.exceeds) {
        await insertBroadcast({ ...base, status: 'cancelled', recipient_count: targets.length, error: `今月の配信上限（${quota.limit} 通）を超えるため見送りました（対象 ${targets.length} 人）` });
        summary.skipped.push({ automation_id: rule.id, reason: '月間上限' });
        continue;
      }

      // 下書きで作る → 宛先 → 送信記録 → 予約済み（この順なら、途中で止まっても二重には送られない）
      await insertBroadcast({ ...base, payloads: built.payloads, links: built.links, has_personalization: built.has_personalization, recipient_count: targets.length });
      await replaceBroadcastRecipients(rule.store_id, broadcastId, targets.map((c) => ({ customer_id: c.id, line_user_id: c.line_user_id as string, display_name: resolveRecipientName(c) })));
      await insertAutomationSends(rule.id, targets.map((c) => ({ customer_id: c.id, marker })), now);
      await updateBroadcast(rule.store_id, broadcastId, { status: 'scheduled', scheduled_at: now.toISOString() });
      todays.push({ ...base, status: 'scheduled' });
      summary.created += 1;
      summary.recipients += targets.length;
      anyCreated = true;
    } catch (e) {
      console.error(`[broadcast-automation] キャンセル時の配信 ${rule.id} の実行エラー:`, e);
      summary.skipped.push({ automation_id: rule.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (anyCreated) await triggerBroadcastSender();
  return summary;
}

/**
 * 予約のキャンセル後に呼ぶ（レスポンスを返したあとに実行）。失敗してもキャンセルの処理には影響しない。
 * source = 'customer'（お客様の LINE キャンセル）/ 'store'（管理画面でのキャンセル）
 */
export function scheduleCancelOpeningBroadcast(input: { storeId: string | null | undefined; reservation: CancelledReservation | null | undefined; source: CancelSource; origin: string }): void {
  if (!input.storeId || !input.reservation) return;
  const storeId = input.storeId;
  const reservation = input.reservation;
  const run = async () => {
    try {
      const rules = await listBroadcastAutomations(storeId);
      if (!rules.some((x) => x.enabled && x.trigger.type === 'reservation_cancelled')) return;
      if (getAppEnvironment() !== 'local') await new Promise((resolve) => setTimeout(resolve, CANCEL_OPENING_DELAY_MS));
      const summary = await runCancelOpeningAutomations({ storeId, reservation, source: input.source, origin: input.origin });
      console.log(`[broadcast-automation] キャンセル時の配信 store=${storeId} 配信=${summary.created} 対象=${summary.recipients}人 見送り=${summary.skipped.map((s) => s.reason).join(' / ') || 'なし'}`);
    } catch (e) {
      console.error('[broadcast-automation] キャンセル時の配信エラー:', e);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

/** 予約確認・キャンセルなど、システムが使う言葉（配信停止 / 再開のキーワードにできない） */
const SYSTEM_KEYWORDS = ['予約確認', '予約をキャンセル', 'キャンセル', '予約を変更', '空き待ち確認'];

export async function saveBroadcastSettings(storeId: string, raw: unknown): Promise<ServiceResult<BroadcastSettings>> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const outKw = typeof o.opt_out_keyword === 'string' ? o.opt_out_keyword.trim() : '';
  const inKw = typeof o.opt_in_keyword === 'string' ? o.opt_in_keyword.trim() : '';
  if (!outKw || !inKw) return { ok: false, status: 400, error: '配信停止・配信再開のキーワードを入力してください' };
  if (outKw === inKw) return { ok: false, status: 400, error: '配信停止と配信再開は別の言葉にしてください' };
  const system = [outKw, inKw].find((k) => SYSTEM_KEYWORDS.includes(k));
  if (system) return { ok: false, status: 400, error: `「${system}」はシステムが使う言葉のためキーワードにできません` };
  if (typeof o.automation_time === 'string' && !/^([01]\d|2[0-3]):00$/.test(o.automation_time)) return { ok: false, status: 400, error: '自動配信の実行時刻は 1 時間単位（例 10:00）で指定してください' };
  if (o.monthly_limit !== null && o.monthly_limit !== undefined && o.monthly_limit !== '') {
    const n = Number(o.monthly_limit);
    if (!Number.isFinite(n) || n < 0) return { ok: false, status: 400, error: '月間上限は 0 以上の数字で指定してください（空 = 制限なし）' };
  }
  // LINE メッセージのキーワード自動応答と同じ言葉は使えない（Webhook が配信停止を先に処理するため、自動応答が動かなくなる）
  const conflict = (await listLineFlexMessages(storeId)).find((m) => m.keywords.some((k) => k === outKw || k === inKw));
  if (conflict) return { ok: false, status: 400, error: `そのキーワードは LINE メッセージ「${conflict.name}」の自動応答で使われています` };
  const settings = normalizeBroadcastSettings(o);
  return { ok: true, value: await updateBroadcastSettings(storeId, settings) };
}

/** LINE の今月の通数（Messaging API）。取得できなければ null（トークン未設定・通信エラーなど） */
export async function fetchLineQuota(storeId: string, fetchImpl: typeof fetch = fetch): Promise<LineQuotaInfo | null> {
  const token = await getStoreLineToken(storeId);
  if (!token) return null;
  const get = async (path: string): Promise<Record<string, unknown> | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetchImpl(`https://api.line.me/v2/bot/message/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const [quota, usage] = await Promise.all([get('quota'), get('quota/consumption')]);
  if (!quota || !usage) return null;
  return {
    type: quota.type === 'limited' ? 'limited' : 'none',
    limit: typeof quota.value === 'number' ? quota.value : null,
    usage: typeof usage.totalUsage === 'number' ? usage.totalUsage : 0,
  };
}
