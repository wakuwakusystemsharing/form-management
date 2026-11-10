/**
 * 配信機能のデータアクセス（サーバー専用。fs / Supabase）
 * - local: data/broadcast_data.json（配信・宛先・自動配信・スタンプ）+ 既存の data/*.json（顧客・予約・来店・アンケート・店舗）
 * - staging / production: Supabase（service_role）
 * 仕様: docs/LINE配信機能_仕様書.md §8
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/supabase-fetch-all';
import { normalizeAudience, type FactReservation, type FactSurvey, type FactVisit } from '@/lib/broadcast-audience';
import { normalizeBroadcastItems } from '@/lib/broadcast-items';
import { jstMonthRange, normalizeBroadcastSettings } from '@/lib/broadcast-quota';
import { normalizeAutomationTrigger, normalizeResendAfterDays } from '@/lib/broadcast-automation';
import type {
  AudienceCustomer,
  Broadcast,
  BroadcastAutomation,
  BroadcastRecipient,
  BroadcastRecipientStatus,
  BroadcastSettings,
  BroadcastSticker,
} from '@/types/broadcast';

const DATA_DIR = path.join(process.cwd(), 'data');
const LOCAL_FILE = path.join(DATA_DIR, 'broadcast_data.json');

interface LocalData {
  broadcasts: Broadcast[];
  recipients: Array<BroadcastRecipient & { store_id: string }>;
  automations: BroadcastAutomation[];
  automation_sends: Array<{ automation_id: string; customer_id: string; marker: string; sent_at: string }>;
  stickers: BroadcastSticker[];
}

function isLocal(): boolean {
  return getAppEnvironment() === 'local';
}
function client() {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c as any;
}
function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}
function readLocal(): LocalData {
  const raw = readJson<Partial<LocalData>>(LOCAL_FILE, {});
  return {
    broadcasts: Array.isArray(raw.broadcasts) ? raw.broadcasts.map((r) => normalizeBroadcastRow(r as unknown as Record<string, unknown>)) : [],
    recipients: Array.isArray(raw.recipients) ? raw.recipients : [],
    automations: Array.isArray(raw.automations) ? raw.automations.map((r) => normalizeAutomationRow(r as unknown as Record<string, unknown>)) : [],
    automation_sends: Array.isArray(raw.automation_sends) ? raw.automation_sends : [],
    stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
  };
}
function writeLocal(data: LocalData) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(data, null, 2));
}

function parse<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function payloadList(v: unknown): Record<string, unknown>[] | null {
  const p = parse<unknown>(v, null);
  return Array.isArray(p) ? (p.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : null;
}

export function normalizeBroadcastRow(row: Record<string, unknown>): Broadcast {
  const status = typeof row.status === 'string' && ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'].includes(row.status) ? (row.status as Broadcast['status']) : 'draft';
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    name: typeof row.name === 'string' ? row.name : '',
    status,
    audience: normalizeAudience(parse<unknown>(row.audience, {})),
    items: normalizeBroadcastItems(parse<unknown>(row.items, [])),
    payloads: payloadList(row.payloads),
    has_personalization: row.has_personalization === true,
    track_taps: row.track_taps !== false,
    links: parse<Record<string, string>>(row.links, {}),
    tap_counts: parse<Record<string, number>>(row.tap_counts, {}),
    scheduled_at: strOrNull(row.scheduled_at),
    claimed_at: strOrNull(row.claimed_at),
    started_at: strOrNull(row.started_at),
    finished_at: strOrNull(row.finished_at),
    recipient_count: num(row.recipient_count),
    sent_count: num(row.sent_count),
    failed_count: num(row.failed_count),
    error: strOrNull(row.error),
    automation_id: strOrNull(row.automation_id),
    created_by: strOrNull(row.created_by),
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

export function normalizeAutomationRow(row: Record<string, unknown>): BroadcastAutomation {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    name: typeof row.name === 'string' ? row.name : '',
    enabled: row.enabled === true,
    trigger: normalizeAutomationTrigger(parse<unknown>(row.trigger, null)) ?? { type: 'dormant', days: 90 },
    audience: normalizeAudience(parse<unknown>(row.audience, {})),
    items: normalizeBroadcastItems(parse<unknown>(row.items, [])),
    payloads: payloadList(row.payloads),
    has_personalization: row.has_personalization === true,
    resend_after_days: normalizeResendAfterDays(row.resend_after_days),
    last_run_date: typeof row.last_run_date === 'string' && row.last_run_date ? row.last_run_date.slice(0, 10) : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

function normalizeRecipientRow(row: Record<string, unknown>): BroadcastRecipient {
  const status = typeof row.status === 'string' && ['pending', 'sent', 'failed', 'skipped'].includes(row.status) ? (row.status as BroadcastRecipientStatus) : 'pending';
  return {
    id: String(row.id),
    broadcast_id: String(row.broadcast_id),
    customer_id: String(row.customer_id),
    line_user_id: String(row.line_user_id),
    display_name: strOrNull(row.display_name),
    status,
    error: strOrNull(row.error),
    sent_at: strOrNull(row.sent_at),
  };
}

function normalizeStickerRow(row: Record<string, unknown>): BroadcastSticker {
  return {
    id: String(row.id),
    store_id: strOrNull(row.store_id),
    label: typeof row.label === 'string' ? row.label : '',
    url: typeof row.url === 'string' ? row.url : '',
    preview_url: typeof row.preview_url === 'string' && row.preview_url ? row.preview_url : typeof row.url === 'string' ? row.url : '',
    sort: num(row.sort),
  };
}

export function newBroadcastId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// 配信
// ---------------------------------------------------------------------------

export async function listBroadcasts(storeId: string): Promise<Broadcast[]> {
  if (isLocal()) {
    return readLocal()
      .broadcasts.filter((b) => b.store_id === storeId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data, error } = await client().from('broadcasts').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(`配信の取得に失敗しました: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeBroadcastRow);
}

export async function getBroadcast(storeId: string, id: string): Promise<Broadcast | null> {
  if (isLocal()) return readLocal().broadcasts.find((b) => b.store_id === storeId && b.id === id) ?? null;
  const { data, error } = await client().from('broadcasts').select('*').eq('store_id', storeId).eq('id', id).maybeSingle();
  if (error) throw new Error(`配信の取得に失敗しました: ${error.message}`);
  return data ? normalizeBroadcastRow(data as Record<string, unknown>) : null;
}

export async function insertBroadcast(row: Broadcast): Promise<Broadcast> {
  if (isLocal()) {
    const data = readLocal();
    data.broadcasts.push(row);
    writeLocal(data);
    return row;
  }
  const { data, error } = await client().from('broadcasts').insert(row).select('*').single();
  if (error) throw new Error(`配信の保存に失敗しました: ${error.message}`);
  return normalizeBroadcastRow(data as Record<string, unknown>);
}

/** 一部の列を更新（id / store_id / created_at は変えない） */
export async function updateBroadcast(storeId: string, id: string, patch: Partial<Omit<Broadcast, 'id' | 'store_id' | 'created_at'>>): Promise<Broadcast | null> {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (isLocal()) {
    const data = readLocal();
    const i = data.broadcasts.findIndex((b) => b.store_id === storeId && b.id === id);
    if (i < 0) return null;
    data.broadcasts[i] = { ...data.broadcasts[i], ...next };
    writeLocal(data);
    return data.broadcasts[i];
  }
  const { data, error } = await client().from('broadcasts').update(next).eq('store_id', storeId).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(`配信の更新に失敗しました: ${error.message}`);
  return data ? normalizeBroadcastRow(data as Record<string, unknown>) : null;
}

