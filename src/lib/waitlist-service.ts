/**
 * 空き待ち（キャンセル待ち）のサーバー側処理（Supabase / Google カレンダー / LINE 送信に依存）。
 * 判定は純粋ロジック（waitlist.ts）、カードは waitlist-flex.ts、保存は waitlist-repository.ts。
 *
 * - 登録・一覧・取り消し（予約フォーム / LINE の「空き待ち確認」）
 * - 見回り `processWaitlist`: 有効な空き待ちについて、枠が空いたら知らせ、埋まったらおわびを送り、過ぎたら終了する。
 *   予約のキャンセル・日時変更の直後（`scheduleWaitlistCheck`）と、10 分おきの cron（/api/cron/waitlist）から呼ぶ
 *
 * 予約・キャンセルの処理を巻き込まないよう、ここの関数は失敗しても例外を外に出さない（登録 API を除く）
 */
import fs from 'fs';
import path from 'path';
import { after } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeForm } from '@/lib/form-normalizer';
import { listCalendarEventsAll } from '@/lib/google-calendar';
import { pushLineMessages } from '@/lib/line-push';
import { mergeStaffSchedule } from '@/lib/staff-schedule';
import { isNoPreferenceAssignable, isSlotBookableForSettings } from '@/lib/staff-slot-rules';
import { resolveMaxConcurrentEvents, type CalendarEventLike } from '@/lib/staff-availability';
import { addDays, formatDateTimeShortJa, isSlotFreeByEvents, type ChangeSlotContext } from '@/lib/reservation-change';
import { loadForm, loadLocalFormConfig } from '@/lib/reservation-change-service';
import type { FormConfig } from '@/types/form';
import {
  WAITLIST_MAX_SEND_FAILURES,
  buildWaitlistBookingUrl,
  checkWaitlistRegistration,
  decideWaitlistAction,
  isWaitlistActive,
  isWaitlistSlotPast,
  parseWaitlistPostback,
  renderWaitlistMessageText,
  resolveWaitlistMessageTemplate,
  resolveWaitlistSettings,
  waitlistMenuText,
  waitlistSlotStartMs,
  type WaitlistEntry,
  type WaitlistMessageKey,
  type WaitlistSlotState,
  type WaitlistStatus,
} from '@/lib/waitlist';
import {
  fulfillWaitlistForSlot,
  getWaitlistEntry,
  hasActiveWaitlist,
  insertWaitlistEntry,
  listActiveWaitlist,
  listActiveWaitlistForUser,
  recordWaitlistNotification,
  transitionWaitlistEntry,
} from '@/lib/waitlist-repository';
import {
  buildWaitlistListMessage,
  buildWaitlistRegisteredMessage,
  buildWaitlistSimpleMessage,
  buildWaitlistSlotFilledMessage,
  buildWaitlistSlotOpenedMessage,
} from '@/lib/waitlist-flex';

type Message = Record<string, unknown>;

export interface WaitlistStore {
  id: string;
  name?: string | null;
  phone?: string | null;
  google_calendar_id?: string | null;
  line_channel_access_token?: string | null;
}

/** キャンセル・日時変更の直後に見回るまでの待ち時間（直後の取り直しで空き → 満席がすぐ入れ替わるときに知らせないため） */
export const WAITLIST_TRIGGER_DELAY_MS = 10 * 1000;
/** キャンセル・予約の直後の見回りに使える時間（関数の上限 30 秒に収める。残りは 10 分おきの見回りに回す） */
const WAITLIST_TRIGGER_BUDGET_MS = 10 * 1000;

const isLocal = () => getAppEnvironment() === 'local';
const DATA_DIR = path.join(process.cwd(), 'data');

// ---- 店舗・フォームの読み込み ----

