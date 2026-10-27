/**
 * 宿泊予約（booking_mode = 'stay'）の表示用ヘルパー（純粋関数。クライアント / サーバー両方から使う）
 *
 * 予約一覧・顧客詳細・予約詳細・メールで「11/1(日) 〜 11/4(月) 3泊」や
 * チェックイン / チェックアウト / 泊数 / 人数 / 宿泊料金 の行を同じ書式で出すためにまとめる。
 * 宿泊かどうかは reservations.checkout_date か customer_info.checkout_date で判定する
 * （メール送信など customer_info だけが渡る経路があるため）
 */

export interface StayReservationLike {
  reservation_date: string;
  reservation_time?: string | null;
  checkout_date?: string | null;
  stay_nights?: number | null;
  guest_count?: number | null;
  stay_price_total?: number | null;
  status?: string | null;
  cancel_fee_percent?: number | null;
  cancel_fee_amount?: number | null;
  customer_info?: unknown;
}

interface StayInfo {
  checkout_date?: string;
  stay_nights?: number;
  check_in_time?: string;
  check_out_time?: string;
  guest_text?: string;
  stay_subtotal?: number;
  stay_discount?: { amount?: number; min_nights?: number } | null;
  stay_price_total?: number;
  stay_per_night?: Array<{ date: string; price: number; rate_table_name?: string }>;
}

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function info(r: StayReservationLike): StayInfo {
  return r.customer_info && typeof r.customer_info === 'object' ? (r.customer_info as StayInfo) : {};
}

function dow(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '';
}

export function isStayReservation(r: StayReservationLike | null | undefined): boolean {
  if (!r) return false;
  return !!(r.checkout_date || info(r).checkout_date);
}

export function stayCheckoutDate(r: StayReservationLike): string | null {
  return (r.checkout_date || info(r).checkout_date || null) as string | null;
}

export function stayNightCount(r: StayReservationLike): number {
  const n = Number(r.stay_nights ?? info(r).stay_nights);
  if (Number.isFinite(n) && n > 0) return n;
  const co = stayCheckoutDate(r);
  if (!co || !r.reservation_date) return 0;
  const diff = Math.round((Date.parse(`${co}T00:00:00Z`) - Date.parse(`${String(r.reservation_date).slice(0, 10)}T00:00:00Z`)) / 86400000);
  return diff > 0 ? diff : 0;
}

export function stayPriceTotal(r: StayReservationLike): number | null {
  const v = typeof r.stay_price_total === 'number' ? r.stay_price_total : info(r).stay_price_total;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** "2026-11-01" → "11/1(日)" */
export function formatShortDateJa(date: string): string {
  const d = String(date).slice(0, 10);
  const [, m, dd] = d.split('-');
  if (!m || !dd) return d;
  return `${Number(m)}/${Number(dd)}(${dow(d)})`;
}

/** "2026-11-01" → "2026年11月01日（日）" */
export function formatLongDateJa(date: string): string {
  const d = String(date).slice(0, 10);
  const [y, m, dd] = d.split('-');
  if (!y || !m || !dd) return d;
  return `${y}年${m}月${dd}日（${dow(d)}）`;
}

/** 一覧用: "11/1(日) 〜 11/4(月) 3泊" */
export function formatStayRangeShort(r: StayReservationLike): string {
  const co = stayCheckoutDate(r);
  if (!co) return formatShortDateJa(r.reservation_date);
  const nights = stayNightCount(r);
  return `${formatShortDateJa(r.reservation_date)} 〜 ${formatShortDateJa(co)}${nights > 0 ? ` ${nights}泊` : ''}`;
}

/** 宿泊料金の表示（割引があれば「¥60,000 − 連泊割引 ¥6,000 = ¥54,000」） */
export function formatStayPriceText(r: StayReservationLike): string | null {
  const total = stayPriceTotal(r);
  if (total === null) return null;
  const i = info(r);
  const discount = i.stay_discount && typeof i.stay_discount.amount === 'number' ? i.stay_discount.amount : 0;
  const subtotal = typeof i.stay_subtotal === 'number' ? i.stay_subtotal : total + discount;
  if (discount > 0) return `¥${subtotal.toLocaleString()} − 連泊割引 ¥${discount.toLocaleString()} = ¥${total.toLocaleString()}`;
  return `¥${total.toLocaleString()}`;
}

export interface StayDetailRow {
  label: string;
  value: string;
}

/**
 * 予約内容の行（チェックイン / チェックアウト / 泊数 / 宿泊人数 / 宿泊料金）。
 * includeCheckIn = false のときは基本情報カードに予約日時が別に出る画面向け（チェックアウト以降だけ）
 */
export function buildStayDetailRows(r: StayReservationLike, options: { includeCheckIn?: boolean } = {}): StayDetailRow[] {
  const co = stayCheckoutDate(r);
  if (!co) return [];
  const i = info(r);
  const rows: StayDetailRow[] = [];
  const checkInTime = String(r.reservation_time || i.check_in_time || '').slice(0, 5);
  const checkOutTime = String(i.check_out_time || '').slice(0, 5);
  if (options.includeCheckIn !== false) {
    rows.push({ label: 'チェックイン', value: `${formatLongDateJa(r.reservation_date)}${checkInTime ? ` ${checkInTime}` : ''}` });
  }
  rows.push({ label: 'チェックアウト', value: `${formatLongDateJa(co)}${checkOutTime ? ` ${checkOutTime}` : ''}` });
  const nights = stayNightCount(r);
  if (nights > 0) rows.push({ label: '泊数', value: `${nights}泊` });
  if (i.guest_text) rows.push({ label: '宿泊人数', value: i.guest_text });
  const price = formatStayPriceText(r);
  if (price) rows.push({ label: '宿泊料金', value: price });
  return rows;
}

/** キャンセル済みでキャンセル料が記録されていれば「50%（¥10,000）」 */
export function formatCancelFeeText(r: StayReservationLike): string | null {
  if (r.status !== 'cancelled') return null;
  const pct = r.cancel_fee_percent;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const amt = typeof r.cancel_fee_amount === 'number' ? r.cancel_fee_amount : null;
  if (pct === 0) return 'なし（0%）';
  return `${pct}%${amt !== null ? `（¥${amt.toLocaleString()}）` : ''}`;
}
