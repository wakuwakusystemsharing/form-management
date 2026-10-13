/**
 * LINE リマインダー文面のテンプレート処理（管理画面プレビュー用）
 *
 * ※ 実際の送信は Supabase Edge Function `send-reminders` が行う。
 *   同じロジックを supabase/functions/send-reminders/index.ts に持っているため、
 *   ここを変更したら Edge Function 側も合わせて変更すること（Deno 側から src/ を import できないため）。
 */
import type { ReminderTemplate } from '@/types/store';
import { formatMinutesJa } from '@/lib/follow-message-scheduler';

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
  beforeMinutes?: number;    // 直前リマインダーのとき「何分前」（> 0）。指定があれば daysBefore より優先して既定文言を決める
  lineDisplayName: string;   // 取得できなければお名前を入れる
  customerName: string;
  dateText: string;          // 2026年04月03日（木） 10:00
  dateOnly: string;          // 2026年04月03日（木）
  timeOnly: string;          // 10:00
  menuText: string;
  staffName: string;         // 無ければ ''
}

/** daysBefore: 1 = 前日、2〜 = N 日前、0 = 当日（当日リマインダー）。beforeMinutes > 0 なら直前リマインダー（予約時間の N 分前） */
export function defaultHeaderTitle(daysBefore: number, beforeMinutes?: number): string {
  if (beforeMinutes && beforeMinutes > 0) return `【ご予約${formatMinutesJa(beforeMinutes)}前のお知らせ】`;
  if (daysBefore === 0) return '【予約当日メッセージ】';
  return daysBefore === 1 ? '【予約前日メッセージ】' : `【予約${daysBefore}日前メッセージ】`;
}

export function defaultBodyLabel(daysBefore: number, beforeMinutes?: number): string {
  if (beforeMinutes && beforeMinutes > 0) return `${formatMinutesJa(beforeMinutes)}後にご予約のお時間です`;
  if (daysBefore === 0) return '本日の予約をお知らせします';
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

export interface MessageContentDefaults {
  headerTitle: string;
  bodyText: string;
  footerText: string;
}

export interface ResolvedMessageContent {
  headerTitle: string;
  headerColor: string;
  textColor: string;
  bodyText: string;
  isCustomBody: boolean;
  showDetails: boolean;
  showFooter: boolean;
  footerText: string;
}

/**
 * テンプレート + デフォルト文言から、送信される内容を「表示用の構造」に解決する（リマインダー / フォロー共通）
 * （管理画面プレビューと Edge Function の Flex 組み立てで同じ結果になるようにする）
 */
export function resolveMessageContent(
  template: ReminderTemplate | null | undefined,
  ctx: ReminderContext,
  defaults: MessageContentDefaults
): ResolvedMessageContent {
  const t = template || {};
  const headerTitle = (t.header_title || '').trim() ? applyReminderPlaceholders(t.header_title!, ctx) : defaults.headerTitle;
  const headerColor = isValidHex(t.header_color) ? t.header_color : REMINDER_DEFAULT_HEADER_COLOR;
  const textColor = isValidHex(t.text_color) ? t.text_color : REMINDER_DEFAULT_TEXT_COLOR;
  const customBody = (t.body_text || '').trim() ? applyReminderPlaceholders(t.body_text!, ctx).trim() : '';
  const bodyText = customBody || defaults.bodyText;
  const showDetails = t.show_details !== false;
  const showFooter = t.show_footer !== false;
  const footerText = (t.footer_text || '').trim() ? applyReminderPlaceholders(t.footer_text!, ctx).trim() : defaults.footerText;
  return { headerTitle, headerColor, textColor, bodyText, isCustomBody: !!customBody, showDetails, showFooter, footerText };
}

/**
 * リマインダー文面を解決する（デフォルト文言は「何日前」設定に応じて変わる）
 */
export function resolveReminderContent(template: ReminderTemplate | null | undefined, ctx: ReminderContext): ResolvedMessageContent {
  return resolveMessageContent(template, ctx, {
    headerTitle: defaultHeaderTitle(ctx.daysBefore, ctx.beforeMinutes),
    bodyText: defaultBodyLabel(ctx.daysBefore, ctx.beforeMinutes),
    footerText: REMINDER_DEFAULT_FOOTER,
  });
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
