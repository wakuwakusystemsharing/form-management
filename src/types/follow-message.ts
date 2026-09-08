/**
 * フォローメッセージ配信予定（follow_messages テーブル / data/follow_messages.json）
 * 設計: docs/フォローメッセージ機能_実装設計.md
 */

export type FollowMessageStatus = 'scheduled' | 'sent' | 'skipped' | 'cancelled' | 'superseded' | 'failed';

export type FollowMessageSkipReason =
  | 'rebooked'               // 基準日より後に再予約があった
  | 'reminder_same_day'      // 同じ日に予約リマインダーが送られる
  | 'store_disabled'         // 店舗のフォロー設定が OFF
  | 'no_token'               // LINE チャネルアクセストークン未設定
  | 'reservation_cancelled'; // 予約がキャンセルされた

export const FOLLOW_MESSAGE_STATUSES: FollowMessageStatus[] = ['scheduled', 'sent', 'skipped', 'cancelled', 'superseded', 'failed'];

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
  reservation_cancelled: '予約キャンセルのため',
};