export async function loadWaitlistStore(storeId: string): Promise<WaitlistStore | null> {
  if (isLocal()) {
    try {
      const file = path.join(DATA_DIR, 'stores.json');
      const arr = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
      return (Array.isArray(arr) ? arr.find((s: any) => s?.id === storeId) : null) || null;
    } catch {
      return null;
    }
  }
  try {
    const client = createAdminClient() as any;
    if (!client) return null;
    const { data } = await client.from('stores').select('id, name, phone, google_calendar_id, line_channel_access_token').eq('id', storeId).maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

export async function loadWaitlistFormConfig(storeId: string, formId: string): Promise<FormConfig | null> {
  if (isLocal()) return loadLocalFormConfig(formId);
  const client = createAdminClient();
  if (!client) return null;
  return (await loadForm(client, storeId, formId))?.config || null;
}

// ---- 枠の状態（いま予約できるか） ----

/** 見回り 1 回のあいだ、同じカレンダー・同じ日の予定は 1 回だけ取る */
export type WaitlistEventCache = Map<string, Promise<CalendarEventLike[] | null>>;

function getEvents(cache: WaitlistEventCache, calendarId: string, date: string, storeId: string): Promise<CalendarEventLike[] | null> {
  const key = `${calendarId}|${date}`;
  let p = cache.get(key);
  if (!p) {
    p = listCalendarEventsAll(calendarId, `${date}T00:00:00+09:00`, `${addDays(date, 1)}T00:00:00+09:00`, storeId)
      .then((items) => items as CalendarEventLike[])
      .catch((e) => {
        console.error(`[waitlist] events.list failed (calendar=${calendarId}):`, e instanceof Error ? e.message : e);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}

const idsOf = (list: unknown[], key: string): string[] =>
  (Array.isArray(list) ? list : []).map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[key] : null)).filter((v): v is string => typeof v === 'string' && !!v);

/**
 * その空き待ちの日時が、いま予約できるか。予約フォームのカレンダー・予約 API と同じ規則で見る
 * （受付期間・営業時間などの設定 + Google カレンダーの予定。スタッフ選択のフォームはスタッフのカレンダー）
 */
export async function evaluateWaitlistSlot(
  store: WaitlistStore,
  config: FormConfig,
  entry: Pick<WaitlistEntry, 'reservation_date' | 'reservation_time' | 'duration_minutes' | 'staff_id' | 'selected_menus' | 'selected_options'>,
  now: Date,
  cache: WaitlistEventCache = new Map()
): Promise<WaitlistSlotState> {
  const formCs = config.calendar_settings;
  const date = entry.reservation_date;
  const time = String(entry.reservation_time).slice(0, 5);
  const durationMinutes = entry.duration_minutes > 0 ? entry.duration_minutes : 0;
  const input = { date, time, durationMinutes, now };

  const ss = config.staff_selection as
    | { enabled?: boolean; staff?: any[]; max_staff_concurrent_enabled?: boolean; max_staff_concurrent_events?: number }
    | undefined;
  const calendarStaff = ss?.enabled === true && Array.isArray(ss.staff) ? ss.staff.filter((m) => m && m.id && m.name && m.calendar_id) : [];
  const named = entry.staff_id ? calendarStaff.find((m) => m.id === entry.staff_id) : null;

  if (calendarStaff.length > 0 && (named || !entry.staff_id)) {
    // スタッフのカレンダーで見る: 指名あり = そのスタッフ / 指名なし = 対応できて自動割当の対象のスタッフの誰か
    const menuIds = idsOf(entry.selected_menus, 'menu_id');
    const optionIds = idsOf(entry.selected_options, 'option_id');
    const canHandle = (m: any) => {
      const hiddenMenus = Array.isArray(m.hidden_menu_ids) ? m.hidden_menu_ids : [];
      const hiddenOptions = Array.isArray(m.hidden_option_ids) ? m.hidden_option_ids : [];
      return !menuIds.some((id) => hiddenMenus.includes(id)) && !optionIds.some((id) => hiddenOptions.includes(id));
    };
    const candidates = named ? [named] : calendarStaff.filter((m) => canHandle(m) && isNoPreferenceAssignable(m));
    let staffCap: number | null = null;
    if (ss?.max_staff_concurrent_enabled === true) {
      const v = ss.max_staff_concurrent_events;
      staffCap = typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
    }
    let anyRuleOk = false;
    let unknown = false;
    for (const member of candidates) {
      const cs = mergeStaffSchedule(formCs, member.schedule);
      if (!isSlotBookableForSettings(cs, input)) continue;
      anyRuleOk = true;
      const events = await getEvents(cache, member.calendar_id, date, store.id);
      if (events === null) {
        unknown = true;
        continue;
      }
      let otherStaffEvents: Array<CalendarEventLike[] | null> | undefined;
      if (staffCap !== null) {
        const others = calendarStaff.filter((m) => m.calendar_id !== member.calendar_id);
        otherStaffEvents = await Promise.all(others.map((m) => getEvents(cache, m.calendar_id, date, store.id)));
        if (otherStaffEvents.some((e) => e === null)) unknown = true;
      }
      const ctx: ChangeSlotContext = { cs, durationMinutes, events, staffMode: true, capacity: 1, staffCap, otherStaffEvents };
      if (isSlotFreeByEvents(ctx, date, time)) return 'open';
    }
    if (!anyRuleOk) return 'closed';
    return unknown ? 'unknown' : 'full';
  }

  // 店舗カレンダーで見る（同時刻に埋まるイベント数まで）
  if (!isSlotBookableForSettings(formCs, input)) return 'closed';
  if (!store.google_calendar_id) return 'open';
  const events = await getEvents(cache, store.google_calendar_id, date, store.id);
  if (events === null) return 'unknown';
  const ctx: ChangeSlotContext = { cs: formCs, durationMinutes, events, staffMode: false, capacity: resolveMaxConcurrentEvents(formCs) };
  return isSlotFreeByEvents(ctx, date, time) ? 'open' : 'full';
}

// ---- 登録・一覧・取り消し（お客様） ----

export interface WaitlistRegisterInput {
  storeId: unknown;
  formId: unknown;
  lineUserId: unknown;
  customerName?: unknown;
  date: unknown;
  time: unknown;
  selectedMenus?: unknown;
  selectedOptions?: unknown;
  totalDuration?: unknown;
  menuText?: unknown;
  staffId?: unknown;
  now?: Date;
}

export type WaitlistRegisterResult =
  | { ok: true; entry: WaitlistEntry }
  | { ok: false; status: number; error: string; code?: string };

const asObjects = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 50) : [];
const sumOf = (list: Array<Record<string, unknown>>, key: string) => list.reduce((s, x) => s + (Number(x?.[key]) || 0), 0);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 空き待ちを登録する（満席の枠だけ。フォームの設定が ON のときだけ） */
export async function registerWaitlist(input: WaitlistRegisterInput): Promise<WaitlistRegisterResult> {
  const now = input.now ?? new Date();
  const storeId = str(input.storeId, 64);
  const formId = str(input.formId, 64);
  const lineUserId = str(input.lineUserId, 64);
  if (!storeId || !formId) return { ok: false, status: 400, error: '店舗またはフォームが指定されていません' };
  if (!lineUserId) return { ok: false, status: 400, error: '空き待ちの登録には LINE 連携が必要です。LINE アプリから予約フォームを開いてください。', code: 'no_line' };

  const config = await loadWaitlistFormConfig(storeId, formId);
  if (!config) return { ok: false, status: 404, error: 'フォームが見つかりません' };
  if (!isWaitlistActive(config)) return { ok: false, status: 409, error: 'このフォームでは空き待ちを受け付けていません。', code: 'disabled' };
  const settings = resolveWaitlistSettings(config.calendar_settings);

  const ss = config.staff_selection as { enabled?: boolean; staff?: any[] } | undefined;
  const staffList = ss?.enabled === true && Array.isArray(ss.staff) ? ss.staff : [];
  const rawStaffId = str(input.staffId, 64);
  const member = rawStaffId && rawStaffId !== 'none' ? staffList.find((m) => m && m.id === rawStaffId) : null;
  if (rawStaffId && rawStaffId !== 'none' && !member) {
    return { ok: false, status: 400, error: '選択されたスタッフが見つかりません。フォームを開き直してもう一度お試しください。' };
  }
  const staffId: string | null = member ? member.id : null;

  const activeEntries = await listActiveWaitlistForUser(storeId, lineUserId);
  const check = checkWaitlistRegistration({ settings, date: input.date, time: input.time, staffId, formId, activeEntries, now });
  if (!check.ok) return { ok: false, status: check.reason === 'invalid' ? 400 : 409, error: check.error, code: check.reason };
  const date = input.date as string;
  const time = input.time as string;

  const menus = asObjects(input.selectedMenus);
  const options = asObjects(input.selectedOptions);
  const requested = Number(input.totalDuration);
  const duration = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 24 * 60) : sumOf(menus, 'duration') + sumOf(options, 'duration');

  const draft = { reservation_date: date, reservation_time: time, duration_minutes: duration, staff_id: staffId, selected_menus: menus, selected_options: options };

  let customerId: string | null = null;
  if (!isLocal()) {
    const store = await loadWaitlistStore(storeId);
    if (!store) return { ok: false, status: 404, error: '店舗が見つかりません' };
    // 満席の枠だけ登録できる（いま予約できる枠・受付していない時間は受け付けない）
    const state = await evaluateWaitlistSlot(store, config, draft, now);
    if (state === 'open') {
      return { ok: false, status: 409, error: 'この日時は現在ご予約いただけます。カレンダーを更新してご予約ください。', code: 'slot_open' };
    }
    if (state === 'closed') {
      return { ok: false, status: 409, error: 'この日時は受付時間外のため、空き待ちを登録できません。', code: 'closed' };
    }
    try {
      const client = createAdminClient() as any;
      const { data } = await client.from('customers').select('id').eq('store_id', storeId).eq('line_user_id', lineUserId).limit(1);
      customerId = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
    } catch {
      customerId = null;
    }
  }

  try {
    const entry = await insertWaitlistEntry({
      store_id: storeId,
      form_id: formId,
      customer_id: customerId,
      line_user_id: lineUserId,
      customer_name: str(input.customerName, 100) || null,
      ...draft,
      menu_text: str(input.menuText, 500) || null,
      staff_name: member ? String(member.name || '') || null : null,
    });
    if (entry === 'duplicate') return { ok: false, status: 409, error: 'この日時はすでに空き待ちに登録済みです。', code: 'duplicate' };
    return { ok: true, entry };
  } catch (e) {
    console.error('[waitlist] register error:', e);
    return { ok: false, status: 500, error: '空き待ちを登録できませんでした。時間をおいてもう一度お試しください。' };
  }
}

/** フォームに見せる形（LINE ユーザー ID などは返さない） */
export interface WaitlistEntryForForm {
  id: string;
  form_id: string;
  date: string;
  time: string;
  date_text: string;
  menu_text: string;
  staff_id: string | null;
  staff_name: string | null;
  status: WaitlistStatus;
}

function toFormEntry(e: WaitlistEntry): WaitlistEntryForForm {
  const menus = Array.isArray(e.selected_menus) ? (e.selected_menus as Array<{ menu_name?: string; submenu_name?: string }>) : [];
  return {
    id: e.id,
    form_id: e.form_id,
    date: e.reservation_date,
    time: e.reservation_time,
    date_text: formatDateTimeShortJa(e.reservation_date, e.reservation_time),
    menu_text: menus.map((m) => (m?.submenu_name ? `${m.menu_name || ''} > ${m.submenu_name}` : m?.menu_name || '')).filter(Boolean).join('、'),
    staff_id: e.staff_id,
    staff_name: e.staff_name,
    status: e.status,
  };
}

/** その人の登録中の空き待ち（過ぎたものは出さない） */
export async function listMyWaitlist(storeId: string, lineUserId: string, now: Date = new Date()): Promise<WaitlistEntryForForm[]> {
  const entries = await listActiveWaitlistForUser(storeId, lineUserId);
  return entries.filter((e) => !isWaitlistSlotPast(e.reservation_date, e.reservation_time, now)).map(toFormEntry);
}

/** お客様が自分の空き待ちを取り消す（本人確認: 空き待ち ID + 店舗 + LINE ユーザー ID） */
export async function cancelMyWaitlist(args: { entryId: string; storeId: string; lineUserId: string }): Promise<{ ok: boolean; entry?: WaitlistEntry }> {
  const entry = await getWaitlistEntry(args.entryId);
  if (!entry || entry.store_id !== args.storeId || entry.line_user_id !== args.lineUserId) return { ok: false };
  const done = await transitionWaitlistEntry(entry.id, ['waiting', 'notified'], { status: 'cancelled' });
  return { ok: done, entry };
}

/** 店舗が管理画面から取り消す */
export async function cancelWaitlistByStore(storeId: string, entryId: string): Promise<boolean> {
  const entry = await getWaitlistEntry(entryId);
  if (!entry || entry.store_id !== storeId) return false;
  return transitionWaitlistEntry(entry.id, ['waiting', 'notified'], { status: 'cancelled' });
}

export interface WaitlistSourceForForm extends WaitlistEntryForForm {
  selected_menus: unknown[];
  selected_options: unknown[];
  /** いまその日時を予約できるか（open 以外 = 埋まった / 受付終了） */
  open: boolean;
  /** 空き待ちがまだ有効か（予約済み・取り消し済み・期限切れなら false） */
  active: boolean;
}

/**
 * 空きのお知らせから予約フォームを開いたとき（URL の ?waitlist=空き待ちID）に見せる内容。
 * メニュー・スタッフ・日時を入力済みにするために使う
 */
export async function getWaitlistSourceForForm(args: { entryId: string; storeId: string; lineUserId: string; now?: Date }): Promise<
  { ok: true; entry: WaitlistSourceForForm } | { ok: false; error: string }
> {
  const now = args.now ?? new Date();
  const notFound = { ok: false as const, error: '空き待ちが見つかりませんでした。' };
  if (!args.entryId || !args.storeId || !args.lineUserId) return notFound;
  const entry = await getWaitlistEntry(args.entryId);
  if (!entry || entry.store_id !== args.storeId || entry.line_user_id !== args.lineUserId) return notFound;
  const active = (entry.status === 'waiting' || entry.status === 'notified') && !isWaitlistSlotPast(entry.reservation_date, entry.reservation_time, now);
  let open = false;
  if (active && !isLocal()) {
    try {
      const [store, config] = await Promise.all([loadWaitlistStore(entry.store_id), loadWaitlistFormConfig(entry.store_id, entry.form_id)]);
      if (store && config) open = (await evaluateWaitlistSlot(store, config, entry, now)) === 'open';
    } catch {
      open = false;
    }
  }
  return { ok: true, entry: { ...toFormEntry(entry), selected_menus: entry.selected_menus, selected_options: entry.selected_options, open, active } };
}

// ---- 見回り（空きのお知らせ・おわび・期限切れ） ----

export interface WaitlistRunSummary {
  checked: number;
  notified: number;
  apologized: number;
  expired: number;
  failed: number;
  /** 時間切れで次の回に回した件数 */
  deferred: number;
}

/** 通知の文面（店舗が編集した文章。`{日時}` などを置き換える） */
function messageLead(config: FormConfig | null | undefined, key: WaitlistMessageKey, store: WaitlistStore, entry: WaitlistEntry): string {
  const settings = resolveWaitlistSettings(config?.calendar_settings);
  return renderWaitlistMessageText(resolveWaitlistMessageTemplate(settings, key), {
    日時: formatDateTimeShortJa(entry.reservation_date, entry.reservation_time),
    メニュー: waitlistMenuText(entry),
    店名: store.name || '',
    予約URL: buildWaitlistBookingUrl(config?.basic_info?.liff_id, entry.id) || '',
  });
}

const emptySummary = (): WaitlistRunSummary => ({ checked: 0, notified: 0, apologized: 0, expired: 0, failed: 0, deferred: 0 });

async function sendAndLog(store: WaitlistStore, entry: WaitlistEntry, type: 'slot_opened' | 'slot_filled', message: Message): Promise<boolean> {
  const result = await pushLineMessages(store.line_channel_access_token || '', entry.line_user_id, [message]);
  const startMs = waitlistSlotStartMs(entry.reservation_date, entry.reservation_time);
  await recordWaitlistNotification({
    waitlist_entry_id: entry.id,
    store_id: entry.store_id,
    type,
    slot_start_at: Number.isNaN(startMs) ? null : new Date(startMs).toISOString(),
    result: result.ok ? 'success' : 'failed',
    error_message: result.ok ? null : `${result.status} ${result.body}`.slice(0, 500),
  });
  return result.ok;
}

/**
 * 見回り: 有効な空き待ちを順に見て、
 * - 開始時刻を過ぎた → 終了（expired）
 * - 枠が空いた → 空き待ち中の人に知らせる（waiting → notified）。送信直前のカレンダーで判断する
 * - お知らせした枠がまた埋まった → 予約しなかった人におわび（notified → waiting。お知らせ 1 回につき 1 回）
 * 状態を先に書き換えてから送るので、見回りが重なっても二重に送らない
 */
export async function processWaitlist(opts: { storeId?: string | null; now?: Date; deadlineMs?: number } = {}): Promise<WaitlistRunSummary> {
  const now = opts.now ?? new Date();
  const summary = emptySummary();
  const entries = await listActiveWaitlist(opts.storeId || null);
  if (entries.length === 0) return summary;

  const stores = new Map<string, WaitlistStore | null>();
  const forms = new Map<string, FormConfig | null>();
  const cache: WaitlistEventCache = new Map();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      summary.deferred = entries.length - i;
      break;
    }
    summary.checked++;
    try {
      if (isWaitlistSlotPast(entry.reservation_date, entry.reservation_time, now)) {
        if (await transitionWaitlistEntry(entry.id, ['waiting', 'notified'], { status: 'expired' })) summary.expired++;
        continue;
      }
      // local は Google カレンダー・LINE 送信を使わない（期限切れの整理だけ）
      if (isLocal()) continue;

      if (!stores.has(entry.store_id)) stores.set(entry.store_id, await loadWaitlistStore(entry.store_id));
      const store = stores.get(entry.store_id);
      if (!store || !store.line_channel_access_token) continue;

      const formKey = `${entry.store_id}|${entry.form_id}`;
      if (!forms.has(formKey)) forms.set(formKey, await loadWaitlistFormConfig(entry.store_id, entry.form_id));
      const config = forms.get(formKey);
      // 機能を OFF にしたフォームの空き待ちには何も送らない（期限が来たら終了する）
      if (!config || !isWaitlistActive(config)) continue;
      const settings = resolveWaitlistSettings(config.calendar_settings);

      const state = await evaluateWaitlistSlot(store, config, entry, now, cache);
      const action = decideWaitlistAction(entry, state, settings, now);

      if (action === 'notify') {
        const claimed = await transitionWaitlistEntry(entry.id, ['waiting'], {
          status: 'notified',
          notified_at: new Date().toISOString(),
          notify_count: entry.notify_count + 1,
        });
        if (!claimed) continue;
        const url = buildWaitlistBookingUrl(config.basic_info?.liff_id, entry.id);
        const sent = await sendAndLog(store, entry, 'slot_opened', buildWaitlistSlotOpenedMessage(store.name, entry, url, messageLead(config, 'slot_opened', store, entry)));
        if (sent) {
          summary.notified++;
        } else {
          // 送れなかった: 空き待ちに戻す。続けて失敗したら「送信できず終了」にする（LINE のブロックなど）
          const failCount = entry.fail_count + 1;
          await transitionWaitlistEntry(entry.id, ['notified'], {
            status: failCount >= WAITLIST_MAX_SEND_FAILURES ? 'inactive' : 'waiting',
            fail_count: failCount,
            notify_count: entry.notify_count,
          });
          summary.failed++;
        }
      } else if (action === 'apologize') {
        const claimed = await transitionWaitlistEntry(entry.id, ['notified'], { status: 'waiting' });
        if (!claimed) continue;
        const sent = await sendAndLog(store, entry, 'slot_filled', buildWaitlistSlotFilledMessage(store.name, entry, messageLead(config, 'slot_filled', store, entry)));
        if (sent) summary.apologized++;
        else summary.failed++;
      }
    } catch (e) {
      console.error('[waitlist] process error:', entry.id, e);
    }
  }
  return summary;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 予約のキャンセル・日時変更・新しい予約のあとに、その店舗の空き待ちを見回る（レスポンスを返したあとに実行）。
 * 有効な空き待ちが無い店舗では何もしない。失敗しても呼び出し元の処理には影響しない
 */
