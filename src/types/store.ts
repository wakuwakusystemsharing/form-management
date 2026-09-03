import type { Form } from './form';
import type { StoreAdminTabId } from '@/lib/store-admin-tabs';

// LINE リマインダーの文面カスタマイズ（未設定 = デフォルト文面）
export interface ReminderTemplate {
  header_title?: string;   // ヘッダーのタイトル（空 = 【予約前日メッセージ】等の自動文言）
  header_color?: string;   // ヘッダー背景色（HEX。空 = #877059）
  body_text?: string;      // 本文（空 = デフォルト本文）。{LINE名} {お名前} {予約日時} {メニュー名} 等を差し込める
  text_color?: string;     // 本文の文字色（HEX。空 = #333333）
  show_details?: boolean;  // 日時・メニュー・担当・お名前の詳細ブロックを表示するか（デフォルト true）
  footer_text?: string;    // 末尾の一言（空 = 「心よりお待ちしております」）
  show_footer?: boolean;   // 末尾の一言を表示するか（デフォルト true）
}

export interface Store {
  id: string;                 // 6文字のランダム文字列 (全環境共通)
  name: string;
  description?: string;
  owner_name: string;
  owner_email: string;
  phone?: string;
  postal_code?: string;       // 郵便番号（例: 150-0021）。Web 予約のお客様確認メール本文に差し込み
  address?: string;
  website_url?: string;
  logo_url?: string;          // ロゴ画像URL
  theme_color?: string;       // テーマカラー（HEX形式）
  google_calendar_id?: string; // 店舗用GoogleカレンダーID
  /** 'system' = SA作成カレンダー, 'store_oauth' = 店舗連携のGoogleカレンダー */
  google_calendar_source?: 'system' | 'store_oauth';
  line_channel_access_token?: string; // LINEチャネルアクセストークン
  line_channel_id?: string | null;    // LINE ログインチャネル ID（抽選フォームの ID トークン検証用。空 = 環境変数を使用）
  reminder_enabled?: boolean;         // LINEリマインダー送信の有効/無効
  reminder_time?: string;             // リマインダー送信時刻（HH:00形式、デフォルト19:00）
  reminder_days_before?: number;      // リマインダーを予約の何日前に送るか（デフォルト1 = 前日）
  reminder_template?: ReminderTemplate | null; // リマインダー文面のカスタマイズ（null = デフォルト）
  admin_visible_tabs?: StoreAdminTabId[] | null; // 店舗管理者に表示するタブ（null = すべて表示。上位管理者には常に全表示）
  created_at: string;
  updated_at: string;
  status: 'active' | 'inactive';
}

export interface StoreWithForms extends Store {
  forms: Form[];
  total_forms: number;
  active_forms: number;
}
