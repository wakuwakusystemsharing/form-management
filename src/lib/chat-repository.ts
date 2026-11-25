/**
 * 1 対 1 トークの保存先 — サーバー専用（fs / Supabase に依存。クライアントから import しない）
 *
 * - local 環境は data/chat.json、それ以外は chat_settings / chat_threads / chat_messages
 * - 3 つの表とも API（service_role）からだけ読み書きする（RLS のポリシーは作らない）
 * - 表が未適用の環境では「OFF・0 件」として動く（Webhook など既存の処理を止めない）
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { chatUsageMonth, type ChatSystemEvent, type ChatUsageCounts } from '@/lib/chat-events';
import {
  CHAT_NOTIFY_DEFAULTS,
  CHAT_NOTIFY_INTERVAL_MS,
  CHAT_RETENTION_BATCH,
  canNotifyChatThread,
  chatNotifySettingsToRow,
  chatRetentionCutoff,
  normalizeChatNotifySettings,
  type ChatNotifySettings,
} from '@/lib/chat-notify';
import {
  CHAT_DEFAULT_SETTINGS,
  buildChatPreview,
  isFormFollowUp,
  normalizeChatSettings,
  normalizeChatTemplates,
  type ChatAutoKind,
  type ChatInbound,
  type ChatMessage,
  type ChatReplyTemplate,
  type ChatRetentionYears,
  type ChatSettings,
  type ChatStats,
  type ChatThread,
  type ChatThreadStatus,
} from '@/lib/chat';

const DATA_DIR = path.join(process.cwd(), 'data');
const localFile = () => path.join(DATA_DIR, 'chat.json');
const isLocal = () => getAppEnvironment() === 'local';

interface LocalUsageRow {
  store_id: string;
  month: string;
  inbound_count: number;
  outbound_count: number;
  image_bytes: number;
}

interface LocalData {
  settings: Array<ChatSettings & { store_id: string }>;
  threads: ChatThread[];
  messages: ChatMessage[];
  /** 利用量（④-5） */
  usage?: LocalUsageRow[];
}

function readLocal(): LocalData {
  try {
    if (!fs.existsSync(localFile())) return { settings: [], threads: [], messages: [] };
    const d = JSON.parse(fs.readFileSync(localFile(), 'utf-8')) as Partial<LocalData>;
    return { settings: Array.isArray(d.settings) ? d.settings : [], threads: Array.isArray(d.threads) ? d.threads : [], messages: Array.isArray(d.messages) ? d.messages : [], usage: Array.isArray(d.usage) ? d.usage : [] };
  } catch {
    return { settings: [], threads: [], messages: [] };
  }
}

function writeLocal(data: LocalData): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(localFile(), JSON.stringify(data, null, 2));
}

function client(): any {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c;
}

/** 表・DB 関数が無い（マイグレーション未適用）ときのエラーか */
export function isMissingChatSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === '42883' || error.code === 'PGRST205' || error.code === 'PGRST202') return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('chat_') && (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache'));
}

/**
 * - missing … 表が無い（④-1 のマイグレーション未適用）
 * - notify … 新着の通知の設定（④-3）
 * - notifyMissing … 通知の列が無い（④-3 のマイグレーション未適用。行がある店舗でだけ分かる）
 */
export type ChatSettingsState = { settings: ChatSettings; missing: boolean; notify: ChatNotifySettings; notifyMissing?: boolean; /** 定型文（④-4） */ templates: ChatReplyTemplate[] };

/** 設定を読む。行が無い店舗・表が未適用の環境は OFF。読み取りに失敗したときも OFF（保存しない側に倒す） */
export async function getChatSettings(storeId: string): Promise<ChatSettingsState> {
  if (isLocal()) {
    const row = readLocal().settings.find((s) => s.store_id === storeId);
    return { settings: row ? normalizeChatSettings(row) : { ...CHAT_DEFAULT_SETTINGS }, missing: false, notify: normalizeChatNotifySettings(row), templates: normalizeChatTemplates((row as Record<string, unknown> | undefined)?.reply_templates) };
  }
  const off = { settings: { ...CHAT_DEFAULT_SETTINGS }, notify: { ...CHAT_NOTIFY_DEFAULTS }, templates: [] as ChatReplyTemplate[] };
  try {
    const { data, error } = await client().from('chat_settings').select('*').eq('store_id', storeId).maybeSingle();
    if (error) {
      if (!isMissingChatSchema(error)) console.error('[chat] 設定の読み取りエラー:', error.message);
      return { ...off, missing: isMissingChatSchema(error) };
    }
    return { settings: normalizeChatSettings(data), missing: false, notify: normalizeChatNotifySettings(data), notifyMissing: !!data && !('notify_line' in (data as Record<string, unknown>)), templates: normalizeChatTemplates((data as Record<string, unknown> | null)?.reply_templates) };
  } catch (e) {
    console.error('[chat] 設定の読み取りエラー:', e);
    return { ...off, missing: false };
  }
}

/** 設定を保存する。失敗時はエラーメッセージ（日本語）を投げる */
export async function saveChatSettings(
  storeId: string,
  value: { enabled: boolean; retention_years: ChatRetentionYears },
  opts: { current: ChatSettings; userId?: string | null; now?: Date },
): Promise<ChatSettings> {
  const nowIso = (opts.now ?? new Date()).toISOString();
  // ON にした日時: OFF → ON のときだけ更新する
  const enabledAt = value.enabled && !opts.current.enabled ? nowIso : opts.current.enabled_at;
  const row = { store_id: storeId, enabled: value.enabled, retention_years: value.retention_years, enabled_at: enabledAt, updated_at: nowIso };
  if (isLocal()) {
    const data = readLocal();
    // 通知の設定（④-3）は同じ行に入っているので、残したまま上書きする
    const existing = data.settings.find((s) => s.store_id === storeId);
    data.settings = [...data.settings.filter((s) => s.store_id !== storeId), { ...existing, ...row }];
    writeLocal(data);
    return normalizeChatSettings(row);
  }
  const { error } = await client()
    .from('chat_settings')
    .upsert({ ...row, updated_by: opts.userId ?? null }, { onConflict: 'store_id' });
  if (error) {
    if (isMissingChatSchema(error)) throw new Error('データベースの更新（マイグレーション）がまだ適用されていません');
    console.error('[chat] 設定の保存エラー:', error.message);
    throw new Error('トークの設定の保存に失敗しました');
  }
  return normalizeChatSettings(row);
}

