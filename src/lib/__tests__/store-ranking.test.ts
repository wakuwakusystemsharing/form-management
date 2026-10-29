import { describe, expect, it } from 'vitest';
import {
  RANKING_METRICS,
  computeStoreRankings,
  formatRankingValue,
  rankRows,
  type StoreRankingRow,
} from '@/lib/store-ranking';

const stores = [
  { id: 'a', name: 'A店' },
  { id: 'b', name: 'B店' },
  { id: 'c', name: 'C店' },
];

const reservations = [
  { store_id: 'a', status: 'confirmed', reservation_date: '2026-10-05', selected_menus: [{ price: 5000 }], selected_options: [{ price: 500 }] },
  { store_id: 'a', status: 'cancelled', reservation_date: '2026-10-06', selected_menus: [{ price: 9999 }] },
  { store_id: 'a', status: 'pending', reservation_date: '2026-09-30', selected_menus: [{ price: 1000 }] }, // 期間外
  { store_id: 'b', status: 'completed', reservation_date: '2026-10-10', selected_menus: [{ price: 3000 }], stay_price_total: 20000 },
  { store_id: 'b', status: 'confirmed', reservation_date: '2026-10-11', selected_menus: [] },
  { store_id: 'zzz', status: 'confirmed', reservation_date: '2026-10-11', selected_menus: [{ price: 100 }] }, // 一覧に無い店舗
];

const surveys = [
  { store_id: 'a', submitted_at: '2026-10-01T10:00:00+09:00' },
  { store_id: 'a', submitted_at: '2026-09-30T23:30:00Z' }, // JST では 10/1 08:30 → 期間内
  { store_id: 'c', submitted_at: '2026-10-31T14:59:59Z' }, // JST 10/31 23:59 → 期間内
  { store_id: 'c', submitted_at: '2026-10-31T15:00:00Z' }, // JST 11/1 → 期間外
];

const customers = [
  { store_id: 'a', line_user_id: 'U1', line_friend_flag: true },
  { store_id: 'a', line_user_id: 'U2', line_friend_flag: false },
  { store_id: 'a', line_user_id: null, line_friend_flag: true }, // 電話のみ → 分母外
  { store_id: 'b', line_user_id: 'U3', line_friend_flag: true },
];

const period = { date_from: '2026-10-01', date_to: '2026-10-31' };

describe('computeStoreRankings', () => {
  const rows = computeStoreRankings(stores, reservations, surveys, customers, period);
  const byId = Object.fromEntries(rows.map((r) => [r.store_id, r])) as Record<string, StoreRankingRow>;

  it('店舗一覧にある店舗だけを返し、一覧に無い店舗の予約は無視する', () => {
    expect(rows.map((r) => r.store_id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('予約数はキャンセルを除き、期間（予約日）で絞る。売上はメニュー + オプション + 宿泊料金', () => {
    expect(byId.a.reservations).toBe(1);
    expect(byId.a.cancelled).toBe(1);
    expect(byId.a.sales).toBe(5500);
    expect(byId.b.reservations).toBe(2);
    expect(byId.b.sales).toBe(23000);
    expect(byId.c.reservations).toBe(0);
    expect(byId.c.sales).toBe(0);
  });

  it('キャンセル率 = キャンセル / (予約 + キャンセル)。予約が無い店舗は null', () => {
    expect(byId.a.cancel_rate).toBe(50);
    expect(byId.b.cancel_rate).toBe(0);
    expect(byId.c.cancel_rate).toBeNull();
  });

  it('アンケート回答数は回答日時を JST の日付にして期間で絞る', () => {
    expect(byId.a.survey_responses).toBe(2);
    expect(byId.c.survey_responses).toBe(1);
    expect(byId.b.survey_responses).toBe(0);
  });

  it('LINE 友だち追加率の分母は line_user_id を持つ顧客。連携顧客が無い店舗は null', () => {
    expect(byId.a.line_linked_customers).toBe(2);
    expect(byId.a.line_friend_connected).toBe(1);
    expect(byId.a.line_friend_rate).toBe(50);
    expect(byId.b.line_friend_rate).toBe(100);
    expect(byId.c.line_friend_rate).toBeNull();
  });

  it('期間 null は全期間', () => {
    const all = computeStoreRankings(stores, reservations, surveys, customers, null);
    expect(all.find((r) => r.store_id === 'a')?.reservations).toBe(2);
    expect(all.find((r) => r.store_id === 'c')?.survey_responses).toBe(2);
  });
});

describe('rankRows', () => {
  const rows = computeStoreRankings(stores, reservations, surveys, customers, period);

  it('多い順に並べ、同値は同じ順位。値が null の店舗は除外', () => {
    const r = rankRows(rows, 'reservations');
    expect(r.map((x) => [x.rank, x.row.store_id, x.value])).toEqual([[1, 'b', 2], [2, 'a', 1], [3, 'c', 0]]);
    const f = rankRows(rows, 'line_friend_rate');
    expect(f.map((x) => [x.rank, x.row.store_id])).toEqual([[1, 'b'], [2, 'a']]);
  });

  it('キャンセル率は低い順（0 件の店舗は除外）', () => {
    const c = rankRows(rows, 'cancel_rate');
    expect(c.map((x) => [x.rank, x.row.store_id, x.value])).toEqual([[1, 'b', 0], [2, 'a', 50]]);
  });

  it('同値は同じ順位で、次の順位は飛ぶ', () => {
    const tie: StoreRankingRow[] = [
      { store_id: 'x', store_name: 'X', reservations: 3, cancelled: 0, cancel_rate: 0, sales: 0, survey_responses: 0, line_linked_customers: 0, line_friend_connected: 0, line_friend_rate: null },
      { store_id: 'y', store_name: 'Y', reservations: 3, cancelled: 0, cancel_rate: 0, sales: 0, survey_responses: 0, line_linked_customers: 0, line_friend_connected: 0, line_friend_rate: null },
      { store_id: 'z', store_name: 'Z', reservations: 1, cancelled: 0, cancel_rate: 0, sales: 0, survey_responses: 0, line_linked_customers: 0, line_friend_connected: 0, line_friend_rate: null },
    ];
    expect(rankRows(tie, 'reservations').map((x) => x.rank)).toEqual([1, 1, 3]);
  });
});

describe('RANKING_METRICS / formatRankingValue', () => {
  it('5 指標を定義し、表示形式が合う', () => {
    expect(RANKING_METRICS.map((m) => m.key)).toEqual(['reservations', 'sales', 'survey_responses', 'line_friend_rate', 'cancel_rate']);
    expect(formatRankingValue('reservations', 12)).toBe('12件');
    expect(formatRankingValue('sales', 1234567)).toBe('¥1,234,567');
    expect(formatRankingValue('line_friend_rate', 66.7)).toBe('66.7%');
    expect(formatRankingValue('cancel_rate', null)).toBe('-');
  });
});
