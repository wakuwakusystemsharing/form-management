/**
 * LINE フォローメッセージ文面のテンプレート処理（管理画面プレビュー用）
 *
 * 差し込み項目・解決ロジックはリマインダー（src/lib/reminder-template.ts）と共通。
 * デフォルト文言だけがフォロー用。
 *
 * ※ 実際の送信は Supabase Edge Function `send-follow-messages` が行う。
 *   同じロジックを supabase/functions/send-follow-messages/index.ts に持っているため、
 *   ここを変更したら Edge Function 側も合わせて変更すること（Deno 側から src/ を import できないため）。
 */
import type { FollowTemplate } from '@/types/store';
import {
  type ReminderContext,
  type ResolvedMessageContent,
  resolveMessageContent,
} from '@/lib/reminder-template';

export const FOLLOW_DEFAULT_HEADER_TITLE = '【ご来店ありがとうございました】';
export const FOLLOW_DEFAULT_BODY = '先日はご来店いただきありがとうございました。\n次回のご予約もお待ちしております。';
export const FOLLOW_DEFAULT_FOOTER = 'またのご来店を心よりお待ちしております';

/** フォロー用のコンテキスト（差し込み項目はリマインダーと同じ。daysBefore は未使用） */
export type FollowContext = ReminderContext;

export function resolveFollowContent(template: FollowTemplate | null | undefined, ctx: FollowContext): ResolvedMessageContent {
  return resolveMessageContent(template, ctx, {
    headerTitle: FOLLOW_DEFAULT_HEADER_TITLE,
    bodyText: FOLLOW_DEFAULT_BODY,
    footerText: FOLLOW_DEFAULT_FOOTER,
  });
}

/** プレビュー用のサンプル予約（前回のご予約として表示） */
export function sampleFollowContext(storeName: string): FollowContext {
  return {
    storeName: storeName || '店舗名',
    daysBefore: 0,
    lineDisplayName: 'はなこ',
    customerName: '山田 花子',
    dateText: '2026年04月03日（木） 10:00',
    dateOnly: '2026年04月03日（木）',
    timeOnly: '10:00',
    menuText: 'カット > ロング',
    staffName: '佐藤',
  };
}
