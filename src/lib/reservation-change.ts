/**
 * LINE の「予約を変更」（お客様自身による日時・時間の変更）の純粋ロジック。DB・API に依存しない（Vitest 対象）
 *
 * - 変更できるか: フォームの `cancel_rules.allow_change`（未設定 = 受け付ける）+ キャンセル期限と同じ期限
 * - 変更先に選べる日付: 今日 〜 フォームの事前予約可能日数（`advance_booking_days`）
 * - 時間の〇✕: 予約フォームのカレンダーと同じ規則（`staff-slot-rules.ts` の `isSlotBookableForSettings`）
 *   + Google カレンダーの予定（自分の予約の予定は除いて数える）
 *
 * 見ないもの: メニュー / オプションの対応時間設定
 */
import type { FormConfig } from '@/types/form';
import { isCancelAllowed, resolveCancelRules, type CancelRules } from './cancel-rules';
import { dayBusinessHours, isSlotBookableForSettings } from './staff-slot-rules';
import {
  countEventsOverlappingSlot,
  eventOverlapsSlot,
  isBusinessDayEvent,
  resolveEventRange,
  resolveReservationSlotWindow,
  type CalendarEventLike,
} from './staff-availability';

type CalendarSettings = FormConfig['calendar_settings'];

export const CHANGE_KEYWORD = '予約を変更';
export const CHANGE_POSTBACK_PREFIX = 'rc:';
/** メニュー変更フォームが送信後に LINE へ送るメッセージの 1 行目（Webhook が完了のカードを返す） */
export const MENU_CHANGE_MESSAGE_HEAD = '【メニュー変更】';
/** 日付の一覧 1 回ぶんの日数（続きは「続きの日付を見る」） */
export const CHANGE_DATES_PAGE_DAYS = 28;
/** 選べる日付の上限（事前予約可能日数がこれより長くてもここまで） */
export const CHANGE_MAX_WINDOW_DAYS = 180;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ---- 日付 ----

