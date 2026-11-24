/**
 * 流入経路の集計（純粋ロジック）
 * - 予約数・売上はキャンセルを除く。キャンセルは別に数える
 * - 期間は予約日（分析のほかのタブと同じ）、フォームで絞り込める
 * - 停止した経路も集計に残る。経路の無い予約・一覧に無い合言葉は「経路なし」
 * - 予約率 = これまでの予約（キャンセルを含む・期間に依らない）÷ 読まれた数。目安
 */
import { describe, expect, it } from 'vitest';
import { computeSourceStats, type SourceStatsReservation } from '@/lib/reservation-source-stats';
import type { ReservationSource } from '@/lib/reservation-sources';

function source(patch: Partial<ReservationSource> & { id: string; code: string; name: string }): ReservationSource {
  return { store_id: 's1', form_id: 'formA', active: true, click_count: 0, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...patch };
}

function resv(patch: Partial<SourceStatsReservation>): SourceStatsReservation {
  return { form_id: 'formA', status: 'confirmed', reservation_date: '2026-11-10', selected_menus: [{ price: 3000 }], selected_options: [], ...patch };
}

const POP = source({ id: 'a', code: 'aaaaaaaa', name: '店頭ポップ', click_count: 10 });
const INSTA = source({ id: 'b', code: 'bbbbbbbb', name: 'Instagram', click_count: 4, created_at: '2026-11-02T00:00:00Z' });
const FLYER = source({ id: 'c', code: 'cccccccc', name: 'チラシ', active: false, click_count: 0, created_at: '2026-11-03T00:00:00Z' });

describe('computeSourceStats', () => {
  it('経路ごとに 予約数・キャンセル数・売上 を数える（キャンセルは予約数と売上に入れない）', () => {
    const stats = computeSourceStats(
      [
        resv({ source_code: 'aaaaaaaa' }),
        resv({ source_code: 'aaaaaaaa', selected_menus: [{ price: 5000 }], selected_options: [{ price: 500 }] }),
        resv({ source_code: 'aaaaaaaa', status: 'cancelled' }),
        resv({ source_code: 'bbbbbbbb' }),
        resv({}),
      ],
      [POP, INSTA, FLYER]
    );
    const pop = stats.rows.find((r) => r.code === 'aaaaaaaa');
    expect(pop).toMatchObject({ name: '店頭ポップ', count: 2, cancelled: 1, revenue: 8500, click_count: 10, total_bookings: 3 });
    expect(stats.rows.find((r) => r.code === 'bbbbbbbb')).toMatchObject({ count: 1, cancelled: 0, revenue: 3000 });
    expect(stats.none).toEqual({ count: 1, cancelled: 0, revenue: 3000 });
    expect(stats.summary).toEqual({ count: 4, with_source: 3, cancelled: 1, revenue: 14500 });
  });

  it('予約数の多い順に並べ、予約が 0 件の経路・停止した経路も残す', () => {
    const stats = computeSourceStats([resv({ source_code: 'bbbbbbbb' }), resv({ source_code: 'bbbbbbbb' }), resv({ source_code: 'aaaaaaaa' })], [POP, INSTA, FLYER]);
    expect(stats.rows.map((r) => r.name)).toEqual(['Instagram', '店頭ポップ', 'チラシ']);
    expect(stats.rows[2]).toMatchObject({ active: false, count: 0, cancelled: 0, revenue: 0, booking_rate: null });
  });

  it('期間は予約日で絞り込む。予約率は期間に依らない累計で出す', () => {
    const stats = computeSourceStats(
      [
        resv({ source_code: 'aaaaaaaa', reservation_date: '2026-10-31' }),
        resv({ source_code: 'aaaaaaaa', reservation_date: '2026-11-01' }),
        resv({ source_code: 'aaaaaaaa', reservation_date: '2026-11-30T00:00:00' }),
        resv({ source_code: 'aaaaaaaa', reservation_date: '2026-12-01' }),
        resv({ reservation_date: '2026-10-01' }),
      ],
      [POP],
      { dateFrom: '2026-11-01', dateTo: '2026-11-30' }
    );
    expect(stats.rows[0]).toMatchObject({ count: 2, total_bookings: 4, booking_rate: 0.4 });
    expect(stats.none.count).toBe(0);
    expect(stats.summary.count).toBe(2);
  });

  it('フォームで絞り込むと、そのフォームの予約だけを数え、関係のない経路は出さない', () => {
    const other = source({ id: 'd', code: 'dddddddd', name: '別フォームの経路', form_id: 'formB', click_count: 2 });
    const stats = computeSourceStats(
      [resv({ source_code: 'aaaaaaaa' }), resv({ source_code: 'dddddddd', form_id: 'formB' }), resv({ form_id: 'formB' })],
      [POP, other],
      { formId: 'formB' }
    );
    expect(stats.rows.map((r) => r.name)).toEqual(['別フォームの経路']);
    expect(stats.rows[0]).toMatchObject({ count: 1 });
    expect(stats.none.count).toBe(1);
  });

  it('経路が開くフォームを変えたあとも、以前のフォームで入った予約は絞り込みで数える', () => {
    const moved = source({ id: 'a', code: 'aaaaaaaa', name: '店頭ポップ', form_id: 'formB', click_count: 5 });
    const stats = computeSourceStats([resv({ source_code: 'aaaaaaaa', form_id: 'formA' })], [moved], { formId: 'formA' });
    expect(stats.rows).toHaveLength(1);
    expect(stats.rows[0].count).toBe(1);
  });

  it('一覧に無い合言葉・空の合言葉は「経路なし」に入れる', () => {
    const stats = computeSourceStats([resv({ source_code: 'zzzzzzzz' }), resv({ source_code: '' }), resv({ source_code: null })], [POP]);
    expect(stats.none.count).toBe(3);
    expect(stats.summary.with_source).toBe(0);
  });

  it('予約率: 読まれた数が 0 なら出さない。読まれた数より予約が多いときは 100% まで', () => {
    const zero = source({ id: 'e', code: 'eeeeeeee', name: '数えていない', click_count: 0 });
    const few = source({ id: 'f', code: 'ffffffff', name: '少ない', click_count: 1 });
    const stats = computeSourceStats([resv({ source_code: 'eeeeeeee' }), resv({ source_code: 'ffffffff' }), resv({ source_code: 'ffffffff', status: 'cancelled' })], [zero, few]);
    expect(stats.rows.find((r) => r.code === 'eeeeeeee')?.booking_rate).toBeNull();
    expect(stats.rows.find((r) => r.code === 'ffffffff')).toMatchObject({ total_bookings: 2, booking_rate: 1 });
  });

  it('宿泊料金・指名料も売上に入る（予約分析と同じ金額）', () => {
    const stats = computeSourceStats([resv({ source_code: 'aaaaaaaa', selected_menus: [], stay_price_total: 20000, customer_info: { nomination_fee: 500 } })], [POP]);
    expect(stats.rows[0].revenue).toBe(20500);
  });

  it('予約も経路も無いときは空で返す', () => {
    expect(computeSourceStats([], [])).toEqual({ rows: [], none: { count: 0, cancelled: 0, revenue: 0 }, summary: { count: 0, with_source: 0, cancelled: 0, revenue: 0 } });
  });
});
