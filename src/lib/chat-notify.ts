/**
 * 1 対 1 トーク（④-3）: 新着の通知と、保存期間を過ぎた会話の自動削除 — 純粋ロジック（DB・通信に依存しない）
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章「未読と通知」「自動削除」
 *
 * - 通知は任意（既定は OFF）。スタッフの LINE・メールのどちらか / 両方
 * - **通知には、メッセージの本文を載せない**（「〇〇様から新しいメッセージが届きました」とリンクだけ）。
 *   会話には体の悩みなど慎重に扱う内容が入ることがあり、通知は転送されたり、他の人の目に触れたりするため
 * - 同じ会話については 10 分に 1 回まで。夜間（既定 22 時〜8 時）は送らない
 */
import type { ChatRetentionYears } from './chat';

export const CHAT_NOTIFY_EMAIL_MAX = 5;
/** 同じ会話について、次の通知を送るまでの間隔 */
export const CHAT_NOTIFY_INTERVAL_MS = 10 * 60 * 1000;

export interface ChatQuietHours {
  enabled: boolean;
  /** 送らない時間帯の始まり・終わり（日本時間の「時」。0〜23。日付またぎ可） */
  start: number;
  end: number;
}

export interface ChatNotifySettings {
  /** スタッフの LINE に通知する（公式 LINE の通数を使う。1 回 × スタッフの人数） */
  line: boolean;
  /** メールで通知する */
  email: boolean;
  emails: string[];
  quiet: ChatQuietHours;
}

export const CHAT_NOTIFY_DEFAULTS: ChatNotifySettings = { line: false, email: false, emails: [], quiet: { enabled: true, start: 22, end: 8 } };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isHour = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;

/** 保存されている行（chat_settings）を通知の設定にする。読めない値・列が無い環境は既定（OFF） */
export function normalizeChatNotifySettings(raw: unknown): ChatNotifySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const emails = Array.isArray(r.notify_emails) ? r.notify_emails.filter((e): e is string => typeof e === 'string' && EMAIL_RE.test(e.trim())).map((e) => e.trim()) : [];
  const start = Number(r.notify_quiet_start);
  const end = Number(r.notify_quiet_end);
  return {
    line: r.notify_line === true,
    email: r.notify_email === true,
    emails: [...new Set(emails)].slice(0, CHAT_NOTIFY_EMAIL_MAX),
    quiet: {
      enabled: r.notify_quiet_enabled === undefined || r.notify_quiet_enabled === null ? CHAT_NOTIFY_DEFAULTS.quiet.enabled : r.notify_quiet_enabled === true,
      start: isHour(start) && r.notify_quiet_start !== null && r.notify_quiet_start !== undefined ? start : CHAT_NOTIFY_DEFAULTS.quiet.start,
      end: isHour(end) && r.notify_quiet_end !== null && r.notify_quiet_end !== undefined ? end : CHAT_NOTIFY_DEFAULTS.quiet.end,
    },
  };
}

/** 保存する行の形（chat_settings の列） */
export function chatNotifySettingsToRow(s: ChatNotifySettings): Record<string, unknown> {
  return { notify_line: s.line, notify_email: s.email, notify_emails: s.emails, notify_quiet_enabled: s.quiet.enabled, notify_quiet_start: s.quiet.start, notify_quiet_end: s.quiet.end };
}

export type ChatNotifyValidation = { ok: true; value: ChatNotifySettings } | { ok: false; error: string };

/** 画面から届いた通知の設定の検証 */
export function validateChatNotifySettings(raw: unknown): ChatNotifyValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '設定の内容が正しくありません' };
  const r = raw as Record<string, unknown>;
  const q = (r.quiet && typeof r.quiet === 'object' ? r.quiet : {}) as Record<string, unknown>;
  const rawEmails = Array.isArray(r.emails) ? r.emails.filter((e): e is string => typeof e === 'string' && e.trim() !== '').map((e) => e.trim()) : [];
  const emails = [...new Set(rawEmails)];
  const bad = emails.find((e) => !EMAIL_RE.test(e));
  if (bad) return { ok: false, error: `メールアドレスの形式が正しくありません: ${bad}` };
  if (emails.length > CHAT_NOTIFY_EMAIL_MAX) return { ok: false, error: `メールアドレスは ${CHAT_NOTIFY_EMAIL_MAX} 件までです` };
  const email = r.email === true;
  if (email && emails.length === 0) return { ok: false, error: '通知を受け取るメールアドレスを入力してください' };
  const start = q.start === undefined ? CHAT_NOTIFY_DEFAULTS.quiet.start : Number(q.start);
  const end = q.end === undefined ? CHAT_NOTIFY_DEFAULTS.quiet.end : Number(q.end);
  if (!isHour(start) || !isHour(end)) return { ok: false, error: '通知を送らない時間帯は、0〜23 時で選んでください' };
  return { ok: true, value: { line: r.line === true, email, emails, quiet: { enabled: q.enabled === undefined ? CHAT_NOTIFY_DEFAULTS.quiet.enabled : q.enabled === true, start, end } } };
}