export function scheduleWaitlistCheck(storeId: string | null | undefined, delayMs: number = WAITLIST_TRIGGER_DELAY_MS): void {
  if (!storeId) return;
  const run = async () => {
    try {
      if (!(await hasActiveWaitlist(storeId))) return;
      if (delayMs > 0 && !isLocal()) await sleep(delayMs);
      const summary = await processWaitlist({ storeId, deadlineMs: Date.now() + WAITLIST_TRIGGER_BUDGET_MS });
      if (summary.notified || summary.apologized || summary.failed) {
        console.log(`[waitlist] store=${storeId} お知らせ=${summary.notified} おわび=${summary.apologized} 失敗=${summary.failed}`);
      }
    } catch (e) {
      console.error('[waitlist] check error:', e);
    }
  };
  try {
    after(run);
  } catch {
    // リクエストの外（テストなど）から呼ばれたとき
    void run();
  }
}

/**
 * 予約が取れたとき: その人の、同じ日時の空き待ちを「予約済み」にして、
 * ほかの空き待ちの人へのおわび（枠が埋まった）をすぐ見回る
 */
export async function onReservationCreatedForWaitlist(args: { storeId?: string | null; lineUserId?: string | null; date?: string | null; time?: string | null }): Promise<void> {
  try {
    if (!args.storeId) return;
    if (args.lineUserId && args.date && args.time) {
      await fulfillWaitlistForSlot(args.storeId, args.lineUserId, String(args.date).slice(0, 10), String(args.time).slice(0, 5));
    }
    scheduleWaitlistCheck(args.storeId, 0);
  } catch (e) {
    console.error('[waitlist] fulfill error:', e);
  }
}

