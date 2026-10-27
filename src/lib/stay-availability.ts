/**
 * 宿泊モード（booking_mode = 'stay'）の空き判定（純粋ロジック。DB / DOM 非依存）
 *
 * 単位は「夜（night）」。日付 d の夜 = d のチェックイン時刻 〜 d+1 のチェックアウト時刻（JST）。
 * - 予約 [checkin, checkout) は checkin 〜 checkout − 1 の夜を使う（チェックアウト日の夜は使わない）
 * - 夜 d が埋まっている = その夜を使う有効予約数 + その夜の窓に重なる Google カレンダー予定数 ≥ room_count
 * - チェックアウト日に選べる = checkin 〜 d − 1 の夜がすべて空いていて泊数が範囲内（夜 d 自体は埋まっていてよい）
 *
 * 静的 HTML 用の同じ判定は src/lib/stay-runtime-js.ts（STAY_RUNTIME_JS）に持つ。直すときは両方。
 * 設計: docs/旅館用予約フォーム検討資料/旅館用予約フォーム_実装設計.md
 */
import type { ConditionalAdvanceRule, StaySettings } from '@/types/form';
import { resolveEarliestBookable } from './advance-rules';
import {
  addDays,
  dateToUtcMs,
  dayOfWeek,
  diffDays,
  isDateString,
  msToDateString,
  resolveNightPrice,
  type GuestCounts,
  type IsHoliday,
} from './stay-pricing';

export { addDays, diffDays };

export interface DateRange {
  from: string; // 含む
  to: string;   // 含む
}

export interface StayReservationRow {
  reservation_date: string;
  checkout_date?: string | null | undefined;
  status?: string | null | undefined;
}

/** Google カレンダーの予定。start / end は ISO 日時（オフセット付き）か 'YYYY-MM-DD'（終日。end は翌日の日付 = 含まない） */
export interface StayCalendarEvent {
  start: string;
  end: string;
}

export type NightUnavailableReason = 'full' | 'closed' | 'holiday' | 'out_of_range' | 'no_price';

export interface NightStatus {
  available: boolean;
  remaining: number;
  price: number | null;
  reason?: NightUnavailableReason;
}

export type NightStatusMap = { [date: string]: NightStatus };

export interface StayAdvanceSettings {
  min_advance_days?: number;
  conditional_advance_rules?: ConditionalAdvanceRule[];
  advance_booking_days?: number;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** checkin 〜 checkout − 1 の夜。不正 / 0 泊は空配列 */
export function nightsBetween(checkin: string, checkout: string): string[] {
  if (!isDateString(checkin) || !isDateString(checkout)) return [];
  const n = diffDays(checkin, checkout);
  if (n < 1) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(checkin, i));
  return out;
}

export function datesInRange(range: DateRange): string[] {
  const n = diffDays(range.from, range.to);
  if (n < 0) return [];
  const out: string[] = [];
  for (let i = 0; i <= n; i++) out.push(addDays(range.from, i));
  return out;
}

/** 休業（曜日 / 特定日 / 期間）の夜か */
export function isNightClosed(settings: Pick<StaySettings, 'closed_weekdays' | 'closed_dates' | 'closed_ranges'>, date: string): boolean {
  if (settings.closed_weekdays?.includes(dayOfWeek(date))) return true;
  if (settings.closed_dates?.includes(date)) return true;
  if (settings.closed_ranges?.some((r) => r.start <= date && date <= r.end)) return true;
  return false;
}

/** "YYYY-MM-DD" + "HH:MM"（JST）→ epoch ms */
export function jstMs(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return dateToUtcMs(date) + (h * 60 + m) * 60000 - JST_OFFSET_MS;
}

/** 今の JST 日付 "YYYY-MM-DD" */
export function jstDateString(now: Date): string {
  return msToDateString(now.getTime() + JST_OFFSET_MS);
}

/** ローカル時刻の getHours()/getMinutes() が JST の値になる Date（advance-rules が now.getHours() を使うため） */
export function toJstLocalDate(now: Date): Date {
  return new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
}

