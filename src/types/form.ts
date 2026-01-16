// メニューオプションの型定義
export interface MenuOption {
  id: string;
  name: string;
  price: number;
  duration: number;          // 分単位
  description?: string;
  is_default?: boolean;      // デフォルトで選択されるか
}

// サブメニューの型定義
export interface SubMenuItem {
  id: string;
  name: string;
  price: number;
  duration: number;          // 分単位
  description?: string;
  image?: string;            // 画像URL
}

// 予約フォームの型定義
export interface MenuItem {
  id: string;
  name: string;
  price?: number;            // サブメニュー使用時は任意
  duration?: number;         // サブメニュー使用時は任意
  description?: string;
  image?: string;            // 画像URL
  category_id?: string;      // カテゴリー構造の場合のみ必要
  treatment_id?: string;     // treatmentId対応
  image_url?: string;        // 画像URL（旧）
  image_name?: string;       // 画像ファイル名（旧）
  gender_filter?: 'male' | 'female' | 'both';  // 性別フィルター
  options?: MenuOption[];    // メニューオプション
  has_submenu?: boolean;     // サブメニューを使用するかどうか
  sub_menu_items?: SubMenuItem[];  // サブメニュー項目
}

export interface MenuCategory {
  id: string;
  name: string;
  display_name: string;      // ◆ブライダルコース◆形式
  menus: MenuItem[];
  options: MenuItem[];       // オプションメニュー
  selection_mode: 'single' | 'multiple';
  gender_condition?: 'male' | 'female' | 'all';  // 性別による表示条件
}

export interface VisitOption {
  id: string;
  label: string;             // "1回目〈30分〉"
  duration: number;
  price: number;
  is_default?: boolean;
}

export interface BusinessHours {
  [key: string]: {
    open: string;
    close: string;
    closed: boolean;
  };
}

export interface FormConfig {
  basic_info: {
    form_name: string;
    store_name: string;
    liff_id?: string;  // オプショナル：Web予約フォームの場合は不要
    theme_color: string;
    logo_url?: string;
  };
  
  visit_options: VisitOption[];
  
  gender_selection: {
    enabled: boolean;           // 性別選択を有効にするか
    required: boolean;          // 性別選択を必須にするか
    options: Array<{
      value: 'male' | 'female';
      label: string;           // "男性", "女性"
    }>;
  };
  
  visit_count_selection: {
    enabled: boolean;           // ご来店回数選択を有効にするか
    required: boolean;          // ご来店回数選択を必須にするか
    options: Array<{
      value: string;            // "first", "repeat"
      label: string;            // "初回", "2回目以降"
    }>;
  };
  
  coupon_selection: {
    enabled: boolean;           // クーポン利用選択を有効にするか
    coupon_name?: string;       // クーポン名（例：「2周年記念」）
    options: Array<{
      value: 'use' | 'not_use';
      label: string;            // "利用する", "利用しない"
    }>;
  };
  
  menu_structure: {
    structure_type: 'category_based' | 'simple';
    categories: MenuCategory[];
    menus?: MenuItem[];  // Simple structure用のメニューリスト
    display_options: {
      show_price: boolean;
      show_duration: boolean;
      show_description: boolean;
      show_treatment_info: boolean;  // 治療説明表示
    };
  };
  
  calendar_settings: {
    business_hours: BusinessHours;
    advance_booking_days: number;
    google_calendar_url?: string;
    // 日時選択モード
    booking_mode?: 'calendar' | 'multiple_dates';  // カレンダー表示 or 第三希望日時選択
    // 第三希望日時モード用設定
    multiple_dates_settings?: {
      time_interval: 15 | 30 | 60;        // 時間間隔（分）
      date_range_days: number;            // 選択可能日数（本日から何日後まで）
      exclude_weekdays: number[];         // 除外曜日 (0:日曜, 1:月曜, ...)
      start_time: string;                 // 開始時間 "09:00"
      end_time: string;                   // 終了時間 "18:00"
    };
  };
  
  ui_settings: {
    theme_color: string;
    button_style: 'rounded' | 'square';
    show_repeat_booking: boolean;    // 前回と同じメニュー
    show_side_nav: boolean;
    custom_css?: string;
  };
  
  validation_rules: {
    required_fields: string[];
    phone_format: 'japanese' | 'international';
    name_max_length: number;
  };

  // Google App Script エンドポイント
  gas_endpoint?: string;
  
  // Web予約フォーム用の設定
  calendar_url?: string;      // カレンダー取得URL（空き状況取得用）
  security_secret?: string;   // SECURITY_SECRET（セキュリティ用の秘密鍵）
  form_type?: 'line' | 'web'; // フォームタイプ（LINE予約フォーム or Web予約フォーム）
}

export type AppEnvironment = 'local' | 'staging' | 'production';

