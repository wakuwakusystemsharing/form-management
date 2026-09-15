import { describe, expect, it } from 'vitest';
import { buildReservationDetailItems, buildAdminReservationRows, formatMenuText } from '../reservation-detail-items';
import { buildCustomerConfirmationEmail, buildStoreNotificationEmail } from '../email-templates';
import { normalizeForm } from '../form-normalizer';

function makeConfig(lineItems: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return normalizeForm({
    id: 'f1',
    store_id: 's1',
    form_type: 'web',
    config: {
      basic_info: { form_name: 'Web予約', store_name: 'テスト店', liff_id: '', theme_color: '#000' },
      gender_selection: { enabled: true, options: [{ value: 'female', label: '女性' }] },
      visit_count_selection: { enabled: true, options: [{ value: 'first', label: '初めて' }] },
      coupon_selection: { enabled: true, options: [{ value: 'c1', label: '初回10%OFF' }] },
      staff_selection: { enabled: true, staff: [] },
      custom_fields: [
        { id: 'cf2', title: '駐車場の利用', type: 'radio', required: false },
        { id: 'cf1', title: 'ご要望', type: 'text', required: false },
      ],
      line_message_items: lineItems,
      ...extra,
    },
  }).config;
}

const reservation = {
  id: 'rsv_1',
  customer_name: '山田 太郎',
  customer_phone: '090-1234-5678',
  customer_email: 'taro@example.com',
  reservation_date: '2026-09-21',
  reservation_time: '14:30:00',
  selected_menus: [
    { menu_id: 'm1', menu_name: 'カット', category_name: 'ヘア', price: 4000, duration: 60 },
    { menu_id: 'm2', menu_name: 'フェイシャル', submenu_name: '60分', category_name: 'エステ', price: 8000, duration: 60 },
  ],
  selected_options: [
    { option_id: 'o1', option_name: 'トリートメント', menu_id: 'm1', price: 1500, duration: 15 },
    { option_id: 'o2', option_name: '延長', category_id: 'cat2', price: 0, duration: 10 },
  ],
  customer_info: {
    gender: 'female', gender_label: '女性',
    visit_count: 'first', visit_count_label: '初めて',
    coupon: 'c1', coupon_label: '初回10%OFF',
    custom_fields_labeled: { 'ご要望': '静かな席希望', '駐車場の利用': '利用する' },
    total_price: 13500,
    total_duration: 145,
  },
  message: 'よろしくお願いします',
  staff_name: '佐藤',
  staff_no_preference: false,
};

describe('buildReservationDetailItems', () => {
  it('すべて ON のとき LINE メッセージと同じ順で全項目を含む', () => {
    const items = buildReservationDetailItems(makeConfig({ option_duration: true }), reservation);
    expect(items.map((i) => i.label)).toEqual([
      'お名前', '電話番号', '担当スタッフ', '性別', 'ご来店回数', 'クーポン',
      '駐車場の利用', 'ご要望', 'メニュー', '合計金額', '合計時間', 'ご来店日時', 'メッセージ',
    ]);
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.value]));
    expect(byLabel['メニュー']).toBe(
      '-（ヘア）-\n・カット\n　└ トリートメント ¥1,500 (15分)\n-（エステ）-\n・フェイシャル > 60分\n　└ 延長 (10分)'
    );
    expect(byLabel['合計金額']).toBe('¥13,500');
    expect(byLabel['合計時間']).toBe('145分');
    expect(byLabel['ご来店日時']).toBe('2026年09月21日（月） 14:30');
    expect(byLabel['担当スタッフ']).toBe('佐藤');
    expect(byLabel['駐車場の利用']).toBe('利用する');
  });

  it('OFF にした項目は含まれない', () => {
    const items = buildReservationDetailItems(
      makeConfig({ name: false, phone: false, gender: false, coupon: false, custom_fields: false, total_price: false, total_duration: false, message: false, options: false }),
      reservation
    );
    expect(items.map((i) => i.label)).toEqual(['担当スタッフ', 'ご来店回数', 'メニュー', 'ご来店日時']);
    expect(items.find((i) => i.label === 'メニュー')?.value).toBe('-（ヘア）-\n・カット\n-（エステ）-\n・フェイシャル > 60分');
  });

  it('カテゴリー名見出しの表示設定（hide / show / auto）', () => {
    const one = { ...reservation, selected_menus: [reservation.selected_menus[0]], selected_options: [] };
    expect(formatMenuText(makeConfig(), one)).toBe('・カット');
    expect(formatMenuText(makeConfig({ menu_category_display: 'show' }), one)).toBe('-（ヘア）-\n・カット');
    expect(formatMenuText(makeConfig({ menu_category_display: 'hide' }), reservation)).not.toContain('-（');
  });

  it('第三希望日時モードは第一〜第三希望日を並べる', () => {
    const md = {
      ...reservation,
      booking_mode: 'multiple_dates',
      customer_info: { ...reservation.customer_info, preferred_date2: '2026-09-22', preferred_time2: '10:00', preferred_date3: '', preferred_time3: '' },
    };
    const items = buildReservationDetailItems(makeConfig(), md);
    const labels = items.map((i) => i.label);
    expect(labels).toContain('第一希望日');
    expect(labels).toContain('第二希望日');
    expect(labels).not.toContain('第三希望日');
    expect(labels).not.toContain('ご来店日時');
  });

  it('指名なし + 自動割当は「指名なし（担当: 名前）」', () => {
    const items = buildReservationDetailItems(makeConfig(), { ...reservation, staff_no_preference: true });
    expect(items.find((i) => i.label === '担当スタッフ')?.value).toBe('指名なし（担当: 佐藤）');
  });
});

