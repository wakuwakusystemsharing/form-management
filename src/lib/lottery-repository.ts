/**
 * 抽選フォーム / 抽選履歴のデータアクセス層
 *
 * - local 環境: data/lottery_forms.json, data/lottery_entries.json（API 経由でのみ更新）
 * - staging / production: Supabase（Admin Client。RLS は API 側の認可チェックで代替）
 *
 * API ルートはこのモジュールだけを使い、環境分岐をルート内に書かない。
 * 抽選の当選判定などの純粋ロジックは lottery-engine.ts に置く。
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeLotteryForm } from '@/lib/lottery-normalizer';
import { generateEntryId, getEffectiveStatus, isEntryExpired } from '@/lib/lottery-engine';
import type {
  DeferredDrawStatus,
  LotteryConfig,
  LotteryDraftStatus,
  LotteryEntry,
  LotteryEntryEffectiveStatus,
  LotteryEntryStatus,
  LotteryEntryView,
  LotteryForm,
  LotteryFormStats,
  LotteryFormStatus,
} from '@/types/lottery';
import type { StaticDeploy } from '@/types/form';

const DATA_DIR = path.join(process.cwd(), 'data');
const FORMS_FILE = path.join(DATA_DIR, 'lottery_forms.json');
const ENTRIES_FILE = path.join(DATA_DIR, 'lottery_entries.json');

const ENTRY_STATUSES: LotteryEntryStatus[] = ['entered', 'provisional', 'drawn', 'lost', 'redeemed', 'cancelled'];

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

function isLocal(): boolean {
  return getAppEnvironment() === 'local';
}

function readJsonFile<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJsonFile<T>(file: string, rows: T[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}

function requireAdminClient() {
  const client = createAdminClient();
  if (!client) throw new Error('Supabase 接続エラー');
  // 型定義に lottery テーブルが無いため any で扱う（他 API と同じ運用）
  return client as unknown as {
    from: (table: string) => any;
    rpc: (fn: string, args: Record<string, unknown>) => any;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** DB / JSON の行を LotteryEntry に整える（欠けた列は既定値） */
export function toLotteryEntry(row: Record<string, unknown>): LotteryEntry {
  const status = typeof row.status === 'string' && (ENTRY_STATUSES as string[]).includes(row.status)
    ? (row.status as LotteryEntryStatus)
    : 'drawn';
  const answersRaw = row.answers;
  let answers: Record<string, unknown> | null = null;
  if (answersRaw && typeof answersRaw === 'object') {
    answers = answersRaw as Record<string, unknown>;
  } else if (typeof answersRaw === 'string') {
    try {
      const parsed = JSON.parse(answersRaw);
      answers = parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      answers = null;
    }
  }
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    id: String(row.id ?? ''),
    lottery_form_id: String(row.lottery_form_id ?? ''),
    store_id: String(row.store_id ?? ''),
    line_user_id: String(row.line_user_id ?? ''),
    line_display_name: str(row.line_display_name),
    line_friend_flag: typeof row.line_friend_flag === 'boolean' ? row.line_friend_flag : null,
    customer_id: str(row.customer_id),
    prize_id: str(row.prize_id),
    prize_name: str(row.prize_name),
    is_win: row.is_win === true,
    is_consolation: row.is_consolation === true,
    redeem_code: str(row.redeem_code),
    qr_token: str(row.qr_token),
    expires_at: str(row.expires_at),
    status,
    redeemed_at: str(row.redeemed_at),
    redeemed_by: str(row.redeemed_by),
    redeemed_note: str(row.redeemed_note),
    answers,
    message_sent: row.message_sent === true,
    push_sent: row.push_sent === true,
    user_agent: str(row.user_agent),
    entered_at: str(row.entered_at) ?? nowIso(),
    created_at: str(row.created_at) ?? nowIso(),
    updated_at: str(row.updated_at) ?? nowIso(),
  };
}

export function toLotteryEntryView(entry: LotteryEntry, now: Date = new Date()): LotteryEntryView {
  return { ...entry, effective_status: getEffectiveStatus(entry, now) };
}

// ---------------------------------------------------------------------------
// 抽選フォーム
// ---------------------------------------------------------------------------

