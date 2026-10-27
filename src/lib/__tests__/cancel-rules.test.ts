import { describe, expect, it } from 'vitest';
import {
  buildCancelDeadlineMessage,
  buildCancelNotificationEmail,
  buildCancelPolicyText,
  resolveCancelFee,
  sanitizeFeeTiers,
  formatDeadlineJst,
  getCancelDeadline,
  isCancelAllowed,
  resolveCancelRules,
} from '@/lib/cancel-rules';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';

describe('cancel-rules（キャンセルルール設定）', () => {
  it('resolveCancelRules: 欠損・不正値は既定（制限なし / 表示なし / 通知なし）', () => {
    const base = { deadline_hours: 0, policy_text: '', show_policy_on_form: false, notify_store_on_cancel: false, fee_tiers: [], fee_base: 'stay', self_cancel_with_fee: 'confirm' };
    expect(resolveCancelRules(undefined)).toEqual(base);
    expect(resolveCancelRules({ cancel_rules: { deadline_hours: -5, policy_text: 3 as unknown as string, show_policy_on_form: 'yes' as unknown as boolean } })).toEqual(base);
    expect(resolveCancelRules({ cancel_rules: { deadline_hours: 24.9, policy_text: '当日キャンセル不可', show_policy_on_form: true, notify_store_on_cancel: true } })).toEqual({
      ...base, deadline_hours: 24, policy_text: '当日キャンセル不可', show_policy_on_form: true, notify_store_on_cancel: true,
    });
    // normalizeForm でも補完される
    expect(normalizeForm({ id: 'f', store_id: 's', config: {} }).config.cancel_rules).toEqual(base);
  });

  it('期限: 予約日時（JST）の N 時間前。制限なしは null', () => {
    expect(getCancelDeadline({ deadline_hours: 0 }, '2026-09-20', '14:00:00')).toBeNull();
    const d = getCancelDeadline({ deadline_hours: 24 }, '2026-09-20', '14:00:00');
    expect(d?.toISOString()).toBe('2026-09-19T05:00:00.000Z'); // 9/19 14:00 JST
    expect(formatDeadlineJst(d!)).toBe('9/19（土）14:00');
    expect(getCancelDeadline({ deadline_hours: 2 }, 'invalid', '10:00')).toBeNull();
  });

  it('isCancelAllowed: 期限前は可、期限後は不可（管理画面からのキャンセルは呼び出し側で適用しない）', () => {
    const rules = { deadline_hours: 24 };
    expect(isCancelAllowed(rules, '2026-09-20', '14:00', new Date('2026-09-19T04:59:00Z'))).toMatchObject({ allowed: true });
    expect(isCancelAllowed(rules, '2026-09-20', '14:00', new Date('2026-09-19T05:00:00Z')).allowed).toBe(true); // ちょうど期限は可
    expect(isCancelAllowed(rules, '2026-09-20', '14:00', new Date('2026-09-19T05:01:00Z')).allowed).toBe(false);
    expect(isCancelAllowed({ deadline_hours: 0 }, '2026-09-20', '14:00', new Date('2026-09-20T04:59:00Z')).allowed).toBe(true);
  });

  it('案内文: 期限と店舗電話番号を含む', () => {
    const deadline = getCancelDeadline({ deadline_hours: 24 }, '2026-09-20', '14:00');
    const msg = buildCancelDeadlineMessage({ deadline_hours: 24 }, deadline, '03-0000-0000');
    expect(msg).toContain('24 時間前まで');
    expect(msg).toContain('9/19（土）14:00');
    expect(msg).toContain('TEL: 03-0000-0000');
    expect(buildCancelDeadlineMessage({ deadline_hours: 2 }, null, null)).toContain('店舗まで直接ご連絡ください');
  });

  it('店舗向けキャンセル通知メール', () => {
    const mail = buildCancelNotificationEmail({
      storeName: 'テスト店',
      reservation: { customer_name: '山田 太郎', customer_phone: '090-0000-0000', reservation_date: '2026-09-20', reservation_time: '14:00:00', menu_name: 'カット', submenu_name: null, staff_name: '佐藤' },
      cancelledAt: new Date('2026-09-18T01:30:00Z'),
    });
    expect(mail.subject).toBe('【予約キャンセル】山田 太郎様｜2026-09-20 14:00');
    expect(mail.body).toContain('お客様によりキャンセルされました');
    expect(mail.body).toContain('■ メニュー：カット');
    expect(mail.body).toContain('■ 担当　　：佐藤');
    expect(mail.body).toContain('■ 操作日時：9/18（金）10:30');
  });

  it('フォーム: 表示 ON かつ文言ありのときだけ送信ボタンの上にキャンセル規定を出す', () => {
    const base = { id: 'f1', store_id: 'st1', form_type: 'line', config: { basic_info: { form_name: '予約', store_name: '店', liff_id: '', theme_color: '#3B82F6' } } };
    const gen = new StaticReservationGenerator();
    const on = normalizeForm({ ...base, config: { ...base.config, cancel_rules: { deadline_hours: 24, policy_text: '当日キャンセルは\nキャンセル料 50%', show_policy_on_form: true } } });
    const html = gen.generateHTML(on.config, on.id, on.store_id, 'preview');
    expect(html).toContain('id="cancel-policy"');
    expect(html).toContain('当日キャンセルは<br>キャンセル料 50%');
    expect(html).toContain('ご予約日時の 24 時間前まで');
    expect(html.indexOf('id="cancel-policy"')).toBeLessThan(html.indexOf('id="submit-button"'));
    const off = normalizeForm({ ...base, config: { ...base.config, cancel_rules: { deadline_hours: 24, policy_text: 'x', show_policy_on_form: false } } });
    expect(gen.generateHTML(off.config, off.id, off.store_id, 'preview')).not.toContain('id="cancel-policy"');
  });
});

