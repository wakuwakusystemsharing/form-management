import { describe, expect, it } from 'vitest';
import {
  computeReservationAnalytics,
  demographicLabel,
  menuDisplayName,
  reservationAmount,
  resolveAnalyticsPeriod,
  type AnalyticsReservation,
} from '../reservation-analytics';

const base = (over: Partial<AnalyticsReservation>): AnalyticsReservation => ({
  id: 'r',
  form_id: 'fA',
  status: 'confirmed',
  reservation_date: '2026-10-05',
  reservation_time: '10:30',
  selected_menus: [{ menu_id: 'menu1', menu_name: 'カット', category_name: 'ヘア', price: 3000, duration: 60 }],
  selected_options: [],
  customer_info: { gender: 'female', visit_count: 'first', coupon: 'use' },
  ...over,
});

const forms = [
  { id: 'fA', name: 'LINE 予約' },
  { id: 'fB', name: 'Web 予約' },
];

describe('reservationAmount / ラベル / メニュー名', () => {
  it('金額はメニュー + オプション（文字列の価格も数える）', () => {
    const r = base({
      selected_menus: [{ menu_name: 'A', price: '3000' }, { menu_name: 'B', price: 2000 }],
      selected_options: [{ option_name: 'トリートメント', price: 1500 }, { option_name: '不明', price: null }],
    });
    expect(reservationAmount(r)).toBe(6500);
  });

  it('属性ラベルは送信時のラベル → 既定の日本語 → 生の値の順', () => {
    expect(demographicLabel('gender', base({ customer_info: { gender: 'male', gender_label: '男性（成人）' } }))).toBe('男性（成人）');
    expect(demographicLabel('visit_count', base({ customer_info: { visit_count: 'repeat' } }))).toBe('2回目以降');
    expect(demographicLabel('visit_count', base({ customer_info: { visit_count: 'vc_3plus' } }))).toBe('vc_3plus');
    expect(demographicLabel('coupon', base({ customer_info: {}, coupon: 'not_use' }))).toBe('利用しない');
    expect(demographicLabel('gender', base({ customer_info: {} }))).toBeNull();
  });

  it('メニュー名はサブメニューを「 > 」でつなぐ', () => {
    expect(menuDisplayName({ menu_name: 'カット', submenu_name: 'ミディアム' })).toBe('カット > ミディアム');
    expect(menuDisplayName({ menu_name: 'カット' })).toBe('カット');
    expect(menuDisplayName({})).toBe('不明');
  });
});