export async function listLotteryForms(storeId: string): Promise<LotteryForm[]> {
  if (isLocal()) {
    return readJsonFile<Record<string, unknown>>(FORMS_FILE)
      .filter((f) => f.store_id === storeId)
      .map(normalizeLotteryForm)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const client = requireAdminClient();
  const { data, error } = await client
    .from('lottery_forms')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`抽選フォームの取得に失敗しました: ${error.message}`);
  return (data || []).map(normalizeLotteryForm);
}

export async function getLotteryForm(id: string): Promise<LotteryForm | null> {
  if (!id) return null;
  if (isLocal()) {
    const row = readJsonFile<Record<string, unknown>>(FORMS_FILE).find((f) => f.id === id);
    return row ? normalizeLotteryForm(row) : null;
  }
  const client = requireAdminClient();
  const { data, error } = await client.from('lottery_forms').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`抽選フォームの取得に失敗しました: ${error.message}`);
  return data ? normalizeLotteryForm(data) : null;
}

export async function lotteryFormIdExists(id: string): Promise<boolean> {
  return (await getLotteryForm(id)) !== null;
}

export interface CreateLotteryFormInput {
  id: string;
  store_id: string;
  config: LotteryConfig;
  status: LotteryFormStatus;
  created_by?: string | null;
}

export async function createLotteryForm(input: CreateLotteryFormInput): Promise<LotteryForm> {
  const ts = nowIso();
  const row: Record<string, unknown> = {
    id: input.id,
    store_id: input.store_id,
    name: input.config.basic_info.title || '',
    config: input.config,
    draft_config: null,
    status: input.status,
    draft_status: 'none',
    static_deploy: null,
    last_published_at: null,
    deferred_draw_status: 'accepting',
    deferred_drawn_at: null,
    deferred_notified_at: null,
    created_at: ts,
    updated_at: ts,
  };
  if (isLocal()) {
    const rows = readJsonFile<Record<string, unknown>>(FORMS_FILE);
    rows.push(row);
    writeJsonFile(FORMS_FILE, rows);
    return normalizeLotteryForm(row);
  }
  const client = requireAdminClient();
  const { data, error } = await client
    .from('lottery_forms')
    .insert({ ...row, created_by: input.created_by ?? null, updated_by: input.created_by ?? null })
    .select()
    .single();
  if (error || !data) throw new Error(`抽選フォームの作成に失敗しました: ${error?.message ?? 'unknown'}`);
  return normalizeLotteryForm(data);
}

export interface UpdateLotteryFormInput {
  config?: LotteryConfig;
  draft_config?: LotteryConfig | null;
  status?: LotteryFormStatus;
  draft_status?: LotteryDraftStatus;
  static_deploy?: StaticDeploy | null;
  last_published_at?: string | null;
  deferred_draw_status?: DeferredDrawStatus;
  deferred_drawn_at?: string | null;
  deferred_notified_at?: string | null;
  updated_by?: string | null;
}

export async function updateLotteryForm(id: string, patch: UpdateLotteryFormInput): Promise<LotteryForm | null> {
  const update: Record<string, unknown> = { updated_at: nowIso() };
  const keys: (keyof UpdateLotteryFormInput)[] = [
    'config', 'draft_config', 'status', 'draft_status', 'static_deploy', 'last_published_at',
    'deferred_draw_status', 'deferred_drawn_at', 'deferred_notified_at',
  ];
  for (const key of keys) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }
  if (patch.config) update.name = patch.config.basic_info.title || '';

  if (isLocal()) {
    const rows = readJsonFile<Record<string, unknown>>(FORMS_FILE);
    const idx = rows.findIndex((f) => f.id === id);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...update };
    writeJsonFile(FORMS_FILE, rows);
    return normalizeLotteryForm(rows[idx]);
  }
  const client = requireAdminClient();
  if (patch.updated_by !== undefined) update.updated_by = patch.updated_by;
  const { data, error } = await client.from('lottery_forms').update(update).eq('id', id).select().maybeSingle();
  if (error) throw new Error(`抽選フォームの更新に失敗しました: ${error.message}`);
  return data ? normalizeLotteryForm(data) : null;
}