export interface StaticDeploy {
  deployed_at: string;
  deploy_url: string;
  storage_url?: string;  // Supabase Storage URL
  blob_url?: string;     // 旧Vercel Blob URL（後方互換性のため）
  status: 'deployed' | 'failed' | 'pending';
  environment?: AppEnvironment;
}

export interface Form {
  id: string;          // 16文字のランダム英数文字列
  store_id: string;    // 6文字のランダム文字列 (全環境共通)
  config: FormConfig;
  draft_config?: FormConfig;  // 下書き設定
  status: 'active' | 'inactive' | 'paused';
  draft_status: 'none' | 'draft' | 'ready_to_publish';  // 下書きステータス
  created_at: string;
  updated_at: string;
  last_published_at?: string;  // 最終公開日時
  static_deploy?: StaticDeploy;  // 静的デプロイ情報
}

// 顧客情報
export interface CustomerInfo {
  name: string;
  phone: string;
  message?: string;
}

// メニュー選択状態
export interface MenuSelections {
  visit_option: VisitOption | null;
  gender?: 'male' | 'female';       // 選択された性別
  visit_count?: string;             // 選択されたご来店回数
  coupon_usage?: 'use' | 'not_use'; // クーポン利用有無
  selected_menus: MenuItem[];
  selected_menu_options: { [menuId: string]: MenuOption[] };  // メニューIDごとの選択されたオプション
  selected_options: MenuItem[];     // カテゴリーオプション（従来のもの）
  customer_info: CustomerInfo;
  selected_datetime: Date | null;
  // 第三希望日時対応
  selected_datetime_2?: Date | null;  // 第二希望日時
  selected_datetime_3?: Date | null;  // 第三希望日時
  booking_mode?: 'calendar' | 'multiple_dates';  // 選択モード
}

// 料金計算結果
export interface PriceCalculation {
  menu_price: number;
  options_price: number;
  visit_fee: number;
  total_price: number;
  duration_minutes: number;
}

// カレンダー関連
export interface TimeSlot {
  time: string;              // "09:00"
  available: boolean;
  reason?: string;           // 不可理由
}

export interface CalendarDay {
  date: string;              // ISO形式
  day_of_week: number;       // 0-6
  is_holiday: boolean;
  is_business_day: boolean;
  time_slots: TimeSlot[];
}

// Google Calendar APIレスポンス
export interface GoogleCalendarEvent {
  summary: string;
  startTime: string;
  endTime: string;
  title?: string;
}

// Supabase Database型
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          name: string;
          owner_name: string;
          owner_email: string;
          phone: string | null;
          address: string | null;
          website_url: string | null;
          description: string | null;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          owner_name: string;
          owner_email: string;
          phone?: string | null;
          address?: string | null;
          website_url?: string | null;
          description?: string | null;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          owner_name?: string;
          owner_email?: string;
          phone?: string | null;
          address?: string | null;
          website_url?: string | null;
          description?: string | null;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
      };
      forms: {
        Row: {
          id: string;
          store_id: string;
          config: Json;
          draft_config: Json | null;
          status: 'active' | 'inactive' | 'paused';
          draft_status: 'none' | 'draft' | 'ready_to_publish';
          created_at: string;
          updated_at: string;
          last_published_at: string | null;
        };
        Insert: {
          id: string;
          store_id: string;
          config: Json;
          draft_config?: Json | null;
          status?: 'active' | 'inactive' | 'paused';
          draft_status?: 'none' | 'draft' | 'ready_to_publish';
          created_at?: string;
          updated_at?: string;
          last_published_at?: string | null;
        };
        Update: {
          id?: string;
          store_id?: string;
          config?: Json;
          draft_config?: Json | null;
          status?: 'active' | 'inactive' | 'paused';
          draft_status?: 'none' | 'draft' | 'ready_to_publish';
          created_at?: string;
          updated_at?: string;
          last_published_at?: string | null;
        };
      };
      reservations: {
        Row: {
          id: string;
          form_id: string;
          store_id: string;
          customer_name: string;
          customer_phone: string;
          customer_email: string | null;
          selected_menus: Json;
          selected_options: Json;
          reservation_date: string;
          reservation_time: string;
          customer_info: Json;
          status: 'pending' | 'confirmed' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          form_id: string;
          store_id: string;
          customer_name: string;
          customer_phone: string;
          customer_email?: string | null;
          selected_menus: Json;
          selected_options: Json;
          reservation_date: string;
          reservation_time: string;
          customer_info: Json;
          status?: 'pending' | 'confirmed' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          form_id?: string;
          store_id?: string;
          customer_name?: string;
          customer_phone?: string;
          customer_email?: string | null;
          selected_menus?: Json;
          selected_options?: Json;
          reservation_date?: string;
          reservation_time?: string;
          customer_info?: Json;
          status?: 'pending' | 'confirmed' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
