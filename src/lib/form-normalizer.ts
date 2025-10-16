/**
 * フォームデータの正規化ユーティリティ
 * 旧形式と新形式の互換性を保つ
 */

import { Form } from '@/types/form';

/**
 * フォーム構造を正規化する関数
 * 旧「フラット形式」(top-level form_name 等) と新 config.* 形式を統一
 */
export function normalizeForm(form: Form | Record<string, unknown>): Form {
  // 既にconfig構造を持っている場合はそのまま返す
  if ('config' in form && form.config) {
    return form as Form;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawForm = form as any;
  
  // 新しい簡易形式を従来のconfig形式に変換
  const normalizedForm: Form = {
    id: rawForm.id,
    store_id: rawForm.store_id,
    status: rawForm.status || 'inactive',
    draft_status: rawForm.draft_status || 'none',
    created_at: rawForm.created_at,
    updated_at: rawForm.updated_at,
    last_published_at: rawForm.last_published_at,
    config: {
      basic_info: {
        form_name: rawForm.form_name || rawForm.config?.basic_info?.form_name || 'フォーム',
        store_name: rawForm.config?.basic_info?.store_name || rawForm.basic_info?.store_name || '',
        liff_id: rawForm.config?.basic_info?.liff_id || rawForm.basic_info?.liff_id || rawForm.line_settings?.liff_id || '',
        theme_color: rawForm.config?.basic_info?.theme_color || rawForm.basic_info?.theme_color || '#3B82F6',
        logo_url: rawForm.config?.basic_info?.logo_url || rawForm.basic_info?.logo_url
      },
      visit_options: rawForm.config?.visit_options || [],
      gender_selection: {
        enabled: rawForm.config?.basic_info?.show_gender_selection || rawForm.basic_info?.show_gender_selection || false,
        required: false,
        options: [
          { value: 'male', label: '男性' },
          { value: 'female', label: '女性' }
        ]
      },
      visit_count_selection: {
        enabled: rawForm.config?.ui_settings?.show_visit_count || rawForm.ui_settings?.show_visit_count || false,
        required: false,
        options: [
          { value: 'first', label: '初回' },
          { value: 'repeat', label: '2回目以降' }
        ]
      },
      coupon_selection: {
        enabled: rawForm.config?.ui_settings?.show_coupon_selection || rawForm.ui_settings?.show_coupon_selection || false,
        coupon_name: '',
        options: [
          { value: 'use', label: '利用する' },
          { value: 'not_use', label: '利用しない' }
        ]
      },
      menu_structure: {
        structure_type: rawForm.config?.menu_structure?.structure_type || 'category_based',
        categories: rawForm.config?.menu_structure?.categories || rawForm.menu_structure?.categories || [],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      },
      calendar_settings: {
        business_hours: rawForm.config?.calendar_settings?.business_hours || rawForm.business_rules?.business_hours || {
          monday: { open: '09:00', close: '18:00', closed: false },
          tuesday: { open: '09:00', close: '18:00', closed: false },
          wednesday: { open: '09:00', close: '18:00', closed: false },
          thursday: { open: '09:00', close: '18:00', closed: false },
          friday: { open: '09:00', close: '18:00', closed: false },
          saturday: { open: '09:00', close: '18:00', closed: false },
          sunday: { open: '09:00', close: '18:00', closed: true }
        },
        advance_booking_days: rawForm.config?.calendar_settings?.advance_booking_days || rawForm.business_rules?.advance_booking_days || 30
      },
      ui_settings: {
        theme_color: rawForm.config?.basic_info?.theme_color || rawForm.basic_info?.theme_color || rawForm.config?.ui_settings?.theme_color || rawForm.ui_settings?.theme_color || '#3B82F6',
        button_style: rawForm.config?.ui_settings?.button_style || rawForm.ui_settings?.button_style || 'rounded',
        show_repeat_booking: rawForm.config?.ui_settings?.show_repeat_booking || rawForm.ui_settings?.show_repeat_booking || false,
        show_side_nav: rawForm.config?.ui_settings?.show_side_nav !== undefined ? rawForm.config?.ui_settings?.show_side_nav : (rawForm.ui_settings?.show_side_nav !== undefined ? rawForm.ui_settings?.show_side_nav : true)
      },
      validation_rules: {
        required_fields: rawForm.config?.validation_rules?.required_fields || ['name', 'phone'],
        phone_format: rawForm.config?.validation_rules?.phone_format || 'japanese',
        name_max_length: rawForm.config?.validation_rules?.name_max_length || 50
      },
      gas_endpoint: rawForm.config?.gas_endpoint || rawForm.gas_endpoint || ''
    }
  };
  
  return normalizedForm;
}
