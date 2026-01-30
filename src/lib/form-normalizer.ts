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
  const rawForm = form as Record<string, unknown>;
  
  // Supabase からの JSONB は string になることがあるのでパース
  let existingConfig: Form['config'] | undefined = rawForm.config as Form['config'] | undefined;
  if (typeof existingConfig === 'string') {
    try {
      existingConfig = JSON.parse(existingConfig) as Form['config'];
    } catch {
      existingConfig = undefined;
    }
  }
  
  // rawFormの型を定義
  const typedRawForm = rawForm as {
    id?: string;
    store_id?: string;
    status?: 'active' | 'inactive' | 'paused';
    draft_status?: 'none' | 'draft' | 'ready_to_publish';
    created_at?: string;
    updated_at?: string;
    last_published_at?: string | null;
    form_name?: string;
    store_name?: string;
    liff_id?: string;
    config?: Form['config'] | Record<string, unknown>;
    basic_info?: Record<string, unknown>;
    ui_settings?: Record<string, unknown>;
    menu_structure?: Record<string, unknown>;
    business_rules?: Record<string, unknown>;
    line_settings?: Record<string, unknown>;
    gas_endpoint?: string;
  };
  
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
      allow_cross_category_selection: false,
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
  const typedConfig = typedRawForm.config as Form['config'] | Record<string, unknown> | undefined;
  const typedBasicInfo = typedRawForm.basic_info as Record<string, unknown> | undefined;
  const typedUiSettings = typedRawForm.ui_settings as Record<string, unknown> | undefined;
  const typedMenuStructure = typedRawForm.menu_structure as Record<string, unknown> | undefined;
  const typedBusinessRules = typedRawForm.business_rules as Record<string, unknown> | undefined;
  const typedLineSettings = typedRawForm.line_settings as Record<string, unknown> | undefined;
  
  const normalizedForm: Form = {
    id: typedRawForm.id as string,
    store_id: typedRawForm.store_id as string,
    status: (typedRawForm.status || 'inactive') as 'active' | 'inactive' | 'paused',
    draft_status: (typedRawForm.draft_status || 'none') as 'none' | 'draft' | 'ready_to_publish',
    created_at: typedRawForm.created_at as string,
    updated_at: typedRawForm.updated_at as string,
    last_published_at: (typedRawForm.last_published_at ?? undefined) as string | undefined,
    config: {
      basic_info: {
        form_name: (typedRawForm.form_name as string) || (existingConfig?.basic_info?.form_name as string) || (typedConfig?.basic_info as Form['config']['basic_info'])?.form_name || 'フォーム',
        store_name: (existingConfig?.basic_info?.store_name as string) || (typedConfig?.basic_info as Form['config']['basic_info'])?.store_name || (typedBasicInfo?.store_name as string) || '',
        liff_id: (existingConfig?.basic_info?.liff_id as string) || (typedConfig?.basic_info as Form['config']['basic_info'])?.liff_id || (typedBasicInfo?.liff_id as string) || (typedLineSettings?.liff_id as string) || '',
        theme_color: (existingConfig?.basic_info?.theme_color as string) || (typedConfig?.basic_info as Form['config']['basic_info'])?.theme_color || (typedBasicInfo?.theme_color as string) || '#3B82F6',
        logo_url: (existingConfig?.basic_info?.logo_url as string | undefined) || (typedConfig?.basic_info as Form['config']['basic_info'])?.logo_url || (typedBasicInfo?.logo_url as string | undefined)
      },
      visit_options: (existingConfig?.visit_options || typedConfig?.visit_options || []) as Form['config']['visit_options'],
      gender_selection: {
        enabled: existingConfig?.gender_selection?.enabled ?? (typedConfig?.gender_selection as Form['config']['gender_selection'])?.enabled ?? ((typedConfig?.basic_info as Record<string, unknown>)?.show_gender_selection as boolean) ?? ((typedBasicInfo?.show_gender_selection as boolean) ?? false),
        required: existingConfig?.gender_selection?.required ?? false,
        options: (existingConfig?.gender_selection?.options || (typedConfig?.gender_selection as Form['config']['gender_selection'])?.options || [
          { value: 'male', label: '男性' },
          { value: 'female', label: '女性' }
        ]) as Form['config']['gender_selection']['options']
      },
      visit_count_selection: {
        enabled: existingConfig?.visit_count_selection?.enabled ?? (typedConfig?.visit_count_selection as Form['config']['visit_count_selection'])?.enabled ?? ((typedConfig?.ui_settings as Record<string, unknown>)?.show_visit_count as boolean) ?? ((typedUiSettings?.show_visit_count as boolean) ?? false),
        required: existingConfig?.visit_count_selection?.required ?? false,
        options: (existingConfig?.visit_count_selection?.options || (typedConfig?.visit_count_selection as Form['config']['visit_count_selection'])?.options || [
          { value: 'first', label: '初回' },
          { value: 'repeat', label: '2回目以降' }
        ]) as Form['config']['visit_count_selection']['options']
      },
      coupon_selection: {
        enabled: existingConfig?.coupon_selection?.enabled ?? (typedConfig?.coupon_selection as Form['config']['coupon_selection'])?.enabled ?? ((typedConfig?.ui_settings as Record<string, unknown>)?.show_coupon_selection as boolean) ?? ((typedUiSettings?.show_coupon_selection as boolean) ?? false),
        coupon_name: (existingConfig?.coupon_selection?.coupon_name as string) || ((typedConfig?.coupon_selection as Form['config']['coupon_selection'])?.coupon_name as string) || '',
        options: (existingConfig?.coupon_selection?.options || (typedConfig?.coupon_selection as Form['config']['coupon_selection'])?.options || [
          { value: 'use', label: '利用する' },
          { value: 'not_use', label: '利用しない' }
        ]) as Form['config']['coupon_selection']['options']
      },
      menu_structure: {
        structure_type: (existingConfig?.menu_structure?.structure_type || (typedConfig?.menu_structure as Form['config']['menu_structure'])?.structure_type || 'category_based') as Form['config']['menu_structure']['structure_type'],
        categories: (existingConfig?.menu_structure?.categories || (typedConfig?.menu_structure as Form['config']['menu_structure'])?.categories || typedMenuStructure?.categories || []) as Form['config']['menu_structure']['categories'],
        allow_cross_category_selection: existingConfig?.menu_structure?.allow_cross_category_selection ?? (typedConfig?.menu_structure as Form['config']['menu_structure'])?.allow_cross_category_selection ?? (typedMenuStructure?.allow_cross_category_selection as boolean) ?? false,
        display_options: {
          show_price: existingConfig?.menu_structure?.display_options?.show_price ?? true,
          show_duration: existingConfig?.menu_structure?.display_options?.show_duration ?? true,
          show_description: existingConfig?.menu_structure?.display_options?.show_description ?? true,
          show_treatment_info: existingConfig?.menu_structure?.display_options?.show_treatment_info ?? false
        }
      },
      custom_fields: (existingConfig?.custom_fields ?? (typedConfig as Form['config'])?.custom_fields ?? []) as Form['config']['custom_fields'],
      calendar_settings: {
        business_hours: (existingConfig?.calendar_settings?.business_hours || (typedConfig?.calendar_settings as Form['config']['calendar_settings'])?.business_hours || typedBusinessRules?.business_hours || defaultConfig.calendar_settings.business_hours) as Form['config']['calendar_settings']['business_hours'],
        advance_booking_days: (existingConfig?.calendar_settings?.advance_booking_days || (typedConfig?.calendar_settings as Form['config']['calendar_settings'])?.advance_booking_days || (typedBusinessRules?.advance_booking_days as number) || 30) as number,
        google_calendar_url: (existingConfig?.calendar_settings?.google_calendar_url || (typedConfig?.calendar_settings as Form['config']['calendar_settings'])?.google_calendar_url) as string | undefined,
        // 日時選択モードのデフォルト値設定
        booking_mode: (existingConfig?.calendar_settings?.booking_mode || (typedConfig?.calendar_settings as Form['config']['calendar_settings'])?.booking_mode || 'calendar') as Form['config']['calendar_settings']['booking_mode'],
        multiple_dates_settings: (existingConfig?.calendar_settings?.multiple_dates_settings || (typedConfig?.calendar_settings as Form['config']['calendar_settings'])?.multiple_dates_settings || {
          time_interval: 30,
          date_range_days: 30,
          exclude_weekdays: [0], // 日曜日
          start_time: '09:00',
          end_time: '18:00'
        }) as Form['config']['calendar_settings']['multiple_dates_settings']
      },
      ui_settings: {
        theme_color: (existingConfig?.ui_settings?.theme_color || (typedConfig?.basic_info as Form['config']['basic_info'])?.theme_color || (typedBasicInfo?.theme_color as string) || (typedConfig?.ui_settings as Form['config']['ui_settings'])?.theme_color || (typedUiSettings?.theme_color as string) || '#3B82F6') as string,
        button_style: (existingConfig?.ui_settings?.button_style || (typedConfig?.ui_settings as Form['config']['ui_settings'])?.button_style || (typedUiSettings?.button_style as string) || 'rounded') as 'rounded' | 'square',
        show_repeat_booking: existingConfig?.ui_settings?.show_repeat_booking ?? (typedConfig?.ui_settings as Form['config']['ui_settings'])?.show_repeat_booking ?? (typedUiSettings?.show_repeat_booking as boolean) ?? false,
        show_side_nav: existingConfig?.ui_settings?.show_side_nav !== undefined ? existingConfig?.ui_settings?.show_side_nav : ((typedConfig?.ui_settings as Form['config']['ui_settings'])?.show_side_nav !== undefined ? (typedConfig?.ui_settings as Form['config']['ui_settings'])?.show_side_nav : ((typedUiSettings?.show_side_nav as boolean) !== undefined ? typedUiSettings?.show_side_nav as boolean : true))
      },
      validation_rules: {
        required_fields: (existingConfig?.validation_rules?.required_fields || (typedConfig?.validation_rules as Form['config']['validation_rules'])?.required_fields || ['name', 'phone']) as Form['config']['validation_rules']['required_fields'],
        phone_format: (existingConfig?.validation_rules?.phone_format || (typedConfig?.validation_rules as Form['config']['validation_rules'])?.phone_format || 'japanese') as 'japanese' | 'international',
        name_max_length: (existingConfig?.validation_rules?.name_max_length || (typedConfig?.validation_rules as Form['config']['validation_rules'])?.name_max_length || 50) as number
      },
      gas_endpoint: (existingConfig?.gas_endpoint || (typedConfig?.gas_endpoint as string) || typedRawForm.gas_endpoint || '') as string
    }
  };
  
  return normalizedForm;
}
