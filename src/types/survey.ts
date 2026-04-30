import { StaticDeploy } from './form';

export type SurveyQuestionType = 'text' | 'textarea' | 'radio' | 'checkbox' | 'date';

export interface SurveyQuestionOption {
  label: string;
  value: string;
}

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  title: string;
  description?: string; // For agreement text or additional info
  required: boolean;
  options?: SurveyQuestionOption[]; // For radio/checkbox
  placeholder?: string;
}

export interface SurveyConfig {
  basic_info: {
    title: string;
    store_name?: string;
    liff_id: string;
    theme_color: string;
    logo_url?: string;
    // フォーム送信時に LIFF が 2 通目に流すテキスト（公式 LINE の完全一致応答メッセージ用）
    second_message?: {
      enabled: boolean;
      text: string;
    };
  };
  questions: SurveyQuestion[];
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
