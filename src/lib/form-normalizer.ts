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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawForm = form as any;
  
  // Supabase からの JSONB は string になることがあるのでパース
  let existingConfig = rawForm.config;
  if (typeof existingConfig === 'string') {
    try {
      existingConfig = JSON.parse(existingConfig);
    } catch {
      existingConfig = undefined;
    }
  }
  
  // デフォルト config 構造
  const defaultConfig = {
    basic_info: {
      form_name: 'フォーム',
      store_name: '',
      liff_id: '',
      theme_color: '#3B82F6',
      logo_url: undefined
    },
    visit_options: [],
    gender_selection: {
      enabled: false,
      required: false,
      options: [
        { value: 'male', label: '男性' },
        { value: 'female', label: '女性' }
      ]
    },
    visit_count_selection: {
      enabled: false,
      required: false,
      options: [
        { value: 'first', label: '初回' },
        { value: 'repeat', label: '2回目以降' }
      ]
    },
    coupon_selection: {
      enabled: false,
      coupon_name: '',
      options: [
        { value: 'use', label: '利用する' },
        { value: 'not_use', label: '利用しない' }
      ]
    },
    menu_structure: {
      structure_type: 'category_based' as const,
      categories: [],
      display_options: {
        show_price: true,
        show_duration: true,
        show_description: true,
        show_treatment_info: false
      }
    },
    calendar_settings: {
      business_hours: {
        monday: { open: '09:00', close: '18:00', closed: false },
        tuesday: { open: '09:00', close: '18:00', closed: false },
        wednesday: { open: '09:00', close: '18:00', closed: false },
        thursday: { open: '09:00', close: '18:00', closed: false },
        friday: { open: '09:00', close: '18:00', closed: false },
        saturday: { open: '09:00', close: '18:00', closed: false },
        sunday: { open: '09:00', close: '18:00', closed: true }
      },
      advance_booking_days: 30
    },
    ui_settings: {
      theme_color: '#3B82F6',
      button_style: 'rounded' as const,
      show_repeat_booking: false,
      show_side_nav: true
    },
    validation_rules: {
      required_fields: ['name', 'phone'],
      phone_format: 'japanese' as const,
      name_max_length: 50
    },
    gas_endpoint: ''
  };

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
        form_name: rawForm.form_name || existingConfig?.basic_info?.form_name || rawForm.config?.basic_info?.form_name || 'フォーム',
        store_name: existingConfig?.basic_info?.store_name || rawForm.config?.basic_info?.store_name || rawForm.basic_info?.store_name || '',
        liff_id: existingConfig?.basic_info?.liff_id || rawForm.config?.basic_info?.liff_id || rawForm.basic_info?.liff_id || rawForm.line_settings?.liff_id || '',
        theme_color: existingConfig?.basic_info?.theme_color || rawForm.config?.basic_info?.theme_color || rawForm.basic_info?.theme_color || '#3B82F6',
        logo_url: existingConfig?.basic_info?.logo_url || rawForm.config?.basic_info?.logo_url || rawForm.basic_info?.logo_url
      },
      visit_options: existingConfig?.visit_options || rawForm.config?.visit_options || [],
      gender_selection: {
        enabled: existingConfig?.gender_selection?.enabled ?? rawForm.config?.gender_selection?.enabled ?? rawForm.config?.basic_info?.show_gender_selection ?? rawForm.basic_info?.show_gender_selection ?? false,
        required: existingConfig?.gender_selection?.required ?? false,
        options: existingConfig?.gender_selection?.options || rawForm.config?.gender_selection?.options || [
          { value: 'male', label: '男性' },
          { value: 'female', label: '女性' }
        ]
      },
      visit_count_selection: {
        enabled: existingConfig?.visit_count_selection?.enabled ?? rawForm.config?.visit_count_selection?.enabled ?? rawForm.config?.ui_settings?.show_visit_count ?? rawForm.ui_settings?.show_visit_count ?? false,
        required: existingConfig?.visit_count_selection?.required ?? false,
        options: existingConfig?.visit_count_selection?.options || rawForm.config?.visit_count_selection?.options || [
          { value: 'first', label: '初回' },
          { value: 'repeat', label: '2回目以降' }
        ]
      },
      coupon_selection: {
        enabled: existingConfig?.coupon_selection?.enabled ?? rawForm.config?.coupon_selection?.enabled ?? rawForm.config?.ui_settings?.show_coupon_selection ?? rawForm.ui_settings?.show_coupon_selection ?? false,
        coupon_name: existingConfig?.coupon_selection?.coupon_name || rawForm.config?.coupon_selection?.coupon_name || '',
        options: existingConfig?.coupon_selection?.options || rawForm.config?.coupon_selection?.options || [
          { value: 'use', label: '利用する' },
          { value: 'not_use', label: '利用しない' }
        ]
      },
      menu_structure: {
        structure_type: existingConfig?.menu_structure?.structure_type || rawForm.config?.menu_structure?.structure_type || 'category_based',
        categories: existingConfig?.menu_structure?.categories || rawForm.config?.menu_structure?.categories || rawForm.menu_structure?.categories || [],
        display_options: {
          show_price: existingConfig?.menu_structure?.display_options?.show_price ?? true,
          show_duration: existingConfig?.menu_structure?.display_options?.show_duration ?? true,
          show_description: existingConfig?.menu_structure?.display_options?.show_description ?? true,
          show_treatment_info: existingConfig?.menu_structure?.display_options?.show_treatment_info ?? false
        }
      },
      calendar_settings: {
        business_hours: existingConfig?.calendar_settings?.business_hours || rawForm.config?.calendar_settings?.business_hours || rawForm.business_rules?.business_hours || defaultConfig.calendar_settings.business_hours,
        advance_booking_days: existingConfig?.calendar_settings?.advance_booking_days || rawForm.config?.calendar_settings?.advance_booking_days || rawForm.business_rules?.advance_booking_days || 30
      },
      ui_settings: {
        theme_color: existingConfig?.ui_settings?.theme_color || rawForm.config?.basic_info?.theme_color || rawForm.basic_info?.theme_color || rawForm.config?.ui_settings?.theme_color || rawForm.ui_settings?.theme_color || '#3B82F6',
        button_style: (existingConfig?.ui_settings?.button_style || rawForm.config?.ui_settings?.button_style || rawForm.ui_settings?.button_style || 'rounded') as 'rounded' | 'square',
        show_repeat_booking: existingConfig?.ui_settings?.show_repeat_booking ?? rawForm.config?.ui_settings?.show_repeat_booking ?? rawForm.ui_settings?.show_repeat_booking ?? false,
        show_side_nav: existingConfig?.ui_settings?.show_side_nav !== undefined ? existingConfig?.ui_settings?.show_side_nav : (rawForm.config?.ui_settings?.show_side_nav !== undefined ? rawForm.config?.ui_settings?.show_side_nav : (rawForm.ui_settings?.show_side_nav !== undefined ? rawForm.ui_settings?.show_side_nav : true))
      },
      validation_rules: {
        required_fields: existingConfig?.validation_rules?.required_fields || rawForm.config?.validation_rules?.required_fields || ['name', 'phone'],
        phone_format: (existingConfig?.validation_rules?.phone_format || rawForm.config?.validation_rules?.phone_format || 'japanese') as 'japanese' | 'international',
        name_max_length: existingConfig?.validation_rules?.name_max_length || rawForm.config?.validation_rules?.name_max_length || 50
      },
      gas_endpoint: existingConfig?.gas_endpoint || rawForm.config?.gas_endpoint || rawForm.gas_endpoint || ''
    }
  };
  
  return normalizedForm;
}
