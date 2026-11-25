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
import {
  CHAT_DEFAULT_SETTINGS,
  buildChatPreview,
  isFormFollowUp,
  normalizeChatSettings,
  type ChatAutoKind,
  type ChatInbound,
  type ChatMessage,
  type ChatRetentionYears,
  type ChatSettings,
  type ChatStats,
  type ChatThread,
} from '@/lib/chat';

const DATA_DIR = path.join(process.cwd(), 'data');
const localFile = () => path.join(DATA_DIR, 'chat.json');
const isLocal = () => getAppEnvironment() === 'local';

interface LocalData {
  settings: Array<ChatSettings & { store_id: string }>;
  threads: ChatThread[];
  messages: ChatMessage[];
}

function readLocal(): LocalData {
  try {
    if (!fs.existsSync(localFile())) return { settings: [], threads: [], messages: [] };
    const d = JSON.parse(fs.readFileSync(localFile(), 'utf-8')) as Partial<LocalData>;
    return { settings: Array.isArray(d.settings) ? d.settings : [], threads: Array.isArray(d.threads) ? d.threads : [], messages: Array.isArray(d.messages) ? d.messages : [] };
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

export type ChatSettingsState = { settings: ChatSettings; missing: boolean };

/** 設定を読む。行が無い店舗・表が未適用の環境は OFF。読み取りに失敗したときも OFF（保存しない側に倒す） */
export async function getChatSettings(storeId: string): Promise<ChatSettingsState> {
  if (isLocal()) {
    const row = readLocal().settings.find((s) => s.store_id === storeId);
    return { settings: row ? normalizeChatSettings(row) : { ...CHAT_DEFAULT_SETTINGS }, missing: false };
  }
  try {
    const { data, error } = await client().from('chat_settings').select('enabled, retention_years, enabled_at, updated_at').eq('store_id', storeId).maybeSingle();
    if (error) {
      if (!isMissingChatSchema(error)) console.error('[chat] 設定の読み取りエラー:', error.message);
      return { settings: { ...CHAT_DEFAULT_SETTINGS }, missing: isMissingChatSchema(error) };
    }
    return { settings: normalizeChatSettings(data), missing: false };
  } catch (e) {
    console.error('[chat] 設定の読み取りエラー:', e);
    return { settings: { ...CHAT_DEFAULT_SETTINGS }, missing: false };
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
    data.settings = [...data.settings.filter((s) => s.store_id !== storeId), row];
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
  text: string;
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
  const meta = input.sentByName ? { sent_by_name: input.sentByName } : null;
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
      kind: 'text',
      text: input.text,
      meta,
      media_path: null,
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
  const row = { thread_id: threadId, store_id: storeId, direction: 'out', kind: 'text', text: input.text, meta, auto: false, client_key: input.clientKey, send_status: 'sending', sent_by: input.sentBy, created_at: at };
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
