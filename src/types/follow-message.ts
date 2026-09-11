/**
 * フォローメッセージ配信予定（follow_messages テーブル / data/follow_messages.json）
 * 設計: docs/フォローメッセージ機能_実装設計.md
 */

export type FollowMessageStatus = 'scheduled' | 'sending' | 'sent' | 'skipped' | 'cancelled' | 'superseded' | 'failed';

export type FollowMessageSkipReason =
  | 'rebooked'               // 基準日より後に再予約があった
  | 'reminder_same_day'      // 同じ日に予約リマインダーが送られる
  | 'store_disabled'         // 店舗のフォロー設定が OFF
  | 'no_token'               // LINE チャネルアクセストークン未設定
  | 'no_line_user'           // LINE ユーザー ID が無い
  | 'reservation_cancelled'; // 予約がキャンセルされた

export const FOLLOW_MESSAGE_STATUSES: FollowMessageStatus[] = ['scheduled', 'sending', 'sent', 'skipped', 'cancelled', 'superseded', 'failed'];

export interface FollowMessage {
  id: string;
  store_id: string;
  reservation_id: string;
  line_user_id: string;
  customer_id: string | null;
  base_date: string;          // YYYY-MM-DD
  scheduled_at: string;       // ISO（UTC）
  status: FollowMessageStatus;
  skip_reason: FollowMessageSkipReason | null;
  attempt_count: number;
  last_error: string | null;
  claimed_at?: string | null; // 送信処理が行を確保した時刻（sending）
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 顧客詳細の予約履歴に同梱する要約 */
export interface FollowMessageSummary {
  status: FollowMessageStatus;
  skip_reason: FollowMessageSkipReason | null;
  scheduled_at: string;
  sent_at: string | null;
}

export const FOLLOW_MESSAGE_STATUS_LABELS: Record<FollowMessageStatus, string> = {
  scheduled: 'フォロー予定',
  sending: 'フォロー送信中',
  sent: 'フォロー送信済み',
  skipped: 'フォロー見送り',
  cancelled: 'フォロー取消',
  superseded: 'フォロー差替',
  failed: 'フォロー失敗',
};

export const FOLLOW_MESSAGE_SKIP_REASON_LABELS: Record<FollowMessageSkipReason, string> = {
  rebooked: '再予約のため',
  reminder_same_day: 'リマインダーと同日のため',
  store_disabled: '設定 OFF のため',
  no_token: 'LINE 未設定のため',
  no_line_user: 'LINE ユーザーではないため',
  reservation_cancelled: '予約キャンセルのため',
};

// ---------------------------------------------------------------------------
// リマインダー送信記録（reminder_logs）
// ---------------------------------------------------------------------------

export type ReminderLogStatus = 'sending' | 'sent' | 'failed' | 'skipped';

/** 顧客詳細の予約履歴に同梱する要約（最新の対象日の 1 件） */
export interface ReminderLogSummary {
  status: ReminderLogStatus;
  target_date: string;
  skip_reason: string | null;
  sent_at: string | null;
  last_error: string | null;
}

export const REMINDER_LOG_STATUS_LABELS: Record<ReminderLogStatus, string> = {
  sending: 'リマインダー送信中',
  sent: 'リマインダー送信済み',
  failed: 'リマインダー失敗',
  skipped: 'リマインダー見送り',
};

/** まだ送信記録が無い予約に対する、店舗設定から計算したリマインダーの送信予定（顧客詳細の表示用） */
export interface ReminderPlanSummary {
  scheduled_at: string;  // ISO（UTC）。予約日 - reminder_days_before 日 の reminder_time（JST）
}