function parseEventBoundary(v: string): number | null {
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 夜ごとの使用数（予約 + カレンダー予定）。
 * - 時刻付きの予定は夜の窓 [d check_in, d+1 check_out) と重なれば数える（10:00〜15:00 の間だけの予定は数えない）
 * - 終日予定（'YYYY-MM-DD'。end は含まない翌日）はその日付の夜を使う（11/5 終日 → 11/5 の夜。前夜の朝には掛からない）
 */
export function occupiedCountByNight(
  range: DateRange,
  reservations: StayReservationRow[],
  events: StayCalendarEvent[],
  settings: Pick<StaySettings, 'check_in_time' | 'check_out_time'>
): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (d: string) => out.set(d, (out.get(d) || 0) + 1);
  for (const r of reservations) {
    if (!r || r.status === 'cancelled' || !r.checkout_date) continue;
    if (!isDateString(r.reservation_date) || !isDateString(r.checkout_date)) continue;
    for (const night of nightsBetween(r.reservation_date, r.checkout_date)) {
      if (night < range.from || night > range.to) continue;
      bump(night);
    }
  }
  const timed: StayCalendarEvent[] = [];
  for (const e of events) {
    if (!e) continue;
    if (isDateString(e.start)) {
      // 終日予定: start 〜 end の前日 までの夜
      const endExclusive = isDateString(e.end) ? e.end : addDays(e.start, 1);
      for (const night of nightsBetween(e.start, endExclusive)) {
        if (night < range.from || night > range.to) continue;
        bump(night);
      }
      continue;
    }
    timed.push(e);
  }
  if (timed.length > 0) {
    const parsed = timed
      .map((e) => ({ start: parseEventBoundary(e.start), end: parseEventBoundary(e.end) }))
      .filter((e): e is { start: number; end: number } => e.start !== null && e.end !== null && e.end > e.start);
    for (const night of datesInRange(range)) {
      const winStart = jstMs(night, settings.check_in_time);
      const winEnd = jstMs(addDays(night, 1), settings.check_out_time);
      for (const e of parsed) {
        if (e.start < winEnd && e.end > winStart) bump(night);
      }
    }
  }
  return out;
}

/**
 * 範囲内の各夜の状態（空き・残り・料金・不可の理由）。
 * 受付期間は min_advance_days / 条件付き受付開始（日数部分）/ advance_booking_days（既定 30）で判定
 */
export function buildNightStatus(
  range: DateRange,
  occupied: Map<string, number>,
  settings: StaySettings,
  cs: StayAdvanceSettings | null | undefined,
  now: Date,
  isHoliday: IsHoliday,
  isHolidayBlocked: (date: string) => boolean,
  counts: GuestCounts
): NightStatusMap {
  const today = jstDateString(now);
  const earliest = addDays(today, resolveEarliestBookable(cs, toJstLocalDate(now)).days);
  const adv = cs?.advance_booking_days;
  const latest = addDays(today, typeof adv === 'number' && Number.isFinite(adv) && adv > 0 ? Math.floor(adv) : 30);
  const roomCount = Math.max(1, settings.room_count || 1);
  const out: NightStatusMap = {};
  for (const date of datesInRange(range)) {
    const used = occupied.get(date) || 0;
    const remaining = Math.max(0, roomCount - used);
    const price = resolveNightPrice(settings, date, counts, isHoliday);
    let reason: NightUnavailableReason | undefined;
    if (date < earliest || date > latest) reason = 'out_of_range';
    else if (isNightClosed(settings, date)) reason = 'closed';
    else if (isHolidayBlocked(date)) reason = 'holiday';
    else if (remaining <= 0) reason = 'full';
    else if (price === null) reason = 'no_price';
    out[date] = reason
      ? { available: false, remaining, price: reason === 'full' || reason === 'no_price' ? price : null, reason }
      : { available: true, remaining, price };
  }
  return out;
}

/** checkin 〜 checkout で予約できるか（途中の夜がすべて空き、泊数が範囲内） */
export function isRangeBookable(
  status: NightStatusMap,
  checkin: string,
  checkout: string,
  settings: Pick<StaySettings, 'min_nights' | 'max_nights'>
): { ok: boolean; reason?: string } {
  const nights = nightsBetween(checkin, checkout);
  if (nights.length === 0) return { ok: false, reason: 'チェックアウト日はチェックイン日より後にしてください' };
  if (nights.length < Math.max(1, settings.min_nights || 1)) return { ok: false, reason: `${settings.min_nights}泊以上でご予約ください` };
  if (settings.max_nights > 0 && nights.length > settings.max_nights) return { ok: false, reason: `最大${settings.max_nights}泊までご予約いただけます` };
  for (const n of nights) {
    const st = status[n];
    if (!st || !st.available) return { ok: false, reason: `${n} は空きがありません` };
  }
  return { ok: true };
}

/** チェックイン日を決めたときに選べるチェックアウト日（昇順） */
export function selectableCheckoutDates(
  status: NightStatusMap,
  checkin: string,
  settings: Pick<StaySettings, 'min_nights' | 'max_nights'>
): string[] {
  const out: string[] = [];
  const minN = Math.max(1, settings.min_nights || 1);
  const maxN = settings.max_nights > 0 ? settings.max_nights : 365;
  for (let n = 1; n <= maxN; n++) {
    const night = addDays(checkin, n - 1);
    const st = status[night];
    if (!st || !st.available) break;
    if (n >= minN) out.push(addDays(checkin, n));
  }
  return out;
}
