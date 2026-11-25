/**
 * 1 対 1 トーク（④-5）: 自動で送ったメッセージを会話に出す・利用量の記録 — 純粋ロジック（DB・通信に依存しない）
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章「自動で送ったメッセージを会話に出す」「利用量の記録」
 *
 * - リマインダー・フォロー・配信・自動応答・空き待ちのお知らせを、**「何を送ったか」の 1 行**で会話に並べる
 *   （送った本文そのものは保存しない。データが大きくなり、配信の内容と二重に持つことになるため）
 * - 記録するのは、トーク機能が ON の店舗で、**すでに会話のあるお客様だけ**（DB 関数が判断する）。
 *   会話の無いお客様の会話は作らない（配信のたびに、数千人ぶんの空の会話ができてしまうため）
 * - 同じ送信は 1 回だけ記録する（source_key = 元の送信の ID。重複は DB の一意制約で捨てる）
 * - **Edge Function（Deno）は同じ文を自分で組み立てている。文を直すときは両方**
 *   （supabase/functions/send-reminders・send-follow-messages・send-broadcasts の recordChatEvents）
 */

export type ChatEventKind = 'reminder' | 'follow' | 'broadcast' | 'auto_reply' | 'waitlist';

export interface ChatSystemEvent {
  line_user_id: string;
  kind: ChatEventKind;
  /** 会話に出す 1 行 */
  text: string;
  /** 元の送信の ID（同じ送信を 2 回記録しないための鍵） */
  source_key: string;
  /** 送った日時 */
  at: string;
}

export const CHAT_EVENT_TEXT_MAX = 200;
const SOURCE_KEY_PATTERN = /^[A-Za-z0-9:_.-]{1,200}$/;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** 記録する形にそろえる。宛先・文・鍵のどれかが欠けている / 形がおかしいものは null（記録しない） */
export function normalizeChatSystemEvent(raw: { line_user_id?: string | null; kind: ChatEventKind; text?: string | null; source_key?: string | null; at?: string | Date | null }): ChatSystemEvent | null {
  const lineUserId = (raw.line_user_id ?? '').trim();
  const text = (raw.text ?? '').replace(/\s+/g, ' ').trim();
  const sourceKey = (raw.source_key ?? '').trim();
  if (!lineUserId || !text || !SOURCE_KEY_PATTERN.test(sourceKey)) return null;
  const at = raw.at instanceof Date ? raw.at : raw.at ? new Date(raw.at) : new Date();
  return { line_user_id: lineUserId, kind: raw.kind, text: clip(text, CHAT_EVENT_TEXT_MAX), source_key: sourceKey, at: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString() };
}

// ---- 会話に出す 1 行（Edge Function も同じ文を組み立てる）

/** 予約リマインダー（前日・当日・直前）。dateText = 「11月25日（水） 14:00」のような予約の日時 */
export function reminderEventText(dateText: string): string {
  const d = dateText.trim();
  return d ? `リマインダーを送信しました（${d} のご予約）` : 'リマインダーを送信しました';
}

export function followEventText(): string {
  return 'フォローメッセージを送信しました';
}

export function broadcastEventText(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n ? `配信「${clip(n, 60)}」を送信しました` : '配信を送信しました';
}

export function waitlistEventText(type: 'slot_opened' | 'slot_filled'): string {
  return type === 'slot_opened' ? '空き待ちの「空きが出ました」のお知らせを送信しました' : '空き待ちの「埋まりました」のお知らせを送信しました';
}

/**
 * Webhook が自動で返信した内容の 1 行（予約確認・キャンセル・予約変更・キーワード自動応答・あいさつメッセージなど）。
 * 1 通目の見出し（カードは代わりの文 = altText、文字は 1 行目）を使う。返信が空なら null
 */
export function autoReplyEventText(messages: ReadonlyArray<unknown>): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const first = (messages[0] && typeof messages[0] === 'object' ? messages[0] : {}) as Record<string, unknown>;
  let label = '';
  if (typeof first.altText === 'string') label = first.altText;
  else if (typeof first.text === 'string') label = first.text.split('\n')[0];
  label = label.replace(/\s+/g, ' ').trim();
  const head = label ? `「${clip(label, 40)}」を自動で返信しました` : '自動で返信しました';
  return messages.length > 1 ? `${head}（ほか ${messages.length - 1} 通）` : head;
}

// ---------------------------------------------------------------------------
// 利用量（有料オプションの料金を決める・請求するときの材料）
// ---------------------------------------------------------------------------

/** 利用量を数える月（日本時間の YYYY-MM） */
export function chatUsageMonth(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 7);
}

/** 前の月（YYYY-MM） */
export function previousUsageMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export const isUsageMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export interface ChatUsageCounts {
  /** お客様から届いた通数（フォームの送信文・コマンドなど、自動の文は数えない） */
  inbound: number;
  /** 店舗が返信した通数（送れたものだけ。自動で送ったメッセージは数えない） */
  outbound: number;
  /** その月に保存した画像の容量（バイト。届いた画像 + 送った画像） */
  image_bytes: number;
}

export const EMPTY_USAGE: ChatUsageCounts = { inbound: 0, outbound: 0, image_bytes: 0 };

export interface ChatUsageRow {
  store_id: string;
  store_name: string;
  /** トーク機能が ON か */
  enabled: boolean;
  /** 最後に ON にした日時 */
  enabled_at: string | null;
  /** 指定した月 */
  current: ChatUsageCounts;
  /** その前の月 */
  previous: ChatUsageCounts;
}

/** 一覧の並び: ON の店舗が上、その中は指定した月の合計（受信 + 返信）が多い順 */
export function sortChatUsageRows(rows: ReadonlyArray<ChatUsageRow>): ChatUsageRow[] {
  const total = (r: ChatUsageRow) => r.current.inbound + r.current.outbound;
  return [...rows].sort((a, b) => Number(b.enabled) - Number(a.enabled) || total(b) - total(a) || a.store_name.localeCompare(b.store_name, 'ja'));
}

export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** CSV の 1 マス（= + - @ で始まる値は、表計算ソフトが式として実行しないよう ' を付ける） */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 利用状況の CSV（先頭に BOM。Excel でそのまま開ける） */
export function chatUsageCsv(month: string, rows: ReadonlyArray<ChatUsageRow>): string {
  const prev = previousUsageMonth(month);
  const header = ['店舗ID', '店舗名', 'トーク機能', 'ON にした日時', `${month} 受信`, `${month} 返信`, `${month} 画像(MB)`, `${prev} 受信`, `${prev} 返信`, `${prev} 画像(MB)`];
  const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
  const lines = rows.map((r) => [r.store_id, r.store_name, r.enabled ? 'ON' : 'OFF', r.enabled_at ?? '', r.current.inbound, r.current.outbound, mb(r.current.image_bytes), r.previous.inbound, r.previous.outbound, mb(r.previous.image_bytes)]);
  return `﻿${[header, ...lines].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
