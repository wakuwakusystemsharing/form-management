import type { Form } from './form';

export interface Store {
  id: string;                 // 6文字のランダム文字列 (全環境共通)
  name: string;
  description?: string;
  owner_name: string;
  owner_email: string;
  phone?: string;
  address?: string;
  website_url?: string;
  logo_url?: string;          // ロゴ画像URL
  theme_color?: string;       // テーマカラー（HEX形式）
  subdomain?: string;         // サブドメイン（例: st0001）
  custom_domain?: string;     // カスタムドメイン（例: myshop.com）
  google_calendar_id?: string; // 店舗用GoogleカレンダーID
  /** 'system' = SA作成カレンダー, 'store_oauth' = 店舗連携のGoogleカレンダー */
  google_calendar_source?: 'system' | 'store_oauth';
  line_channel_access_token?: string; // LINEチャネルアクセストークン
  created_at: string;
  updated_at: string;
  status: 'active' | 'inactive';
}

export interface StoreWithForms extends Store {
  forms: Form[];
  total_forms: number;
  active_forms: number;
}
