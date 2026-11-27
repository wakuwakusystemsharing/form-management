/**
 * 料金の「幅」と「自由に書く表示」（メニュー / サブメニュー / オプション / カテゴリー共通オプション / オプションのオプション）
 *
 * - `price`      … 料金（円）。幅があるときは下限。合計金額・売上の計算に使う
 * - `price_max`  … 上限（円）。`price` より大きいときだけ意味を持つ → フォームに「¥5,000〜¥7,000」と出す
 * - `price_label`… 料金の表示を自由に書く（例: 「¥5,000〜」「要相談」）。あればこちらを優先して出す（計算には使わない）
 *
 * 合計金額は「下限の合計〜上限の合計」で出す。予約データには、幅のある項目だけ `price_max` を残し
 * （`selected_menus[].price_max` / `selected_options[].price_max`）、合計の上限は
 * `customer_info.total_price + priceSpread(...)` でいつでも計算し直せるようにする（合計の上限そのものは保存しない）。
 *
 * 生成 HTML には下の PRICE_RANGE_RUNTIME_JS に同じ実装を持つ。直すときは両方
 */

export const PRICE_LABEL_MAX = 40;

export interface PriceRangeItem {
  price?: number | null;
  price_max?: number | null;
  price_label?: string | null;
  hide_price?: boolean;
}

const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').replace(/[^0-9.-]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

/** 上限の金額（幅が無いときは料金と同じ） */
export function resolvePriceMax(item: PriceRangeItem | null | undefined): number {
  const min = int(item?.price);
  const max = int(item?.price_max);
  return max > min ? max : min;
}

/** 幅のある料金か */
export function hasPriceRange(item: PriceRangeItem | null | undefined): boolean {
  return resolvePriceMax(item) > int(item?.price);
}

/** 保存する上限（料金より大きいときだけ。それ以外は undefined = 項目を持たない） */
export function sanitizePriceMax(price: unknown, max: unknown): number | undefined {
  const m = int(max);
  return m > int(price) ? m : undefined;
}

/** 保存する自由入力の表示（1 行・40 文字まで。空は undefined） */
export function normalizePriceLabel(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, PRICE_LABEL_MAX);
  return s || undefined;
}

/** 「¥5,000〜¥7,000」（幅が無ければ「¥5,000」） */
export function formatYenRange(min: unknown, max: unknown): string {
  const lo = int(min);
  const hi = int(max);
  return hi > lo ? `${yen(lo)}〜${yen(hi)}` : yen(lo);
}

/**
 * フォームのボタンに出す料金の文字（空文字 = 出さない）。
 * @param opts.plus     true = オプション（「+¥1,000」）
 * @param opts.zeroText 料金 0 のときに出す文字（メニューオプションの「無料」）
 */
export function itemPriceText(item: PriceRangeItem | null | undefined, opts: { plus?: boolean; zeroText?: string } = {}): string {
  if (!item || item.hide_price) return '';
  const label = normalizePriceLabel(item.price_label);
  if (label) return label;
  const min = int(item.price);
  const max = resolvePriceMax(item);
  if (max <= 0) return opts.zeroText || '';
  return `${opts.plus ? '+' : ''}${formatYenRange(min, max)}`;
}

/** 予約データ（selected_menus / selected_options）の、上限と下限の差の合計 */
export function priceSpread(menus: unknown, options: unknown): number {
  let spread = 0;
  for (const list of [menus, options]) {
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      if (!x || typeof x !== 'object') continue;
      const row = x as Record<string, unknown>;
      const diff = int(row.price_max) - int(row.price);
      if (diff > 0) spread += diff;
    }
  }
  return spread;
}

/** 合計金額の表示（幅があれば「¥6,000〜¥8,000」） */
export function formatTotalPrice(total: unknown, spread: unknown = 0): string {
  const lo = int(total);
  return formatYenRange(lo, lo + int(spread));
}

/** 予約の合計金額の表示（customer_info.total_price + 選んだ項目の幅） */
export function reservationTotalPriceText(reservation: { customer_info?: unknown; selected_menus?: unknown; selected_options?: unknown } | null | undefined): string {
  const info = reservation?.customer_info;
  const total = info && typeof info === 'object' && !Array.isArray(info) ? int((info as Record<string, unknown>).total_price) : 0;
  if (total <= 0) return '';
  return formatTotalPrice(total, priceSpread(reservation?.selected_menus, reservation?.selected_options));
}

/**
 * 生成 HTML に埋め込む JS（バッククォート・テンプレート記法は使わない）
 * - prMax(item) / prRange(min, max) / prItemText(item, plus, zeroText)
 */
export const PRICE_RANGE_RUNTIME_JS = `
function prInt(v) {
    var n = typeof v === 'number' ? v : parseInt(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''), 10);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function prMax(item) {
    var min = prInt(item && item.price);
    var max = prInt(item && item.price_max);
    return max > min ? max : min;
}
function prRange(min, max) {
    var lo = prInt(min);
    var hi = prInt(max);
    return hi > lo ? '¥' + lo.toLocaleString() + '〜¥' + hi.toLocaleString() : '¥' + lo.toLocaleString();
}
function prLabel(item) {
    var v = item && item.price_label;
    if (typeof v !== 'string') return '';
    return v.replace(/[ \\t\\r\\n　]+/g, ' ').replace(/^ +| +$/g, '').slice(0, ${PRICE_LABEL_MAX});
}
function prItemText(item, plus, zeroText) {
    if (!item || item.hide_price) return '';
    var label = prLabel(item);
    if (label) return label;
    var max = prMax(item);
    if (max <= 0) return zeroText || '';
    return (plus ? '+' : '') + prRange(item.price, max);
}
`;
