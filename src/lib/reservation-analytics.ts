/**
 * 予約分析（店舗管理者ページ / テナント側 店舗ページの「分析」タブ）の純粋ロジック
 *
 * - キャンセル済み（status = 'cancelled'）は件数・メニュー・時間帯・顧客属性・売上から除外し、
 *   ステータス別集計と「キャンセル数」にだけ数える
 * - 売上は メニュー料金 + オプション料金（顧客管理の total_spent と同じ `calculateTotalAmount` の考え方）
 * - メニューは名前（カテゴリー > メニュー > サブメニュー）でまとめる。menu_id はテンプレート由来で
 *   フォームをまたいで重複する（menu1 など）ため ID では集計しない
 * - 顧客属性は送信時のラベル（customer_info.gender_label など）を優先し、無ければ既定値を日本語に変換
 * - DB 非依存（Vitest 対象）
 */

export interface AnalyticsReservation {
  id?: string;
  form_id?: string | null;
  status?: string | null;
  reservation_date?: string | null;
  reservation_time?: string | null;
  selected_menus?: unknown[] | null;
  selected_options?: unknown[] | null;
  customer_info?: Record<string, unknown> | null;
  // 旧カラム（customer_info が無い古い予約のフォールバック）
  gender?: string | null;
  visit_count?: string | null;
  coupon?: string | null;
}

export interface AnalyticsFormInfo {
  id: string;
  name: string;
}

export interface MenuPopularityRow {
  menu_name: string;      // 「メニュー > サブメニュー」
  category_name: string;
  count: number;
  revenue: number;        // メニュー（サブメニュー）料金の合計。オプションは含まない
}

export interface OptionPopularityRow {
  option_name: string;
  count: number;
  revenue: number;
}

export interface FormBreakdownRow {
  form_id: string;
  form_name: string;
  count: number;          // キャンセル以外
  cancelled: number;
  revenue: number;
}