/** 削除して、削除前の行を返す（監査ログ用）。無ければ null */
export async function deleteLotteryForm(id: string): Promise<LotteryForm | null> {
  if (isLocal()) {
    const rows = readJsonFile<Record<string, unknown>>(FORMS_FILE);
    const target = rows.find((f) => f.id === id);
    if (!target) return null;
    writeJsonFile(FORMS_FILE, rows.filter((f) => f.id !== id));
    // 履歴もカスケード削除
    const entries = readJsonFile<Record<string, unknown>>(ENTRIES_FILE);
    writeJsonFile(ENTRIES_FILE, entries.filter((e) => e.lottery_form_id !== id));
    return normalizeLotteryForm(target);
  }
  const before = await getLotteryForm(id);
  if (!before) return null;
  const client = requireAdminClient();
  const { error } = await client.from('lottery_forms').delete().eq('id', id);
  if (error) throw new Error(`抽選フォームの削除に失敗しました: ${error.message}`);
  return before;
}

// ---------------------------------------------------------------------------
// 抽選履歴
// ---------------------------------------------------------------------------

export interface LotteryEntryFilter {
  storeId: string;
  formId?: string | null;
  prizeId?: string | null;
  /** 'all' または表示用ステータス。'expired' は drawn + 期限切れ、'drawn' は drawn + 期限内 */
  status?: LotteryEntryEffectiveStatus | 'all' | null;
  /** LINE 表示名 / 引換コードの部分一致 */
  search?: string | null;
  from?: string | null; // entered_at >= from（ISO）
  to?: string | null;   // entered_at <= to（ISO）
  /** 顧客 ID（CRM 連携。顧客詳細の抽選履歴用） */
  customerId?: string | null;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function matchesStatusFilter(entry: LotteryEntry, status: LotteryEntryFilter['status'], now: Date): boolean {
  if (!status || status === 'all') return true;
  return getEffectiveStatus(entry, now) === status;
}

function matchesSearch(entry: LotteryEntry, search: string): boolean {
  const q = search.toLowerCase();
  return (
    (entry.line_display_name || '').toLowerCase().includes(q) ||
    (entry.redeem_code || '').toLowerCase().includes(q) ||
    (entry.prize_name || '').toLowerCase().includes(q)
  );
}

/** PostgREST の or() で意味を持つ文字を落とす */
function escapeForOrFilter(value: string): string {
  return value.replace(/[(),\\%_]/g, ' ').trim();
}

export async function listLotteryEntries(filter: LotteryEntryFilter): Promise<{ entries: LotteryEntryView[]; total: number }> {
  const now = new Date();
  const limit = clampLimit(filter.limit);
  const offset = filter.offset && filter.offset > 0 ? Math.floor(filter.offset) : 0;
  const search = filter.search?.trim() || null;

  if (isLocal()) {
    let rows = readJsonFile<Record<string, unknown>>(ENTRIES_FILE).map(toLotteryEntry).filter((e) => e.store_id === filter.storeId);
    if (filter.formId) rows = rows.filter((e) => e.lottery_form_id === filter.formId);
    if (filter.prizeId) rows = rows.filter((e) => e.prize_id === filter.prizeId);
    if (filter.customerId) rows = rows.filter((e) => e.customer_id === filter.customerId);
    if (filter.from) rows = rows.filter((e) => e.entered_at >= filter.from!);
    if (filter.to) rows = rows.filter((e) => e.entered_at <= filter.to!);
    rows = rows.filter((e) => matchesStatusFilter(e, filter.status, now));
    if (search) rows = rows.filter((e) => matchesSearch(e, search));
    rows.sort((a, b) => b.entered_at.localeCompare(a.entered_at));
    const total = rows.length;
    return { entries: rows.slice(offset, offset + limit).map((e) => toLotteryEntryView(e, now)), total };
  }

  const client = requireAdminClient();
  let query = client
    .from('lottery_entries')
    .select('*', { count: 'exact' })
    .eq('store_id', filter.storeId)
    .order('entered_at', { ascending: false });
  if (filter.formId) query = query.eq('lottery_form_id', filter.formId);
  if (filter.prizeId) query = query.eq('prize_id', filter.prizeId);
  if (filter.customerId) query = query.eq('customer_id', filter.customerId);
  if (filter.from) query = query.gte('entered_at', filter.from);
  if (filter.to) query = query.lte('entered_at', filter.to);
  if (filter.status && filter.status !== 'all') {
    if (filter.status === 'expired') {
      query = query.eq('status', 'drawn').lt('expires_at', now.toISOString());
    } else if (filter.status === 'drawn') {
      query = query.eq('status', 'drawn').or(`expires_at.is.null,expires_at.gte.${now.toISOString()}`);
    } else {
      query = query.eq('status', filter.status);
    }
  }
  if (search) {
    const q = escapeForOrFilter(search);
    if (q) {
      query = query.or(`line_display_name.ilike.%${q}%,redeem_code.ilike.%${q}%,prize_name.ilike.%${q}%`);
    }
  }
  query = query.range(offset, offset + limit - 1);
  const { data, error, count } = await query;
  if (error) throw new Error(`抽選履歴の取得に失敗しました: ${error.message}`);
  const entries = (data || []).map((row: Record<string, unknown>) => toLotteryEntryView(toLotteryEntry(row), now));
  return { entries, total: typeof count === 'number' ? count : entries.length };
}

/** フォーム内の全履歴（後日抽選・集計用。cancelled も含む） */
export async function listEntriesForForm(formId: string): Promise<LotteryEntry[]> {
  if (isLocal()) {
    return readJsonFile<Record<string, unknown>>(ENTRIES_FILE)
      .map(toLotteryEntry)
      .filter((e) => e.lottery_form_id === formId)
      .sort((a, b) => b.entered_at.localeCompare(a.entered_at));
  }
  const client = requireAdminClient();
  const { data, error } = await client
    .from('lottery_entries')
    .select('*')
    .eq('lottery_form_id', formId)
    .order('entered_at', { ascending: false });
  if (error) throw new Error(`抽選履歴の取得に失敗しました: ${error.message}`);
  return (data || []).map(toLotteryEntry);
}

export async function getLotteryEntry(storeId: string, entryId: string): Promise<LotteryEntry | null> {
  if (!entryId) return null;
  if (isLocal()) {
    const row = readJsonFile<Record<string, unknown>>(ENTRIES_FILE).find((e) => e.id === entryId && e.store_id === storeId);
    return row ? toLotteryEntry(row) : null;
  }
  const client = requireAdminClient();
  const { data, error } = await client.from('lottery_entries').select('*').eq('id', entryId).eq('store_id', storeId).maybeSingle();
  if (error) throw new Error(`抽選履歴の取得に失敗しました: ${error.message}`);
  return data ? toLotteryEntry(data) : null;
}

export async function getLotteryEntryByQrToken(storeId: string, qrToken: string): Promise<LotteryEntry | null> {
  if (!qrToken) return null;
  if (isLocal()) {
    const row = readJsonFile<Record<string, unknown>>(ENTRIES_FILE).find((e) => e.qr_token === qrToken && e.store_id === storeId);
    return row ? toLotteryEntry(row) : null;
  }
  const client = requireAdminClient();
  const { data, error } = await client.from('lottery_entries').select('*').eq('qr_token', qrToken).eq('store_id', storeId).maybeSingle();
  if (error) throw new Error(`抽選履歴の取得に失敗しました: ${error.message}`);
  return data ? toLotteryEntry(data) : null;
}

/** QR トークンだけから履歴を探す（店舗不問。/r/{token} が店舗のスキャン画面へ振り分けるために使う） */
export async function findLotteryEntryByQrTokenAnyStore(qrToken: string): Promise<LotteryEntry | null> {
  if (!qrToken) return null;
  if (isLocal()) {
    const row = readJsonFile<Record<string, unknown>>(ENTRIES_FILE).find((e) => e.qr_token === qrToken);
    return row ? toLotteryEntry(row) : null;
  }
  const client = requireAdminClient();
  const { data, error } = await client.from('lottery_entries').select('*').eq('qr_token', qrToken).maybeSingle();
  if (error) throw new Error(`抽選履歴の取得に失敗しました: ${error.message}`);
  return data ? toLotteryEntry(data) : null;
}

export async function getLotteryEntryByRedeemCode(storeId: string, code: string): Promise<LotteryEntry | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  if (isLocal()) {
    const row = readJsonFile<Record<string, unknown>>(ENTRIES_FILE).find((e) => e.redeem_code === normalized && e.store_id === storeId);
    return row ? toLotteryEntry(row) : null;
  }
  const client = requireAdminClient();
  const { data, error } = await client.from('lottery_entries').select('*').eq('redeem_code', normalized).eq('store_id', storeId).maybeSingle();
  if (error) throw new Error(`抽選履歴の取得に失敗しました: ${error.message}`);
  return data ? toLotteryEntry(data) : null;
}

