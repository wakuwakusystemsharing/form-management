import { describe, expect, it } from 'vitest';
import {
  buildStayDetailRows,
  formatCancelFeeText,
  formatStayPriceText,
  formatStayRangeShort,
  isStayReservation,
  stayNightCount,
} from '@/lib/stay-display';
import { buildAdminReservationRows, buildReservationDetailItems } from '@/lib/reservation-detail-items';
import { reservationAmount } from '@/lib/reservation-analytics';
import { normalizeForm } from '@/lib/form-normalizer';

const stayRow = {
  reservation_date: '2026-11-01',
  reservation_time: '15:00:00',
  checkout_date: '2026-11-04',
  stay_nights: 3,
  guest_count: 2,
  stay_price_total: 54000,
  status: 'confirmed',
  customer_info: {
    booking_mode: 'stay',
    checkout_date: '2026-11-04',
    stay_nights: 3,
    check_in_time: '15:00',
    check_out_time: '10:00',
    guest_text: '6歳以上 2名 / 0〜5歳 1名',
    stay_subtotal: 60000,
    stay_discount: { min_nights: 3, type: 'percent', value: 10, amount: 6000 },
    stay_price_total: 54000,
    total_price: 0,
  },
};

describe('stay-display', () => {
  it('判定と一覧表示', () => {
    expect(isStayReservation(stayRow)).toBe(true);
    expect(isStayReservation({ reservation_date: '2026-11-01' })).toBe(false);
    // customer_info だけでも宿泊と判定できる（メール経路）
    expect(isStayReservation({ reservation_date: '2026-11-01', customer_info: { checkout_date: '2026-11-02' } })).toBe(true);
    expect(stayNightCount(stayRow)).toBe(3);
    expect(stayNightCount({ reservation_date: '2026-11-01', checkout_date: '2026-11-03' })).toBe(2);
    expect(formatStayRangeShort(stayRow)).toBe('11/1(日) 〜 11/4(水) 3泊');
    expect(formatStayPriceText(stayRow)).toBe('¥60,000 − 連泊割引 ¥6,000 = ¥54,000');
    expect(formatStayPriceText({ reservation_date: '2026-11-01', stay_price_total: 20000 })).toBe('¥20,000');
  });

  it('buildStayDetailRows: チェックイン〜宿泊料金', () => {
    expect(buildStayDetailRows(stayRow)).toEqual([
      { label: 'チェックイン', value: '2026年11月01日（日） 15:00' },
      { label: 'チェックアウト', value: '2026年11月04日（水） 10:00' },
      { label: '泊数', value: '3泊' },
      { label: '宿泊人数', value: '6歳以上 2名 / 0〜5歳 1名' },
      { label: '宿泊料金', value: '¥60,000 − 連泊割引 ¥6,000 = ¥54,000' },
    ]);
    expect(buildStayDetailRows(stayRow, { includeCheckIn: false })[0].label).toBe('チェックアウト');
    expect(buildStayDetailRows({ reservation_date: '2026-11-01' })).toEqual([]);
  });

  it('formatCancelFeeText: キャンセル済みで記録があるときだけ', () => {
    expect(formatCancelFeeText({ ...stayRow, status: 'cancelled', cancel_fee_percent: 50, cancel_fee_amount: 27000 })).toBe('50%（¥27,000）');
    expect(formatCancelFeeText({ ...stayRow, status: 'cancelled', cancel_fee_percent: 0, cancel_fee_amount: 0 })).toBe('なし（0%）');
    expect(formatCancelFeeText({ ...stayRow, status: 'confirmed', cancel_fee_percent: 50 })).toBeNull();
    expect(formatCancelFeeText({ ...stayRow, status: 'cancelled' })).toBeNull();
  });

  it('reservation-detail-items: メール用はご来店日時の代わりに宿泊の行、管理画面用はチェックアウト以降 + キャンセル料', () => {
    const config = normalizeForm({ id: 'f', store_id: 's', config: { calendar_settings: { booking_mode: 'stay', show_customer_name: true, show_message_field: false } } }).config;
    const items = buildReservationDetailItems(config, { ...stayRow, customer_name: '山田', customer_phone: '090' });
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['お名前', '電話番号', 'チェックイン', 'チェックアウト', '泊数', '宿泊人数', '宿泊料金']);
    expect(labels).not.toContain('ご来店日時');

    const admin = buildAdminReservationRows(config, { ...stayRow, status: 'cancelled', cancel_fee_percent: 50, cancel_fee_amount: 27000, message: '遅くなります' });
    expect(admin.map((i) => i.label)).toEqual(['チェックアウト', '泊数', '宿泊人数', '宿泊料金', 'メッセージ', 'キャンセル料']);
    expect(admin.find((i) => i.label === 'キャンセル料')?.value).toBe('50%（¥27,000）');
  });

  it('reservation-analytics: 売上に宿泊料金を加える', () => {
    expect(reservationAmount({ selected_menus: [{ price: 3000 }], selected_options: [], stay_price_total: 54000 })).toBe(57000);
    expect(reservationAmount({ selected_menus: [{ price: 3000 }], selected_options: [] })).toBe(3000);
  });
});
