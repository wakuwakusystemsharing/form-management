/**
 * 朝のまとめ・月次レポートの保存先 — サーバー専用（fs / Supabase に依存。クライアントから import しない）
 * local 環境は data/store_digest.json（+ 既存の data/*.json）、それ以外は store_digest_settings / store_digest_staff / store_digest_logs。
 * 3 つのテーブルは API（service_role）からだけ読み書きする（RLS のポリシーは作らない）
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/supabase-fetch-all';
import { pickPendingNextVisitNote, type VisitNoteSource } from '@/lib/customer-chart';
import { DIGEST_CODE_MAX_FAILURES, normalizeDigestSettings, type DigestCustomer, type DigestReservation, type DigestSettings, type ReportReservation } from '@/lib/store-digest';

export type DigestKind = 'morning' | 'monthly';
export type DigestLogStatus = 'sending' | 'sent' | 'skipped' | 'failed';

export interface DigestSettingsRow {
  store_id: string;
  settings: DigestSettings;
  /** スタッフ登録の合言葉（null = 無効。出し直すまで登録できない） */
  staff_code: string | null;
  code_failures: number;
}

export interface DigestStaffRow {
  id: string;
  store_id: string;
  line_user_id: string;
  display_name: string | null;
  created_at: string;
}

export interface DigestLogRow {
  id: string;
  store_id: string;
  kind: DigestKind;
  /** 朝のまとめ = 日付（YYYY-MM-DD）/ 月次 = 対象の月（YYYY-MM） */
  target_key: string;
  status: DigestLogStatus;
  email_sent: number;
  line_sent: number;
  failed_count: number;
  detail: string | null;
  created_at: string;
}

export interface DigestStore {
  id: string;
  name: string;
  line_channel_access_token: string | null;
}

interface LocalData {
  settings: DigestSettingsRow[];
  staff: DigestStaffRow[];
  logs: DigestLogRow[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'store_digest.json');
const isLocal = () => getAppEnvironment() === 'local';

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}
const readArray = (name: string) => {
  const v = readJson<unknown>(path.join(DATA_DIR, name), []);
  return (Array.isArray(v) ? v : []) as Array<Record<string, any>>;
};
function readLocal(): LocalData {
  const raw = readJson<Partial<LocalData>>(FILE, {});
  return {
    settings: Array.isArray(raw.settings) ? raw.settings : [],
    staff: Array.isArray(raw.staff) ? raw.staff : [],
    logs: Array.isArray(raw.logs) ? raw.logs : [],
  };
}
function writeLocal(data: LocalData) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
function client(): any {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c as any;
}

function toSettingsRow(row: Record<string, any>): DigestSettingsRow {
  return {
    store_id: String(row.store_id),
    settings: normalizeDigestSettings(typeof row.settings === 'string' ? safeParse(row.settings) : row.settings),
    staff_code: typeof row.staff_code === 'string' && row.staff_code ? row.staff_code : null,
    code_failures: Number(row.code_failures) || 0,
  };
}
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 設定・合言葉
// ---------------------------------------------------------------------------

export async function getDigestSettingsRow(storeId: string): Promise<DigestSettingsRow | null> {
  if (isLocal()) {
    const row = readLocal().settings.find((s) => s.store_id === storeId);
    return row ? toSettingsRow(row) : null;
  }
  const { data, error } = await client().from('store_digest_settings').select('*').eq('store_id', storeId).maybeSingle();
  if (error) throw new Error(`まとめ・レポートの設定の取得に失敗しました: ${error.message}`);
  return data ? toSettingsRow(data) : null;
}

/** 指定した項目だけを書き換える（行が無ければ作る） */
export async function upsertDigestSettingsRow(storeId: string, patch: Partial<Omit<DigestSettingsRow, 'store_id'>>): Promise<DigestSettingsRow> {
  const current = (await getDigestSettingsRow(storeId)) ?? { store_id: storeId, settings: normalizeDigestSettings(null), staff_code: null, code_failures: 0 };
  const next: DigestSettingsRow = { ...current, ...patch, store_id: storeId };
  if (isLocal()) {
    const data = readLocal();
    data.settings = [...data.settings.filter((s) => s.store_id !== storeId), next];
    writeLocal(data);
    return next;
  }
  const { error } = await client()
    .from('store_digest_settings')
    .upsert({ store_id: storeId, settings: next.settings, staff_code: next.staff_code, code_failures: next.code_failures, updated_at: new Date().toISOString() }, { onConflict: 'store_id' });
  if (error) throw new Error(`まとめ・レポートの設定の保存に失敗しました: ${error.message}`);
  return next;
}

/** 合言葉の間違いを 1 回数える。上限に達したら合言葉を無効にする。戻り値 = 無効になったか */
export async function recordStaffCodeFailure(storeId: string): Promise<boolean> {
  const row = await getDigestSettingsRow(storeId);
  if (!row) return false;
  const failures = row.code_failures + 1;
  const locked = failures >= DIGEST_CODE_MAX_FAILURES;
  await upsertDigestSettingsRow(storeId, { code_failures: failures, ...(locked ? { staff_code: null } : {}) });
  return locked;
}