/**
 * お客様から届いた 1 通を保存する（会話が無ければ作る）。
 * 戻り値: true = 保存した / false = 同じメッセージを保存済み。失敗は例外
 *
 * autoKind が null で文字のメッセージのときは、直前がフォームの送信文なら「続けて送った文」として印を付ける。
 * Supabase では、未読の加算まで DB 関数 chat_record_inbound が 1 回で行う。
 */
export async function recordChatInbound(storeId: string, msg: ChatInbound, autoKind: ChatAutoKind | null): Promise<boolean> {
  const preview = buildChatPreview(msg.kind, msg.text);
  const followUpCandidate = autoKind === null && msg.kind === 'text';
  if (!isLocal()) {
    const { data, error } = await client().rpc('chat_record_inbound', {
      p_store_id: storeId,
      p_line_user_id: msg.lineUserId,
      p_line_message_id: msg.lineMessageId,
      p_kind: msg.kind,
      p_text: msg.text,
      p_meta: msg.meta,
      p_auto_kind: autoKind,
      p_follow_up_candidate: followUpCandidate,
      p_preview: preview,
      p_at: msg.at,
    });
    if (error) throw new Error(error.message || 'トークの保存エラー');
    return data === true;
  }

  // local: DB 関数と同じ手順を JSON の中で行う
  const data = readLocal();
  if (data.messages.some((m) => m.store_id === storeId && m.line_message_id === msg.lineMessageId)) return false;
  const nowIso = new Date().toISOString();
  let thread = data.threads.find((t) => t.store_id === storeId && t.line_user_id === msg.lineUserId);
  if (!thread) {
    thread = {
      id: randomUUID(),
      store_id: storeId,
      line_user_id: msg.lineUserId,
      customer_id: findLocalCustomerId(storeId, msg.lineUserId),
      last_message_at: msg.at,
      last_message_preview: null,
      unread_count: 0,
      status: 'open',
      notified_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    };
    data.threads.push(thread);
  } else if (!thread.customer_id) {
    thread.customer_id = findLocalCustomerId(storeId, msg.lineUserId);
  }
  let auto = autoKind;
  if (followUpCandidate) {
    const threadId = thread.id;
    const prev = data.messages
      .filter((m) => m.thread_id === threadId && m.direction === 'in')
      .sort((a, b) => (a.created_at === b.created_at ? Number(a.id) - Number(b.id) : a.created_at < b.created_at ? -1 : 1))
      .pop();
    if (prev && isFormFollowUp({ autoKind: prev.auto_kind, at: prev.created_at }, msg.at)) auto = 'follow_up';
  }
  const nextId = data.messages.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;
  data.messages.push({
    id: String(nextId),
    thread_id: thread.id,
    store_id: storeId,
    direction: 'in',
    kind: msg.kind,
    text: msg.text,
    meta: msg.meta,
    media_path: null,
    auto: auto !== null,
    auto_kind: auto,
    line_message_id: msg.lineMessageId,
    client_key: null,
    send_status: null,
    send_error: null,
    sent_by: null,
    created_at: msg.at,
  });
  if (auto === null) {
    thread.unread_count += 1;
    thread.status = 'open';
    // 利用量: お客様が手で書いた文・画像などだけを数える（DB 関数 chat_record_inbound と同じ）
    const usage = (data.usage ??= []);
    const month = chatUsageMonth(msg.at);
    let row = usage.find((u) => u.store_id === storeId && u.month === month);
    if (!row) {
      row = { store_id: storeId, month, inbound_count: 0, outbound_count: 0, image_bytes: 0 };
      usage.push(row);
    }
    row.inbound_count += 1;
  }
  if (msg.at >= thread.last_message_at || thread.last_message_preview === null) thread.last_message_preview = preview;
  if (msg.at > thread.last_message_at) thread.last_message_at = msg.at;
  thread.updated_at = nowIso;
  writeLocal(data);
  return true;
}