/** 日本時間の今日 YYYY-MM-DD */
export function jstToday(now: Date): string {
  const d = new Date(now.getTime() + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** "11/20（金）" */
export function formatDateShortJa(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}（${WEEKDAYS[dow]}）`;
}

/** "11/20（金）14:00" */
export function formatDateTimeShortJa(date: string, time: string | null | undefined): string {
  const t = String(time || '').slice(0, 5);
  return `${formatDateShortJa(date)}${t ? ` ${t}` : ''}`;
}

/** 変更先に選べる日数（今日から数えて何日先まで）。フォームの事前予約可能日数（未設定 30） */
export function resolveChangeWindowDays(cs: CalendarSettings | null | undefined): number {
  const raw = cs?.advance_booking_days;
  const days = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 30;
  return Math.min(days, CHANGE_MAX_WINDOW_DAYS);
}

/** 変更先に選べる日付（今日 〜 今日 + 事前予約可能日数） */
export function listChangeWindowDates(cs: CalendarSettings | null | undefined, now: Date): string[] {
  const today = jstToday(now);
  const days = resolveChangeWindowDays(cs);
  const out: string[] = [];
  for (let i = 0; i <= days; i++) out.push(addDays(today, i));
  return out;
}

// ---- ボタン（postback）の data ----

export type ChangeAction =
  | { kind: 'dates'; reservationId: string; page: number }
  | { kind: 'times'; reservationId: string; date: string }
  | { kind: 'confirm'; reservationId: string; date: string; time: string }
  | { kind: 'apply'; reservationId: string; date: string; time: string };

const compactDate = (d: string) => d.replace(/-/g, '');
const expandDate = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '');
const compactTime = (t: string) => t.replace(':', '');
const expandTime = (t: string) => (/^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : '');

/** 例: `rc:t:{予約ID}:20261120` */
export function buildChangePostback(action: ChangeAction): string {
  const id = action.reservationId;
  switch (action.kind) {
    case 'dates':
      return `${CHANGE_POSTBACK_PREFIX}d:${id}:${action.page}`;
    case 'times':
      return `${CHANGE_POSTBACK_PREFIX}t:${id}:${compactDate(action.date)}`;
    case 'confirm':
      return `${CHANGE_POSTBACK_PREFIX}c:${id}:${compactDate(action.date)}:${compactTime(action.time)}`;
    case 'apply':
      return `${CHANGE_POSTBACK_PREFIX}x:${id}:${compactDate(action.date)}:${compactTime(action.time)}`;
  }
}

export function isChangePostback(data: string | null | undefined): boolean {
  return typeof data === 'string' && data.startsWith(CHANGE_POSTBACK_PREFIX);
}

export function parseChangePostback(data: string | null | undefined): ChangeAction | null {
  if (!isChangePostback(data)) return null;
  const parts = String(data).slice(CHANGE_POSTBACK_PREFIX.length).split(':');
  const [kind, reservationId, a, b] = parts;
  if (!reservationId || !ID_RE.test(reservationId)) return null;
  if (kind === 'd' && parts.length === 3) {
    const page = Number(a);
    if (!Number.isInteger(page) || page < 0 || page > 50) return null;
    return { kind: 'dates', reservationId, page };
  }
  if (kind === 't' && parts.length === 3) {
    const date = expandDate(a || '');
    return DATE_RE.test(date) ? { kind: 'times', reservationId, date } : null;
  }
  if ((kind === 'c' || kind === 'x') && parts.length === 4) {
    const date = expandDate(a || '');
    const time = expandTime(b || '');
    if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
    return { kind: kind === 'c' ? 'confirm' : 'apply', reservationId, date, time };
  }
  return null;
}

// ---- 変更できるか ----

export interface ChangeReservationLike {
  reservation_date: string;
  reservation_time?: string | null;
  status?: string | null;
  checkout_date?: string | null;
  form_id?: string | null;
  staff_id?: string | null;
  staff_calendar_id?: string | null;
  selected_menus?: unknown;
  selected_options?: unknown;
  customer_info?: unknown;
}

export type ChangeBlockReason = 'cancelled' | 'past' | 'stay' | 'no_form' | 'disabled' | 'deadline';

export interface ChangeEligibility {
  allowed: boolean;
  reason?: ChangeBlockReason;
  /** calendar = トーク内で日時・時間を選べる / form_only = メニューの変更だけ（第三希望日時モードなど。日時は店舗へ連絡） */
  mode: 'calendar' | 'form_only';
  rules: CancelRules;
  deadline: Date | null;
}

/** フォームの設定で LINE からの予約変更を受け付けるか（未設定 = 受け付ける） */
export function isChangeEnabled(config: Pick<FormConfig, 'cancel_rules'> | null | undefined): boolean {
  return (config?.cancel_rules as { allow_change?: unknown } | undefined)?.allow_change !== false;
}

/** 予約の開始時刻（JST）。時刻が無ければその日の終わり */
function reservationStart(r: ChangeReservationLike): Date | null {
  if (!DATE_RE.test(String(r.reservation_date || ''))) return null;
  const t = String(r.reservation_time || '').slice(0, 5);
  const d = new Date(`${r.reservation_date}T${TIME_RE.test(t) ? t : '23:59'}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * その予約をお客様が LINE から変更できるか。
 * 期限はキャンセル期限（`cancel_rules.deadline_hours`）と同じ。宿泊予約は対象外
 */
export function resolveChangeEligibility(
  reservation: ChangeReservationLike,
  formConfig: FormConfig | null | undefined,
  now: Date
): ChangeEligibility {
  const rules = resolveCancelRules(formConfig);
  const mode: ChangeEligibility['mode'] = (formConfig?.calendar_settings?.booking_mode || 'calendar') === 'calendar' ? 'calendar' : 'form_only';
  const base = { mode, rules, deadline: null as Date | null };
  if (reservation.status === 'cancelled') return { ...base, allowed: false, reason: 'cancelled' };
  const start = reservationStart(reservation);
  if (!start || start.getTime() <= now.getTime()) return { ...base, allowed: false, reason: 'past' };
  if (reservation.checkout_date || formConfig?.calendar_settings?.booking_mode === 'stay') return { ...base, allowed: false, reason: 'stay' };
  if (!formConfig) return { ...base, allowed: false, reason: 'no_form' };
  if (!isChangeEnabled(formConfig)) return { ...base, allowed: false, reason: 'disabled' };
  const check = isCancelAllowed(rules, reservation.reservation_date, reservation.reservation_time, now);
  if (!check.allowed) return { ...base, allowed: false, reason: 'deadline', deadline: check.deadline };
  return { ...base, allowed: true, deadline: check.deadline };
}

/** 変更できない理由の案内文 */
export function describeChangeBlock(e: ChangeEligibility, storePhone?: string | null): string {
  const contact = storePhone ? `店舗（TEL: ${storePhone}）` : '店舗';
  switch (e.reason) {
    case 'cancelled':
      return 'このご予約はキャンセル済みです。';
    case 'past':
      return 'このご予約は日時を過ぎているため変更できません。';
    case 'deadline':
      return `変更の期限（ご予約の ${e.rules.deadline_hours} 時間前）を過ぎています。${contact}まで直接ご連絡ください。`;
    default:
      return `このご予約は LINE から変更できません。${contact}まで直接ご連絡ください。`;
  }
}

/** 予約の所要時間（分）。保存された合計 → メニュー + オプションの合計 → 0 */
export function reservationDurationMinutes(r: ChangeReservationLike): number {
  const info = r.customer_info && typeof r.customer_info === 'object' ? (r.customer_info as { total_duration?: unknown }) : {};
  const saved = Number(info.total_duration);
  if (Number.isFinite(saved) && saved > 0) return Math.floor(saved);
  const sum = (list: unknown) =>
    Array.isArray(list) ? list.reduce((s: number, x) => s + (Number((x as { duration?: unknown })?.duration) || 0), 0) : 0;
  const total = sum(r.selected_menus) + sum(r.selected_options);
  return total > 0 ? total : 0;
}

// ---- 時間の〇✕ ----

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

function toMin(t: unknown, fallback: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof t === 'string' && t ? t : fallback);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * その日に並べる時刻（予約フォームのカレンダーの行と同じ作り方）:
 * 全曜日の営業時間のいちばん早い開始 〜 いちばん遅い終了を時間間隔で刻み、「追加で表示する分」を足す。
 * 祝日の営業時間・その日の臨時営業日も範囲に含める
 */
export function listGridTimes(cs: CalendarSettings | null | undefined, date: string): number[] {
  let earliest = 9 * 60;
  let latest = 18 * 60;
  let found = false;
  const widen = (o: number | null, c: number | null) => {
    if (o === null || c === null) return;
    if (!found) {
      earliest = o;
      latest = c;
      found = true;
      return;
    }
    if (o < earliest) earliest = o;
    if (c > latest) latest = c;
  };
  const bh = cs?.business_hours as Record<string, { open?: string; close?: string; closed?: boolean } | undefined> | undefined;
  if (bh) {
    for (const key of DAY_KEYS) {
      const h = bh[key];
      if (h && !h.closed) widen(toMin(h.open, '09:00'), toMin(h.close, '18:00'));
    }
  }
  // ここから先は「見つかった範囲を広げる」だけ（フォームと同じ）
  found = true;
  const hh = cs?.holiday_hours;
  if (hh && hh.enabled === true) widen(toMin(hh.open, '09:00'), toMin(hh.close, '18:00'));
  const sp = (cs?.special_business_days || []).find((e) => e && e.date === date);
  if (sp) widen(toMin(sp.open, '09:00'), toMin(sp.close, '18:00'));

  const raw = cs?.time_interval as number | undefined;
  const interval = raw && [10, 15, 20, 30, 45, 60, 120].includes(raw) ? raw : 30;
  const set = new Set<number>();
  for (let m = earliest; m < latest; m += interval) set.add(m);
  const extras = Array.isArray(cs?.extra_minutes) ? (cs?.extra_minutes as number[]).filter((n) => Number.isInteger(n) && n >= 0 && n <= 59) : [];
  if (extras.length > 0) {
    for (let h = Math.floor(earliest / 60); h * 60 < latest; h++) {
      for (const mm of extras) {
        const m = h * 60 + mm;
        if (m >= earliest && m < latest) set.add(m);
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

export interface ChangeSlotContext {
  /** 判定に使う設定（担当スタッフの希望日時設定を重ねたもの） */
  cs: CalendarSettings | null | undefined;
  durationMinutes: number;
  /**
   * 空きを見るカレンダーの予定（自分の予約の予定は除いておく）。
   * null = 取得できなかった（すべて ✕）/ undefined = カレンダーが無い（設定だけで判定）
   */
  events: CalendarEventLike[] | null | undefined;
  /** true = スタッフのカレンダー（1 件でも重なれば ✕）/ false = 店舗カレンダー（同時刻に埋まるイベント数まで） */
  staffMode: boolean;
  /** 店舗カレンダーの上限（`max_concurrent_events`） */
  capacity: number;
  /** スタッフ同時刻上限（ON のときだけ）と、ほかのスタッフのカレンダーの予定 */
  staffCap?: number | null;
  otherStaffEvents?: Array<CalendarEventLike[] | null>;
}

export interface ChangeSlot {
  time: string;
  ok: boolean;
}

/** カレンダーの予定から見て、その枠が空いているか（フォームのカレンダーと同じ判定） */
export function isSlotFreeByEvents(ctx: ChangeSlotContext, date: string, time: string): boolean {
  if (ctx.events === null) return false;
  if (ctx.events === undefined) return true;
  const window = resolveReservationSlotWindow(date, time, ctx.durationMinutes, ctx.cs as { time_interval?: unknown } | null | undefined);
  if (!window) return false;
  const { slotStart, slotEnd } = window;
  if (ctx.staffMode) {
    if (ctx.events.some((ev) => eventOverlapsSlot(ev, slotStart, slotEnd))) return false;
    if (typeof ctx.staffCap === 'number' && ctx.staffCap >= 1) {
      const others = ctx.otherStaffEvents || [];
      const busy = others.reduce((n, evs) => n + (evs === null || evs.some((ev) => eventOverlapsSlot(ev, slotStart, slotEnd)) ? 1 : 0), 0);
      if (busy >= ctx.staffCap) return false;
    }
    return true;
  }
  const count = countEventsOverlappingSlot(ctx.events, slotStart, slotEnd);
  if (count >= ctx.capacity) return false;
  // 「営業日」イベントがその日にあるときは、その時間帯の中だけ予約できる
  const dayStart = new Date(`${date}T00:00:00+09:00`).getTime();
  const dayEnd = dayStart + 86400000;
  const businessRanges = ctx.events
    .filter(isBusinessDayEvent)
    .map(resolveEventRange)
    .filter((r): r is { start: Date; end: Date } => !!r && r.start.getTime() >= dayStart && r.start.getTime() < dayEnd);
  if (businessRanges.length > 0) return businessRanges.some((r) => slotStart < r.end && r.start < slotEnd);
  return true;
}

/**
 * その日の時間の一覧と〇✕。営業時間内の時刻だけを並べる（定休日・予約できない祝日は空）。
 * 〇 = フォームの規則（受付期間・営業時間・✕にする時間帯・営業時間超過など）を満たし、カレンダーも空いている
 */
export function evaluateDaySlots(ctx: ChangeSlotContext, date: string, now: Date): ChangeSlot[] {
  if (!DATE_RE.test(date)) return [];
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const { hours } = dayBusinessHours(ctx.cs, date, dow);
  if (hours?.closed === true) return [];
  const open = hours ? toMin(hours.open, '09:00') : null;
  const close = hours ? toMin(hours.close, '18:00') : null;
  const input = { date, durationMinutes: ctx.durationMinutes, now };
  const slots: ChangeSlot[] = [];
  for (const min of listGridTimes(ctx.cs, date)) {
    if (open !== null && close !== null && !(min >= open && min < close)) continue;
    const time = fmtMin(min);
    const ruleOk = isSlotBookableForSettings(ctx.cs, { ...input, time });
    slots.push({ time, ok: ruleOk && isSlotFreeByEvents(ctx, date, time) });
  }
  return slots;
}

export type ChangeDayStatus = 'open' | 'full' | 'closed';

export interface ChangeDay {
  date: string;
  status: ChangeDayStatus;
}

/**
 * 日付ごとの状態: open = 空きあり / full = 受付はしているが空きが無い / closed = 定休日・受付期間外など。
 * `exclude` の日時（いまの予約の日時）は空きに数えない
 */
export function evaluateChangeDays(
  ctx: ChangeSlotContext,
  dates: string[],
  now: Date,
  exclude?: { date: string; time: string } | null
): ChangeDay[] {
  return dates.map((date) => {
    const slots = evaluateDaySlots(ctx, date, now);
    const ruleCtx: ChangeSlotContext = { ...ctx, events: undefined };
    const anyRuleOk = evaluateDaySlots(ruleCtx, date, now).some((s) => s.ok);
    if (!anyRuleOk) return { date, status: 'closed' as const };
    const anyFree = slots.some((s) => s.ok && !(exclude && exclude.date === date && exclude.time === s.time));
    return { date, status: anyFree ? ('open' as const) : ('full' as const) };
  });
}
