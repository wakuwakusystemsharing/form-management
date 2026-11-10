/**
 * 公式 LINE 向け Flex Message（店舗ページ → 「LINE メッセージ」タブ）
 *
 * - テンプレート（予約導線カード / メニュー・料金カルーセル / 店舗紹介カード）に項目を入れるだけで Flex を作る。
 *   上級者は生成された JSON を直接直せる（flex_override）。`custom` は最初から JSON だけで作る
 * - 送り方: キーワード自動応答（Webhook）/ 予約確認・リマインダー・フォローへの差し込み / テスト送信（push）
 * - ボタンの URL は計測リンク（/go/{id}/{key}）に置き換え、タップ数を数える（track_taps）
 */

export type LineFlexTemplate =
  | 'custom'
  | 'booking_card'
  | 'menu_carousel'
  | 'store_card'
  | 'coupon_card'
  | 'notice_card'
  | 'menu_list'
  | 'staff_carousel'
  | 'steps_card'
  | 'scenario';

export interface FlexButtonInput {
  key: string; // 行の識別子（編集 UI 用）
  label: string;
  url: string; // https:// または tel:。分岐は `next:{メッセージID}?tags=…`（押したら別の LINE メッセージを返す。src/lib/line-flex-branch.ts）
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

/** クーポン・キャンペーンカード */
export interface CouponCardData {
  image_url?: string;
  title: string; // 例: 友だち限定クーポン
  highlight: string; // 大きく出す文字（例: 10% OFF）
  description?: string;
  expires?: string; // 有効期限（表示文字列）
  conditions?: string; // 利用条件
  code?: string; // 提示コード（枠で強調）
  button?: FlexButtonInput | null;
  color?: string;
}

/** お知らせ・営業案内カード（色付きヘッダー） */
export interface NoticeCardData {
  label?: string; // ヘッダー上の小さな分類（例: お知らせ）
  title: string;
  date?: string; // 表示文字列（例: 2026年11月20日）
  body: string;
  image_url?: string;
  button?: FlexButtonInput | null;
  color?: string; // ヘッダーの背景色
}

export interface MenuListItem {
  key: string;
  name: string;
  price?: string;
  note?: string; // 所要時間や補足
}

/** 料金表（1 枚のリスト型。カルーセルにしたくないとき） */
export interface MenuListData {
  title: string;
  items: MenuListItem[]; // 最大 15 行
  footnote?: string;
  button?: FlexButtonInput | null;
  color?: string;
}

export interface StaffCarouselItem {
  key: string;
  image_url?: string;
  name: string;
  role?: string; // 役職・得意分野
  comment?: string;
  button?: FlexButtonInput | null;
}

/** スタッフ紹介カルーセル */
export interface StaffCarouselData {
  items: StaffCarouselItem[]; // 最大 12
  button_label?: string; // 共通ボタン（例: このスタッフで予約）
  button_url?: string;
  color?: string;
}

export interface StepItem {
  key: string;
  title: string;
  text?: string;
}

/** ご利用の流れ（番号付きステップ） */
export interface StepsCardData {
  title: string;
  steps: StepItem[]; // 最大 8
  button?: FlexButtonInput | null;
  color?: string;
}

/**
 * 分岐アンケート（かんたんモード。テンプレート `scenario`）: 質問 → 選択肢 → 選んだら（次の質問 / 結果 / 保存済みメッセージ）の木
 * 純粋ロジックは src/lib/line-flex-scenario.ts
 */
export interface ScenarioResult {
  key: string;
  title: string;
  text?: string;
  image_url?: string;
  button?: FlexButtonInput | null; // 予約フォームへのボタンなど
}
export type ScenarioNext =
  | { type: 'none' } // 記録・タグ付けだけ（何も返さない）
  | { type: 'question'; question: ScenarioQuestion }
  | { type: 'result'; result: ScenarioResult }
  | { type: 'message'; message_id: string }; // 保存済みの LINE メッセージを返す
export interface ScenarioChoice {
  key: string;
  label: string; // ボタンの文言
  tags?: string[]; // 選んだお客様に付ける顧客タグ
  then: ScenarioNext;
}
export interface ScenarioQuestion {
  key: string;
  title: string;
  text?: string;
  image_url?: string;
  choices: ScenarioChoice[]; // 最大 6
}
export interface ScenarioData {
  root: ScenarioQuestion; // 最初の質問（= Flex 本体）
  color?: string;
}

/** 分岐ボタンの対応（ボタンのキー → 何を選んだか・タグ・次に返すもの）。保存時にサーバーで作る */
export interface LineFlexBranch {
  label: string; // ボタンの文言
  question: string; // 質問文（分岐アンケート）。くわしくモードのボタンは空
  tags: string[];
  next: { type: 'message'; id: string } | { type: 'node'; key: string } | { type: 'none' };
}

export type LineFlexTemplateData =
  | BookingCardData
  | MenuCarouselData
  | StoreCardData
  | CouponCardData
  | NoticeCardData
  | MenuListData
  | StaffCarouselData
  | StepsCardData
  | ScenarioData
  | Record<string, never>;

/** Flex Message の contents（bubble / carousel）。構造は LINE の仕様どおりなので型は緩くしておく */
export type FlexContainer = Record<string, unknown>;

/**
 * まとめて送るメッセージの並び（`src/lib/line-flex-items.ts`）。main = テンプレートで作った Flex 本体（ちょうど 1 つ）。
 * テキスト / 画像 / 動画 / Flex（JSON）/ 保存済みの別の LINE メッセージ（ref）を合わせて最大 5 通
 */
export type LineFlexItem =
  | { key: string; type: 'main' }
  | { key: string; type: 'text'; text: string }
  | { key: string; type: 'image'; url: string; preview_url?: string }
  | { key: string; type: 'video'; url: string; preview_url: string }
  | { key: string; type: 'flex'; alt_text: string; contents: FlexContainer | null }
  | { key: string; type: 'ref'; message_id: string };

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
  items: LineFlexItem[]; // まとめて送るメッセージの並び（main を含む。旧データは [main] だけ）
  payload: Record<string, unknown> | null; // Flex 本体の送信用メッセージ（{ type: 'flex', altText, contents }）。保存時にサーバーで生成
  payloads: Record<string, unknown>[] | null; // items の順に並べた送信用メッセージ（最大 5 通）。Webhook / Edge Function はこれを送る（無ければ [payload]）
  links: Record<string, string>; // 計測キー → 本来の URL
  reply_count: number; // キーワード応答・差し込みで送った回数
  tap_counts: Record<string, number>; // 計測キー → タップ数
  branches: Record<string, LineFlexBranch>; // 分岐ボタンのキー → 対応（保存時に生成。無ければ {}）
  branch_payloads: Record<string, Record<string, unknown>>; // 分岐アンケートの 2 問目以降・結果: ノードのキー → 送信用メッセージ
  show_choice_text: boolean; // 分岐ボタンを押したとき、お客様のトークに選んだ文言を表示する
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
  items?: LineFlexItem[];
  show_choice_text?: boolean;
}
