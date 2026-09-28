import { StaticDeploy, MultipleDatesSettings } from './form';

// multiple_dates = 第三希望日時選択（予約フォームの日時選択モードと同じ設定・同じ選択 UI。第一〜第三希望の日付 + 時間）
export type SurveyQuestionType = 'text' | 'textarea' | 'radio' | 'checkbox' | 'date' | 'datetime' | 'select' | 'multiple_dates';

/** 選択肢ごとの追加質問で使える回答タイプ */
export type SurveyFollowUpType = 'text' | 'textarea' | 'radio' | 'checkbox' | 'select';

/**
 * 選択肢ごとの追加質問。
 * 例: 「紹介者」を選択したら「ご紹介者を入力してください」というテキスト入力欄を表示する
 */
export interface SurveyFollowUpQuestion {
  enabled: boolean;
  title: string; // 追加質問の文言（例: ご紹介者を入力してください）
  type: SurveyFollowUpType;
  required?: boolean; // 親の選択肢が選ばれているときのみ必須チェック
  options?: SurveyQuestionOption[]; // radio/checkbox/select 用（ネストした follow_up は不可）
}

export interface SurveyQuestionOption {
  label: string;
  value: string;
  follow_up?: SurveyFollowUpQuestion; // この選択肢が選ばれたときに表示する追加質問
  // この選択肢を選んで送信した回答者（LINE ユーザー ID で紐付く顧客）に付与するタグ（顧客管理のタグと同じ）
  tags?: string[];
}

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  title: string;
  description?: string; // For agreement text or additional info
  required: boolean;
  options?: SurveyQuestionOption[]; // For radio/checkbox
  placeholder?: string;
  allow_other?: boolean; // radio/checkbox/select: 選択肢の最後に「その他」+ 理由入力欄を表示
  restore_enabled?: boolean; // 回答内容を端末の localStorage に保存し、再訪時に復元する（他ユーザーには共有されない）
  // type = 'multiple_dates' の設定（予約フォームの multiple_dates_settings と同じ形。未設定は既定値で補完）。
  // required が true のときは required_choices（第一希望は常に必須）を検証する。false なら全て任意
  multiple_dates?: MultipleDatesSettings;
}

/**
 * 質問と質問の間に表示するテキスト / 画像ブロック（編集画面の「テキスト/画像表示を追加」）
 * - anchor: 基準となる質問 ID。position が 'above' ならその質問の上、'below' なら下に表示
 * - text は [color=#rrggbb]〜[/color] で部分的に文字色を変えられる（静的 HTML 側で span に変換）
 */
export interface SurveyContentBlock {
  id: string;
  type: 'text' | 'image';
  text?: string;
  image_url?: string;
  anchor: string;
  position: 'above' | 'below';
}

export interface SurveyConfig {
  basic_info: {
    title: string;
    store_name?: string;
    liff_id: string;
    theme_color: string;
    logo_url?: string;
    notice?: string; // 回答にあたっての注意事項（入力時のみ Q1 の上に目立つデザインで表示）
    // フォーム送信時に LIFF が 2 通目に流すテキスト（公式 LINE の完全一致応答メッセージ用）
    second_message?: {
      enabled: boolean;
      text: string;
    };
  };
  questions: SurveyQuestion[];
  content_blocks?: SurveyContentBlock[]; // 質問間のテキスト / 画像ブロック
  ui_settings: {
    submit_button_text: string;
    theme_color: string;
  };
}

export interface SurveyForm {
  id: string;
  store_id: string;
  config: SurveyConfig;
  draft_config?: SurveyConfig;
  status: 'active' | 'inactive' | 'paused';
  draft_status: 'none' | 'draft' | 'ready_to_publish';
  created_at: string;
  updated_at: string;
  last_published_at?: string;
  static_deploy?: StaticDeploy;
}
