/**
 * 空き待ち（キャンセル待ち）の保存先 — サーバー専用（fs / Supabase に依存）
 * local 環境は data/waitlist.json、それ以外は waitlist_entries / waitlist_notifications。
 *
 * マイグレーション未適用の環境でも予約・キャンセルの処理を止めないよう、
 * 読み取りは失敗したら「空き待ちなし」を返す
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { WAITLIST_ACTIVE_STATUSES, type WaitlistEntry, type WaitlistNotificationType, type WaitlistStatus } from '@/lib/waitlist';

export interface WaitlistNotification {
  id: string;
  waitlist_entry_id: string;
  store_id: string;
  type: WaitlistNotificationType;
  slot_start_at: string | null;
  sent_at: string;
  result: 'success' | 'failed';
  error_message: string | null;
}

export type NewWaitlistEntry = Omit<WaitlistEntry, 'id' | 'status' | 'notified_at' | 'notify_count' | 'fail_count' | 'created_at' | 'updated_at'>;

interface LocalData {
  entries: WaitlistEntry[];
  notifications: WaitlistNotification[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'waitlist.json');

const isLocal = () => getAppEnvironment() === 'local';

function readLocal(): LocalData {
  try {
    if (!fs.existsSync(FILE)) return { entries: [], notifications: [] };
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return {
      entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
      notifications: Array.isArray(parsed?.notifications) ? parsed.notifications : [],
    };
  } catch {
    return { entries: [], notifications: [] };
  }
}

function writeLocal(data: LocalData) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function admin(): any | null {
  return createAdminClient() as any;
}

function normalizeRow(row: any): WaitlistEntry {
  return {
    ...row,
    reservation_date: String(row.reservation_date).slice(0, 10),
    reservation_time: String(row.reservation_time || '').slice(0, 5),
    duration_minutes: Number(row.duration_minutes) || 0,
    selected_menus: Array.isArray(row.selected_menus) ? row.selected_menus : [],
    selected_options: Array.isArray(row.selected_options) ? row.selected_options : [],
    notify_count: Number(row.notify_count) || 0,
    fail_count: Number(row.fail_count) || 0,
  };
}

const isActive = (e: WaitlistEntry) => WAITLIST_ACTIVE_STATUSES.includes(e.status);
const byDateTime = (a: WaitlistEntry, b: WaitlistEntry) =>
  `${a.reservation_date} ${a.reservation_time}`.localeCompare(`${b.reservation_date} ${b.reservation_time}`) || a.created_at.localeCompare(b.created_at);

/** その人の、いま有効な空き待ち（店舗内。希望日時の早い順） */
export async function listActiveWaitlistForUser(storeId: string, lineUserId: string): Promise<WaitlistEntry[]> {
  if (!storeId || !lineUserId) return [];
  if (isLocal()) {
    return readLocal().entries.filter((e) => e.store_id === storeId && e.line_user_id === lineUserId && isActive(e)).sort(byDateTime);
  }
  try {
    const client = admin();
    if (!client) return [];
    const { data, error } = await client
      .from('waitlist_entries')
      .select('*')
      .eq('store_id', storeId)
      .eq('line_user_id', lineUserId)
      .in('status', WAITLIST_ACTIVE_STATUSES)
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });
    if (error) return [];
    return (data || []).map(normalizeRow);
  } catch {
    return [];
  }
}

/** 見回りの対象（有効な空き待ち。storeId 省略 = 全店舗）。登録の早い順 */
export async function listActiveWaitlist(storeId?: string | null, limit = 1000): Promise<WaitlistEntry[]> {
  if (isLocal()) {
    return readLocal()
      .entries.filter((e) => isActive(e) && (!storeId || e.store_id === storeId))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit);
  }
  try {
    const client = admin();
    if (!client) return [];
    let q = client.from('waitlist_entries').select('*').in('status', WAITLIST_ACTIVE_STATUSES);
    if (storeId) q = q.eq('store_id', storeId);
    const { data, error } = await q.order('created_at', { ascending: true }).limit(limit);
    if (error) return [];
    return (data || []).map(normalizeRow);
  } catch {
    return [];
  }
}

