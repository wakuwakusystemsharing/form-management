import { StaticDeploy, MultipleDatesSettings } from './form';
import type { SelectSearchSettings } from '@/lib/searchable-select';

// multiple_dates = 第三希望日時選択（予約フォームの日時選択モードと同じ設定・同じ選択 UI。第一〜第三希望の日付 + 時間）
// birthday = 誕生日選択（年 / 月 / 日を別々のプルダウンで選択。値は "YYYY-MM-DD"）
export type SurveyQuestionType = 'text' | 'textarea' | 'radio' | 'checkbox' | 'date' | 'datetime' | 'birthday' | 'select' | 'multiple_dates';

/** 選択肢ごとの追加質問で使える回答タイプ */
export type SurveyFollowUpType = 'text' | 'textarea' | 'radio' | 'checkbox' | 'birthday' | 'select';

/**
 * 選択肢ごとの追加質問。
 * 例: 「紹介者」を選択したら「ご紹介者を入力してください」というテキスト入力欄を表示する
 * - 1 つの選択肢に複数の追加質問を付けられる（`SurveyQuestionOption.follow_ups`）
 * - 追加質問の選択肢（radio / checkbox / select）にもさらに追加質問を付けられる（入れ子。
 *   深さの上限は `SURVEY_FOLLOW_UP_MAX_DEPTH`（`src/lib/survey-follow-ups.ts`））
 */
export interface SurveyFollowUpQuestion {
  id?: string; // 編集画面での安定キー（旧データには無い）
  enabled: boolean;
  title: string; // 追加質問の文言（例: ご紹介者を入力してください）
  type: SurveyFollowUpType;
  required?: boolean; // 親の選択肢が選ばれているときのみ必須チェック
  options?: SurveyQuestionOption[]; // radio/checkbox/select 用（各選択肢に follow_ups / tags を付けられる）
  allow_other?: boolean; // radio/checkbox/select: 選択肢の最後に「その他」+ 理由入力欄を表示（通常の質問と同じ）
  // この追加質問の上下に表示するテキスト / 画像ブロック（`anchor` は未使用。`position` で上下を決める）
  content_blocks?: SurveyContentBlock[];
}

export interface SurveyQuestionOption {
  label: string;
  value: string;
  /**
   * @deprecated 旧形式（1 選択肢 1 追加質問）。読み取りは `getOptionFollowUps()` を通すこと。
   * 編集画面で保存すると `follow_ups` に移行される
   */
  follow_up?: SurveyFollowUpQuestion;
  follow_ups?: SurveyFollowUpQuestion[]; // この選択肢が選ばれたときに表示する追加質問（複数・上から順に表示）
  // ふりがな（任意）。ドロップダウン選択の検索・絞り込み機能で五十音の判定と名前検索に使う
  kana?: string;
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
  // type = 'select' のとき: 名前検索 + 五十音ボタンで絞り込み、「不明」を独立したボタンで表示する（選択肢が多いとき用）
  select_search?: SelectSearchSettings;
  // type = 'multiple_dates' の設定（予約フォームの multiple_dates_settings と同じ形。未設定は既定値で補完）。
  // required が true のときは required_choices（第一希望は常に必須）を検証する。false なら全て任意
  multiple_dates?: MultipleDatesSettings;
  // 質問に添える画像（https の URL）と位置（未設定 = 'above' = 質問名の上。'middle' = 質問名と入力欄の間、'below' = 入力欄の下）
  image_url?: string;
  image_position?: 'above' | 'middle' | 'below';
  // フォームを開いたときは非表示にし、show_triggers が成立したら表示する。
  // 非表示の間は必須チェック・送信内容（responses / タグ付与）の対象外。純粋ロジックは src/lib/survey-visibility.ts
  hidden_by_default?: boolean;
  // 表示トリガー: 別の質問（path があればその選択肢の追加質問）で value の選択肢が選ばれていたら表示。
  // value は選択肢の送信値（value || label）。「その他」は '__other__'。トリガー元の質問が非表示なら不成立
  show_triggers?: Array<{ question_id: string; path?: number[]; value: string }>;
  // 複数トリガーの判定（未設定 = 'any' = いずれか 1 つでも成立で表示。'all' = すべて成立で表示）
  show_triggers_mode?: 'any' | 'all';
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
