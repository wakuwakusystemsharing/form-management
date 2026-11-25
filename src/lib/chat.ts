/**
 * 1 対 1 トーク（④）の純粋ロジック — DB・通信に依存しない
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
 *
 * - 既定は OFF。運営（マスター管理者・システム管理者）が店舗ごとに ON にした店舗だけ、会話を保存する
 * - フォームが自動で送る文（【…】）・コマンド（「予約確認」など）には「自動」の印を付け、未読に数えない
 */
import { matchesKeyword } from './line-flex-templates';
import { CHANGE_KEYWORD } from './reservation-change';
import { STAFF_REGISTER_KEYWORD } from './store-digest';
import { WAITLIST_KEYWORD } from './waitlist';

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

/** 会話の保存期間（年） */
export const CHAT_RETENTION_OPTIONS = [1, 2, 3] as const;
export type ChatRetentionYears = (typeof CHAT_RETENTION_OPTIONS)[number];
export const CHAT_DEFAULT_RETENTION_YEARS: ChatRetentionYears = 1;

export interface ChatSettings {
  /** トーク機能を使う（運営だけが変えられる） */
  enabled: boolean;
  retention_years: ChatRetentionYears;
  /** 最後に ON にした日時 */
  enabled_at: string | null;
  updated_at: string | null;
}

export const CHAT_DEFAULT_SETTINGS: ChatSettings = { enabled: false, retention_years: CHAT_DEFAULT_RETENTION_YEARS, enabled_at: null, updated_at: null };

const isRetention = (v: unknown): v is ChatRetentionYears => (CHAT_RETENTION_OPTIONS as readonly unknown[]).includes(v);

/** 保存されている値（どんな形でも）を設定にする。読めない値は既定（OFF・1 年） */
export function normalizeChatSettings(raw: unknown): ChatSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const years = Number(r.retention_years);
  return {
    enabled: r.enabled === true,
    retention_years: isRetention(years) ? years : CHAT_DEFAULT_RETENTION_YEARS,
    enabled_at: typeof r.enabled_at === 'string' && r.enabled_at ? r.enabled_at : null,
    updated_at: typeof r.updated_at === 'string' && r.updated_at ? r.updated_at : null,
  };
}

export type ChatSettingsValidation = { ok: true; value: { enabled: boolean; retention_years: ChatRetentionYears } } | { ok: false; error: string };

/** 画面から届いた設定の検証（指定の無い項目は、いまの値のまま） */
export function validateChatSettingsInput(raw: unknown, current: ChatSettings): ChatSettingsValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '設定の内容が正しくありません' };
  const r = raw as Record<string, unknown>;
  let enabled = current.enabled;
  if (r.enabled !== undefined) {
    if (typeof r.enabled !== 'boolean') return { ok: false, error: 'トーク機能の ON / OFF が正しくありません' };
    enabled = r.enabled;
  }
  let years = current.retention_years;
  if (r.retention_years !== undefined) {
    const n = Number(r.retention_years);
    if (!isRetention(n)) return { ok: false, error: '保存期間は 1 年 / 2 年 / 3 年から選んでください' };
    years = n;
  }
  return { ok: true, value: { enabled, retention_years: years } };
}

/**
 * ON にできない理由（できるなら null）。
 * 偽の通知を会話として保存しないよう、Webhook の署名チェック（チャネルシークレットの登録）が済んだ店舗だけ ON にできる
 */
export function chatEnableBlocker(input: { secretSet: boolean; tableMissing?: boolean; local?: boolean }): string | null {
  if (input.tableMissing) return 'データベースの更新（マイグレーション）がまだ適用されていません';
  if (input.local) return null;
  if (!input.secretSet) return '先に「LINE 通知の署名チェック」でチャネルシークレットを登録してください（偽の通知を会話として保存しないためです）';
  return null;
}

// ---------------------------------------------------------------------------
// 届いたメッセージ
// ---------------------------------------------------------------------------