describe('メール本文が送信時の項目編集に従う', () => {
  const store = { name: 'テスト店', address: '東京都', phone: '03-0000-0000', postal_code: '100-0001', owner_email: 'owner@example.com' };

  it('お客様向けメールに全項目が入り、OFF の項目は消える', () => {
    const on = buildCustomerConfirmationEmail({ store, reservation, form: { config: makeConfig() } });
    expect(on.body).toContain('■ ご来店回数\n初めて');
    expect(on.body).toContain('■ クーポン\n初回10%OFF');
    expect(on.body).toContain('■ ご要望\n静かな席希望');
    expect(on.body).toContain('■ 合計金額\n¥13,500');
    expect(on.body).toContain('■ メッセージ\nよろしくお願いします');
    expect(on.subject).toContain('2026年09月21日（月） 14:30');

    const off = buildCustomerConfirmationEmail({ store, reservation, form: { config: makeConfig({ coupon: false, custom_fields: false, message: false }) } });
    expect(off.body).not.toContain('クーポン');
    expect(off.body).not.toContain('ご要望');
    expect(off.body).not.toContain('メッセージ');
    expect(off.body).toContain('山田 太郎 様');
  });

  it('店舗向けメールも同じ項目を含み、お客様の連絡先は常に載る', () => {
    const mail = buildStoreNotificationEmail({ store, reservation, form: { config: makeConfig({ name: false, phone: false, gender: false }) } });
    expect(mail.body).toContain('■ ご来店回数：初めて');
    expect(mail.body).toContain('■ メニュー：');
    expect(mail.body).not.toContain('■ 性別');
    expect(mail.body).toContain('■ お名前：山田 太郎');
    expect(mail.body).toContain('■ 電話　：090-1234-5678');
    expect(mail.body).toContain('■ メール：taro@example.com');
  });

  it('form を渡さなくても既定（全項目 ON）で組み立てられる', () => {
    const mail = buildCustomerConfirmationEmail({ store, reservation });
    expect(mail.body).toContain('■ メニュー');
    expect(mail.body).toContain('■ ご来店日時');
  });
});

describe('buildAdminReservationRows（店舗管理画面の予約詳細）', () => {
  it('送信時の項目編集が OFF でもすべて出し、追加質問の ID を表示名に変換する', () => {
    const config = makeConfig(
      { gender: false, custom_fields: false, message: false },
      {
        menu_structure: {
          structure_type: 'category_based',
          categories: [{ id: 'c1', name: 'ヘア', menus: [{ id: 'm1', name: 'カット', price: 4000, duration: 60, options: [
            { id: 'o1', name: 'トリートメント', price: 1500, duration: 15, additional_questions: [{ id: 'aq1', title: '髪の悩み', type: 'text' }] },
          ] }] }],
          display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false },
        },
      }
    );
    const rows = buildAdminReservationRows(config, {
      ...reservation,
      message: '  よろしくお願いします ',
      customer_info: {
        gender: 'female',
        visit_count: 'first',
        coupon: 'c1',
        custom_fields: { cf1: '静かな席希望', aq1: 'パサつき', cf2: '', unknown_id: '2026-09-30' },
        total_price: 13500,
        total_duration: 145,
        preferred_date2: '2026-09-22',
        preferred_time2: '10:00',
      },
    });
    expect(rows).toEqual([
      { label: '担当スタッフ', value: '佐藤' },
      { label: '性別', value: '女性' },
      { label: 'ご来店回数', value: '初めて' },
      { label: 'クーポン', value: '初回10%OFF' },
      { label: '髪の悩み', value: 'パサつき' },
      { label: 'ご要望', value: '静かな席希望' },
      { label: 'unknown_id', value: '2026-09-30' },
      { label: '合計金額', value: '¥13,500' },
      { label: '合計時間', value: '145分' },
      { label: '第二希望日', value: '2026年09月22日（火） 10:00' },
      { label: 'メッセージ', value: 'よろしくお願いします' },
    ]);
  });

  it('customer_info が無くても担当スタッフとメッセージは出る', () => {
    const rows = buildAdminReservationRows(undefined, { ...reservation, customer_info: null, staff_no_preference: true });
    expect(rows).toEqual([
      { label: '担当スタッフ', value: '指名なし（担当: 佐藤）' },
      { label: 'メッセージ', value: 'よろしくお願いします' },
    ]);
  });
});
