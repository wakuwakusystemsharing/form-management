import { describe, expect, it } from 'vitest';
import {
  buildCancelDeadlineMessage,
  buildCancelNotificationEmail,
  formatDeadlineJst,
  getCancelDeadline,
  isCancelAllowed,
  resolveCancelRules,
} from '@/lib/cancel-rules';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';

describe('cancel-rules（キャンセルルール設定）', () => {
  it('resolveCancelRules: 欠損・不正値は既定（制限なし / 表示なし / 通知なし）', () => {
    expect(resolveCancelRules(undefined)).toEqual({ deadline_hours: 0, policy_text: '', show_policy_on_form: false, notify_store_on_cancel: false });
    expect(resolveCancelRules({ cancel_rules: { deadline_hours: -5, policy_text: 3 as unknown as string, show_policy_on_form: 'yes' as unknown as boolean } })).toEqual({
      deadline_hours: 0, policy_text: '', show_policy_on_form: false, notify_store_on_cancel: false,
    });
    expect(resolveCancelRules({ cancel_rules: { deadline_hours: 24.9, policy_text: '当日キャンセル不可', show_policy_on_form: true, notify_store_on_cancel: true } })).toEqual({
      deadline_hours: 24, policy_text: '当日キャンセル不可', show_policy_on_form: true, notify_store_on_cancel: true,
    });
    // normalizeForm でも補完される
    expect(normalizeForm({ id: 'f', store_id: 's', config: {} }).config.cancel_rules).toEqual({ deadline_hours: 0, policy_text: '', show_policy_on_form: false, notify_store_on_cancel: false });
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