export async function redeemCodeExists(storeId: string, code: string): Promise<boolean> {
  return (await getLotteryEntryByRedeemCode(storeId, code)) !== null;
}

export type LotteryEntryPatch = Partial<
  Pick<
    LotteryEntry,
    | 'status' | 'redeemed_at' | 'redeemed_by' | 'redeemed_note' | 'customer_id' | 'message_sent' | 'push_sent'
    | 'prize_id' | 'prize_name' | 'is_win' | 'is_consolation' | 'redeem_code' | 'qr_token' | 'expires_at'
  >
>;

export async function updateLotteryEntry(entryId: string, patch: LotteryEntryPatch): Promise<LotteryEntry | null> {
  const update: Record<string, unknown> = { ...patch, updated_at: nowIso() };
  if (isLocal()) {
    const rows = readJsonFile<Record<string, unknown>>(ENTRIES_FILE);
    const idx = rows.findIndex((e) => e.id === entryId);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...update };
    writeJsonFile(ENTRIES_FILE, rows);
    return toLotteryEntry(rows[idx]);
  }
  const client = requireAdminClient();
  const { data, error } = await client.from('lottery_entries').update(update).eq('id', entryId).select().maybeSingle();
  if (error) throw new Error(`抽選履歴の更新に失敗しました: ${error.message}`);
  return data ? toLotteryEntry(data) : null;
}