// ---- LINE（Webhook） ----

/** 「空き待ち確認」と送られたとき: 登録中の空き待ちの一覧（取り消しボタン付き） */
export async function buildWaitlistListReply(store: WaitlistStore, userId: string, now: Date = new Date()): Promise<Message[]> {
  const entries = (await listActiveWaitlistForUser(store.id, userId)).filter((e) => !isWaitlistSlotPast(e.reservation_date, e.reservation_time, now));
  return [buildWaitlistListMessage(store.name, entries)];
}

/** 取り消しボタン（postback。data = `wl:x:{空き待ちID}`）が押されたとき */
export async function handleWaitlistPostback(store: WaitlistStore, userId: string, data: string): Promise<Message[] | null> {
  const action = parseWaitlistPostback(data);
  if (!action) return null;
  const result = await cancelMyWaitlist({ entryId: action.entryId, storeId: store.id, lineUserId: userId });
  if (!result.entry) return [buildWaitlistSimpleMessage('空き待ち', '空き待ちが見つかりませんでした。', store.name)];
  const when = formatDateTimeShortJa(result.entry.reservation_date, result.entry.reservation_time);
  return [
    buildWaitlistSimpleMessage(
      '空き待ち',
      result.ok ? `${when} の空き待ちを取り消しました。` : `${when} の空き待ちは、すでに終了しています。`,
      store.name
    ),
  ];
}

/** 登録後にフォームが送ってくる「【空き待ち登録】…」への返信（いちばん最近登録した空き待ちの受付カード） */
export async function buildWaitlistRegisteredReply(store: WaitlistStore, userId: string): Promise<Message[] | null> {
  const entries = await listActiveWaitlistForUser(store.id, userId);
  if (entries.length === 0) return null;
  const latest = [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  let config: FormConfig | null = null;
  try {
    config = await loadWaitlistFormConfig(latest.store_id, latest.form_id);
  } catch {
    config = null;
  }
  return [buildWaitlistRegisteredMessage(store.name, latest, messageLead(config, 'registered', store, latest))];
}