export async function deleteBroadcast(storeId: string, id: string): Promise<boolean> {
  if (isLocal()) {
    const data = readLocal();
    const before = data.broadcasts.length;
    data.broadcasts = data.broadcasts.filter((b) => !(b.store_id === storeId && b.id === id));
    if (data.broadcasts.length === before) return false;
    data.recipients = data.recipients.filter((r) => r.broadcast_id !== id);
    writeLocal(data);
    return true;
  }
  const { data, error } = await client().from('broadcasts').delete().eq('store_id', storeId).eq('id', id).select('id');
  if (error) throw new Error(`配信の削除に失敗しました: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// 宛先
// ---------------------------------------------------------------------------

export interface RecipientSeed {
  customer_id: string;
  line_user_id: string;
  display_name: string | null;
}

/** 配信の宛先を入れ替える（予約 / 即時送信で対象者を確定するとき。すべて pending で作る） */
export async function replaceBroadcastRecipients(storeId: string, broadcastId: string, seeds: RecipientSeed[]): Promise<number> {
  if (isLocal()) {
    const data = readLocal();
    data.recipients = data.recipients.filter((r) => r.broadcast_id !== broadcastId);
    for (const s of seeds) {
      data.recipients.push({ id: randomUUID(), broadcast_id: broadcastId, store_id: storeId, customer_id: s.customer_id, line_user_id: s.line_user_id, display_name: s.display_name, status: 'pending', error: null, sent_at: null });
    }
    writeLocal(data);
    return seeds.length;
  }
  const c = client();
  const del = await c.from('broadcast_recipients').delete().eq('broadcast_id', broadcastId);
  if (del.error) throw new Error(`宛先の更新に失敗しました: ${del.error.message}`);
  for (let i = 0; i < seeds.length; i += 500) {
    const chunk = seeds.slice(i, i + 500).map((s) => ({ broadcast_id: broadcastId, store_id: storeId, customer_id: s.customer_id, line_user_id: s.line_user_id, display_name: s.display_name }));
    const ins = await c.from('broadcast_recipients').insert(chunk);
    if (ins.error) throw new Error(`宛先の保存に失敗しました: ${ins.error.message}`);
  }
  return seeds.length;
}

export async function listBroadcastRecipients(broadcastId: string, opts: { status?: BroadcastRecipientStatus; limit?: number; offset?: number } = {}): Promise<{ recipients: BroadcastRecipient[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  if (isLocal()) {
    const all = readLocal().recipients.filter((r) => r.broadcast_id === broadcastId && (!opts.status || r.status === opts.status));
    return { recipients: all.slice(offset, offset + limit).map((r) => normalizeRecipientRow(r as unknown as Record<string, unknown>)), total: all.length };
  }
  let q = client().from('broadcast_recipients').select('*', { count: 'exact' }).eq('broadcast_id', broadcastId);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error, count } = await q.order('created_at', { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw new Error(`宛先の取得に失敗しました: ${error.message}`);
  return { recipients: ((data ?? []) as Record<string, unknown>[]).map(normalizeRecipientRow), total: typeof count === 'number' ? count : (data ?? []).length };
}

/** 今月（JST）この店舗が配信機能で送った通数（1 人 = 1 通） */
export async function countMonthlySent(storeId: string, now: Date = new Date()): Promise<number> {
  const { start, end } = jstMonthRange(now);
  if (isLocal()) {
    return readLocal().recipients.filter((r) => r.store_id === storeId && r.status === 'sent' && !!r.sent_at && r.sent_at >= start && r.sent_at < end).length;
  }
  const { count, error } = await client().from('broadcast_recipients').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'sent').gte('sent_at', start).lt('sent_at', end);
  if (error) throw new Error(`配信通数の集計に失敗しました: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// 自動配信
// ---------------------------------------------------------------------------

export async function listBroadcastAutomations(storeId: string): Promise<BroadcastAutomation[]> {
  if (isLocal()) return readLocal().automations.filter((a) => a.store_id === storeId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const { data, error } = await client().from('broadcast_automations').select('*').eq('store_id', storeId).order('created_at', { ascending: true });
  if (error) throw new Error(`自動配信の取得に失敗しました: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeAutomationRow);
}

export async function getBroadcastAutomation(storeId: string, id: string): Promise<BroadcastAutomation | null> {
  if (isLocal()) return readLocal().automations.find((a) => a.store_id === storeId && a.id === id) ?? null;
  const { data, error } = await client().from('broadcast_automations').select('*').eq('store_id', storeId).eq('id', id).maybeSingle();
  if (error) throw new Error(`自動配信の取得に失敗しました: ${error.message}`);
  return data ? normalizeAutomationRow(data as Record<string, unknown>) : null;
}

export async function upsertBroadcastAutomation(row: BroadcastAutomation): Promise<BroadcastAutomation> {
  if (isLocal()) {
    const data = readLocal();
    const i = data.automations.findIndex((a) => a.id === row.id && a.store_id === row.store_id);
    if (i >= 0) data.automations[i] = row;
    else data.automations.push(row);
    writeLocal(data);
    return row;
  }
  const { data, error } = await client().from('broadcast_automations').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw new Error(`自動配信の保存に失敗しました: ${error.message}`);
  return normalizeAutomationRow(data as Record<string, unknown>);
}

export async function deleteBroadcastAutomation(storeId: string, id: string): Promise<boolean> {
  if (isLocal()) {
    const data = readLocal();
    const before = data.automations.length;
    data.automations = data.automations.filter((a) => !(a.store_id === storeId && a.id === id));
    if (data.automations.length === before) return false;
    data.automation_sends = data.automation_sends.filter((s) => s.automation_id !== id);
    writeLocal(data);
    return true;
  }
  const { data, error } = await client().from('broadcast_automations').delete().eq('store_id', storeId).eq('id', id).select('id');
  if (error) throw new Error(`自動配信の削除に失敗しました: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// スタンプ
// ---------------------------------------------------------------------------

/** 共通（store_id NULL）+ その店舗のスタンプ。共通が先 */
export async function listBroadcastStickers(storeId: string): Promise<BroadcastSticker[]> {
  let rows: BroadcastSticker[];
  if (isLocal()) {
    rows = readLocal().stickers.filter((s) => s.store_id === null || s.store_id === storeId);
  } else {
    const { data, error } = await client().from('broadcast_stickers').select('*').or(`store_id.is.null,store_id.eq.${storeId}`);
    if (error) throw new Error(`スタンプの取得に失敗しました: ${error.message}`);
    rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeStickerRow);
  }
  return rows.sort((a, b) => (a.store_id === null ? 0 : 1) - (b.store_id === null ? 0 : 1) || a.sort - b.sort || a.label.localeCompare(b.label, 'ja'));
}

export async function insertBroadcastSticker(input: { store_id: string; label: string; url: string; preview_url?: string; sort?: number }): Promise<BroadcastSticker> {
  const row: BroadcastSticker = { id: randomUUID(), store_id: input.store_id, label: input.label, url: input.url, preview_url: input.preview_url || input.url, sort: input.sort ?? 0 };
  if (isLocal()) {
    const data = readLocal();
    data.stickers.push(row);
    writeLocal(data);
    return row;
  }
  const { data, error } = await client().from('broadcast_stickers').insert(row).select('*').single();
  if (error) throw new Error(`スタンプの保存に失敗しました: ${error.message}`);
  return normalizeStickerRow(data as Record<string, unknown>);
}

/** 店舗が追加したスタンプだけ削除できる（共通分は消せない） */
export async function deleteBroadcastSticker(storeId: string, id: string): Promise<boolean> {
  if (isLocal()) {
    const data = readLocal();
    const before = data.stickers.length;
    data.stickers = data.stickers.filter((s) => !(s.id === id && s.store_id === storeId));
    if (data.stickers.length === before) return false;
    writeLocal(data);
    return true;
  }
  const { data, error } = await client().from('broadcast_stickers').delete().eq('id', id).eq('store_id', storeId).select('id');
  if (error) throw new Error(`スタンプの削除に失敗しました: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// 店舗の配信設定（stores の列）
// ---------------------------------------------------------------------------

const STORES_FILE = path.join(DATA_DIR, 'stores.json');
const SETTINGS_COLUMNS = 'broadcast_monthly_limit,broadcast_over_limit,broadcast_opt_out_keyword,broadcast_opt_in_keyword,broadcast_automation_time';

export async function getBroadcastSettings(storeId: string): Promise<BroadcastSettings> {
  if (isLocal()) {
    const stores = readJson<Array<Record<string, unknown>>>(STORES_FILE, []);
    return normalizeBroadcastSettings(stores.find((s) => s.id === storeId) ?? null);
  }
  const { data, error } = await client().from('stores').select(SETTINGS_COLUMNS).eq('id', storeId).maybeSingle();
  if (error) throw new Error(`配信設定の取得に失敗しました: ${error.message}`);
  return normalizeBroadcastSettings(data);
}

export async function updateBroadcastSettings(storeId: string, settings: BroadcastSettings): Promise<BroadcastSettings> {
  const s = normalizeBroadcastSettings(settings);
  const columns = {
    broadcast_monthly_limit: s.monthly_limit,
    broadcast_over_limit: s.over_limit,
    broadcast_opt_out_keyword: s.opt_out_keyword,
    broadcast_opt_in_keyword: s.opt_in_keyword,
    broadcast_automation_time: s.automation_time,
  };
  if (isLocal()) {
    const stores = readJson<Array<Record<string, unknown>>>(STORES_FILE, []);
    const i = stores.findIndex((x) => x.id === storeId);
    if (i < 0) throw new Error('店舗が見つかりません');
    stores[i] = { ...stores[i], ...columns };
    fs.writeFileSync(STORES_FILE, JSON.stringify(stores, null, 2));
    return s;
  }
  const { error } = await client().from('stores').update(columns).eq('id', storeId);
  if (error) throw new Error(`配信設定の保存に失敗しました: ${error.message}`);
  return s;
}

// ---------------------------------------------------------------------------
// 配信先の判定に使うデータ（顧客・予約・来店・アンケート）
// ---------------------------------------------------------------------------

export interface AudienceSource {
  customers: AudienceCustomer[];
  reservations: FactReservation[];
  visits: FactVisit[];
  surveys: FactSurvey[];
}

const CUSTOMER_COLUMNS_BASE = 'id,name,line_user_id,line_display_name,line_friend_flag,line_opt_out_at,tags,gender,birthday,total_visits,total_spent,first_visit_date,last_visit_date';
const CUSTOMER_COLUMNS = `${CUSTOMER_COLUMNS_BASE},line_blocked_at`;

function toAudienceCustomer(row: Record<string, unknown>): AudienceCustomer {
  return {
    id: String(row.id),
    name: strOrNull(row.name),
    line_user_id: strOrNull(row.line_user_id),
    line_display_name: strOrNull(row.line_display_name),
    line_friend_flag: typeof row.line_friend_flag === 'boolean' ? row.line_friend_flag : null,
    line_blocked_at: strOrNull(row.line_blocked_at),
    line_opt_out_at: strOrNull(row.line_opt_out_at),
    tags: Array.isArray(row.tags) ? (row.tags.filter((t) => typeof t === 'string') as string[]) : [],
    gender: strOrNull(row.gender),
    birthday: strOrNull(row.birthday),
    total_visits: typeof row.total_visits === 'number' ? row.total_visits : 0,
    total_spent: typeof row.total_spent === 'number' ? row.total_spent : 0,
    first_visit_date: strOrNull(row.first_visit_date),
    last_visit_date: strOrNull(row.last_visit_date),
  };
}

/**
 * 店舗の顧客と、条件の判定に使う予約・来店・アンケートを全件読む（1000 件ずつ）。
 * `need` で不要なものは読まない（メニュー / フォーム / 今後の予約の条件が無ければ予約は読まない、など）
 */
export async function loadAudienceSource(storeId: string, need: { reservations?: boolean; visits?: boolean; surveys?: boolean } = { reservations: true, visits: true, surveys: true }): Promise<AudienceSource> {
  if (isLocal()) {
    const customers = readJson<Array<Record<string, unknown>>>(path.join(DATA_DIR, 'customers.json'), []).filter((c) => c.store_id === storeId).map(toAudienceCustomer);
    const ids = new Set(customers.map((c) => c.id));
    return {
      customers,
      reservations: need.reservations ? (readJson<Array<Record<string, unknown>>>(path.join(DATA_DIR, 'reservations.json'), []).filter((r) => r.store_id === storeId) as FactReservation[]) : [],
      visits: need.visits ? (readJson<Array<Record<string, unknown>>>(path.join(DATA_DIR, 'customer_visits.json'), []).filter((v) => typeof v.customer_id === 'string' && ids.has(v.customer_id)) as FactVisit[]) : [],
      surveys: need.surveys ? (readJson<Array<Record<string, unknown>>>(path.join(DATA_DIR, 'survey_responses.json'), []).filter((s) => s.store_id === storeId) as FactSurvey[]) : [],
    };
  }
  const c = client();
  // line_blocked_at 列が未適用の環境（マイグレーション前）では、列なしで取り直す
  const customerRows = await fetchAllRows<Record<string, unknown>>((from, to) => c.from('customers').select(CUSTOMER_COLUMNS).eq('store_id', storeId).order('id').range(from, to)).catch(() =>
    fetchAllRows<Record<string, unknown>>((from, to) => c.from('customers').select(CUSTOMER_COLUMNS_BASE).eq('store_id', storeId).order('id').range(from, to))
  );
  const customers = customerRows.map(toAudienceCustomer);
  const reservations = need.reservations
    ? await fetchAllRows<FactReservation>((from, to) => c.from('reservations').select('customer_id,line_user_id,form_id,reservation_date,status,selected_menus').eq('store_id', storeId).order('id').range(from, to))
    : [];
  const visits = need.visits
    ? await fetchAllRows<FactVisit>((from, to) => c.from('customer_visits').select('customer_id,visit_date,treatment_menus').eq('store_id', storeId).order('id').range(from, to))
    : [];
  const surveys = need.surveys
    ? await fetchAllRows<FactSurvey>((from, to) => c.from('surveys').select('line_user_id,survey_form_id,responses').eq('store_id', storeId).not('line_user_id', 'is', null).order('id').range(from, to))
    : [];
  return { customers, reservations, visits, surveys };
}

/** 配信停止 / 再開（LINE ユーザー ID で店舗内の顧客を更新）。更新した顧客数を返す */
export async function setLineOptOut(storeId: string, lineUserId: string, optedOut: boolean, now: Date = new Date()): Promise<number> {
  const value = optedOut ? now.toISOString() : null;
  if (isLocal()) {
    const file = path.join(DATA_DIR, 'customers.json');
    const rows = readJson<Array<Record<string, unknown>>>(file, []);
    let n = 0;
    for (const r of rows) {
      if (r.store_id === storeId && r.line_user_id === lineUserId) {
        r.line_opt_out_at = value;
        n += 1;
      }
    }
    if (n > 0) fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    return n;
  }
  const { data, error } = await client().from('customers').update({ line_opt_out_at: value }).eq('store_id', storeId).eq('line_user_id', lineUserId).select('id');
  if (error) throw new Error(`配信停止の更新に失敗しました: ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}

// ---------------------------------------------------------------------------
// 計測リンク・集計・送信の補助
// ---------------------------------------------------------------------------

/** 計測リンク /go/b/{id}/{key} の本来の URL（店舗を問わず ID で引く） */
export async function getBroadcastLinkTarget(id: string, key: string): Promise<string | null> {
  if (isLocal()) return readLocal().broadcasts.find((b) => b.id === id)?.links?.[key] ?? null;
  const { data, error } = await client().from('broadcasts').select('links').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return parse<Record<string, string>>((data as Record<string, unknown>).links, {})[key] ?? null;
}

export async function incrementBroadcastTap(id: string, key: string): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    const b = data.broadcasts.find((x) => x.id === id);
    if (b) {
      b.tap_counts = { ...(b.tap_counts ?? {}), [key]: ((b.tap_counts ?? {})[key] ?? 0) + 1 };
      writeLocal(data);
    }
    return;
  }
  const { error } = await client().rpc('broadcast_increment_tap', { p_id: id, p_key: key });
  if (error) console.warn('[broadcast] tap_counts 更新に失敗:', error.message);
}

/** 配信停止中の顧客数（LINE 連携済みのみ） */
export async function countOptedOutCustomers(storeId: string): Promise<number> {
  if (isLocal()) {
    return readJson<Array<Record<string, unknown>>>(path.join(DATA_DIR, 'customers.json'), []).filter((c) => c.store_id === storeId && !!c.line_user_id && !!c.line_opt_out_at).length;
  }
  const { count, error } = await client().from('customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId).not('line_user_id', 'is', null).not('line_opt_out_at', 'is', null);
  if (error) throw new Error(`配信停止数の取得に失敗しました: ${error.message}`);
  return count ?? 0;
}

/** 店舗の LINE チャネルアクセストークン（未設定は null） */
export async function getStoreLineToken(storeId: string): Promise<string | null> {
  if (isLocal()) {
    const stores = readJson<Array<Record<string, unknown>>>(STORES_FILE, []);
    const t = stores.find((s) => s.id === storeId)?.line_channel_access_token;
    return typeof t === 'string' && t.trim() ? t : null;
  }
  const { data } = await client().from('stores').select('line_channel_access_token').eq('id', storeId).maybeSingle();
  const t = (data as { line_channel_access_token?: string } | null)?.line_channel_access_token;
  return typeof t === 'string' && t.trim() ? t : null;
}

/** 宛先をすべて消す（予約を取り消して下書きに戻すとき） */
export async function clearBroadcastRecipients(broadcastId: string): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    data.recipients = data.recipients.filter((r) => r.broadcast_id !== broadcastId);
    writeLocal(data);
    return;
  }
  const { error } = await client().from('broadcast_recipients').delete().eq('broadcast_id', broadcastId);
  if (error) throw new Error(`宛先の削除に失敗しました: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 自動配信の実行（cron から）
// ---------------------------------------------------------------------------

/** 全店舗の ON の自動配信ルール */
export async function listEnabledAutomationsAllStores(): Promise<BroadcastAutomation[]> {
  if (isLocal()) return readLocal().automations.filter((a) => a.enabled);
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) => client().from('broadcast_automations').select('*').eq('enabled', true).order('id').range(from, to));
  return rows.map(normalizeAutomationRow);
}

/**
 * 今日（JST）の実行を確保する。まだ今日実行していなければ last_run_date を今日にして true。
 * 同時に 2 つ動いても片方だけが true になる（条件付き UPDATE）
 */
export async function claimAutomationRun(id: string, today: string): Promise<boolean> {
  if (isLocal()) {
    const data = readLocal();
    const a = data.automations.find((x) => x.id === id);
    if (!a || (a.last_run_date && a.last_run_date >= today)) return false;
    a.last_run_date = today;
    writeLocal(data);
    return true;
  }
  const { data, error } = await client().from('broadcast_automations').update({ last_run_date: today }).eq('id', id).or(`last_run_date.is.null,last_run_date.lt.${today}`).select('id');
  if (error) throw new Error(`自動配信の実行確保に失敗しました: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

export interface AutomationSend {
  customer_id: string;
  marker: string;
  sent_at: string;
}

export async function listAutomationSends(automationId: string): Promise<AutomationSend[]> {
  if (isLocal()) return readLocal().automation_sends.filter((s) => s.automation_id === automationId).map((s) => ({ customer_id: s.customer_id, marker: s.marker, sent_at: s.sent_at }));
  return fetchAllRows<AutomationSend>((from, to) => client().from('broadcast_automation_sends').select('customer_id,marker,sent_at').eq('automation_id', automationId).order('customer_id').order('marker').range(from, to));
}

/** 送信記録を追加（同じ ルール × 顧客 × marker は無視） */
export async function insertAutomationSends(automationId: string, rows: Array<{ customer_id: string; marker: string }>, now: Date = new Date()): Promise<void> {
  if (rows.length === 0) return;
  const sentAt = now.toISOString();
  if (isLocal()) {
    const data = readLocal();
    for (const r of rows) {
      if (data.automation_sends.some((s) => s.automation_id === automationId && s.customer_id === r.customer_id && s.marker === r.marker)) continue;
      data.automation_sends.push({ automation_id: automationId, customer_id: r.customer_id, marker: r.marker, sent_at: sentAt });
    }
    writeLocal(data);
    return;
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ automation_id: automationId, customer_id: r.customer_id, marker: r.marker, sent_at: sentAt }));
    const { error } = await client().from('broadcast_automation_sends').upsert(chunk, { onConflict: 'automation_id,customer_id,marker', ignoreDuplicates: true });
    if (error) throw new Error(`自動配信の送信記録に失敗しました: ${error.message}`);
  }
}

/** ルールごとの直近 30 日の送信数（一覧に出す） */
export async function countRecentAutomationSends(automationIds: string[], now: Date = new Date()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (automationIds.length === 0) return out;
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isLocal()) {
    for (const s of readLocal().automation_sends) if (automationIds.includes(s.automation_id) && s.sent_at >= since) out[s.automation_id] = (out[s.automation_id] ?? 0) + 1;
    return out;
  }
  for (const id of automationIds) {
    const { count } = await client().from('broadcast_automation_sends').select('customer_id', { count: 'exact', head: true }).eq('automation_id', id).gte('sent_at', since);
    out[id] = count ?? 0;
  }
  return out;
}

/**
 * 友だち状態を記録する（送信前に LINE へ確認した結果）。
 * friend = true … 友だち（line_friend_flag = true、ブロックの記録を消す）/ false … 友だちでない（line_blocked_at を入れる）
 */
export async function updateLineFriendStatus(storeId: string, customerIds: string[], friend: boolean, now: Date = new Date()): Promise<void> {
  if (customerIds.length === 0) return;
  const patch = friend ? { line_friend_flag: true, line_blocked_at: null } : { line_friend_flag: false, line_blocked_at: now.toISOString() };
  if (isLocal()) {
    const file = path.join(DATA_DIR, 'customers.json');
    const rows = readJson<Array<Record<string, unknown>>>(file, []);
    for (const r of rows) if (r.store_id === storeId && typeof r.id === 'string' && customerIds.includes(r.id)) Object.assign(r, patch);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    return;
  }
  for (let i = 0; i < customerIds.length; i += 200) {
    const { error } = await client().from('customers').update(patch).eq('store_id', storeId).in('id', customerIds.slice(i, i + 200));
    if (error) console.warn('[broadcast] 友だち状態の更新に失敗:', error.message);
  }
}