export type ChatMessageKind = 'text' | 'image' | 'sticker' | 'video' | 'audio' | 'file' | 'location' | 'other';
/** 自動の印の種類: フォームの送信文 / コマンド / キーワード自動応答の合言葉 / フォームの送信文に続けて送られた文 */
export type ChatAutoKind = 'form' | 'command' | 'keyword' | 'follow_up';

export const CHAT_TEXT_MAX = 5000;
export const CHAT_PREVIEW_MAX = 60;
/** フォームの送信文のあと、この時間内に同じ人から届いた文は「フォームが続けて送った文」（2 通目・追加メッセージ）とみなす */
export const CHAT_FOLLOW_UP_WINDOW_MS = 3000;

export interface ChatInbound {
  lineUserId: string;
  /** LINE 側のメッセージ ID（同じ通知が 2 回届いても 1 件にするための鍵） */
  lineMessageId: string;
  kind: ChatMessageKind;
  text: string | null;
  /** スタンプの番号など（本文以外の小さな情報） */
  meta: Record<string, string> | null;
  /** LINE の通知に入っている日時（届いた順ではなく、送られた順に並べる） */
  at: string;
}

type LineEventLike = {
  type?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string };
  message?: { id?: string; type?: string; text?: string; packageId?: string; stickerId?: string };
};

const KIND_BY_LINE_TYPE: Record<string, ChatMessageKind> = { text: 'text', image: 'image', sticker: 'sticker', video: 'video', audio: 'audio', file: 'file', location: 'location' };

/**
 * LINE の通知 1 件を、保存する形にする。保存しないものは null:
 * メッセージ以外（友だち追加・ボタン操作など）/ グループ・複数人トーク / ユーザー ID・メッセージ ID の無いもの
 */
export function toChatInbound(ev: unknown, now: Date = new Date()): ChatInbound | null {
  const e = (ev && typeof ev === 'object' ? ev : {}) as LineEventLike;
  if (e.type !== 'message' || !e.message) return null;
  if (e.source?.type && e.source.type !== 'user') return null;
  const lineUserId = typeof e.source?.userId === 'string' ? e.source.userId : '';
  const lineMessageId = typeof e.message.id === 'string' ? e.message.id : '';
  if (!lineUserId || !lineMessageId) return null;
  const kind = KIND_BY_LINE_TYPE[String(e.message.type)] ?? 'other';
  const ts = typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) && e.timestamp > 0 ? new Date(e.timestamp) : now;
  let text: string | null = null;
  let meta: Record<string, string> | null = null;
  if (kind === 'text') {
    text = String(e.message.text ?? '').slice(0, CHAT_TEXT_MAX);
    if (!text) return null;
  } else if (kind === 'sticker') {
    const stickerId = String(e.message.stickerId ?? '');
    const packageId = String(e.message.packageId ?? '');
    if (/^\d+$/.test(stickerId)) meta = { sticker_id: stickerId, ...(/^\d+$/.test(packageId) ? { package_id: packageId } : {}) };
  }
  return { lineUserId, lineMessageId, kind, text, meta, at: ts.toISOString() };
}

const KIND_LABELS: Record<ChatMessageKind, string> = {
  text: 'メッセージ',
  image: '画像',
  sticker: 'スタンプ',
  video: '動画',
  audio: '音声',
  file: 'ファイル',
  location: '位置情報',
  other: 'メッセージ',
};

export const chatKindLabel = (kind: ChatMessageKind): string => KIND_LABELS[kind] ?? KIND_LABELS.other;

/** 会話の一覧に出す 1 行（文字は改行をつめて 60 文字まで。文字以外は「画像が送られました」の形） */
export function buildChatPreview(kind: ChatMessageKind, text: string | null): string {
  if (kind === 'text') {
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    return t.length > CHAT_PREVIEW_MAX ? `${t.slice(0, CHAT_PREVIEW_MAX)}…` : t;
  }
  return `${chatKindLabel(kind)}が送られました`;
}