function findLocalCustomerId(storeId: string, lineUserId: string): string | null {
  try {
    const file = path.join(DATA_DIR, 'customers.json');
    if (!fs.existsSync(file)) return null;
    const rows = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<{ id?: string; store_id?: string; line_user_id?: string }>;
    const hit = Array.isArray(rows) ? rows.find((c) => c.store_id === storeId && c.line_user_id === lineUserId) : null;
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

/** 設定画面に出す件数（会話の中身は読まない）。表が未適用・読み取り失敗は 0 件 */
export async function getChatStats(storeId: string): Promise<ChatStats> {
  const empty: ChatStats = { threads: 0, messages: 0, last_message_at: null };
  if (isLocal()) {
    const data = readLocal();
    const threads = data.threads.filter((t) => t.store_id === storeId);
    return {
      threads: threads.length,
      messages: data.messages.filter((m) => m.store_id === storeId).length,
      last_message_at: threads.reduce<string | null>((max, t) => (!max || t.last_message_at > max ? t.last_message_at : max), null),
    };
  }
  try {
    const c = client();
    const [threads, messages, last] = await Promise.all([
      c.from('chat_threads').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
      c.from('chat_messages').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
      c.from('chat_threads').select('last_message_at').eq('store_id', storeId).order('last_message_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (threads.error || messages.error) return empty;
    return { threads: threads.count ?? 0, messages: messages.count ?? 0, last_message_at: last.data?.last_message_at ?? null };
  } catch {
    return empty;
  }
}

/** テスト・local の確認用: 会話とメッセージ（local だけ） */
export function readLocalChatData(): { threads: ChatThread[]; messages: ChatMessage[] } {
  const d = readLocal();
  return { threads: d.threads, messages: d.messages };
}

// ---------------------------------------------------------------------------
// ④-2: 会話の一覧・メッセージ・既読・返信
// ---------------------------------------------------------------------------

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_COLUMNS = 'id, thread_id, store_id, direction, kind, text, meta, media_path, auto, auto_kind, line_message_id, client_key, send_status, send_error, sent_by, created_at';

const byCreated = (a: ChatMessage, b: ChatMessage) => (a.created_at === b.created_at ? Number(a.id) - Number(b.id) : a.created_at < b.created_at ? -1 : 1);

/** その店舗の会話（新しい順。最大 limit 本）。表が未適用なら空 */
export async function listChatThreads(storeId: string, limit = 300): Promise<ChatThread[]> {
  if (isLocal()) {
    return readLocal()
      .threads.filter((t) => t.store_id === storeId)
      .sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1))
      .slice(0, limit);
  }
  const { data, error } = await client().from('chat_threads').select('*').eq('store_id', storeId).order('last_message_at', { ascending: false }).limit(limit);
  if (error) {
    if (isMissingChatSchema(error)) return [];
    throw new Error(error.message || '会話の読み取りエラー');
  }
  return (data ?? []) as ChatThread[];
}

/** 会話 1 本。**必ず店舗 ID と一緒に確かめる**（他の店舗の会話 ID を指定されても返さない） */
export async function getChatThread(storeId: string, threadId: string): Promise<ChatThread | null> {
  if (!THREAD_ID_PATTERN.test(threadId)) return null;
  if (isLocal()) return readLocal().threads.find((t) => t.id === threadId && t.store_id === storeId) ?? null;
  const { data, error } = await client().from('chat_threads').select('*').eq('id', threadId).eq('store_id', storeId).maybeSingle();
  if (error) {
    if (isMissingChatSchema(error)) return null;
    throw new Error(error.message || '会話の読み取りエラー');
  }
  return (data as ChatThread | null) ?? null;
}

/** DB の id は数値で返るので、文字列にそろえる */
function normalizeMessageRow(m: ChatMessage): ChatMessage {
  return { ...m, id: String(m.id) };
}

/**
 * 会話のメッセージ（古い → 新しい順）。
 * - 指定なし: 新しいほうから limit 通
 * - beforeId: その ID より前の limit 通（さかのぼって読む）
 * - afterId: その ID より後（新着の確認）
 */
export async function listChatMessages(
  storeId: string,
  threadId: string,
  opts: { beforeId?: string | null; afterId?: string | null; limit?: number } = {},
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);
  const before = num(opts.beforeId);
  const after = num(opts.afterId);
  if (isLocal()) {
    const all = readLocal()
      .messages.filter((m) => m.thread_id === threadId && m.store_id === storeId)
      .sort(byCreated);
    if (after !== null) return { messages: all.filter((m) => Number(m.id) > after), hasMore: false };
    const pool = before !== null ? all.filter((m) => Number(m.id) < before) : all;
    return { messages: pool.slice(-limit), hasMore: pool.length > limit };
  }
  if (after !== null) {
    const { data, error } = await client()
      .from('chat_messages')
      .select(MESSAGE_COLUMNS)
      .eq('thread_id', threadId)
      .eq('store_id', storeId)
      .gt('id', after)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message || 'メッセージの読み取りエラー');
    return { messages: ((data ?? []) as ChatMessage[]).map(normalizeMessageRow), hasMore: false };
  }
  let q = client().from('chat_messages').select(MESSAGE_COLUMNS).eq('thread_id', threadId).eq('store_id', storeId);
  if (before !== null) q = q.lt('id', before);
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error(error.message || 'メッセージの読み取りエラー');
  const rows = ((data ?? []) as ChatMessage[]).map(normalizeMessageRow);
  return { messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
}

/** 既読にする（未読の数を 0 に） */
export async function markChatThreadRead(storeId: string, threadId: string): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    const t = data.threads.find((x) => x.id === threadId && x.store_id === storeId);
    if (t && t.unread_count !== 0) {
      t.unread_count = 0;
      writeLocal(data);
    }
    return;
  }
  const { error } = await client().from('chat_threads').update({ unread_count: 0 }).eq('id', threadId).eq('store_id', storeId).gt('unread_count', 0);
  if (error) throw new Error(error.message || '既読の更新エラー');
}

/** 未読の合計（タブのバッジ用）。表が未適用・読み取り失敗は 0 */
export async function countChatUnread(storeId: string): Promise<number> {
  if (isLocal()) return readLocal().threads.filter((t) => t.store_id === storeId).reduce((sum, t) => sum + (t.unread_count || 0), 0);
  try {
    const { data, error } = await client().from('chat_threads').select('unread_count').eq('store_id', storeId).gt('unread_count', 0).limit(1000);
    if (error) return 0;
    return ((data ?? []) as Array<{ unread_count: number }>).reduce((sum, r) => sum + (Number(r.unread_count) || 0), 0);
  } catch {
    return 0;
  }
}