/** 朝のまとめ か 月次レポート が ON の店舗の設定 */
export async function listEnabledDigestSettings(storeId?: string | null): Promise<DigestSettingsRow[]> {
  const enabled = (r: DigestSettingsRow) => r.settings.morning.enabled || r.settings.monthly.enabled;
  if (isLocal()) {
    return readLocal()
      .settings.map(toSettingsRow)
      .filter((r) => (!storeId || r.store_id === storeId) && enabled(r));
  }
  const c = client();
  const rows = await fetchAllRows<Record<string, any>>((from, to) => {
    let q = c.from('store_digest_settings').select('*');
    if (storeId) q = q.eq('store_id', storeId);
    return q.order('store_id').range(from, to);
  });
  return rows.map(toSettingsRow).filter(enabled);
}

// ---------------------------------------------------------------------------
// LINE で受け取るスタッフ
// ---------------------------------------------------------------------------

export async function listDigestStaff(storeId: string): Promise<DigestStaffRow[]> {
  if (isLocal()) {
    return readLocal()
      .staff.filter((s) => s.store_id === storeId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const { data, error } = await client().from('store_digest_staff').select('*').eq('store_id', storeId).order('created_at', { ascending: true });
  if (error) throw new Error(`スタッフの取得に失敗しました: ${error.message}`);
  return (data || []) as DigestStaffRow[];
}

/** 登録（同じ LINE ユーザーは 1 行。表示名だけ更新） */
export async function upsertDigestStaff(storeId: string, lineUserId: string, displayName: string | null): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    const existing = data.staff.find((s) => s.store_id === storeId && s.line_user_id === lineUserId);
    if (existing) existing.display_name = displayName ?? existing.display_name;
    else data.staff.push({ id: randomUUID(), store_id: storeId, line_user_id: lineUserId, display_name: displayName, created_at: new Date().toISOString() });
    writeLocal(data);
    return;
  }
  const { error } = await client().from('store_digest_staff').upsert({ store_id: storeId, line_user_id: lineUserId, display_name: displayName }, { onConflict: 'store_id,line_user_id' });
  if (error) throw new Error(`スタッフの登録に失敗しました: ${error.message}`);
}

/** 解除（id か LINE ユーザー ID で指定）。戻り値 = 消した数 */
export async function deleteDigestStaff(storeId: string, by: { id?: string; lineUserId?: string }): Promise<number> {
  if (!by.id && !by.lineUserId) return 0;
  if (isLocal()) {
    const data = readLocal();
    const keep = data.staff.filter((s) => !(s.store_id === storeId && (by.id ? s.id === by.id : s.line_user_id === by.lineUserId)));
    const removed = data.staff.length - keep.length;
    data.staff = keep;
    if (removed > 0) writeLocal(data);
    return removed;
  }
  let q = client().from('store_digest_staff').delete().eq('store_id', storeId);
  q = by.id ? q.eq('id', by.id) : q.eq('line_user_id', by.lineUserId);
  const { data, error } = await q.select('id');
  if (error) throw new Error(`スタッフの解除に失敗しました: ${error.message}`);
  return (data || []).length;
}

// ---------------------------------------------------------------------------
// 送信の記録（店舗 × 種類 × 対象日 / 対象月 で 1 行 = 二重に送らない）
// ---------------------------------------------------------------------------

/** 送る前に行を確保する。すでに行があれば null（= ほかの回が送った / 送っている） */
export async function claimDigestLog(storeId: string, kind: DigestKind, targetKey: string): Promise<string | null> {
  const row: DigestLogRow = { id: randomUUID(), store_id: storeId, kind, target_key: targetKey, status: 'sending', email_sent: 0, line_sent: 0, failed_count: 0, detail: null, created_at: new Date().toISOString() };
  if (isLocal()) {
    const data = readLocal();
    if (data.logs.some((l) => l.store_id === storeId && l.kind === kind && l.target_key === targetKey)) return null;
    data.logs.push(row);
    writeLocal(data);
    return row.id;
  }
  const { error } = await client().from('store_digest_logs').insert(row);
  if (error) {
    // 23505 = 一意制約（すでに確保済み）
    if ((error as { code?: string }).code === '23505') return null;
    throw new Error(`送信の記録に失敗しました: ${error.message}`);
  }
  return row.id;
}

export async function finishDigestLog(id: string, patch: Pick<DigestLogRow, 'status' | 'email_sent' | 'line_sent' | 'failed_count' | 'detail'>): Promise<void> {
  if (isLocal()) {
    const data = readLocal();
    const row = data.logs.find((l) => l.id === id);
    if (row) Object.assign(row, patch);
    writeLocal(data);
    return;
  }
  const { error } = await client().from('store_digest_logs').update(patch).eq('id', id);
  if (error) console.warn('[store-digest] 送信の記録を更新できませんでした:', error.message);
}