describe('cancel-rules: 段階式キャンセル料（fee_tiers）', () => {
  // 7 日前以前 無料 / 2〜6 日前 50% / 前日・当日 100%
  const tiers = [{ days_before: 7, percent: 0 }, { days_before: 2, percent: 50 }, { days_before: 0, percent: 100 }];
  const rules = { fee_tiers: tiers, fee_base: 'stay' as const };
  const jst = (s: string) => new Date(`${s}+09:00`);

  it('sanitizeFeeTiers: 不正値を除き、days_before の大きい順に並べ、% は 0〜100 の整数。同じ日数 + 時刻は後勝ち', () => {
    expect(sanitizeFeeTiers(undefined)).toEqual([]);
    expect(sanitizeFeeTiers([
      { days_before: 0, percent: 100 },
      { days_before: 7, percent: -1 },
      { days_before: 2, percent: 50.7, until_time: '25:00' },
      { days_before: 1, percent: 30, until_time: '18:00' },
      { days_before: 'x', percent: 10 },
      { days_before: 2, percent: 55 },
    ])).toEqual([
      { days_before: 7, percent: 0 },
      { days_before: 2, percent: 55 },
      { days_before: 1, until_time: '18:00', percent: 30 },
      { days_before: 0, percent: 100 },
    ]);
    // resolveCancelRules でも補完される
    expect(resolveCancelRules({ cancel_rules: { fee_tiers: tiers, fee_base: 'total', self_cancel_with_fee: 'deny' } })).toMatchObject({ fee_tiers: tiers, fee_base: 'total', self_cancel_with_fee: 'deny' });
    expect(resolveCancelRules({ cancel_rules: { fee_base: 'x' as unknown as 'stay', self_cancel_with_fee: 'y' as unknown as 'deny' } })).toMatchObject({ fee_base: 'stay', self_cancel_with_fee: 'confirm' });
  });

  it('resolveCancelFee: 日付差で段階を選ぶ（7 / 6 / 2 / 1 / 0 日前・過ぎた後）。金額は 10 円未満切り捨て', () => {
    const checkin = '2026-11-10';
    expect(resolveCancelFee(rules, checkin, jst('2026-11-03T23:00:00'), 26000)).toMatchObject({ percent: 0, amount: 0, daysBefore: 7 });
    expect(resolveCancelFee(rules, checkin, jst('2026-11-04T00:00:00'), 26000)).toMatchObject({ percent: 50, amount: 13000, daysBefore: 6 });
    expect(resolveCancelFee(rules, checkin, jst('2026-11-08T12:00:00'), 26000)).toMatchObject({ percent: 50, daysBefore: 2 });
    expect(resolveCancelFee(rules, checkin, jst('2026-11-09T09:00:00'), 26000)).toMatchObject({ percent: 100, amount: 26000, daysBefore: 1 });
    expect(resolveCancelFee(rules, checkin, jst('2026-11-10T14:00:00'), 26000)).toMatchObject({ percent: 100, daysBefore: 0 });
    expect(resolveCancelFee(rules, checkin, jst('2026-11-11T14:00:00'), 26000)).toMatchObject({ percent: 100, daysBefore: -1 });
    expect(resolveCancelFee(rules, checkin, jst('2026-11-08T12:00:00'), 14555).amount).toBe(7270);
    expect(resolveCancelFee({ fee_tiers: [] }, checkin, jst('2026-11-10T00:00:00'), 26000)).toEqual({ percent: 0, amount: 0, daysBefore: 0, tier: null });
  });

  it('resolveCancelFee: until_time 付きの段階（前日 18:00 まで 50%、以降 100%）', () => {
    const r = { fee_tiers: [{ days_before: 7, percent: 0 }, { days_before: 1, until_time: '18:00', percent: 50 }, { days_before: 0, percent: 100 }] };
    expect(resolveCancelFee(r, '2026-11-10', jst('2026-11-09T17:59:00'), 20000).percent).toBe(50);
    expect(resolveCancelFee(r, '2026-11-10', jst('2026-11-09T18:00:00'), 20000).percent).toBe(100);
    expect(resolveCancelFee(r, '2026-11-10', jst('2026-11-05T23:00:00'), 20000).percent).toBe(50); // 5 日前は until_time に関係なく 50%
    // 最初の段階（7 日前以前）が時刻付きでも、それより前の日は無料
    const r2 = { fee_tiers: [{ days_before: 7, until_time: '12:00', percent: 0 }, { days_before: 0, percent: 50 }] };
    expect(resolveCancelFee(r2, '2026-11-10', jst('2026-11-01T20:00:00'), 20000).percent).toBe(0);
    expect(resolveCancelFee(r2, '2026-11-10', jst('2026-11-03T11:59:00'), 20000).percent).toBe(0);
    expect(resolveCancelFee(r2, '2026-11-10', jst('2026-11-03T12:00:00'), 20000).percent).toBe(50);
  });

  it('buildCancelPolicyText: 段階表から規定文を自動生成', () => {
    expect(buildCancelPolicyText({ fee_tiers: tiers })).toBe('7日前まで: 無料\n2〜6日前: 50%\n前日・当日: 100%');
    expect(buildCancelPolicyText({ fee_tiers: [{ days_before: 7, percent: 0 }, { days_before: 1, until_time: '18:00', percent: 50 }, { days_before: 0, percent: 100 }] }))
      .toBe('7日前まで: 無料\n2〜6日前・前日18:00まで: 50%\n前日18:00以降・当日: 100%');
    expect(buildCancelPolicyText({ fee_tiers: [{ days_before: 3, percent: 0 }, { days_before: 0, percent: 100 }] })).toBe('3日前まで: 無料\n2日前〜当日: 100%');
    expect(buildCancelPolicyText({ fee_tiers: [{ days_before: 1, percent: 100 }] })).toBe('全期間: 100%');
    expect(buildCancelPolicyText({ fee_tiers: [] })).toBe('');
  });
});