/** 会話に顧客をひも付ける（会話ができたあとで顧客が登録されたとき） */
export async function setChatThreadCustomer(storeId: string, threadId: string, customerId: string): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    const t = data.threads.find((x) => x.id === threadId && x.store_id === storeId);
    if (t) {
      t.customer_id = customerId;
      writeLocal(data);
    }
    return;
  }
  await client().from('chat_threads').update({ customer_id: customerId }).eq('id', threadId).eq('store_id', storeId).is('customer_id', null);
}

export interface ChatCustomerBrief {
  id: string;
  name: string | null;
  line_user_id: string | null;
  line_blocked_at: string | null;
}

const toBrief = (c: Record<string, unknown>): ChatCustomerBrief => ({
  id: String(c.id),
  name: typeof c.name === 'string' ? c.name : null,
  line_user_id: typeof c.line_user_id === 'string' ? c.line_user_id : null,
  line_blocked_at: typeof c.line_blocked_at === 'string' ? c.line_blocked_at : null,
});

/** 会話の相手の顧客（名前・ブロックの有無）。LINE ユーザー ID で探す（登録の古い順） */
export async function findChatCustomers(storeId: string, lineUserIds: string[]): Promise<ChatCustomerBrief[]> {
  const ids = [...new Set(lineUserIds.filter(Boolean))];
  if (ids.length === 0) return [];
  if (isLocal()) {
    try {
      const file = path.join(DATA_DIR, 'customers.json');
      if (!fs.existsSync(file)) return [];
      const rows = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<Record<string, unknown>>;
      return (Array.isArray(rows) ? rows : []).filter((c) => c.store_id === storeId && typeof c.line_user_id === 'string' && ids.includes(c.line_user_id)).map(toBrief);
    } catch {
      return [];
    }
  }
  const out: ChatCustomerBrief[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const query = (columns: string) => client().from('customers').select(columns).eq('store_id', storeId).in('line_user_id', chunk).order('created_at', { ascending: true });
    let res = await query('id, name, line_user_id, line_blocked_at');
    // line_blocked_at 列が未適用の環境では、列なしで取り直す
    if (res.error) res = await query('id, name, line_user_id');
    if (res.error) throw new Error(res.error.message || '顧客の読み取りエラー');
    for (const c of (res.data ?? []) as Array<Record<string, unknown>>) out.push(toBrief(c));
  }
  return out;
}

export interface ChatOutboundInput {
  /** 文字の返信の本文（画像の返信では空） */
  text: string;
  /** 画像の返信: 送る画像の URL（公開）と、置き場の中のパス */
  image?: { url: string; path: string } | null;
  clientKey: string;
  sentBy: string | null;
  sentByName: string | null;
  now?: Date;
}

/**
 * 返信を「送信中」で保存する。同じ送信の ID（client_key）は 1 回だけ:
 * すでにあれば、そのメッセージを created = false で返す（二重に保存しない）
 */
export async function insertChatOutbound(storeId: string, threadId: string, input: ChatOutboundInput): Promise<{ message: ChatMessage; created: boolean }> {
  const at = (input.now ?? new Date()).toISOString();
  const metaBase: Record<string, string> = { ...(input.sentByName ? { sent_by_name: input.sentByName } : {}), ...(input.image ? { image_url: input.image.url } : {}) };
  const meta = Object.keys(metaBase).length > 0 ? metaBase : null;
  const kind = input.image ? 'image' : 'text';
  const text = input.image ? null : input.text;
  const mediaPath = input.image?.path ?? null;
  if (isLocal()) {
    const data = readLocal();
    const existing = data.messages.find((m) => m.store_id === storeId && m.client_key === input.clientKey);
    if (existing) return { message: existing, created: false };
    const nextId = data.messages.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;
    const message: ChatMessage = {
      id: String(nextId),
      thread_id: threadId,
      store_id: storeId,
      direction: 'out',
      kind,
      text,
      meta,
      media_path: mediaPath,
      auto: false,
      auto_kind: null,
      line_message_id: null,
      client_key: input.clientKey,
      send_status: 'sending',
      send_error: null,
      sent_by: input.sentBy,
      created_at: at,
    };
    data.messages.push(message);
    writeLocal(data);
    return { message, created: true };
  }
  const row = { thread_id: threadId, store_id: storeId, direction: 'out', kind, text, meta, media_path: mediaPath, auto: false, client_key: input.clientKey, send_status: 'sending', sent_by: input.sentBy, created_at: at };
  const { data, error } = await client().from('chat_messages').insert(row).select(MESSAGE_COLUMNS).single();
  if (!error && data) return { message: normalizeMessageRow(data as ChatMessage), created: true };
  if (error?.code === '23505') {
    const found = await client().from('chat_messages').select(MESSAGE_COLUMNS).eq('store_id', storeId).eq('client_key', input.clientKey).maybeSingle();
    if (found.data) return { message: normalizeMessageRow(found.data as ChatMessage), created: false };
  }
  throw new Error(error?.message || '返信の保存エラー');
}

/** 返信の送信結果を書く（sending → sent / failed。もう一度送るときは sending に戻す） */
export async function updateChatOutboundStatus(storeId: string, messageId: string, status: 'sending' | 'sent' | 'failed', sendError: string | null = null): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    const m = data.messages.find((x) => x.id === messageId && x.store_id === storeId);
    if (m) {
      m.send_status = status;
      m.send_error = sendError;
      writeLocal(data);
    }
    return;
  }
  const { error } = await client().from('chat_messages').update({ send_status: status, send_error: sendError }).eq('id', Number(messageId)).eq('store_id', storeId);
  if (error) throw new Error(error.message || '送信結果の保存エラー');
}

