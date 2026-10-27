/**
 * 宿泊モード（booking_mode = 'stay'）の料金計算・設定の正規化（純粋ロジック。DB / DOM 非依存）
 *
 * - 人数の区分（guest_categories）: 店舗が自由に作る。charge = adult（有料人数に数える）/ free / fixed_per_night（1 人 1 泊 price 円加算）
 * - 料金表（rate_tables）: by_count（有料人数 → 1 泊料金）/ per_person（単価 × 有料人数）。曜日 / 祝前日 / 祝日 / 季節 / 特定日に割り当てる
 * - 1 泊の料金表の優先順位: 特定日 > 季節 > 祝日 > 祝前日 > 曜日 > 基本
 * - 合計 = Σ 各夜の料金 − 連泊割引（min_nights を満たす最大の段階を 1 つ）
 *
 * 祝日判定は呼び出し側から isHoliday(date) を渡す（静的 HTML は HOLIDAY_RUNTIME_JS、サーバーは同じ計算の TS 版）。
 * 静的 HTML 用の同じ計算は src/lib/stay-runtime-js.ts（STAY_RUNTIME_JS）に持つ。直すときは両方。
 * 設計: docs/旅館用予約フォーム検討資料/旅館用予約フォーム_実装設計.md
 */
import type {
  StayGuestCategory,
  StayLongStayDiscount,
  StayPricing,
  StayRateTable,
  StaySeason,
  StaySettings,
} from '@/types/form';

export type GuestCounts = { [categoryId: string]: number };
export type IsHoliday = (date: string) => boolean;

export interface StayNightLine {
  date: string;
  rate_table_id: string;
  rate_table_name: string;
  price: number;
}

export interface StayDiscountResult extends StayLongStayDiscount {
  amount: number;
}

