/**
 * 宿泊予約（booking_mode = 'stay'）の受付時の検証と保存項目の組み立て（純粋ロジック。fs / Supabase 非依存）
 *
 * POST /api/reservations（local / Supabase 両方）と PATCH /api/reservations/{id} が使う。
 * 空き（他の予約・カレンダー予定との重なり）はここでは見ない（src/lib/stay-service.ts）。
 */
import type { Form } from '@/types/form';
import { resolveEarliestBookable } from './advance-rules';
import { isHolidayBlocked, isJapaneseHoliday } from './japanese-holidays';
import { addDays, isNightClosed, jstDateString, nightsBetween, toJstLocalDate } from './stay-availability';
import {
  computeStayTotal,
  formatGuestCountsJa,
  paidGuestCount,
  sanitizeStaySettings,
  validateGuestCounts,
  type GuestCounts,
  type StayTotal,
} from './stay-pricing';
import { resolveCancelFee, resolveCancelRules, type CancelFeeResult } from './cancel-rules';

type CalendarSettingsLike = Partial<Form['config']['calendar_settings']> | null | undefined;

export interface StayBodyInput {
  reservation_date?: unknown;
  checkout_date?: unknown;
  guest_counts?: unknown;
  reservation_time?: unknown;
}

/** customer_info に入れる宿泊の内訳（表示側・メール・管理画面が JSONB だけで描けるように） */
export interface StayCustomerInfo {
  booking_mode: 'stay';
  checkout_date: string;
  stay_nights: number;
  check_in_time: string;
  check_out_time: string;
  guest_counts: GuestCounts;
  guest_labels: { [categoryId: string]: string };
  guest_text: string;
  stay_per_night: StayTotal['per_night'];
  stay_subtotal: number;
  stay_discount: StayTotal['discount'];
  stay_price_total: number;
}

export interface StayPrepared {
  reservation_date: string;
  reservation_time: string;
  checkout_date: string;
  stay_nights: number;
  nights: string[];
  guest_counts: GuestCounts;
  guest_count: number;
  stay_price_total: number;
  customer_info: StayCustomerInfo;
}

export function isStayMode(cs: CalendarSettingsLike): boolean {
  return cs?.booking_mode === 'stay';
}

/** body.guest_counts を区分ごとの整数にする（無い区分は min） */
export function normalizeGuestCounts(
  settings: { guest_categories: Array<{ id: string; min: number }> },
  raw: unknown
): GuestCounts {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: GuestCounts = {};
  for (const c of settings.guest_categories) {
    const v = src[c.id];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    out[c.id] = Number.isFinite(n) ? Math.floor(n) : c.min;
  }
  return out;
}

/**
 * 宿泊予約の入力を検証し、保存する値を組み立てる。
 * 受付期間・休業・祝日不可・泊数・人数・料金の計算可否を見る（空きは見ない）
 */
