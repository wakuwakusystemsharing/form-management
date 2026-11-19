/**
 * 公式 LINE 配信機能（セグメント配信 / 自動配信）の型
 * 仕様: docs/LINE配信機能_仕様書.md
 */
import type { LineFlexItem } from '@/types/line-flex';

export type BroadcastSegment = 'new' | 'repeat' | 'vip' | 'dormant';
export type BroadcastGender = 'male' | 'female' | 'other';

/** 配信先の条件。種類の違う条件は AND、同じ種類の中の値は OR（タグだけ AND / OR を選べる）。空 = すべての友だち */
export interface BroadcastAudience {
  tags?: { mode: 'any' | 'all'; values: string[] };
  exclude_tags?: string[];
  segments?: BroadcastSegment[];
  /** 予約したメニュー名（「メニュー」または「メニュー > サブメニュー」の表示名）。within_days = 直近 N 日以内の予約・来店に限る */
  menus?: { names: string[]; within_days?: number };
  /** 予約したフォーム ID */
  forms?: string[];
  /** 最終来店が N 日以上前（min_days_ago）/ N 日以内（max_days_ago） */
  last_visit?: { min_days_ago?: number; max_days_ago?: number };
  visits?: { min?: number; max?: number };
  /** 今後の予約が ある（true）/ ない（false） */
  upcoming_reservation?: boolean;
  gender?: BroadcastGender[];
  birth_month?: number[];
  /** アンケートで特定の選択肢を選んだ人 */
  survey?: { form_id: string; question: string; options: string[] };
  /** 条件に関係なく追加する / 除外する顧客 */
  customer_ids?: string[];
  exclude_customer_ids?: string[];
}

/** 配信の判定に使う顧客の項目（customers の一部） */
export interface AudienceCustomer {
  id: string;
  name: string | null;
  line_user_id: string | null;
  line_display_name: string | null;
  line_friend_flag: boolean | null;
  /** ブロック（友だち解除）された日時。null = ブロックされていない / 不明 */
  line_blocked_at?: string | null;
  line_opt_out_at: string | null;
  tags: string[] | null;
  gender: string | null;
  birthday: string | null;
  total_visits: number | null;
  total_spent: number | null;
  first_visit_date: string | null;
  last_visit_date: string | null;
}

/** 予約・来店・アンケートから顧客ごとに集めた事実 */
export interface CustomerFacts {
  /** 予約・来店したメニュー（labels = 照合に使う表示名の候補。date = 予約日 YYYY-MM-DD） */
  menus: Array<{ labels: string[]; date: string }>;
  formIds: string[];
  hasUpcomingReservation: boolean;
  surveyAnswers: Array<{ form_id: string; responses: Record<string, unknown> }>;
}

/** 配信のメッセージの並び（LINE メッセージの並びから main を除き、スタンプを足したもの） */
export type BroadcastItem = Exclude<LineFlexItem, { type: 'main' }> | { key: string; type: 'sticker'; sticker_id: string };

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';