/** 返信を送ったあと: 一覧の 1 行と日時を更新し、未読を 0 にする（返信した = 読んだ） */
export async function touchChatThreadAfterReply(storeId: string, threadId: string, at: string, preview: string): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    const t = data.threads.find((x) => x.id === threadId && x.store_id === storeId);
    if (t) {
      if (at >= t.last_message_at) {
        t.last_message_at = at;
        t.last_message_preview = preview;
      }
      t.unread_count = 0;
      t.updated_at = new Date().toISOString();
      writeLocal(data);
    }
    return;
  }
  const c = client();
  await c.from('chat_threads').update({ unread_count: 0, updated_at: new Date().toISOString() }).eq('id', threadId).eq('store_id', storeId);
  // 送っているあいだに新しいメッセージが届いていたら、一覧の 1 行はそちらを残す
  await c.from('chat_threads').update({ last_message_at: at, last_message_preview: preview }).eq('id', threadId).eq('store_id', storeId).lte('last_message_at', at);
}

// ---------------------------------------------------------------------------
// ④-3: 新着の通知・自動削除
// ---------------------------------------------------------------------------

/** 列が無い（④-3 のマイグレーション未適用）ときのエラーか */
function isMissingNotifyColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return (error.message || '').toLowerCase().includes('notify_');
}

/** 通知の設定を保存する。失敗時はエラーメッセージ（日本語）を投げる */
export async function saveChatNotifySettings(storeId: string, value: ChatNotifySettings, now: Date = new Date()): Promise<ChatNotifySettings> {
  const row = { ...chatNotifySettingsToRow(value), updated_at: now.toISOString() };
  if (isLocal()) {
    const data = readLocal();
    const existing = data.settings.find((s) => s.store_id === storeId);
    const base = existing ?? { store_id: storeId, ...CHAT_DEFAULT_SETTINGS };
    data.settings = [...data.settings.filter((s) => s.store_id !== storeId), { ...base, ...row } as LocalData['settings'][number]];
    writeLocal(data);
    return value;
  }
  // 行が無い店舗（トーク機能を一度も ON にしていない）でも保存できるように upsert（enabled は既定の OFF のまま）
  const { error } = await client()
    .from('chat_settings')
    .upsert({ store_id: storeId, ...row }, { onConflict: 'store_id' });
  if (error) {
    if (isMissingChatSchema(error) || isMissingNotifyColumn(error)) throw new Error('データベースの更新（マイグレーション）がまだ適用されていません');
    console.error('[chat] 通知の設定の保存エラー:', error.message);
    throw new Error('通知の設定の保存に失敗しました');
  }
  return value;
}

/**
 * 保存したメッセージ（LINE 側の ID）のうち、通知の対象（お客様が手で書いた文・画像など = 自動の印が無いもの）がある会話の ID。
 * 「フォームの送信文に続けて届いた文」の印は保存のときに DB が付けるので、保存したあとに読み直す
 */
export async function listChatThreadsToNotify(storeId: string, lineMessageIds: string[]): Promise<string[]> {
  const ids = [...new Set(lineMessageIds.filter(Boolean))];
  if (ids.length === 0) return [];
  if (isLocal()) {
    return [...new Set(readLocal().messages.filter((m) => m.store_id === storeId && m.direction === 'in' && !m.auto && m.line_message_id && ids.includes(m.line_message_id)).map((m) => m.thread_id))];
  }
  const { data, error } = await client().from('chat_messages').select('thread_id').eq('store_id', storeId).eq('direction', 'in').eq('auto', false).in('line_message_id', ids);
  if (error) throw new Error(error.message || 'メッセージの読み取りエラー');
  return [...new Set(((data ?? []) as Array<{ thread_id: string }>).map((r) => r.thread_id))];
}

/**
 * その会話の通知を確保する。true = いま通知してよい（通知の日時を書き換えた）。
 * 前の通知から 10 分たっていない・未読が無い・同時に別の処理が確保した ときは false（通知を二重に送らない）
 */
export async function claimChatNotification(storeId: string, threadId: string, now: Date = new Date()): Promise<boolean> {
  if (isLocal()) {
    const data = readLocal();
    const t = data.threads.find((x) => x.id === threadId && x.store_id === storeId);
    if (!t || t.unread_count <= 0 || !canNotifyChatThread(t.notified_at, now)) return false;
    t.notified_at = now.toISOString();
    writeLocal(data);
    return true;
  }
  const { data, error } = await client().rpc('chat_claim_notification', { p_store_id: storeId, p_thread_id: threadId, p_now: now.toISOString(), p_interval_seconds: Math.round(CHAT_NOTIFY_INTERVAL_MS / 1000) });
  if (error) {
    // 関数が無い（マイグレーション未適用）ときは通知しない
    if (!isMissingChatSchema(error)) console.error('[chat] 通知の確保エラー:', error.message);
    return false;
  }
  return data === true;
}

export interface ChatPurgeResult {
  messages: number;
  threads: number;
  /** まだ消すものが残っているか（1 回の上限に達した） */
  remaining: boolean;
}

/**
 * 保存期間を過ぎたメッセージを消す（1 回に limit 通まで。古い順）。
 * 画像を持つメッセージ（media_path あり）は消さない（画像のファイルを先に消す必要がある。④-4 で対応）。
 * メッセージが無くなり、最後のメッセージも保存期間より前の会話は、会話ごと消す。
 * Supabase では DB 関数 chat_purge_expired が行う。local は同じ手順を JSON の中で行う（**直すときは両方**）
 */
