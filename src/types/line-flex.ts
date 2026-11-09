/**
 * 公式 LINE 向け Flex Message（店舗ページ → 「LINE メッセージ」タブ）
 *
 * - テンプレート（予約導線カード / メニュー・料金カルーセル / 店舗紹介カード）に項目を入れるだけで Flex を作る。
 *   上級者は生成された JSON を直接直せる（flex_override）。`custom` は最初から JSON だけで作る
 * - 送り方: キーワード自動応答（Webhook）/ 予約確認・リマインダー・フォローへの差し込み / テスト送信（push）
 * - ボタンの URL は計測リンク（/go/{id}/{key}）に置き換え、タップ数を数える（track_taps）
 */

export type LineFlexTemplate = 'booking_card' | 'menu_carousel' | 'store_card' | 'custom';

export interface FlexButtonInput {
  key: string; // 行の識別子（編集 UI 用）
  label: string;
  url: string; // https:// または tel:
}

export interface BookingCardData {
  image_url?: string;
  title: string;
  text: string;
  buttons: FlexButtonInput[]; // 最大 3
  color?: string; // ボタン・アクセント色（HEX）
}

export interface MenuCarouselItem {
  key: string;
  image_url?: string;
  name: string;
  price?: string; // 表示文字列（例: ¥3,300）
  duration?: string; // 表示文字列（例: 60分）
  description?: string;
  button?: FlexButtonInput | null; // 個別ボタン（空なら共通ボタン）
}

export interface MenuCarouselData {
  items: MenuCarouselItem[]; // 最大 12
  color?: string;
  button_label?: string; // 共通ボタン（全カードに同じ）
  button_url?: string;
}

export interface StoreCardData {
  image_url?: string;
  name: string;
  hours?: string;
  phone?: string;
  address?: string;
  map_url?: string;
  website_url?: string;
  booking_url?: string;
  color?: string;
}

export type LineFlexTemplateData = BookingCardData | MenuCarouselData | StoreCardData | Record<string, never>;

/** Flex Message の contents（bubble / carousel）。構造は LINE の仕様どおりなので型は緩くしておく */
export type FlexContainer = Record<string, unknown>;

export interface LineFlexMessage {
  id: string; // 12 文字 [a-z0-9]
  store_id: string;
  name: string; // 管理用の名前
  template: LineFlexTemplate;
  data: LineFlexTemplateData; // テンプレートの入力値
  flex_override: FlexContainer | null; // JSON を直接編集したときの contents（null = テンプレートから生成）
  alt_text: string; // 通知・トーク一覧に出る代替テキスト（1〜400 文字）
  keywords: string[]; // この言葉がそのまま送られてきたら返す（完全一致。最大 10）
  attach_confirm: boolean; // 【ご予約確認】の返信に添える
  attach_reminder: boolean; // リマインダーに添える
  attach_follow: boolean; // フォローメッセージに添える
  enabled: boolean;
  track_taps: boolean; // ボタンの URL を計測リンクにする
  payload: Record<string, unknown> | null; // 送信用の LINE メッセージ（{ type: 'flex', altText, contents }）。保存時にサーバーで生成
  links: Record<string, string>; // 計測キー → 本来の URL
  reply_count: number; // キーワード応答・差し込みで送った回数
  tap_counts: Record<string, number>; // 計測キー → タップ数
  created_at: string;
  updated_at: string;
}

/** 作成・更新の入力（id は新規作成時に任意。画像アップロードのため先に決めてよい） */
export interface LineFlexMessageInput {
  id?: string;
  name: string;
  template: LineFlexTemplate;
  data: LineFlexTemplateData;
  flex_override?: FlexContainer | null;
  alt_text: string;
  keywords?: string[];
  attach_confirm?: boolean;
  attach_reminder?: boolean;
  attach_follow?: boolean;
  enabled?: boolean;
  track_taps?: boolean;
}