/** 店舗に有効な空き待ちがあるか（予約・キャンセルのたびに呼ぶので軽く） */
export async function hasActiveWaitlist(storeId: string): Promise<boolean> {
  if (!storeId) return false;
  if (isLocal()) return readLocal().entries.some((e) => e.store_id === storeId && isActive(e));
  try {
    const client = admin();
    if (!client) return false;
    const { data, error } = await client.from('waitlist_entries').select('id').eq('store_id', storeId).in('status', WAITLIST_ACTIVE_STATUSES).limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

export async function getWaitlistEntry(id: string): Promise<WaitlistEntry | null> {
  if (!id) return null;
  if (isLocal()) return readLocal().entries.find((e) => e.id === id) || null;
  try {
    const client = admin();
    if (!client) return null;
    const { data, error } = await client.from('waitlist_entries').select('*').eq('id', id).maybeSingle();
    return error || !data ? null : normalizeRow(data);
  } catch {
    return null;
  }
}

/** 管理画面の一覧（新しい登録順） */
export async function listWaitlistForStore(storeId: string, opts: { statuses?: WaitlistStatus[]; limit?: number } = {}): Promise<WaitlistEntry[]> {
  const limit = opts.limit ?? 200;
  if (isLocal()) {
    return readLocal()
      .entries.filter((e) => e.store_id === storeId && (!opts.statuses || opts.statuses.includes(e.status)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const client = admin();
  if (!client) throw new Error('Supabase 接続エラー');
  let q = client.from('waitlist_entries').select('*').eq('store_id', storeId);
  if (opts.statuses && opts.statuses.length > 0) q = q.in('status', opts.statuses);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message || '空き待ちの取得に失敗しました');
  return (data || []).map(normalizeRow);
}

/** 登録する。同じ条件の有効な空き待ちがすでにあれば 'duplicate' */
export async function insertWaitlistEntry(input: NewWaitlistEntry): Promise<WaitlistEntry | 'duplicate'> {
  const now = new Date().toISOString();
  if (isLocal()) {
    const data = readLocal();
    const dup = data.entries.some(
      (e) =>
        isActive(e) &&
        e.store_id === input.store_id &&
        e.form_id === input.form_id &&
        e.line_user_id === input.line_user_id &&
        e.reservation_date === input.reservation_date &&
        e.reservation_time === input.reservation_time &&
        (e.staff_id || null) === (input.staff_id || null)
    );
    if (dup) return 'duplicate';
    const entry: WaitlistEntry = { ...input, id: randomUUID(), status: 'waiting', notified_at: null, notify_count: 0, fail_count: 0, created_at: now, updated_at: now };
    data.entries.push(entry);
    writeLocal(data);
    return entry;
  }
  const client = admin();
  if (!client) throw new Error('Supabase 接続エラー');
  const { data, error } = await client.from('waitlist_entries').insert({ ...input, status: 'waiting' }).select().single();
  if (error) {
    if (error.code === '23505') return 'duplicate';
    throw new Error(error.message || '空き待ちの登録に失敗しました');
  }
  return normalizeRow(data);
}

/**
 * 状態を変える。`from` のどれかの状態のときだけ書き換え、書き換えたら true。
 * （見回りが同時に 2 つ動いても、お知らせ・おわびを 1 回しか送らないための「先に確保する」更新）
 */
export async function transitionWaitlistEntry(id: string, from: WaitlistStatus[], patch: Partial<WaitlistEntry>): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  if (isLocal()) {
    const data = readLocal();
    const i = data.entries.findIndex((e) => e.id === id && from.includes(e.status));
    if (i < 0) return false;
    data.entries[i] = { ...data.entries[i], ...patch, updated_at: updatedAt };
    writeLocal(data);
    return true;
  }
  try {
    const client = admin();
    if (!client) return false;
    const { data, error } = await client.from('waitlist_entries').update({ ...patch, updated_at: updatedAt }).eq('id', id).in('status', from).select('id');
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** その人の、その日時の空き待ちを「予約済み」にする（予約が取れたとき）。変えた件数を返す */
export async function fulfillWaitlistForSlot(storeId: string, lineUserId: string, date: string, time: string): Promise<number> {
  if (!storeId || !lineUserId || !date || !time) return 0;
  const t = String(time).slice(0, 5);
  const updatedAt = new Date().toISOString();
  if (isLocal()) {
    const data = readLocal();
    let n = 0;
    data.entries = data.entries.map((e) => {
      if (e.store_id === storeId && e.line_user_id === lineUserId && e.reservation_date === date && e.reservation_time === t && isActive(e)) {
        n++;
        return { ...e, status: 'fulfilled' as const, updated_at: updatedAt };
      }
      return e;
    });
    if (n > 0) writeLocal(data);
    return n;
  }
  try {
    const client = admin();
    if (!client) return 0;
    const { data, error } = await client
      .from('waitlist_entries')
      .update({ status: 'fulfilled', updated_at: updatedAt })
      .eq('store_id', storeId)
      .eq('line_user_id', lineUserId)
      .eq('reservation_date', date)
      .eq('reservation_time', t)
      .in('status', WAITLIST_ACTIVE_STATUSES)
      .select('id');
    return error || !Array.isArray(data) ? 0 : data.length;
  } catch {
    return 0;
  }
}

/** 送信履歴（新しい順）。どの空き待ちへの通知かが分かるよう、お客様名と希望日時を添える */
export interface WaitlistNotificationRow extends WaitlistNotification {
  customer_name: string | null;
  reservation_date: string | null;
  reservation_time: string | null;
}

export async function listWaitlistNotifications(storeId: string, limit = 100): Promise<WaitlistNotificationRow[]> {
  const attach = (n: WaitlistNotification, e: WaitlistEntry | undefined): WaitlistNotificationRow => ({
    ...n,
    customer_name: e?.customer_name ?? null,
    reservation_date: e?.reservation_date ?? null,
    reservation_time: e?.reservation_time ?? null,
  });
  if (isLocal()) {
    const data = readLocal();
    const byId = new Map(data.entries.map((e) => [e.id, e]));
    return data.notifications
      .filter((n) => n.store_id === storeId)
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
      .slice(0, limit)
      .map((n) => attach(n, byId.get(n.waitlist_entry_id)));
  }
  const client = admin();
  if (!client) throw new Error('Supabase 接続エラー');
  const { data, error } = await client.from('waitlist_notifications').select('*').eq('store_id', storeId).order('sent_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message || '送信履歴の取得に失敗しました');
  const rows: WaitlistNotification[] = data || [];
  const ids = [...new Set(rows.map((n) => n.waitlist_entry_id))];
  const byId = new Map<string, WaitlistEntry>();
  if (ids.length > 0) {
    const { data: entries } = await client.from('waitlist_entries').select('*').in('id', ids);
    (entries || []).forEach((e: any) => byId.set(e.id, normalizeRow(e)));
  }
  return rows.map((n) => attach(n, byId.get(n.waitlist_entry_id)));
}

/** 期間内（sent_at が from 以上 to 未満）の送信数。空き待ちのお知らせ・おわびで使った通数の目安 */
export async function countWaitlistNotifications(storeId: string, fromIso: string, toIso: string): Promise<{ sent: number; failed: number }> {
  if (isLocal()) {
    const list = readLocal().notifications.filter((n) => n.store_id === storeId && n.sent_at >= fromIso && n.sent_at < toIso);
    return { sent: list.filter((n) => n.result === 'success').length, failed: list.filter((n) => n.result === 'failed').length };
  }
  try {
    const client = admin();
    if (!client) return { sent: 0, failed: 0 };
    const count = async (result: 'success' | 'failed') => {
      const { count: n, error } = await client
        .from('waitlist_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', storeId)
        .eq('result', result)
        .gte('sent_at', fromIso)
        .lt('sent_at', toIso);
      return error ? 0 : n || 0;
    };
    const [sent, failed] = await Promise.all([count('success'), count('failed')]);
    return { sent, failed };
  } catch {
    return { sent: 0, failed: 0 };
  }
}

/** 通知の記録（失敗しても処理は続ける） */
export async function recordWaitlistNotification(input: Omit<WaitlistNotification, 'id' | 'sent_at'>): Promise<void> {
  try {
    if (isLocal()) {
      const data = readLocal();
      data.notifications.push({ ...input, id: randomUUID(), sent_at: new Date().toISOString() });
      writeLocal(data);
      return;
    }
    const client = admin();
    if (!client) return;
    await client.from('waitlist_notifications').insert(input);
  } catch (e) {
    console.error('[waitlist] notification log error:', e);
  }
}