export async function purgeExpiredChat(now: Date, limit: number = CHAT_RETENTION_BATCH): Promise<ChatPurgeResult> {
  if (!isLocal()) {
    const { data, error } = await client().rpc('chat_purge_expired', { p_now: now.toISOString(), p_limit: limit });
    if (error) {
      if (isMissingChatSchema(error)) return { messages: 0, threads: 0, remaining: false };
      throw new Error(error.message || '自動削除のエラー');
    }
    const r = (data ?? {}) as Record<string, unknown>;
    return { messages: Number(r.messages) || 0, threads: Number(r.threads) || 0, remaining: r.remaining === true };
  }
  const data = readLocal();
  const cutoffByStore = new Map<string, string>();
  for (const s of data.settings) cutoffByStore.set(s.store_id, chatRetentionCutoff(normalizeChatSettings(s).retention_years, now));
  const expired = (m: ChatMessage) => {
    const cutoff = cutoffByStore.get(m.store_id);
    return !!cutoff && m.created_at < cutoff && !m.media_path;
  };
  const victims = data.messages
    .filter(expired)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .slice(0, Math.max(limit, 0));
  const victimIds = new Set(victims.map((m) => m.id));
  data.messages = data.messages.filter((m) => !victimIds.has(m.id));
  const before = data.threads.length;
  data.threads = data.threads.filter((t) => {
    const cutoff = cutoffByStore.get(t.store_id);
    return !(cutoff && t.last_message_at < cutoff && !data.messages.some((m) => m.thread_id === t.id));
  });
  const result = { messages: victims.length, threads: before - data.threads.length, remaining: data.messages.some(expired) };
  if (result.messages > 0 || result.threads > 0) writeLocal(data);
  return result;
}

// ---------------------------------------------------------------------------
// ④-4: 画像・定型文・対応済みの切り替え
// ---------------------------------------------------------------------------

/** メッセージ 1 通。**必ず店舗 ID と一緒に確かめる** */
export async function getChatMessage(storeId: string, messageId: string): Promise<ChatMessage | null> {
  if (!/^\d+$/.test(messageId)) return null;
  if (isLocal()) return readLocal().messages.find((m) => m.id === messageId && m.store_id === storeId) ?? null;
  const { data, error } = await client().from('chat_messages').select(MESSAGE_COLUMNS).eq('id', Number(messageId)).eq('store_id', storeId).maybeSingle();
  if (error) {
    if (isMissingChatSchema(error)) return null;
    throw new Error(error.message || 'メッセージの読み取りエラー');
  }
  return data ? normalizeMessageRow(data as ChatMessage) : null;
}

/** LINE 側の ID からメッセージを探す（届いた画像の中身を保存するとき） */
export async function findChatMessageByLineId(storeId: string, lineMessageId: string): Promise<ChatMessage | null> {
  if (isLocal()) return readLocal().messages.find((m) => m.store_id === storeId && m.line_message_id === lineMessageId) ?? null;
  const { data, error } = await client().from('chat_messages').select(MESSAGE_COLUMNS).eq('store_id', storeId).eq('line_message_id', lineMessageId).maybeSingle();
  if (error) throw new Error(error.message || 'メッセージの読み取りエラー');
  return data ? normalizeMessageRow(data as ChatMessage) : null;
}

/** メッセージの画像の場所と、小さな情報（meta）を書き換える */
export async function setChatMessageMedia(storeId: string, messageId: string, patch: { media_path: string | null; meta: Record<string, string> | null }): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    const m = data.messages.find((x) => x.id === messageId && x.store_id === storeId);
    if (m) {
      m.media_path = patch.media_path;
      m.meta = patch.meta;
      writeLocal(data);
    }
    return;
  }
  const { error } = await client().from('chat_messages').update({ media_path: patch.media_path, meta: patch.meta }).eq('id', Number(messageId)).eq('store_id', storeId);
  if (error) throw new Error(error.message || '画像の記録エラー');
}

/** 対応中 / 対応済み を切り替える。会話が無ければ false */
export async function setChatThreadStatus(storeId: string, threadId: string, status: ChatThreadStatus): Promise<boolean> {
  if (!THREAD_ID_PATTERN.test(threadId)) return false;
  if (isLocal()) {
    const data = readLocal();
    const t = data.threads.find((x) => x.id === threadId && x.store_id === storeId);
    if (!t) return false;
    t.status = status;
    t.updated_at = new Date().toISOString();
    writeLocal(data);
    return true;
  }
  const { data, error } = await client().from('chat_threads').update({ status, updated_at: new Date().toISOString() }).eq('id', threadId).eq('store_id', storeId).select('id');
  if (error) throw new Error(error.message || '対応の状態の保存エラー');
  return Array.isArray(data) && data.length > 0;
}

/** 定型文を保存する。失敗時はエラーメッセージ（日本語）を投げる */
export async function saveChatTemplates(storeId: string, templates: ChatReplyTemplate[], now: Date = new Date()): Promise<ChatReplyTemplate[]> {
  const row = { reply_templates: templates, updated_at: now.toISOString() };
  if (isLocal()) {
    const data = readLocal();
    const existing = data.settings.find((s) => s.store_id === storeId);
    const base = existing ?? { store_id: storeId, ...CHAT_DEFAULT_SETTINGS };
    data.settings = [...data.settings.filter((s) => s.store_id !== storeId), { ...base, ...row } as LocalData['settings'][number]];
    writeLocal(data);
    return templates;
  }
  const { error } = await client()
    .from('chat_settings')
    .upsert({ store_id: storeId, ...row }, { onConflict: 'store_id' });
  if (error) {
    if (isMissingChatSchema(error) || error.code === '42703' || error.code === 'PGRST204' || (error.message || '').includes('reply_templates')) throw new Error('データベースの更新（マイグレーション）がまだ適用されていません');
    console.error('[chat] 定型文の保存エラー:', error.message);
    throw new Error('定型文の保存に失敗しました');
  }
  return templates;
}

export interface ChatExpiredMedia {
  id: string;
  store_id: string;
  direction: 'in' | 'out' | 'system';
  media_path: string;
}

/**
 * 保存期間を過ぎたメッセージのうち、画像を持つもの（古い順に limit 通まで）。
 * 自動削除は、先にこの画像のファイルを消してから、行を消す（行を先に消すと、画像の場所が分からなくなって画像だけ残る）
 */