/** いまが「通知を送らない時間帯」か（日本時間）。OFF、または始まりと終わりが同じなら常に false */
export function isChatQuietTime(quiet: ChatQuietHours | null | undefined, now: Date): boolean {
  if (!quiet || quiet.enabled !== true || quiet.start === quiet.end) return false;
  const hour = new Date(now.getTime() + 9 * 3600000).getUTCHours();
  return quiet.start < quiet.end ? hour >= quiet.start && hour < quiet.end : hour >= quiet.start || hour < quiet.end;
}

/** その会話について、いま通知してよいか（前の通知から 10 分たっている） */
export function canNotifyChatThread(notifiedAt: string | null | undefined, now: Date): boolean {
  if (!notifiedAt) return true;
  const t = Date.parse(notifiedAt);
  return !Number.isFinite(t) || now.getTime() - t >= CHAT_NOTIFY_INTERVAL_MS;
}

/** 通知を送らない理由（送るなら null） */
export function chatNotifySkipReason(settings: ChatNotifySettings, now: Date): 'off' | 'quiet' | null {
  if (!settings.line && !(settings.email && settings.emails.length > 0)) return 'off';
  if (isChatQuietTime(settings.quiet, now)) return 'quiet';
  return null;
}

export interface ChatNotifyContent {
  storeName: string;
  /** お客様の名前（分からなければ「お客様」） */
  customerName: string;
  /** その会話の未読の数 */
  unread: number;
  /** トークの画面の URL */
  url: string;
}

const nameOf = (c: ChatNotifyContent) => (c.customerName.trim() ? `${c.customerName.trim()} 様` : 'お客様');
const unreadOf = (c: ChatNotifyContent) => (c.unread > 1 ? `（未読 ${c.unread} 件）` : '');

/** スタッフの LINE に送る文（本文は載せない） */
export function buildChatNotifyLineText(c: ChatNotifyContent): string {
  return `【トーク】${nameOf(c)}から新しいメッセージが届きました${unreadOf(c)}\n内容は管理画面で確認してください。\n${c.url}`;
}

/** メールの件名と本文（本文は載せない） */
export function buildChatNotifyEmail(c: ChatNotifyContent): { subject: string; body: string } {
  return {
    subject: `【${c.storeName}】${nameOf(c)}から新しいメッセージが届きました`,
    body: [
      `${c.storeName} の公式 LINE に、${nameOf(c)}から新しいメッセージが届きました${unreadOf(c)}。`,
      '',
      '内容の確認と返信は、管理画面の「トーク」から行えます。',
      c.url,
      '',
      '※ このメールには、メッセージの内容は載せていません。',
      '※ 同じお客様からの新着は、10 分に 1 回までお知らせします。通知の設定は、管理画面の「設定」から変更できます。',
    ].join('\n'),
  };
}

/** トークの画面の URL（店舗管理者ページ） */
export function buildChatAdminUrl(origin: string, storeId: string): string {
  return `${origin.replace(/\/+$/, '')}/${encodeURIComponent(storeId)}/admin?tab=chat`;
}

// ---------------------------------------------------------------------------
// 自動削除（保存期間）
// ---------------------------------------------------------------------------

/** 1 回の実行で消すメッセージの上限（残りは次の日に回す） */
export const CHAT_RETENTION_BATCH = 5000;

/**
 * この日時より前のメッセージを消す（いま − 保存期間。暦の年で引く）。
 * 例: 2027-11-25 に保存期間 1 年 → 2026-11-25 より前
 */
export function chatRetentionCutoff(years: ChatRetentionYears, now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString();
}
