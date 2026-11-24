import { describe, expect, it } from 'vitest';
import { buildStoreAdminNav, normalizeAdminVisibleOptions, resolveAdminVisibleOptions, resolveVisibleTabs } from '@/lib/store-admin-tabs';

describe('resolveVisibleTabs', () => {
  it('null / 不正値はすべて表示', () => {
    expect(resolveVisibleTabs(null)).toEqual(['dashboard', 'reservations', 'customers', 'surveys', 'lotteries', 'walls', 'broadcasts', 'settings']);
    expect(resolveVisibleTabs('x')).toHaveLength(8);
    expect(resolveVisibleTabs(['nope'])).toHaveLength(8);
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
      customer_survey_history: false,      // アンケート管理 OFF に連動
      store_digest: true,                  // 設定 ON に連動
      calendar: false,                     // 予約管理 OFF に連動
    });
    const all = resolveAdminVisibleOptions(null, null);
    expect(Object.values(all).every(Boolean)).toBe(true);
  });
  it('今日の予約まとめ・月次レポートは「設定」に連動し、個別に隠せる', () => {
    expect(resolveAdminVisibleOptions(['dashboard', 'settings'], null).store_digest).toBe(true);
    expect(resolveAdminVisibleOptions(['dashboard'], null).store_digest).toBe(false);
    expect(resolveAdminVisibleOptions(['dashboard', 'settings'], { store_digest: false }).store_digest).toBe(false);
    // 運営が開いたときは常に表示
    expect(resolveAdminVisibleOptions(['dashboard', 'settings'], { store_digest: false }, true).store_digest).toBe(true);
    expect(normalizeAdminVisibleOptions({ store_digest: false })).toEqual({ store_digest: false });
  });
  it('カレンダーは「予約管理」に連動し、個別に表示・非表示にできる', () => {
    // 何も設定していない店舗（すべて表示）では出る
    expect(resolveAdminVisibleOptions(null, null).calendar).toBe(true);
    // 予約管理を非表示にしている店舗では出ない（予約を見せない設定の店舗で、予約が見えてしまわないように）
    expect(resolveAdminVisibleOptions(['dashboard', 'customers'], null).calendar).toBe(false);
    // 予約管理は非表示のまま、カレンダーだけ表示
    expect(resolveAdminVisibleOptions(['dashboard', 'customers'], { calendar: true }).calendar).toBe(true);
    // 予約管理は表示のまま、カレンダーだけ非表示
    expect(resolveAdminVisibleOptions(['dashboard', 'reservations'], { calendar: false }).calendar).toBe(false);
  });
  it('メニューの並び: カレンダーは予約管理のすぐ後ろ', () => {
    expect(buildStoreAdminNav(resolveVisibleTabs(null), true)).toEqual(['dashboard', 'reservations', 'calendar', 'customers', 'surveys', 'lotteries', 'walls', 'broadcasts', 'settings']);
    expect(buildStoreAdminNav(resolveVisibleTabs(null), false)).not.toContain('calendar');
    expect(buildStoreAdminNav(['dashboard', 'customers'], true)).toEqual(['dashboard', 'calendar', 'customers']);
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