export async function listExpiredChatMedia(now: Date, limit = 200): Promise<ChatExpiredMedia[]> {
  if (isLocal()) {
    const data = readLocal();
    const cutoffByStore = new Map<string, string>();
    for (const s of data.settings) cutoffByStore.set(s.store_id, chatRetentionCutoff(normalizeChatSettings(s).retention_years, now));
    return data.messages
      .filter((m) => !!m.media_path && !!cutoffByStore.get(m.store_id) && m.created_at < (cutoffByStore.get(m.store_id) as string))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .slice(0, limit)
      .map((m) => ({ id: m.id, store_id: m.store_id, direction: m.direction, media_path: m.media_path as string }));
  }
  const c = client();
  const settings = await c.from('chat_settings').select('store_id, retention_years');
  if (settings.error) {
    if (isMissingChatSchema(settings.error)) return [];
    throw new Error(settings.error.message || '設定の読み取りエラー');
  }
  const out: ChatExpiredMedia[] = [];
  for (const s of (settings.data ?? []) as Array<{ store_id: string; retention_years: number }>) {
    if (out.length >= limit) break;
    const cutoff = chatRetentionCutoff(normalizeChatSettings(s).retention_years, now);
    const { data, error } = await c
      .from('chat_messages')
      .select('id, store_id, direction, media_path')
      .eq('store_id', s.store_id)
      .lt('created_at', cutoff)
      .not('media_path', 'is', null)
      .order('created_at', { ascending: true })
      .limit(limit - out.length);
    if (error) throw new Error(error.message || 'メッセージの読み取りエラー');
    for (const m of (data ?? []) as Array<Record<string, unknown>>) out.push({ id: String(m.id), store_id: String(m.store_id), direction: m.direction as ChatExpiredMedia['direction'], media_path: String(m.media_path) });
  }
  return out;
}

/** 画像のファイルを消したメッセージの、画像の場所を空にする（このあと行を消せるようになる） */
export async function clearChatMessageMedia(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (isLocal()) {
    const data = readLocal();
    const set = new Set(ids);
    for (const m of data.messages) if (set.has(m.id)) m.media_path = null;
    writeLocal(data);
    return;
  }
  const { error } = await client()
    .from('chat_messages')
    .update({ media_path: null })
    .in(
      'id',
      ids.map((id) => Number(id)),
    );
  if (error) throw new Error(error.message || '画像の記録エラー');
}

// ---------------------------------------------------------------------------
// ④-5: 自動で送ったメッセージを会話に出す・利用量の記録
// ---------------------------------------------------------------------------

/**
 * 自動で送ったメッセージを、会話に 1 行で残す。戻り値 = 記録した件数。
 * - トーク機能が ON の店舗・すでに会話のあるお客様だけ（無ければ何もしない。会話は作らない）
 * - 同じ送信（source_key）は 1 回だけ
 * - 未読・一覧の 1 行・並び順は変えない
 * Supabase では DB 関数 chat_record_system_events が行う。local は同じ手順を JSON の中で行う（**直すときは両方**）。
 * 関数が無い（マイグレーション未適用）ときは 0
 */
export async function recordChatSystemEvents(storeId: string, events: ChatSystemEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  if (!isLocal()) {
    const { data, error } = await client().rpc('chat_record_system_events', { p_store_id: storeId, p_events: events });
    if (error) {
      if (isMissingChatSchema(error)) return 0;
      throw new Error(error.message || '自動の記録エラー');
    }
    return Number(data) || 0;
  }
  const data = readLocal();
  if (!data.settings.some((s) => s.store_id === storeId && normalizeChatSettings(s).enabled)) return 0;
  let added = 0;
  for (const e of events) {
    const thread = data.threads.find((t) => t.store_id === storeId && t.line_user_id === e.line_user_id);
    if (!thread || !e.text || !e.source_key) continue;
    if (data.messages.some((m) => m.store_id === storeId && m.client_key === e.source_key)) continue;
    const nextId = data.messages.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;
    data.messages.push({
      id: String(nextId),
      thread_id: thread.id,
      store_id: storeId,
      direction: 'system',
      kind: 'text',
      text: e.text.slice(0, 300),
      meta: { event: e.kind },
      media_path: null,
      auto: true,
      auto_kind: 'system',
      line_message_id: null,
      client_key: e.source_key,
      send_status: null,
      send_error: null,
      sent_by: null,
      created_at: e.at,
    });
    added += 1;
  }
  if (added > 0) writeLocal(data);
  return added;
}

/** 利用量を足す（月 = 日本時間の YYYY-MM）。表・関数が無い（マイグレーション未適用）ときは何もしない */
export async function addChatUsage(storeId: string, month: string, delta: Partial<ChatUsageCounts>): Promise<void> {
  const inbound = Math.max(0, Math.round(delta.inbound ?? 0));
  const outbound = Math.max(0, Math.round(delta.outbound ?? 0));
  const imageBytes = Math.max(0, Math.round(delta.image_bytes ?? 0));
  if (inbound + outbound + imageBytes === 0) return;
  if (isLocal()) {
    const data = readLocal();
    const usage = (data.usage ??= []);
    let row = usage.find((u) => u.store_id === storeId && u.month === month);
    if (!row) {
      row = { store_id: storeId, month, inbound_count: 0, outbound_count: 0, image_bytes: 0 };
      usage.push(row);
    }
    row.inbound_count += inbound;
    row.outbound_count += outbound;
    row.image_bytes += imageBytes;
    writeLocal(data);
    return;
  }
  const { error } = await client().rpc('chat_add_usage', { p_store_id: storeId, p_month: month, p_inbound: inbound, p_outbound: outbound, p_image_bytes: imageBytes });
  if (error && !isMissingChatSchema(error)) throw new Error(error.message || '利用量の記録エラー');
}

