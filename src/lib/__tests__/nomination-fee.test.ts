import { describe, it, expect } from 'vitest';
import {
  applyNominationFeeToCustomerInfo,
  formatNominationFee,
  reservationNominationFee,
  sanitizeNominationFee,
  staffNominationFee,
} from '../nomination-fee';
import { normalizeForm } from '../form-normalizer';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { reservationAmount } from '../reservation-analytics';
import { buildAdminReservationRows, buildReservationDetailItems } from '../reservation-detail-items';

const ss = {
  enabled: true,
  staff: [
    { id: 'a', name: 'A', calendar_id: 'ca' },
    { id: 'b', name: 'B', calendar_id: 'cb', nomination_fee: 500 },
  ],
};

describe('sanitizeNominationFee', () => {
  it('0 以上の整数にする', () => {
    expect(sanitizeNominationFee(500)).toBe(500);
    expect(sanitizeNominationFee('1200')).toBe(1200);
    expect(sanitizeNominationFee(550.9)).toBe(550);
    expect(sanitizeNominationFee(-100)).toBe(0);
    expect(sanitizeNominationFee('abc')).toBe(0);
    expect(sanitizeNominationFee(undefined)).toBe(0);
    expect(sanitizeNominationFee(99_999_999)).toBe(1_000_000);
  });
});

describe('staffNominationFee', () => {
  it('指名したスタッフの指名料を返す', () => {
    expect(staffNominationFee(ss, 'b')).toBe(500);
    expect(staffNominationFee(ss, 'a')).toBe(0);
  });
  it('指名なし・未選択・スタッフ選択 OFF は 0', () => {
    expect(staffNominationFee(ss, 'none')).toBe(0);
    expect(staffNominationFee(ss, null)).toBe(0);
    expect(staffNominationFee(ss, 'zzz')).toBe(0);
    expect(staffNominationFee({ ...ss, enabled: false }, 'b')).toBe(0);
  });
});

describe('formatNominationFee', () => {
  it('＋500円 の形にする', () => {
    expect(formatNominationFee(500)).toBe('＋500円');
    expect(formatNominationFee(1500)).toBe('＋1,500円');
    expect(formatNominationFee(0)).toBe('');
  });
});

describe('applyNominationFeeToCustomerInfo', () => {
  it('設定どおりならそのまま残す', () => {
    const info: Record<string, unknown> = { total_price: 4500, nomination_fee: 500 };
    expect(applyNominationFeeToCustomerInfo(info, ss, 'b')).toBe(500);
    expect(info).toEqual({ total_price: 4500, nomination_fee: 500 });
  });
  it('フォームが送ってきていないときは足さない（古い HTML）', () => {
    const info: Record<string, unknown> = { total_price: 4000 };
    expect(applyNominationFeeToCustomerInfo(info, ss, 'b')).toBe(0);
    expect(info).toEqual({ total_price: 4000 });
  });
  it('指名料の無いスタッフ・指名なしなら消して合計も戻す', () => {
    const info: Record<string, unknown> = { total_price: 4500, nomination_fee: 500 };
    expect(applyNominationFeeToCustomerInfo(info, ss, 'a')).toBe(0);
    expect(info).toEqual({ total_price: 4000 });
    const info2: Record<string, unknown> = { total_price: 4500, nomination_fee: 500 };
    applyNominationFeeToCustomerInfo(info2, ss, null);
    expect(info2).toEqual({ total_price: 4000 });
  });
  it('金額が設定と違えば設定の値にして合計も直す', () => {
    const info: Record<string, unknown> = { total_price: 4001, nomination_fee: 1 };
    expect(applyNominationFeeToCustomerInfo(info, ss, 'b')).toBe(500);
    expect(info).toEqual({ total_price: 4500, nomination_fee: 500 });
  });
});

describe('予約の金額・表示', () => {
  const reservation = {
    status: 'confirmed',
    reservation_date: '2026-12-01',
    reservation_time: '10:00',
    customer_name: '山田',
    customer_phone: '090',
    selected_menus: [{ menu_name: 'カット', price: 4000 }],
    selected_options: [],
    customer_info: { total_price: 4500, nomination_fee: 500 },
    staff_name: 'B',
    staff_no_preference: false,
  };

  it('reservationNominationFee', () => {
    expect(reservationNominationFee(reservation)).toBe(500);
    expect(reservationNominationFee({ customer_info: null })).toBe(0);
  });

  it('売上に指名料を含める', () => {
    expect(reservationAmount(reservation as never)).toBe(4500);
  });

  it('メール用の項目に 指名料 を担当スタッフの次に出す（送信時の項目編集で消せる）', () => {
    const config = { staff_selection: ss } as never;
    const items = buildReservationDetailItems(config, reservation as never);
    const labels = items.map((i) => i.label);
    expect(labels.indexOf('指名料')).toBe(labels.indexOf('担当スタッフ') + 1);
    expect(items.find((i) => i.label === '指名料')?.value).toBe('¥500');
    const hidden = buildReservationDetailItems(
      { staff_selection: ss, line_message_items: { nomination_fee: false } } as never,
      reservation as never
    );
    expect(hidden.some((i) => i.label === '指名料')).toBe(false);
  });

  it('管理画面の予約詳細に 指名料 を出す', () => {
    const rows = buildAdminReservationRows({ staff_selection: ss } as never, reservation as never);
    expect(rows.find((r) => r.label === '指名料')?.value).toBe('¥500');
  });
});

describe('normalizeForm / 生成 HTML', () => {
  const baseForm = (staff: unknown[]) => ({
    id: 'f1',
    store_id: 's1',
    config: {
      basic_info: { form_name: 'テスト', store_name: '店', liff_id: '123-abc', theme_color: '#3B82F6' },
      staff_selection: { enabled: true, staff },
    },
  });

  it('指名料があるスタッフだけキーを持つ', () => {
    const form = normalizeForm(baseForm([
      { id: 'a', name: 'A', calendar_id: 'ca', nomination_fee: 0 },
      { id: 'b', name: 'B', calendar_id: 'cb', nomination_fee: '500' },
    ]) as never);
    const staff = form.config.staff_selection!.staff;
    expect('nomination_fee' in staff[0]).toBe(false);
    expect(staff[1].nomination_fee).toBe(500);
  });

  it('スタッフのボタンに ＋500円 を表示し、合計・LINE メッセージに指名料を入れる', () => {
    const form = normalizeForm(baseForm([
      { id: 'a', name: 'A', calendar_id: 'ca' },
      { id: 'b', name: 'B', calendar_id: 'cb', nomination_fee: 500 },
    ]) as never);
    const html = new StaticReservationGenerator().generateHTML(form.config as never, 'f1', 's1');
    expect(html).toContain('data-staff-id="b">B<span class="staff-fee">＋500円</span>');
    expect(html).toContain('data-staff-id="a">A</button>');
    expect(html).toContain('getNominationFee()');
    expect(html).toContain('《指名料》');
    expect(html).toContain('customerInfo.nomination_fee');
    // 埋め込み JS が構文エラーになっていないこと
    const scripts = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)).map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    scripts.forEach((code) => { expect(() => new Function(code)).not.toThrow(); });
  });
});
