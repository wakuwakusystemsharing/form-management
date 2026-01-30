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
  created_at: string;
  updated_at: string;
  status: 'active' | 'inactive';
}

export interface StoreWithForms extends Store {
  forms: Form[];
  total_forms: number;
  active_forms: number;
}