export function prepareStayReservation(
  cs: CalendarSettingsLike,
  body: StayBodyInput,
  now: Date = new Date(),
  options: { skipWindow?: boolean } = {}
): { ok: true; value: StayPrepared } | { ok: false; error: string } {
  const settings = sanitizeStaySettings(cs?.stay_settings);
  const checkin = typeof body.reservation_date === 'string' ? body.reservation_date : '';
  const checkout = typeof body.checkout_date === 'string' ? body.checkout_date : '';
  const nights = nightsBetween(checkin, checkout);
  if (nights.length === 0) return { ok: false, error: 'チェックイン日とチェックアウト日を正しく指定してください' };
  if (nights.length < settings.min_nights) return { ok: false, error: `${settings.min_nights}泊以上でご予約ください` };
  if (settings.max_nights > 0 && nights.length > settings.max_nights) return { ok: false, error: `最大${settings.max_nights}泊までご予約いただけます` };

  const counts = normalizeGuestCounts(settings, body.guest_counts);
  const gv = validateGuestCounts(settings, counts);
  if (!gv.ok) return { ok: false, error: gv.error };

  // 受付期間（JST）。管理画面からの編集（skipWindow）では見ない
  if (!options.skipWindow) {
    const today = jstDateString(now);
    const earliest = addDays(today, resolveEarliestBookable(cs, toJstLocalDate(now)).days);
    const adv = cs?.advance_booking_days;
    const latest = addDays(today, typeof adv === 'number' && Number.isFinite(adv) && adv > 0 ? Math.floor(adv) : 30);
    if (checkin < earliest) return { ok: false, error: 'この日程は受付期間を過ぎています。別の日程をお選びください' };
    if (nights[nights.length - 1] > latest) return { ok: false, error: 'この日程はまだ受付を開始していません。別の日程をお選びください' };
  }

  for (const night of nights) {
    if (isNightClosed(settings, night)) return { ok: false, error: `${night} は休業日のためご予約いただけません` };
    if (isHolidayBlocked(cs, night)) return { ok: false, error: `${night} は祝日のためご予約いただけません` };
  }

  const total = computeStayTotal(settings, checkin, checkout, counts, isJapaneseHoliday);
  if ('error' in total) return { ok: false, error: total.error };

  const requested = typeof body.reservation_time === 'string' ? body.reservation_time.slice(0, 5) : '';
  const reservationTime = settings.check_in_time_options?.includes(requested) ? requested : settings.check_in_time;

  const guestLabels: { [id: string]: string } = {};
  for (const c of settings.guest_categories) guestLabels[c.id] = c.label;

  const customerInfo: StayCustomerInfo = {
    booking_mode: 'stay',
    checkout_date: checkout,
    stay_nights: total.nights,
    check_in_time: reservationTime,
    check_out_time: settings.check_out_time,
    guest_counts: counts,
    guest_labels: guestLabels,
    guest_text: formatGuestCountsJa(settings.guest_categories, counts),
    stay_per_night: total.per_night,
    stay_subtotal: total.subtotal,
    stay_discount: total.discount,
    stay_price_total: total.total,
  };

  return {
    ok: true,
    value: {
      reservation_date: checkin,
      reservation_time: reservationTime,
      checkout_date: checkout,
      stay_nights: total.nights,
      nights,
      guest_counts: counts,
      guest_count: paidGuestCount(settings.guest_categories, counts),
      stay_price_total: total.total,
      customer_info: customerInfo,
    },
  };
}

/** カレンダー予定の長さ（分）: チェックイン時刻 〜 チェックアウト日のチェックアウト時刻 */
export function stayEventDurationMinutes(checkin: string, reservationTime: string, checkout: string, checkOutTime: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const days = nightsBetween(checkin, checkout).length;
  const minutes = days * 24 * 60 + toMin(checkOutTime) - toMin(reservationTime);
  return Math.max(60, minutes);
}

function sumPrices(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce((s: number, x) => s + (x && typeof x === 'object' ? Number((x as { price?: unknown }).price) || 0 : 0), 0);
}

/**
 * 宿泊予約のキャンセル料（フォームのキャンセルルール設定に従う）。
 * fee_base = 'stay' は宿泊料金のみ、'total' はメニュー・オプション込み
 */
export function resolveStayCancelFee(
  config: Pick<Form['config'], 'cancel_rules'> | null | undefined,
  reservation: {
    reservation_date: string;
    stay_price_total?: number | null;
    selected_menus?: unknown;
    selected_options?: unknown;
    customer_info?: unknown;
  },
  now: Date = new Date()
): CancelFeeResult {
  const rules = resolveCancelRules(config ?? undefined);
  const info = reservation.customer_info && typeof reservation.customer_info === 'object' ? (reservation.customer_info as { stay_price_total?: unknown }) : {};
  const stay = typeof reservation.stay_price_total === 'number' ? reservation.stay_price_total : Number(info.stay_price_total) || 0;
  const base = rules.fee_base === 'total' ? stay + sumPrices(reservation.selected_menus) + sumPrices(reservation.selected_options) : stay;
  return resolveCancelFee(rules, reservation.reservation_date, now, base);
}
