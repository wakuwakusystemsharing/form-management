/**
 * LINE リマインダー文面のテンプレート処理（管理画面プレビュー用）
 *
 * ※ 実際の送信は Supabase Edge Function `send-reminders` が行う。
 *   同じロジックを supabase/functions/send-reminders/index.ts に持っているため、
 *   ここを変更したら Edge Function 側も合わせて変更すること（Deno 側から src/ を import できないため）。
 */
import type { ReminderTemplate } from '@/types/store';

export const REMINDER_DEFAULT_HEADER_COLOR = '#877059';
export const REMINDER_DEFAULT_TEXT_COLOR = '#333333';
export const REMINDER_DEFAULT_FOOTER = '心よりお待ちしております';

export const REMINDER_PLACEHOLDERS: Array<{ key: string; label: string }> = [
  { key: '{LINE名}', label: 'LINEの表示名' },
  { key: '{お名前}', label: '予約時のお名前' },
  { key: '{予約日時}', label: '予約日時（例: 2026年04月03日（木） 10:00）' },
  { key: '{予約日}', label: '予約日のみ' },
  { key: '{予約時間}', label: '予約時間のみ' },
  { key: '{メニュー名}', label: 'メニュー名' },
  { key: '{担当スタッフ}', label: '担当スタッフ名（未設定なら空）' },
  { key: '{店舗名}', label: '店舗名' },
];

export interface ReminderContext {
  storeName: string;
  daysBefore: number;
  lineDisplayName: string;   // 取得できなければお名前を入れる
  customerName: string;
  dateText: string;          // 2026年04月03日（木） 10:00
  dateOnly: string;          // 2026年04月03日（木）
  timeOnly: string;          // 10:00
  menuText: string;
  staffName: string;         // 無ければ ''
}

export function defaultHeaderTitle(daysBefore: number): string {
  return daysBefore === 1 ? '【予約前日メッセージ】' : `【予約${daysBefore}日前メッセージ】`;
}

export function defaultBodyLabel(daysBefore: number): string {
  return daysBefore === 1 ? '明日の予約をお知らせします' : `${daysBefore}日後の予約をお知らせします`;
}

export function isValidHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** プレースホルダーを差し込む */
export function applyReminderPlaceholders(text: string, ctx: ReminderContext): string {
  return String(text || '')
    .replace(/\{LINE名\}/g, ctx.lineDisplayName || ctx.customerName)
    .replace(/\{お名前\}/g, ctx.customerName)
    .replace(/\{予約日時\}/g, ctx.dateText)
    .replace(/\{予約日\}/g, ctx.dateOnly)
    .replace(/\{予約時間\}/g, ctx.timeOnly)
    .replace(/\{メニュー名\}/g, ctx.menuText)
    .replace(/\{担当スタッフ\}/g, ctx.staffName || '')
    .replace(/\{店舗名\}/g, ctx.storeName);
}

/**
 * テンプレートと予約情報から、送信される内容を「表示用の構造」に解決する
 * （管理画面プレビューと Edge Function の Flex 組み立てで同じ結果になるようにする）
 */
export function resolveReminderContent(template: ReminderTemplate | null | undefined, ctx: ReminderContext) {
  const t = template || {};
  const headerTitle = (t.header_title || '').trim() ? applyReminderPlaceholders(t.header_title!, ctx) : defaultHeaderTitle(ctx.daysBefore);
  const headerColor = isValidHex(t.header_color) ? t.header_color : REMINDER_DEFAULT_HEADER_COLOR;
  const textColor = isValidHex(t.text_color) ? t.text_color : REMINDER_DEFAULT_TEXT_COLOR;
  const customBody = (t.body_text || '').trim() ? applyReminderPlaceholders(t.body_text!, ctx).trim() : '';
  const bodyText = customBody || defaultBodyLabel(ctx.daysBefore);
  const showDetails = t.show_details !== false;
  const showFooter = t.show_footer !== false;
  const footerText = (t.footer_text || '').trim() ? applyReminderPlaceholders(t.footer_text!, ctx).trim() : REMINDER_DEFAULT_FOOTER;
  return { headerTitle, headerColor, textColor, bodyText, isCustomBody: !!customBody, showDetails, showFooter, footerText };
}

/** プレビュー用のサンプル予約 */
export function sampleReminderContext(storeName: string, daysBefore: number): ReminderContext {
  return {
    storeName: storeName || '店舗名',
    daysBefore,
    lineDisplayName: 'はなこ',
    customerName: '山田 花子',
    dateText: '2026年04月03日（木） 10:00',
    dateOnly: '2026年04月03日（木）',
    timeOnly: '10:00',
    menuText: 'カット > ロング',
    staffName: '佐藤',
  };
}