// ---------------------------------------------------------------------------
// 「自動」の印（フォームの送信文・コマンド）
// ---------------------------------------------------------------------------

/** このシステムが決めているコマンド（完全一致） */
export const CHAT_SYSTEM_COMMANDS: readonly string[] = ['予約確認', '予約をキャンセル', CHANGE_KEYWORD, WAITLIST_KEYWORD];
/** 「キャンセル: 3」「キャンセル確定: 3」（予約のキャンセルのボタンが送る文） */
const CANCEL_COMMAND_HEADS = ['キャンセル:', 'キャンセル確定:'];
/** フォームの送信文は「【フォーム名】」「【空き待ち登録】」「【メニュー変更】」のように、1 行目が【…】で始まる */
const FORM_MESSAGE_PATTERN = /^【[^】\n]{1,100}】/;

export interface ChatAutoContext {
  /** その店舗のキーワード自動応答の合言葉（LINE メッセージの「キーワード」） */
  keywords?: ReadonlyArray<string>;
  /** その店舗の「配信停止」「配信再開」の合言葉 */
  optKeywords?: ReadonlyArray<string>;
}

/**
 * お客様の手で書いた文ではなく、フォーム・ボタンが送った文かを見分ける（文字のメッセージだけ）。
 * 印を付けないと、予約が入るたびに未読が増え、通知が飛ぶ。
 */
export function classifyAutoMessage(text: string | null | undefined, ctx: ChatAutoContext = {}): ChatAutoKind | null {
  const raw = text ?? '';
  const t = raw.trim();
  if (!t) return null;
  if (FORM_MESSAGE_PATTERN.test(t)) return 'form';
  if (CHAT_SYSTEM_COMMANDS.includes(t)) return 'command';
  if (CANCEL_COMMAND_HEADS.some((h) => t.startsWith(h))) return 'command';
  // 「スタッフ登録 4821」「スタッフ登録解除」（Webhook と同じく、先頭が一致すれば対象）
  if (t.startsWith(STAFF_REGISTER_KEYWORD)) return 'command';
  if ((ctx.optKeywords ?? []).some((k) => k && k.trim() === t)) return 'command';
  if (matchesKeyword(ctx.keywords ?? [], t)) return 'keyword';
  return null;
}

/**
 * フォームの送信文のすぐあと（3 秒以内）に同じ人から届いた文か。
 * フォームは送信文に続けて「2 通目の固定テキスト」「選択肢ごとの追加メッセージ」を一度に送るので、それも自動の文として扱う
 */
export function isFormFollowUp(prev: { autoKind: ChatAutoKind | null; at: string } | null | undefined, at: string): boolean {
  if (!prev || (prev.autoKind !== 'form' && prev.autoKind !== 'follow_up')) return false;
  const a = Date.parse(prev.at);
  const b = Date.parse(at);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(b - a) <= CHAT_FOLLOW_UP_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// 保存される形
// ---------------------------------------------------------------------------

export interface ChatThread {
  id: string;
  store_id: string;
  line_user_id: string;
  customer_id: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  /** open = 対応中 / done = 対応済み */
  status: 'open' | 'done';
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  store_id: string;
  /** in = お客様から / out = 店舗から / system = 自動の記録 */
  direction: 'in' | 'out' | 'system';
  kind: ChatMessageKind;
  text: string | null;
  meta: Record<string, string> | null;
  media_path: string | null;
  auto: boolean;
  auto_kind: ChatAutoKind | null;
  line_message_id: string | null;
  client_key: string | null;
  send_status: 'sending' | 'sent' | 'failed' | null;
  send_error: string | null;
  sent_by: string | null;
  created_at: string;
}

/** 設定画面に出す件数（会話の中身は含めない） */
export interface ChatStats {
  threads: number;
  messages: number;
  last_message_at: string | null;
}