describe('computeReservationAnalytics', () => {
  const reservations: AnalyticsReservation[] = [
    base({ id: '1' }),
    base({
      id: '2',
      reservation_date: '2026-10-05',
      reservation_time: '10:00',
      selected_menus: [{ menu_id: 'menu1', menu_name: 'カット', category_name: 'ヘア', price: 3000, submenu_id: 's1', submenu_name: 'ロング' }],
      selected_options: [{ option_id: 'o1', option_name: 'トリートメント', price: 1500 }],
      customer_info: { gender: 'male', visit_count: 'repeat', coupon: 'not_use' },
    }),
    base({ id: '3', form_id: 'fB', reservation_date: '2026-09-28', reservation_time: '14:15', status: 'completed',
      selected_menus: [{ menu_id: 'menu1', menu_name: 'ネイル', price: 5000 }], customer_info: {} }),
    base({ id: '4', form_id: 'fB', reservation_date: '2026-10-06', reservation_time: '9:00', status: 'cancelled',
      selected_menus: [{ menu_id: 'menu1', menu_name: 'ネイル', price: 5000 }] }),
    base({ id: '5', form_id: 'deleted', reservation_date: '2026-10-07', reservation_time: '', status: 'pending',
      selected_menus: [], customer_info: null }),
  ];

  it('キャンセルは件数・メニュー・時間帯・属性・売上から除外し、ステータス別とキャンセル数にだけ数える', () => {
    const a = computeReservationAnalytics(reservations, forms);
    expect(a.summary).toEqual({ total: 4, cancelled: 1, total_revenue: 12500, average_revenue: 3125 });
    expect(a.status_distribution).toEqual({ confirmed: 2, completed: 1, cancelled: 1, pending: 1 });
    expect(a.daily_stats).toEqual([
      { date: '2026-09-28', count: 1 },
      { date: '2026-10-05', count: 2 },
      { date: '2026-10-07', count: 1 },
    ]);
    expect(a.monthly_stats).toEqual([{ month: '2026-09', count: 1 }, { month: '2026-10', count: 3 }]);
    // ネイルはキャンセル分を数えない（1 件 5000 円）
    expect(a.menu_popularity.find((m) => m.menu_name === 'ネイル')).toEqual({ menu_name: 'ネイル', category_name: '', count: 1, revenue: 5000 });
    // 時間帯は 1 桁の時刻も 09:00 に揃える。空の時刻は数えない
    expect(a.time_slot_distribution).toEqual([{ time: '10:00', count: 2 }, { time: '14:00', count: 1 }]);
    expect(a.customer_demographics.gender).toEqual({ 女性: 1, 男性: 1 });
    expect(a.customer_demographics.visit_count).toEqual({ 初回: 1, '2回目以降': 1 });
    expect(a.customer_demographics.coupon_usage).toEqual({ 利用する: 1, 利用しない: 1 });
  });

  it('メニューは menu_id ではなく名前（カテゴリー > メニュー > サブメニュー）でまとめ、オプションは別集計', () => {
    const a = computeReservationAnalytics(reservations, forms);
    const rows = a.menu_popularity.map((m) => `${m.category_name}|${m.menu_name}|${m.count}`);
    expect(rows.length).toBe(3);
    expect(rows).toEqual(expect.arrayContaining(['ヘア|カット|1', 'ヘア|カット > ロング|1', '|ネイル|1']));
    expect(a.option_popularity).toEqual([{ option_name: 'トリートメント', count: 1, revenue: 1500 }]);
    // 売上（メニュー別）はオプションを含めず、合計はオプションを含む
    expect(a.revenue_analysis.by_menu.reduce((s, m) => s + m.revenue, 0)).toBe(11000);
    expect(a.revenue_analysis.total_revenue).toBe(12500);
    expect(a.revenue_analysis.by_month).toEqual([{ month: '2026-09', revenue: 5000 }, { month: '2026-10', revenue: 7500 }]);
  });

  it('フォーム別はフォーム一覧の順に並び、削除されたフォームの予約は後ろに「削除されたフォーム」として出る', () => {
    const a = computeReservationAnalytics(reservations, forms);
    expect(a.by_form).toEqual([
      { form_id: 'fA', form_name: 'LINE 予約', count: 2, cancelled: 0, revenue: 7500 },
      { form_id: 'fB', form_name: 'Web 予約', count: 1, cancelled: 1, revenue: 5000 },
      { form_id: 'deleted', form_name: '削除されたフォーム', count: 1, cancelled: 0, revenue: 0 },
    ]);
  });

  it('フォームを指定すると、フォーム別一覧以外はそのフォームの予約だけで集計する', () => {
    const a = computeReservationAnalytics(reservations, forms, 'fB');
    expect(a.summary).toEqual({ total: 1, cancelled: 1, total_revenue: 5000, average_revenue: 5000 });
    expect(a.status_distribution).toEqual({ completed: 1, cancelled: 1 });
    expect(a.menu_popularity).toEqual([{ menu_name: 'ネイル', category_name: '', count: 1, revenue: 5000 }]);
    expect(a.by_form.length).toBe(3);
  });

  it('予約が無いときは空の結果', () => {
    const a = computeReservationAnalytics([], forms);
    expect(a.summary).toEqual({ total: 0, cancelled: 0, total_revenue: 0, average_revenue: 0 });
    expect(a.daily_stats).toEqual([]);
    expect(a.by_form).toEqual([]);
  });
});

describe('resolveAnalyticsPeriod', () => {
  // 2026-10-21 00:30 JST（= 2026-10-20 15:30 UTC）。UTC の日付とずれる時刻で JST 基準を確認
  const now = new Date('2026-10-20T15:30:00Z');

  it('今月 / 先月 / 過去 N か月を JST の月初〜月末で返す', () => {
    expect(resolveAnalyticsPeriod('this_month', now)).toEqual({ date_from: '2026-10-01', date_to: '2026-10-31' });
    expect(resolveAnalyticsPeriod('last_month', now)).toEqual({ date_from: '2026-09-01', date_to: '2026-09-30' });
    expect(resolveAnalyticsPeriod('last_3_months', now)).toEqual({ date_from: '2026-08-01', date_to: '2026-10-31' });
    expect(resolveAnalyticsPeriod('last_12_months', now)).toEqual({ date_from: '2025-11-01', date_to: '2026-10-31' });
  });

  it('年をまたぐ先月と、全期間 / 期間指定は null', () => {
    expect(resolveAnalyticsPeriod('last_month', new Date('2026-01-10T00:00:00Z'))).toEqual({ date_from: '2025-12-01', date_to: '2025-12-31' });
    expect(resolveAnalyticsPeriod('all', now)).toBeNull();
    expect(resolveAnalyticsPeriod('custom', now)).toBeNull();
  });
});