export interface ReservationAnalyticsResult {
  summary: {
    total: number;              // キャンセル以外の予約数
    cancelled: number;
    total_revenue: number;
    average_revenue: number;    // 予約 1 件あたり（キャンセル以外。0 件なら 0）
  };
  daily_stats: Array<{ date: string; count: number }>;
  monthly_stats: Array<{ month: string; count: number }>;
  menu_popularity: MenuPopularityRow[];
  option_popularity: OptionPopularityRow[];
  time_slot_distribution: Array<{ time: string; count: number }>;
  customer_demographics: {
    gender: Record<string, number>;
    visit_count: Record<string, number>;
    coupon_usage: Record<string, number>;
  };
  status_distribution: Record<string, number>;
  revenue_analysis: {
    total_revenue: number;
    by_menu: Array<{ menu_name: string; revenue: number }>;
    by_month: Array<{ month: string; revenue: number }>;
  };
  by_form: FormBreakdownRow[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** 既定の選択肢値 → 表示ラベル（フォームで独自の value を使っている場合は *_label を優先する） */
const DEFAULT_LABELS: Record<'gender' | 'visit_count' | 'coupon', Record<string, string>> = {
  gender: { male: '男性', female: '女性', other: 'その他' },
  visit_count: { first: '初回', repeat: '2回目以降' },
  coupon: { use: '利用する', not_use: '利用しない' },
};

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(asRecord) : [];
}

export function isCancelledReservation(r: AnalyticsReservation): boolean {
  return r.status === 'cancelled';
}

/** 予約 1 件の金額（メニュー + オプション。顧客管理の来店金額と同じ） */
export function reservationAmount(r: AnalyticsReservation): number {
  let total = 0;
  for (const m of asArray(r.selected_menus)) total += toNumber(m.price);
  for (const o of asArray(r.selected_options)) total += toNumber(o.price);
  return total;
}

/** 顧客属性の表示ラベル（送信時のラベル → 既定値の日本語 → 生の値） */
export function demographicLabel(
  kind: 'gender' | 'visit_count' | 'coupon',
  r: AnalyticsReservation
): string | null {
  const info = asRecord(r.customer_info);
  const label = info[`${kind}_label`];
  if (typeof label === 'string' && label.trim()) return label.trim();
  const raw = info[kind] ?? r[kind];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return DEFAULT_LABELS[kind][raw] || raw;
}

/** メニュー行の表示名（メニュー > サブメニュー） */
export function menuDisplayName(menu: Record<string, unknown>): string {
  const name = typeof menu.menu_name === 'string' && menu.menu_name.trim() ? menu.menu_name.trim() : '不明';
  const sub = typeof menu.submenu_name === 'string' && menu.submenu_name.trim() ? menu.submenu_name.trim() : '';
  return sub ? `${name} > ${sub}` : name;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function hourSlot(time: string): string | null {
  const m = /^(\d{1,2}):\d{2}/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  return `${String(h).padStart(2, '0')}:00`;
}

function sortedEntries<T extends { [k: string]: unknown }>(map: Record<string, T>, key: keyof T): T[] {
  return Object.values(map).sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

/**
 * 予約一覧から分析結果を計算する
 * @param reservations 対象期間の予約（店舗全体。フォーム絞り込み前）
 * @param forms 店舗のフォーム一覧（フォーム名の解決と「フォーム別」の並び順に使う）
 * @param formId 指定すると、フォーム別一覧以外をそのフォームの予約だけで集計する
 */
export function computeReservationAnalytics(
  reservations: AnalyticsReservation[],
  forms: AnalyticsFormInfo[] = [],
  formId?: string | null
): ReservationAnalyticsResult {
  const all = reservations.filter((r) => r && typeof r === 'object');
  const target = formId ? all.filter((r) => r.form_id === formId) : all;
  const active = target.filter((r) => !isCancelledReservation(r));

  // 日別 / 月別
  const daily: Record<string, { date: string; count: number }> = {};
  const monthly: Record<string, { month: string; count: number }> = {};
  const revenueByMonth: Record<string, { month: string; revenue: number }> = {};
  for (const r of active) {
    const date = typeof r.reservation_date === 'string' && DATE_RE.test(r.reservation_date) ? r.reservation_date.slice(0, 10) : null;
    if (!date) continue;
    daily[date] = daily[date] || { date, count: 0 };
    daily[date].count++;
    const month = monthOf(date);
    monthly[month] = monthly[month] || { month, count: 0 };
    monthly[month].count++;
    revenueByMonth[month] = revenueByMonth[month] || { month, revenue: 0 };
    revenueByMonth[month].revenue += reservationAmount(r);
  }

  // メニュー / オプション
  const menuMap: Record<string, MenuPopularityRow> = {};
  const optionMap: Record<string, OptionPopularityRow> = {};
  for (const r of active) {
    for (const m of asArray(r.selected_menus)) {
      const menuName = menuDisplayName(m);
      const categoryName = typeof m.category_name === 'string' ? m.category_name.trim() : '';
      const key = `${categoryName}\u0000${menuName}`;
      menuMap[key] = menuMap[key] || { menu_name: menuName, category_name: categoryName, count: 0, revenue: 0 };
      menuMap[key].count++;
      menuMap[key].revenue += toNumber(m.price);
    }
    for (const o of asArray(r.selected_options)) {
      const optionName = typeof o.option_name === 'string' && o.option_name.trim() ? o.option_name.trim() : '不明';
      optionMap[optionName] = optionMap[optionName] || { option_name: optionName, count: 0, revenue: 0 };
      optionMap[optionName].count++;
      optionMap[optionName].revenue += toNumber(o.price);
    }
  }
  const menuPopularity = Object.values(menuMap).sort((a, b) => b.count - a.count || b.revenue - a.revenue);
  const optionPopularity = Object.values(optionMap).sort((a, b) => b.count - a.count || b.revenue - a.revenue);

  // 時間帯
  const slots: Record<string, number> = {};
  for (const r of active) {
    const slot = typeof r.reservation_time === 'string' ? hourSlot(r.reservation_time) : null;
    if (!slot) continue;
    slots[slot] = (slots[slot] || 0) + 1;
  }
  const timeSlotDistribution = Object.entries(slots)
    .map(([time, count]) => ({ time, count }))
    .sort((a, b) => a.time.localeCompare(b.time));

  // 顧客属性
  const gender: Record<string, number> = {};
  const visitCount: Record<string, number> = {};
  const couponUsage: Record<string, number> = {};
  for (const r of active) {
    const g = demographicLabel('gender', r);
    if (g) gender[g] = (gender[g] || 0) + 1;
    const v = demographicLabel('visit_count', r);
    if (v) visitCount[v] = (visitCount[v] || 0) + 1;
    const c = demographicLabel('coupon', r);
    if (c) couponUsage[c] = (couponUsage[c] || 0) + 1;
  }

  // ステータス（キャンセルも含む）
  const statusDistribution: Record<string, number> = {};
  for (const r of target) {
    const s = typeof r.status === 'string' && r.status ? r.status : 'pending';
    statusDistribution[s] = (statusDistribution[s] || 0) + 1;
  }

  // 売上
  const totalRevenue = active.reduce((sum, r) => sum + reservationAmount(r), 0);
  const byMenuRevenue = menuPopularity
    .map((m) => ({ menu_name: m.category_name ? `${m.category_name} > ${m.menu_name}` : m.menu_name, revenue: m.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  // フォーム別（絞り込み前の全予約で計算。フォーム一覧の順に並べ、一覧に無いフォームの予約は後ろに置く）
  const formName = new Map(forms.map((f) => [f.id, f.name]));
  const formMap: Record<string, FormBreakdownRow> = {};
  for (const r of all) {
    const id = typeof r.form_id === 'string' && r.form_id ? r.form_id : '';
    const row = (formMap[id] = formMap[id] || {
      form_id: id,
      form_name: formName.get(id) || (id ? '削除されたフォーム' : 'フォーム不明'),
      count: 0,
      cancelled: 0,
      revenue: 0,
    });
    if (isCancelledReservation(r)) row.cancelled++;
    else {
      row.count++;
      row.revenue += reservationAmount(r);
    }
  }
  const order = new Map(forms.map((f, i) => [f.id, i]));
  const byForm = Object.values(formMap).sort((a, b) => {
    const ia = order.has(a.form_id) ? (order.get(a.form_id) as number) : Number.MAX_SAFE_INTEGER;
    const ib = order.has(b.form_id) ? (order.get(b.form_id) as number) : Number.MAX_SAFE_INTEGER;
    return ia - ib || b.count - a.count;
  });

  return {
    summary: {
      total: active.length,
      cancelled: target.length - active.length,
      total_revenue: totalRevenue,
      average_revenue: active.length > 0 ? Math.round(totalRevenue / active.length) : 0,
    },
    daily_stats: sortedEntries(daily, 'date'),
    monthly_stats: sortedEntries(monthly, 'month'),
    menu_popularity: menuPopularity,
    option_popularity: optionPopularity,
    time_slot_distribution: timeSlotDistribution,
    customer_demographics: { gender, visit_count: visitCount, coupon_usage: couponUsage },
    status_distribution: statusDistribution,
    revenue_analysis: {
      total_revenue: totalRevenue,
      by_menu: byMenuRevenue,
      by_month: sortedEntries(revenueByMonth, 'month'),
    },
    by_form: byForm,
  };
}

/** 分析の期間プリセット（UI と API で共通。日付は JST の YYYY-MM-DD） */
export type AnalyticsPeriodPreset = 'this_month' | 'last_month' | 'last_3_months' | 'last_12_months' | 'all' | 'custom';

export const ANALYTICS_PERIOD_OPTIONS: Array<{ value: AnalyticsPeriodPreset; label: string }> = [
  { value: 'this_month', label: '今月' },
  { value: 'last_month', label: '先月' },
  { value: 'last_3_months', label: '過去3か月' },
  { value: 'last_12_months', label: '過去12か月' },
  { value: 'all', label: '全期間' },
  { value: 'custom', label: '期間指定' },
];

function ymd(y: number, m0: number, d: number): string {
  // Date.UTC で月末のはみ出し（d = 0 → 前月末日）を正規化する
  const dt = new Date(Date.UTC(y, m0, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * プリセットから date_from / date_to を求める（JST 基準）。`all` / `custom` は null
 * - 今月: 1 日 〜 月末 / 先月: 先月 1 日 〜 先月末
 * - 過去 N か月: 今月を含む N か月（N-1 か月前の 1 日 〜 今月末）
 */
export function resolveAnalyticsPeriod(
  preset: AnalyticsPeriodPreset,
  now: Date = new Date()
): { date_from: string; date_to: string } | null {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m0 = jst.getUTCMonth();
  switch (preset) {
    case 'this_month':
      return { date_from: ymd(y, m0, 1), date_to: ymd(y, m0 + 1, 0) };
    case 'last_month':
      return { date_from: ymd(y, m0 - 1, 1), date_to: ymd(y, m0, 0) };
    case 'last_3_months':
      return { date_from: ymd(y, m0 - 2, 1), date_to: ymd(y, m0 + 1, 0) };
    case 'last_12_months':
      return { date_from: ymd(y, m0 - 11, 1), date_to: ymd(y, m0 + 1, 0) };
    default:
      return null;
  }
}