/** 賞品ごとの発行数（cancelled を除く）。在庫判定に使う */
export async function countPrizeEntries(formId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (isLocal()) {
    for (const e of await listEntriesForForm(formId)) {
      if (e.prize_id && e.status !== 'cancelled') counts[e.prize_id] = (counts[e.prize_id] ?? 0) + 1;
    }
    return counts;
  }
  const client = requireAdminClient();
  const { data, error } = await client
    .from('lottery_entries')
    .select('prize_id')
    .eq('lottery_form_id', formId)
    .not('prize_id', 'is', null)
    .neq('status', 'cancelled');
  if (error) throw new Error(`在庫の確認に失敗しました: ${error.message}`);
  for (const row of data || []) {
    const id = row.prize_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/** 同一ユーザーの履歴（新しい順。cancelled は除く） */
export async function listUserEntries(formId: string, lineUserId: string): Promise<LotteryEntry[]> {
  if (isLocal()) {
    return (await listEntriesForForm(formId)).filter((e) => e.line_user_id === lineUserId && e.status !== 'cancelled');
  }
  const client = requireAdminClient();
  const { data, error } = await client
    .from('lottery_entries')
    .select('*')
    .eq('lottery_form_id', formId)
    .eq('line_user_id', lineUserId)
    .neq('status', 'cancelled')
    .order('entered_at', { ascending: false });
  if (error) throw new Error(`抽選履歴の取得に失敗しました: ${error.message}`);
  return (data || []).map(toLotteryEntry);
}

export async function findLatestUserEntry(formId: string, lineUserId: string): Promise<LotteryEntry | null> {
  const entries = await listUserEntries(formId, lineUserId);
  return entries[0] ?? null;
}

export type NewLotteryEntry = Omit<LotteryEntry, 'id' | 'created_at' | 'updated_at' | 'message_sent' | 'push_sent'> & { id?: string };

export interface InsertEntryCheckedParams {
  form_id: string;
  line_user_id: string;
  prize_id: string | null;
  /** 賞品の在庫。null = 無制限 */
  prize_stock: number | null;
  window_start: Date | null;
  max_entries: number | null;
  entry: NewLotteryEntry;
}

export type InsertEntryCheckedResult =
  | { ok: true; entry: LotteryEntry }
  | { ok: false; reason: 'limit' | 'sold_out' | 'not_found' };

/**
 * 参加回数上限と賞品在庫を確認してから履歴を 1 件挿入する。
 * Supabase では DB 関数（フォーム行ロック）で原子的に実行する。
 */
export async function insertLotteryEntryChecked(params: InsertEntryCheckedParams): Promise<InsertEntryCheckedResult> {
  const ts = nowIso();
  const entry: LotteryEntry = {
    ...params.entry,
    id: params.entry.id || generateEntryId(),
    lottery_form_id: params.form_id,
    line_user_id: params.line_user_id,
    prize_id: params.prize_id,
    message_sent: false,
    push_sent: false,
    created_at: ts,
    updated_at: ts,
  };

  if (isLocal()) {
    const forms = readJsonFile<Record<string, unknown>>(FORMS_FILE);
    if (!forms.some((f) => f.id === params.form_id)) return { ok: false, reason: 'not_found' };
    const rows = readJsonFile<Record<string, unknown>>(ENTRIES_FILE);
    const existing = rows.map(toLotteryEntry).filter((e) => e.lottery_form_id === params.form_id && e.status !== 'cancelled');
    if (params.max_entries !== null) {
      const userCount = existing.filter(
        (e) => e.line_user_id === params.line_user_id && (!params.window_start || new Date(e.entered_at) >= params.window_start)
      ).length;
      if (userCount >= params.max_entries) return { ok: false, reason: 'limit' };
    }
    if (params.prize_id && params.prize_stock !== null) {
      const prizeCount = existing.filter((e) => e.prize_id === params.prize_id).length;
      if (prizeCount >= params.prize_stock) return { ok: false, reason: 'sold_out' };
    }
    rows.push(entry as unknown as Record<string, unknown>);
    writeJsonFile(ENTRIES_FILE, rows);
    return { ok: true, entry };
  }

  const client = requireAdminClient();
  const { data, error } = await client.rpc('lottery_insert_entry_checked', {
    p_form_id: params.form_id,
    p_line_user_id: params.line_user_id,
    p_prize_id: params.prize_id,
    p_prize_stock: params.prize_stock,
    p_window_start: params.window_start ? params.window_start.toISOString() : null,
    p_max_entries: params.max_entries,
    p_entry: {
      id: entry.id,
      store_id: entry.store_id,
      line_display_name: entry.line_display_name,
      line_friend_flag: entry.line_friend_flag,
      customer_id: entry.customer_id,
      prize_name: entry.prize_name,
      is_win: entry.is_win,
      is_consolation: entry.is_consolation,
      redeem_code: entry.redeem_code,
      qr_token: entry.qr_token,
      expires_at: entry.expires_at,
      status: entry.status,
      answers: entry.answers,
      user_agent: entry.user_agent,
      entered_at: entry.entered_at,
    },
  });
  if (error) throw new Error(`抽選の記録に失敗しました: ${error.message}`);
  const result = (data || {}) as { ok?: boolean; reason?: string; entry?: Record<string, unknown> };
  if (result.ok && result.entry) return { ok: true, entry: toLotteryEntry(result.entry) };
  const reason = result.reason === 'limit' || result.reason === 'sold_out' ? result.reason : 'not_found';
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

export function computeFormStats(entries: LotteryEntry[]): LotteryFormStats {
  const stats: LotteryFormStats = { entries: 0, wins: 0, redeemed: 0, prize_counts: {} };
  for (const e of entries) {
    if (e.status === 'cancelled') continue;
    stats.entries++;
    if (e.is_win) stats.wins++;
    if (e.status === 'redeemed') stats.redeemed++;
    if (e.prize_id) stats.prize_counts[e.prize_id] = (stats.prize_counts[e.prize_id] ?? 0) + 1;
  }
  return stats;
}

/** 店舗内の抽選フォームごとの集計（フォーム一覧カード用） */
export async function getLotteryFormStatsByStore(storeId: string): Promise<Record<string, LotteryFormStats>> {
  let entries: LotteryEntry[];
  if (isLocal()) {
    entries = readJsonFile<Record<string, unknown>>(ENTRIES_FILE).map(toLotteryEntry).filter((e) => e.store_id === storeId);
  } else {
    const client = requireAdminClient();
    const { data, error } = await client
      .from('lottery_entries')
      .select('lottery_form_id, prize_id, is_win, status')
      .eq('store_id', storeId);
    if (error) throw new Error(`抽選の集計に失敗しました: ${error.message}`);
    entries = (data || []).map((row: Record<string, unknown>) => toLotteryEntry({ ...row, store_id: storeId }));
  }
  const grouped: Record<string, LotteryEntry[]> = {};
  for (const e of entries) (grouped[e.lottery_form_id] ??= []).push(e);
  const result: Record<string, LotteryFormStats> = {};
  for (const [formId, rows] of Object.entries(grouped)) result[formId] = computeFormStats(rows);
  return result;
}

export { isEntryExpired };