export interface ChatUsageSource {
  /** トークの設定がある店舗（一度でも ON にした・通知や定型文を保存した店舗） */
  settings: Array<{ store_id: string; enabled: boolean; enabled_at: string | null }>;
  /** 指定した月の利用量 */
  usage: Array<{ store_id: string; month: string } & ChatUsageCounts>;
  /** 店舗 ID → 店舗名 */
  storeNames: Record<string, string>;
  /** 利用量の表が無い（④-5 のマイグレーション未適用） */
  missing: boolean;
}

/** 全店舗の利用状況のもとになるデータ（運営の一覧用）。months = 読む月（YYYY-MM） */
export async function loadChatUsageSource(months: string[]): Promise<ChatUsageSource> {
  if (isLocal()) {
    const data = readLocal();
    let stores: Array<{ id?: string; name?: string }> = [];
    try {
      const file = path.join(DATA_DIR, 'stores.json');
      if (fs.existsSync(file)) stores = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {}
    return {
      settings: data.settings.map((s) => ({ store_id: s.store_id, enabled: normalizeChatSettings(s).enabled, enabled_at: normalizeChatSettings(s).enabled_at })),
      usage: (data.usage ?? []).filter((u) => months.includes(u.month)).map((u) => ({ store_id: u.store_id, month: u.month, inbound: u.inbound_count, outbound: u.outbound_count, image_bytes: u.image_bytes })),
      storeNames: Object.fromEntries((Array.isArray(stores) ? stores : []).filter((s) => s.id).map((s) => [String(s.id), s.name || String(s.id)])),
      missing: false,
    };
  }
  const c = client();
  const settingsRes = await c.from('chat_settings').select('store_id, enabled, enabled_at').limit(5000);
  if (settingsRes.error) {
    if (isMissingChatSchema(settingsRes.error)) return { settings: [], usage: [], storeNames: {}, missing: true };
    throw new Error(settingsRes.error.message || '設定の読み取りエラー');
  }
  const usageRes = await c.from('chat_usage_monthly').select('store_id, month, inbound_count, outbound_count, image_bytes').in('month', months).limit(10000);
  const missing = !!usageRes.error && isMissingChatSchema(usageRes.error);
  if (usageRes.error && !missing) throw new Error(usageRes.error.message || '利用量の読み取りエラー');
  const settings = ((settingsRes.data ?? []) as Array<Record<string, unknown>>).map((s) => ({ store_id: String(s.store_id), enabled: s.enabled === true, enabled_at: typeof s.enabled_at === 'string' ? s.enabled_at : null }));
  const usage = ((usageRes.data ?? []) as Array<Record<string, unknown>>).map((u) => ({
    store_id: String(u.store_id),
    month: String(u.month),
    inbound: Number(u.inbound_count) || 0,
    outbound: Number(u.outbound_count) || 0,
    image_bytes: Number(u.image_bytes) || 0,
  }));
  const ids = [...new Set([...settings.map((s) => s.store_id), ...usage.map((u) => u.store_id)])];
  const storeNames: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await c
      .from('stores')
      .select('id, name')
      .in('id', ids.slice(i, i + 200));
    for (const s of (data ?? []) as Array<{ id: string; name: string | null }>) storeNames[s.id] = s.name || s.id;
  }
  return { settings, usage, storeNames, missing };
}

// ---------------------------------------------------------------------------
// 会話を消す（お客様から削除を求められたとき。運営だけ）
// ---------------------------------------------------------------------------

/** その会話の、画像を持つメッセージ（会話を消す前に、画像のファイルを消すために読む） */
export async function listChatThreadMedia(storeId: string, threadId: string): Promise<Array<{ direction: 'in' | 'out' | 'system'; media_path: string }>> {
  if (isLocal()) {
    return readLocal()
      .messages.filter((m) => m.store_id === storeId && m.thread_id === threadId && !!m.media_path)
      .map((m) => ({ direction: m.direction, media_path: m.media_path as string }));
  }
  const { data, error } = await client().from('chat_messages').select('direction, media_path').eq('store_id', storeId).eq('thread_id', threadId).not('media_path', 'is', null).limit(10000);
  if (error) throw new Error(error.message || 'メッセージの読み取りエラー');
  return ((data ?? []) as Array<{ direction: 'in' | 'out' | 'system'; media_path: string }>).filter((m) => !!m.media_path);
}

/**
 * 会話 1 本と、そのメッセージをすべて消す。**必ず店舗 ID と一緒に確かめる**。
 * 戻り値 = 消したメッセージの数（会話が無ければ null）。画像のファイルは、呼び出し側が先に消しておく
 */
export async function deleteChatThreadRows(storeId: string, threadId: string): Promise<{ messages: number } | null> {
  if (!THREAD_ID_PATTERN.test(threadId)) return null;
  if (isLocal()) {
    const data = readLocal();
    if (!data.threads.some((t) => t.id === threadId && t.store_id === storeId)) return null;
    const before = data.messages.length;
    data.messages = data.messages.filter((m) => !(m.thread_id === threadId && m.store_id === storeId));
    data.threads = data.threads.filter((t) => !(t.id === threadId && t.store_id === storeId));
    writeLocal(data);
    return { messages: before - data.messages.length };
  }
  const c = client();
  const counted = await c.from('chat_messages').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('thread_id', threadId);
  // メッセージは、会話を消すと一緒に消える（外部キーの ON DELETE CASCADE）
  const { data, error } = await c.from('chat_threads').delete().eq('id', threadId).eq('store_id', storeId).select('id');
  if (error) throw new Error(error.message || '会話の削除エラー');
  if (!Array.isArray(data) || data.length === 0) return null;
  return { messages: counted.count ?? 0 };
}
