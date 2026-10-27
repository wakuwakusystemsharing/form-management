import { describe, expect, it } from 'vitest';
import { createDefaultStaySettings } from '@/lib/stay-pricing';
import {
  normalizeGuestCounts,
  prepareStayReservation,
  resolveStayCancelFee,
  stayEventDurationMinutes,
} from '@/lib/stay-reservation';

// 2026-10-20 10:00 JST
const NOW = new Date('2026-10-20T01:00:00Z');

function cs(overrides: Record<string, unknown> = {}) {
  return {
    booking_mode: 'stay' as const,
    min_advance_days: 0,
    advance_booking_days: 365,
    stay_settings: createDefaultStaySettings(),
    ...overrides,
  };
}

describe('stay-reservation: prepareStayReservation', () => {
  it('正常: 保存項目と customer_info の内訳を組み立てる（時刻は check_in_time に固定）', () => {
    const r = prepareStayReservation(cs(), {
      reservation_date: '2026-11-01',
      checkout_date: '2026-11-03',
      guest_counts: { adult: '2', child: 1 },
      reservation_time: '09:00', // 選択肢が無いので無視される
    }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      reservation_date: '2026-11-01',
      reservation_time: '15:00',
      checkout_date: '2026-11-03',
      stay_nights: 2,
      nights: ['2026-11-01', '2026-11-02'],
      guest_counts: { adult: 2, child: 1 },
      guest_count: 2,
      stay_price_total: 40000,
    });
    expect(r.value.customer_info).toMatchObject({
      booking_mode: 'stay',
      checkout_date: '2026-11-03',
      stay_nights: 2,
      check_in_time: '15:00',
      check_out_time: '10:00',
      guest_text: '6歳以上 2名 / 0〜5歳 1名',
      guest_labels: { adult: '6歳以上', child: '0〜5歳' },
      stay_subtotal: 40000,
      stay_discount: null,
      stay_price_total: 40000,
    });
    expect(r.value.customer_info.stay_per_night).toHaveLength(2);
  });

  it('check_in_time_options にある時刻なら採用する', () => {
    const settings = createDefaultStaySettings();
    settings.check_in_time_options = ['15:00', '16:00', '17:00'];
    const r = prepareStayReservation(cs({ stay_settings: settings }), { reservation_date: '2026-11-01', checkout_date: '2026-11-02', guest_counts: { adult: 1 }, reservation_time: '17:00' }, NOW);
    expect(r.ok && r.value.reservation_time).toBe('17:00');
    const r2 = prepareStayReservation(cs({ stay_settings: settings }), { reservation_date: '2026-11-01', checkout_date: '2026-11-02', guest_counts: { adult: 1 }, reservation_time: '18:00' }, NOW);
    expect(r2.ok && r2.value.reservation_time).toBe('15:00');
  });

  it('不正: 日付 / 泊数 / 人数 / 受付期間 / 休業日 / 祝日不可 / 料金なし', () => {
    const err = (r: ReturnType<typeof prepareStayReservation>) => (r.ok ? '' : r.error);
    expect(err(prepareStayReservation(cs(), { reservation_date: '2026-11-03', checkout_date: '2026-11-01', guest_counts: { adult: 1 } }, NOW))).toContain('正しく指定');
    expect(err(prepareStayReservation(cs(), { reservation_date: '2026-11-01', checkout_date: '2026-11-10', guest_counts: { adult: 1 } }, NOW))).toContain('最大7泊');
    expect(err(prepareStayReservation(cs(), { reservation_date: '2026-11-01', checkout_date: '2026-11-02', guest_counts: { adult: 0 } }, NOW))).toContain('6歳以上');
    expect(err(prepareStayReservation(cs({ min_advance_days: 1 }), { reservation_date: '2026-10-20', checkout_date: '2026-10-21', guest_counts: { adult: 1 } }, NOW))).toContain('受付期間');
    expect(err(prepareStayReservation(cs({ advance_booking_days: 5 }), { reservation_date: '2026-10-25', checkout_date: '2026-10-27', guest_counts: { adult: 1 } }, NOW))).toContain('まだ受付');
    const closed = createDefaultStaySettings();
    closed.closed_dates = ['2026-11-02'];
    expect(err(prepareStayReservation(cs({ stay_settings: closed }), { reservation_date: '2026-11-01', checkout_date: '2026-11-03', guest_counts: { adult: 1 } }, NOW))).toContain('休業日');
    expect(err(prepareStayReservation(cs({ holidays_as_closed: true }), { reservation_date: '2026-11-03', checkout_date: '2026-11-04', guest_counts: { adult: 1 } }, NOW))).toContain('祝日');
    expect(err(prepareStayReservation(cs(), { reservation_date: '2026-11-01', checkout_date: '2026-11-02', guest_counts: { adult: 4 } }, NOW))).toContain('料金が設定されていません');
  });

  it('normalizeGuestCounts: 無い区分は min、不正値も min', () => {
    const s = createDefaultStaySettings();
    expect(normalizeGuestCounts(s, { adult: 'x' })).toEqual({ adult: 1, child: 0 });
    expect(normalizeGuestCounts(s, undefined)).toEqual({ adult: 1, child: 0 });
  });
});

describe('stay-reservation: カレンダー予定の長さとキャンセル料', () => {
  it('stayEventDurationMinutes: 15:00 → 2 泊後 10:00 = 2 日 − 5 時間', () => {
    expect(stayEventDurationMinutes('2026-11-01', '15:00', '2026-11-03', '10:00')).toBe(2 * 24 * 60 - 5 * 60);
    expect(stayEventDurationMinutes('2026-11-01', '15:00', '2026-11-02', '10:00')).toBe(19 * 60);
  });

  it('resolveStayCancelFee: fee_base = stay は宿泊料金のみ、total はメニュー込み', () => {
    const config = { cancel_rules: { fee_tiers: [{ days_before: 7, percent: 0 }, { days_before: 2, percent: 50 }, { days_before: 0, percent: 100 }], fee_base: 'stay' as const } };
    const reservation = { reservation_date: '2026-11-10', stay_price_total: 40000, selected_menus: [{ price: 6000 }], selected_options: [{ price: 2000 }] };
    const now = new Date('2026-11-07T00:00:00+09:00'); // 3 日前 → 50%
    expect(resolveStayCancelFee(config, reservation, now)).toMatchObject({ percent: 50, amount: 20000, daysBefore: 3 });
    expect(resolveStayCancelFee({ cancel_rules: { ...config.cancel_rules, fee_base: 'total' } }, reservation, now).amount).toBe(24000);
    // stay_price_total が無ければ customer_info から
    expect(resolveStayCancelFee(config, { reservation_date: '2026-11-10', customer_info: { stay_price_total: 10000 } }, now).amount).toBe(5000);
    expect(resolveStayCancelFee(undefined, reservation, now)).toMatchObject({ percent: 0, amount: 0 });
  });
});