export async function listDigestLogs(storeId: string, limit = 10): Promise<DigestLogRow[]> {
  if (isLocal()) {
    return readLocal()
      .logs.filter((l) => l.store_id === storeId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await client().from('store_digest_logs').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`送信の記録の取得に失敗しました: ${error.message}`);
  return (data || []) as DigestLogRow[];
}

// ---------------------------------------------------------------------------
// まとめ・レポートの材料
// ---------------------------------------------------------------------------

export async function getDigestStore(storeId: string): Promise<DigestStore | null> {
  const toStore = (s: Record<string, any> | null | undefined): DigestStore | null =>
    s ? { id: String(s.id), name: typeof s.name === 'string' && s.name ? s.name : '店舗', line_channel_access_token: typeof s.line_channel_access_token === 'string' && s.line_channel_access_token.trim() ? s.line_channel_access_token : null } : null;
  if (isLocal()) return toStore(readArray('stores.json').find((s) => s.id === storeId));
  const { data } = await client().from('stores').select('id,name,line_channel_access_token').eq('id', storeId).maybeSingle();
  return toStore(data);
}

/** その日（予約日）の予約 */
export async function listDigestReservations(storeId: string, date: string): Promise<DigestReservation[]> {
  if (isLocal()) {
    return readArray('reservations.json').filter((r) => r.store_id === storeId && String(r.reservation_date || '').slice(0, 10) === date) as unknown as DigestReservation[];
  }
  const c = client();
  return fetchAllRows<DigestReservation>((from, to) => c.from('reservations').select('*').eq('store_id', storeId).eq('reservation_date', date).order('id').range(from, to));
}

const CUSTOMER_COLUMNS = 'id,name,line_user_id,total_visits,total_spent,birthday,allergies,medical_history';

/** 予約に紐付く顧客（顧客 ID → LINE ユーザー ID） */
export async function listDigestCustomers(storeId: string, customerIds: string[], lineUserIds: string[]): Promise<DigestCustomer[]> {
  if (customerIds.length === 0 && lineUserIds.length === 0) return [];
  if (isLocal()) {
    const ids = new Set(customerIds);
    const lines = new Set(lineUserIds);
    return readArray('customers.json').filter((c) => c.store_id === storeId && (ids.has(c.id) || (c.line_user_id && lines.has(c.line_user_id)))) as unknown as DigestCustomer[];
  }
  const c = client();
  const out = new Map<string, DigestCustomer>();
  const load = async (column: 'id' | 'line_user_id', values: string[]) => {
    for (let i = 0; i < values.length; i += 200) {
      const { data, error } = await c.from('customers').select(CUSTOMER_COLUMNS).eq('store_id', storeId).in(column, values.slice(i, i + 200));
      if (error) throw new Error(`顧客の取得に失敗しました: ${error.message}`);
      for (const row of (data || []) as DigestCustomer[]) out.set(row.id, row);
    }
  };
  await load('id', customerIds);
  await load('line_user_id', lineUserIds);
  return [...out.values()];
}

/** 顧客 ID → 未確認の申し送り（最新 1 件） */
export async function listPendingVisitNotes(storeId: string, customerIds: string[]): Promise<Record<string, string>> {
  if (customerIds.length === 0) return {};
  type Row = VisitNoteSource & { customer_id: string };
  let rows: Row[] = [];
  if (isLocal()) {
    const ids = new Set(customerIds);
    rows = readArray('customer_visits.json').filter((v) => ids.has(v.customer_id)) as unknown as Row[];
  } else {
    const c = client();
    for (let i = 0; i < customerIds.length; i += 200) {
      const { data, error } = await c
        .from('customer_visits')
        .select('id,customer_id,visit_date,created_at,next_visit_note,next_visit_note_acknowledged_at')
        .eq('store_id', storeId)
        .in('customer_id', customerIds.slice(i, i + 200))
        .not('next_visit_note', 'is', null)
        .is('next_visit_note_acknowledged_at', null);
      // 申し送りの列が無い環境でも、まとめ自体は送る
      if (error) return {};
      rows.push(...((data || []) as Row[]));
    }
  }
  const byCustomer = new Map<string, Row[]>();
  for (const r of rows) byCustomer.set(r.customer_id, [...(byCustomer.get(r.customer_id) ?? []), r]);
  const out: Record<string, string> = {};
  for (const [id, list] of byCustomer) {
    const note = pickPendingNextVisitNote(list)?.next_visit_note;
    if (note && note.trim()) out[id] = note.trim();
  }
  return out;
}

/** 店舗のすべての予約（月次レポートの集計用。必要な列だけ） */
export async function listReportReservations(storeId: string): Promise<ReportReservation[]> {
  if (isLocal()) return readArray('reservations.json').filter((r) => r.store_id === storeId) as unknown as ReportReservation[];
  const c = client();
  return fetchAllRows<ReportReservation>((from, to) =>
    c
      .from('reservations')
      .select('id,customer_id,line_user_id,customer_phone,form_id,status,reservation_date,reservation_time,selected_menus,selected_options,customer_info,stay_price_total')
      .eq('store_id', storeId)
      .order('id')
      .range(from, to)
  );
}
