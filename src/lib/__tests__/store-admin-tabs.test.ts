import { describe, expect, it } from 'vitest';
import { normalizeAdminVisibleOptions, resolveAdminVisibleOptions, resolveVisibleTabs } from '@/lib/store-admin-tabs';

describe('resolveVisibleTabs', () => {
  it('null / 不正値はすべて表示', () => {
    expect(resolveVisibleTabs(null)).toEqual(['dashboard', 'reservations', 'customers', 'surveys', 'lotteries', 'settings']);
    expect(resolveVisibleTabs('x')).toHaveLength(6);
    expect(resolveVisibleTabs(['nope'])).toHaveLength(6);
  });
  it('有効な ID だけを定義順で返す', () => {
    expect(resolveVisibleTabs(['settings', 'customers', 'zzz'])).toEqual(['customers', 'settings']);
  });
});

describe('normalizeAdminVisibleOptions', () => {
  it('不正なキー・値を捨てる', () => {
    expect(normalizeAdminVisibleOptions({ reservation_forms: false, foo: true, survey_forms: 'yes' })).toEqual({ reservation_forms: false });
    expect(normalizeAdminVisibleOptions(null)).toEqual({});
    expect(normalizeAdminVisibleOptions([true])).toEqual({});
  });
});

describe('resolveAdminVisibleOptions', () => {
  it('未設定なら親タブに連動する', () => {
    const r = resolveAdminVisibleOptions(['dashboard', 'customers', 'settings'], null);
    expect(r).toEqual({
      reservation_forms: false,
      survey_forms: false,
      lottery_forms: false,
      customer_reservation_history: false, // 予約管理 OFF に連動
      customer_lottery_history: false,     // 抽選管理 OFF に連動
    });
    const all = resolveAdminVisibleOptions(null, null);
    expect(Object.values(all).every(Boolean)).toBe(true);
  });
  it('明示的な設定が連動より優先される', () => {
    const r = resolveAdminVisibleOptions(['dashboard', 'customers', 'reservations'], {
      customer_reservation_history: false, // 予約管理 ON でも履歴は隠す
      customer_lottery_history: true,      // 抽選管理 OFF でも抽選履歴は出す
      reservation_forms: false,            // 予約管理 ON でもフォーム管理は隠す
    });
    expect(r.customer_reservation_history).toBe(false);
    expect(r.customer_lottery_history).toBe(true);
    expect(r.reservation_forms).toBe(false);
    expect(r.survey_forms).toBe(false);
  });
  it('上位管理者はすべて表示', () => {
    const r = resolveAdminVisibleOptions(['dashboard'], { reservation_forms: false }, true);
    expect(Object.values(r).every(Boolean)).toBe(true);
  });
});