export interface StayTotal {
  nights: number;
  per_night: StayNightLine[];
  subtotal: number;
  discount: StayDiscountResult | null;
  total: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

export const DEFAULT_RATE_TABLE_ID = 'base';
export const DEFAULT_ADULT_CATEGORY_ID = 'adult';
export const DEFAULT_CHILD_CATEGORY_ID = 'child';

// ---- 日付ユーティリティ（UTC で計算してタイムゾーンの影響を受けない） ----

export function isDateString(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function dateToUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function msToDateString(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  return msToDateString(dateToUtcMs(date) + n * 86400000);
}

/** b − a（日） */
export function diffDays(a: string, b: string): number {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / 86400000);
}

export function dayOfWeek(date: string): number {
  return new Date(dateToUtcMs(date)).getUTCDay();
}

export function normalizeHHMM(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const m = TIME_RE.exec(t.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// ---- 既定値 ----

export function createDefaultStaySettings(): StaySettings {
  return {
    check_in_time: '15:00',
    check_out_time: '10:00',
    min_nights: 1,
    max_nights: 7,
    room_count: 1,
    closed_weekdays: [],
    closed_dates: [],
    closed_ranges: [],
    guest_categories: [
      { id: DEFAULT_ADULT_CATEGORY_ID, label: '6歳以上', charge: 'adult', min: 1, max: 4, counts_toward_capacity: true },
      { id: DEFAULT_CHILD_CATEGORY_ID, label: '0〜5歳', charge: 'free', min: 0, max: 3, counts_toward_capacity: true },
    ],
    pricing: {
      rate_tables: [
        { id: DEFAULT_RATE_TABLE_ID, name: '基本', mode: 'by_count', prices: { '1': 14000, '2': 20000, '3': 26000 } },
      ],
      default_rate_table_id: DEFAULT_RATE_TABLE_ID,
      weekday_rate_table_ids: {},
      seasons: [],
      date_rate_table_ids: [],
      long_stay_discounts: [],
    },
    show_price_on_calendar: true,
    price_note: '',
    block_calendar_ids: [],
  };
}

// ---- 正規化 ----

function toInt(v: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Math.floor(Number(v)) : fallback;
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
}

function toMoney(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function toId(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function sanitizeGuestCategories(raw: unknown): StayGuestCategory[] {
  const defaults = createDefaultStaySettings().guest_categories;
  if (!Array.isArray(raw)) return defaults;
  const out: StayGuestCategory[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const c = r as Record<string, unknown>;
    let id = toId(c.id, `cat${i + 1}`);
    if (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    const charge: StayGuestCategory['charge'] = c.charge === 'free' || c.charge === 'fixed_per_night' ? c.charge : 'adult';
    const min = toInt(c.min, 0, 0, 99);
    const max = Math.max(min, toInt(c.max, Math.max(min, 1), 0, 99));
    const price = charge === 'fixed_per_night' ? toMoney(c.price) ?? 0 : undefined;
    out.push({
      id,
      label: typeof c.label === 'string' && c.label.trim() ? c.label.trim().slice(0, 30) : `区分${i + 1}`,
      charge,
      ...(price !== undefined ? { price } : {}),
      min,
      max,
      counts_toward_capacity: c.counts_toward_capacity !== false,
    });
  });
  if (out.length === 0) return defaults;
  if (!out.some((c) => c.charge === 'adult')) {
    out[0] = { ...out[0], charge: 'adult', min: Math.max(1, out[0].min), max: Math.max(1, out[0].max) };
    delete (out[0] as { price?: number }).price;
  }
  // adult 区分のうち最初のものは 1 人以上（0 人では料金が引けない）
  const firstAdult = out.find((c) => c.charge === 'adult');
  if (firstAdult && firstAdult.min < 1) {
    firstAdult.min = 1;
    if (firstAdult.max < 1) firstAdult.max = 1;
  }
  return out;
}

function sanitizeRateTable(raw: unknown, index: number): StayRateTable | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mode: StayRateTable['mode'] = r.mode === 'per_person' ? 'per_person' : 'by_count';
  const prices: { [count: string]: number } = {};
  if (r.prices && typeof r.prices === 'object') {
    for (const [k, v] of Object.entries(r.prices as Record<string, unknown>)) {
      const count = /^\d{1,2}$/.test(k) ? parseInt(k, 10) : NaN;
      const money = toMoney(v);
      if (!Number.isFinite(count) || count < 1 || money === null) continue;
      prices[String(count)] = money;
    }
  }
  const out: StayRateTable = {
    id: toId(r.id, `rate${index + 1}`),
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 30) : `料金表${index + 1}`,
    mode,
    prices,
  };
  const per = toMoney(r.per_person_price);
  if (per !== null) out.per_person_price = per;
  const extra = toMoney(r.extra_person_price);
  if (extra !== null) out.extra_person_price = extra;
  return out;
}

function sanitizeSeasons(raw: unknown, tableIds: Set<string>, fallbackId: string): StaySeason[] {
  if (!Array.isArray(raw)) return [];
  const out: StaySeason[] = [];
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const s = r as Record<string, unknown>;
    const start = s.start;
    const end = s.end;
    if (!isDateString(start) || !isDateString(end) || end < start) return;
    // 重なる期間は先勝ち
    if (out.some((o) => !(end < o.start || start > o.end))) return;
    const rid = typeof s.rate_table_id === 'string' && tableIds.has(s.rate_table_id) ? s.rate_table_id : fallbackId;
    out.push({
      id: toId(s.id, `season${i + 1}`),
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 30) : `期間${i + 1}`,
      start,
      end,
      rate_table_id: rid,
    });
  });
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

function sanitizeDiscounts(raw: unknown): StayLongStayDiscount[] {
  if (!Array.isArray(raw)) return [];
  const out: StayLongStayDiscount[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const d = r as Record<string, unknown>;
    const type: StayLongStayDiscount['type'] = d.type === 'per_night' || d.type === 'total' ? d.type : 'percent';
    const minNights = Math.max(1, toInt(d.min_nights, 1, 0, 365));
    let value = toMoney(d.value) ?? 0;
    if (type === 'percent') value = Math.min(100, value);
    out.push({ min_nights: minNights, type, value });
  }
  return out.sort((a, b) => a.min_nights - b.min_nights);
}

export function sanitizeStayPricing(raw: unknown): StayPricing {
  const def = createDefaultStaySettings().pricing;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tables: StayRateTable[] = [];
  const ids = new Set<string>();
  if (Array.isArray(r.rate_tables)) {
    r.rate_tables.forEach((t, i) => {
      const st = sanitizeRateTable(t, i);
      if (!st) return;
      if (ids.has(st.id)) st.id = `${st.id}_${i + 1}`;
      ids.add(st.id);
      tables.push(st);
    });
  }
  if (tables.length === 0) {
    tables.push(def.rate_tables[0]);
    ids.add(def.rate_tables[0].id);
  }
  const defaultId = typeof r.default_rate_table_id === 'string' && ids.has(r.default_rate_table_id) ? r.default_rate_table_id : tables[0].id;
  const ref = (v: unknown): string | undefined => (typeof v === 'string' && ids.has(v) ? v : undefined);

  const weekday: { [dow: string]: string } = {};
  if (r.weekday_rate_table_ids && typeof r.weekday_rate_table_ids === 'object') {
    for (const [k, v] of Object.entries(r.weekday_rate_table_ids as Record<string, unknown>)) {
      if (!/^[0-6]$/.test(k)) continue;
      const id = ref(v);
      if (id) weekday[k] = id;
    }
  }
  const dateIds: Array<{ date: string; rate_table_id: string }> = [];
  if (Array.isArray(r.date_rate_table_ids)) {
    const seen = new Set<string>();
    for (const x of r.date_rate_table_ids) {
      if (!x || typeof x !== 'object') continue;
      const d = (x as { date?: unknown; rate_table_id?: unknown });
      const id = ref(d.rate_table_id);
      if (!isDateString(d.date) || !id || seen.has(d.date)) continue;
      seen.add(d.date);
      dateIds.push({ date: d.date, rate_table_id: id });
    }
    dateIds.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  const out: StayPricing = {
    rate_tables: tables,
    default_rate_table_id: defaultId,
    weekday_rate_table_ids: weekday,
    seasons: sanitizeSeasons(r.seasons, ids, defaultId),
    date_rate_table_ids: dateIds,
    long_stay_discounts: sanitizeDiscounts(r.long_stay_discounts),
  };
  const eve = ref(r.holiday_eve_rate_table_id);
  if (eve) out.holiday_eve_rate_table_id = eve;
  const hol = ref(r.holiday_rate_table_id);
  if (hol) out.holiday_rate_table_id = hol;
  return out;
}

/** 保存データを既定値で補完する（normalizeForm が呼ぶ。不正な値は捨てる） */
export function sanitizeStaySettings(raw: unknown): StaySettings {
  const def = createDefaultStaySettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const closedWeekdays = Array.isArray(r.closed_weekdays)
    ? [...new Set(r.closed_weekdays.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const closedDates = Array.isArray(r.closed_dates)
    ? [...new Set(r.closed_dates.filter((d): d is string => isDateString(d)))].sort()
    : [];
  const closedRanges: NonNullable<StaySettings['closed_ranges']> = [];
  if (Array.isArray(r.closed_ranges)) {
    for (const x of r.closed_ranges) {
      if (!x || typeof x !== 'object') continue;
      const c = x as { start?: unknown; end?: unknown; label?: unknown };
      if (!isDateString(c.start) || !isDateString(c.end) || c.end < c.start) continue;
      const item: { start: string; end: string; label?: string } = { start: c.start, end: c.end };
      if (typeof c.label === 'string' && c.label.trim()) item.label = c.label.trim().slice(0, 30);
      closedRanges.push(item);
    }
    closedRanges.sort((a, b) => (a.start < b.start ? -1 : 1));
  }
  const checkInOptions = Array.isArray(r.check_in_time_options)
    ? [...new Set(r.check_in_time_options.map((t) => normalizeHHMM(t)).filter((t): t is string => !!t))].sort()
    : [];
  const guestCategories = sanitizeGuestCategories(r.guest_categories);
  const out: StaySettings = {
    check_in_time: normalizeHHMM(r.check_in_time) ?? def.check_in_time,
    check_out_time: normalizeHHMM(r.check_out_time) ?? def.check_out_time,
    min_nights: toInt(r.min_nights, 1, 1, 365),
    max_nights: toInt(r.max_nights, 0, 0, 365),
    room_count: toInt(r.room_count, 1, 1, 99),
    closed_weekdays: closedWeekdays,
    closed_dates: closedDates,
    closed_ranges: closedRanges,
    guest_categories: guestCategories,
    pricing: sanitizeStayPricing(r.pricing),
    show_price_on_calendar: r.show_price_on_calendar !== false,
    price_note: typeof r.price_note === 'string' ? r.price_note.slice(0, 100) : '',
    block_calendar_ids: Array.isArray(r.block_calendar_ids)
      ? [...new Set(r.block_calendar_ids.filter((x): x is string => typeof x === 'string' && !!x.trim()))]
      : [],
  };
  if (checkInOptions.length > 0) out.check_in_time_options = checkInOptions;
  if (out.max_nights > 0 && out.max_nights < out.min_nights) out.max_nights = out.min_nights;
  const cap = toInt(r.total_capacity, 0, 1, 999);
  if (cap > 0) out.total_capacity = cap;
  return out;
}

// ---- 人数 ----

export function paidGuestCount(categories: StayGuestCategory[], counts: GuestCounts): number {
  return categories.reduce((sum, c) => (c.charge === 'adult' ? sum + Math.max(0, counts[c.id] || 0) : sum), 0);
}

export function capacityCount(categories: StayGuestCategory[], counts: GuestCounts): number {
  return categories.reduce((sum, c) => (c.counts_toward_capacity ? sum + Math.max(0, counts[c.id] || 0) : sum), 0);
}

export function totalCapacity(settings: Pick<StaySettings, 'guest_categories' | 'total_capacity'>): number {
  if (settings.total_capacity && settings.total_capacity > 0) return settings.total_capacity;
  return settings.guest_categories.reduce((s, c) => (c.counts_toward_capacity ? s + c.max : s), 0);
}

export function validateGuestCounts(
  settings: Pick<StaySettings, 'guest_categories' | 'total_capacity'>,
  counts: GuestCounts
): { ok: true } | { ok: false; error: string } {
  for (const c of settings.guest_categories) {
    const n = counts[c.id] ?? 0;
    if (!Number.isInteger(n) || n < c.min || n > c.max) {
      return { ok: false, error: `${c.label}は ${c.min}〜${c.max} 名で指定してください` };
    }
  }
  if (paidGuestCount(settings.guest_categories, counts) < 1) {
    return { ok: false, error: '有料のお客様が 1 名以上必要です' };
  }
  const cap = totalCapacity(settings);
  if (cap > 0 && capacityCount(settings.guest_categories, counts) > cap) {
    return { ok: false, error: `定員は合計 ${cap} 名までです` };
  }
  return { ok: true };
}

/** 「6歳以上 2名 / 0〜5歳 1名」（0 名の区分は省く） */
export function formatGuestCountsJa(categories: StayGuestCategory[], counts: GuestCounts): string {
  return categories
    .filter((c) => (counts[c.id] || 0) > 0)
    .map((c) => `${c.label} ${counts[c.id]}名`)
    .join(' / ');
}

// ---- 料金 ----

function tableById(pricing: StayPricing, id: string | undefined): StayRateTable | undefined {
  return id ? pricing.rate_tables.find((t) => t.id === id) : undefined;
}

/** その夜に使う料金表（特定日 > 季節 > 祝日 > 祝前日 > 曜日 > 基本） */
export function resolveRateTable(pricing: StayPricing, date: string, isHoliday: IsHoliday): StayRateTable {
  const fallback = tableById(pricing, pricing.default_rate_table_id) || pricing.rate_tables[0];
  const specific = pricing.date_rate_table_ids?.find((d) => d.date === date);
  if (specific) return tableById(pricing, specific.rate_table_id) || fallback;
  const season = pricing.seasons?.find((s) => s.start <= date && date <= s.end);
  if (season) return tableById(pricing, season.rate_table_id) || fallback;
  if (isHoliday(date)) {
    const t = tableById(pricing, pricing.holiday_rate_table_id);
    if (t) return t;
  }
  if (isHoliday(addDays(date, 1))) {
    const t = tableById(pricing, pricing.holiday_eve_rate_table_id);
    if (t) return t;
  }
  const w = tableById(pricing, pricing.weekday_rate_table_ids?.[String(dayOfWeek(date))]);
  if (w) return w;
  return fallback;
}

/** 料金表から有料人数ぶんの 1 泊料金。引けないときは null */
export function rateTablePrice(table: StayRateTable, paidCount: number): number | null {
  if (!Number.isInteger(paidCount) || paidCount < 1) return null;
  if (table.mode === 'per_person') {
    return typeof table.per_person_price === 'number' ? table.per_person_price * paidCount : null;
  }
  const exact = table.prices[String(paidCount)];
  if (typeof exact === 'number') return exact;
  const keys = Object.keys(table.prices).map(Number).filter((n) => Number.isFinite(n) && n >= 1);
  if (keys.length === 0) return null;
  const maxKey = Math.max(...keys);
  if (paidCount > maxKey && typeof table.extra_person_price === 'number') {
    return table.prices[String(maxKey)] + table.extra_person_price * (paidCount - maxKey);
  }
  return null;
}

/** 1 泊の料金（区分の加算込み）。引けないときは null */
export function resolveNightPrice(settings: StaySettings, date: string, counts: GuestCounts, isHoliday: IsHoliday): number | null {
  const table = resolveRateTable(settings.pricing, date, isHoliday);
  const base = rateTablePrice(table, paidGuestCount(settings.guest_categories, counts));
  if (base === null) return null;
  const extra = settings.guest_categories.reduce((sum, c) => {
    if (c.charge !== 'fixed_per_night') return sum;
    return sum + (c.price || 0) * Math.max(0, counts[c.id] || 0);
  }, 0);
  return base + extra;
}

/** 連泊割引: min_nights を満たす最大の段階を 1 つ。該当なしは null */
export function resolveLongStayDiscount(
  discounts: StayLongStayDiscount[] | undefined,
  nights: number,
  subtotal: number
): StayDiscountResult | null {
  if (!discounts || discounts.length === 0 || nights < 1) return null;
  let best: StayLongStayDiscount | null = null;
  for (const d of discounts) {
    if (nights >= d.min_nights && (!best || d.min_nights > best.min_nights)) best = d;
  }
  if (!best) return null;
  let amount = 0;
  if (best.type === 'percent') amount = Math.floor((subtotal * best.value) / 100);
  else if (best.type === 'per_night') amount = best.value * nights;
  else amount = best.value;
  amount = Math.max(0, Math.min(subtotal, amount));
  return { ...best, amount };
}

/** チェックイン〜チェックアウトの宿泊料金（夜ごとの内訳・小計・割引・合計） */
export function computeStayTotal(
  settings: StaySettings,
  checkin: string,
  checkout: string,
  counts: GuestCounts,
  isHoliday: IsHoliday
): StayTotal | { error: string } {
  if (!isDateString(checkin) || !isDateString(checkout)) return { error: '日付の形式が正しくありません' };
  const nights = diffDays(checkin, checkout);
  if (nights < 1) return { error: 'チェックアウト日はチェックイン日より後にしてください' };
  const perNight: StayNightLine[] = [];
  for (let i = 0; i < nights; i++) {
    const date = addDays(checkin, i);
    const table = resolveRateTable(settings.pricing, date, isHoliday);
    const price = resolveNightPrice(settings, date, counts, isHoliday);
    if (price === null) return { error: `${date} はこの人数の料金が設定されていません` };
    perNight.push({ date, rate_table_id: table.id, rate_table_name: table.name, price });
  }
  const subtotal = perNight.reduce((s, n) => s + n.price, 0);
  const discount = resolveLongStayDiscount(settings.pricing.long_stay_discounts, nights, subtotal);
  return { nights, per_night: perNight, subtotal, discount, total: subtotal - (discount?.amount || 0) };
}

// ---- 表示 ----

export function formatDateJa(date: string, withYear = true): string {
  const [y, m, d] = date.split('-');
  return `${withYear ? `${y}年` : ''}${m}月${d}日（${DOW_JA[dayOfWeek(date)]}）`;
}

/** 「2026年11月01日（日）〜11月02日（月） 1泊」（年が変わるときはチェックアウト側にも年を付ける） */
export function formatStayRangeJa(checkin: string, checkout: string, nights: number): string {
  const sameYear = checkin.slice(0, 4) === checkout.slice(0, 4);
  return `${formatDateJa(checkin)}〜${formatDateJa(checkout, !sameYear)} ${nights}泊`;
}
