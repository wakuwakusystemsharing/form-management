import { describe, expect, it } from 'vitest';
import { normalizeForm } from '@/lib/form-normalizer';
import { FORM_SYNC_SECTION_IDS, buildSyncedConfig, listSyncTargets } from '@/lib/form-sync';

const line = normalizeForm({
  id: 'line1', store_id: 'st1', status: 'active',
  config: {
    form_type: 'line',
    basic_info: { form_name: 'LINE予約', store_name: '店', liff_id: '1234567890-abcdefgh', theme_color: '#111111', notice: '注意', submit_button_label: '申し込む', line_only: true, second_message: { enabled: true, text: '2通目' } },
    menu_structure: { structure_type: 'category_based', categories: [{ id: 'c1', name: 'ヘア', menus: [{ id: 'm1', name: 'カット', price: 4000, duration: 60 }] }], display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false } },
    custom_fields: [{ id: 'cf1', type: 'text', title: 'ご要望', required: false }],
    calendar_settings: { booking_mode: 'calendar', advance_booking_days: 45, show_customer_email: false, notification_email: '', business_hours: { monday: { open: '10:00', close: '19:00', closed: false } } },
    line_message_items: { name: false, phone: true },
    cancel_rules: { deadline_hours: 24, policy_text: '規定', show_policy_on_form: true, notify_store_on_cancel: true },
    visit_count_selection: { enabled: true, required: true, label: 'ご利用回数', options: [{ value: 'first', label: '初めて' }] },
  },
});
const web = normalizeForm({
  id: 'web1', store_id: 'st1', status: 'active',
  config: {
    form_type: 'web',
    basic_info: { form_name: 'Web予約', store_name: '店', liff_id: '', theme_color: '#999999', notice: '', line_only: false },
    menu_structure: { structure_type: 'category_based', categories: [], display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false } },
    custom_fields: [],
    calendar_settings: { booking_mode: 'calendar', advance_booking_days: 30, show_customer_email: true, notification_email: 'web@example.com', business_hours: { monday: { open: '09:00', close: '18:00', closed: false } } },
    line_message_items: { name: true, phone: false },
    cancel_rules: { deadline_hours: 0, policy_text: '', show_policy_on_form: false, notify_store_on_cancel: false },
  },
});

describe('form-sync: buildSyncedConfig', () => {
  it('全セクション ON: メニュー等はコピー、種別固有の項目と送信時の項目編集は反映先のまま', () => {
    const out = buildSyncedConfig(line.config, web.config, FORM_SYNC_SECTION_IDS);
    // コピーされる
    expect(out.menu_structure.categories[0].menus[0].name).toBe('カット');
    expect(out.custom_fields?.[0].title).toBe('ご要望');
    expect(out.calendar_settings.advance_booking_days).toBe(45);
    expect(out.calendar_settings.business_hours.monday.open).toBe('10:00');
    expect(out.cancel_rules?.deadline_hours).toBe(24);
    expect(out.visit_count_selection.label).toBe('ご利用回数');
    expect(out.basic_info.theme_color).toBe('#111111');
    expect(out.basic_info.notice).toBe('注意');
    expect(out.basic_info.submit_button_label).toBe('申し込む');
    // 反映先のまま
    expect(out.form_type).toBe('web');
    expect(out.basic_info.form_name).toBe('Web予約');
    expect(out.basic_info.liff_id).toBe('');
    expect(out.basic_info.line_only).toBe(false);
    expect(out.basic_info.second_message).toEqual(web.config.basic_info.second_message); // 反映元の「2通目」は入らない
    expect(out.basic_info.second_message?.text).not.toBe('2通目');
    expect(out.calendar_settings.show_customer_email).toBe(true);
    expect(out.calendar_settings.notification_email).toBe('web@example.com');
    expect(out.line_message_items).toEqual(web.config.line_message_items);
    // 元は変更されない
    expect(web.config.menu_structure.categories).toHaveLength(0);
    expect(line.config.basic_info.form_name).toBe('LINE予約');
  });

  it('セクションを絞ると、それ以外は反映先のまま', () => {
    const out = buildSyncedConfig(line.config, web.config, ['menu_structure']);
    expect(out.menu_structure.categories[0].menus[0].name).toBe('カット');
    expect(out.custom_fields).toEqual([]);
    expect(out.calendar_settings.advance_booking_days).toBe(30);
    expect(out.cancel_rules?.deadline_hours).toBe(0);
    expect(out.basic_info.theme_color).toBe('#999999');
    const none = buildSyncedConfig(line.config, web.config, []);
    expect(none).toEqual(web.config);
  });

  it('listSyncTargets: 同じ店舗の予約フォームのうち元以外。種別と表示名を付ける', () => {
    const targets = listSyncTargets([
      line, web,
      normalizeForm({ id: 'other', store_id: 'st2', status: 'active', config: { basic_info: { form_name: '他店', liff_id: '', theme_color: '#000' } } }),
    ], 'line1', 'st1');
    expect(targets).toEqual([{ id: 'web1', name: 'Web予約', form_type: 'web', status: 'active' }]);
  });
});