export interface Broadcast {
  id: string; // UUID
  store_id: string;
  name: string;
  status: BroadcastStatus;
  audience: BroadcastAudience;
  items: BroadcastItem[];
  /** 送信用メッセージ（items の順。{name} の差し込みは送信時に置き換える） */
  payloads: Record<string, unknown>[] | null;
  /** {name} などの差し込みがある = 1 人ずつ push（無ければ multicast） */
  has_personalization: boolean;
  track_taps: boolean;
  links: Record<string, string>;
  tap_counts: Record<string, number>;
  scheduled_at: string | null;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  error: string | null;
  automation_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type BroadcastRecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface BroadcastRecipient {
  id: string;
  broadcast_id: string;
  customer_id: string;
  line_user_id: string;
  /** {name} の差し込みに使う名前（確定時に保存） */
  display_name: string | null;
  status: BroadcastRecipientStatus;
  error: string | null;
  sent_at: string | null;
  /** 配信のボタンを最初にタップした日時（配信の成果の集計に使う。タップしていなければ null） */
  tapped_at: string | null;
  /** ボタンをタップした回数 */
  tap_count: number;
}

/** 自動配信のきっかけ */
export type AutomationTrigger =
  | { type: 'dormant'; days: number } // 最終来店から N 日
  | { type: 'birthday'; day: number } // 誕生月の N 日
  | { type: 'first_visit_after'; days: number } // 初回来店の N 日後
  | { type: 'visits_reached'; counts: number[] } // 来店 N 回目
  | { type: 'tag_added'; tags: string[] } // タグが付いている
  | {
      // 予約フォームでキャンセルが出た時（1 日 1 回の判定ではなく、キャンセルのその場で動く。src/lib/broadcast-cancel-opening.ts）
      type: 'reservation_cancelled';
      /** その日時がいま実際に予約できる状態のときだけ送る */
      only_if_open: boolean;
      /** 予約の N 時間前より後のキャンセルは送らない（0 = 制限なし） */
      min_hours_before: number;
      /** 夜間のキャンセルは送らない（日本時間の start 時 〜 end 時の前まで） */
      quiet_hours: { enabled: boolean; start: number; end: number };
      /** 1 日に送る回数の上限（0 = 制限なし） */
      max_per_day: number;
      /** 店舗が管理画面でキャンセルした時も送る（既定はお客様の LINE キャンセルだけ） */
      include_store_cancel: boolean;
      /** 自動で付ける「空きが出ました」カードの文言（`{日時}` `{店名}` を差し込める） */
      card: { title: string; text: string; button_label: string };
    }
  | {
      // 特定の曜日に 1 週間の空き状況（選んだ曜日の実行時刻に、予約フォームの空き状況を 〇△✕ の表で送る。src/lib/broadcast-weekly-availability.ts）
      type: 'weekly_availability';
      /** 送る曜日（0 = 日 〜 6 = 土） */
      weekdays: number[];
      /** 空き状況を載せる予約フォーム（カレンダー表示モード） */
      form_id: string;
      /** 載せる日数（3 / 5 / 7 / 10 / 14） */
      days: number;
      /** 当日から載せる（false = 翌日から） */
      include_today: boolean;
      /** 「◯ 分の予約が入る空き」として数える所要時間（0 = フォームの時間間隔） */
      duration_minutes: number;
      /** 空きが合計この枠数以上ある時だけ送る */
      min_open_slots: number;
      /** そのスタッフの空きだけを載せる（null = 誰か 1 人でも空いていれば空き） */
      staff_id: string | null;
      /** 時間帯の空きがこの枠数以下なら △（残りわずか） */
      few_threshold: number;
      card: { title: string; text: string; button_label: string };
    };

export interface BroadcastAutomation {
  id: string;
  store_id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  /** 追加の絞り込み（任意） */
  audience: BroadcastAudience;
  items: BroadcastItem[];
  payloads: Record<string, unknown>[] | null;
  has_personalization: boolean;
  /** 同じ人に次に送るまでの最短日数（null = 同じきっかけでは 1 回だけ） */
  resend_after_days: number | null;
  /** 最後に判定した日（JST の YYYY-MM-DD。1 日 1 回の実行管理） */
  last_run_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BroadcastSticker {
  id: string;
  /** null = 全店舗共通の同梱イラスト */
  store_id: string | null;
  label: string;
  url: string;
  preview_url: string;
  sort: number;
}

/** 店舗ごとの配信設定（stores の列） */
export interface BroadcastSettings {
  /** 月間上限（通数。null = 制限なし） */
  monthly_limit: number | null;
  /** 上限を超えるとき: confirm = 確認して送れる / block = 送れない */
  over_limit: 'confirm' | 'block';
  opt_out_keyword: string;
  opt_in_keyword: string;
  /** 自動配信の実行時刻（HH:00。JST） */
  automation_time: string;
}

export interface BroadcastAutomationInput {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  audience?: BroadcastAudience;
  items?: BroadcastItem[];
  resend_after_days?: number | null;
}

/** LINE 公式アカウントの今月の通数（Messaging API の quota / consumption） */
export interface LineQuotaInfo {
  /** limited = 上限あり / none = 上限なし */
  type: 'limited' | 'none';
  /** 月の上限（type = limited のとき） */
  limit: number | null;
  /** 今月すでに送った通数（配信・リマインダー・フォローなどすべて） */
  usage: number;
}

export interface BroadcastInput {
  name: string;
  audience?: BroadcastAudience;
  items?: BroadcastItem[];
  scheduled_at?: string | null;
  track_taps?: boolean;
}
