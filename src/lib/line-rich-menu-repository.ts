/**
 * リッチメニューのデータアクセス（サーバー専用。fs / Supabase）
 * - local: data/line_rich_menus.json
 * - staging / production: Supabase `line_rich_menus`（service_role）
 *
 * マイグレーション（20261125000000_add_line_rich_menus.sql）が未適用でも、
 * 一覧は空を返す（ほかの画面を止めない）。作成・更新は「未適用」の文言を返す。
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeRichMenuAreas, isRichMenuSize, DEFAULT_CHAT_BAR_TEXT, type LineRichMenu, type RichMenuInput, type RichMenuStatus } from '@/lib/line-rich-menu';
import { normalizeRichMenuRule, type RichMenuLink } from '@/lib/line-rich-menu-rules';

const TABLE = 'line_rich_menus';
const FILE = 'line_rich_menus.json';
export const RICH_MENU_SCHEMA_MISSING_MESSAGE = 'リッチメニューのマイグレーションがまだ適用されていません。運営にお問い合わせください';

const isLocal = () => getAppEnvironment() === 'local';
const dataFile = () => path.join(process.cwd(), 'data', FILE);

function client() {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
   
  return c as any;
}

export function isMissingRichMenuSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205' || error.code === 'PGRST204') return true;
  const m = (error.message || '').toLowerCase();
  return m.includes('line_rich_menus') && (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache'));
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeRow(row: Record<string, unknown>): LineRichMenu {
  const status = row.status;
  const now = new Date().toISOString();
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    name: typeof row.name === 'string' ? row.name : '',
    size: isRichMenuSize(row.size) ? row.size : 'large',
    image_url: typeof row.image_url === 'string' ? row.image_url : '',
    areas: normalizeRichMenuAreas(parseJson(row.areas)),
    chat_bar_text: typeof row.chat_bar_text === 'string' && row.chat_bar_text ? row.chat_bar_text : DEFAULT_CHAT_BAR_TEXT,
    open_by_default: row.open_by_default !== false,
    status: status === 'publishing' || status === 'published' || status === 'failed' ? status : 'draft',
    line_rich_menu_id: typeof row.line_rich_menu_id === 'string' && row.line_rich_menu_id ? row.line_rich_menu_id : null,
    is_default: row.is_default === true,
    dirty: row.dirty === true,
    rule: normalizeRichMenuRule(row.rule),
    last_error: typeof row.last_error === 'string' && row.last_error ? row.last_error : null,
    published_at: typeof row.published_at === 'string' ? row.published_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : now,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : now,
  };
}

function readLocal(): LineRichMenu[] {
  try {
    if (!fs.existsSync(dataFile())) return [];
    const parsed = JSON.parse(fs.readFileSync(dataFile(), 'utf-8'));
    return Array.isArray(parsed) ? parsed.map((r) => normalizeRow(r as Record<string, unknown>)) : [];
  } catch {
    return [];
  }
}
function writeLocal(rows: LineRichMenu[]) {
  const dir = path.dirname(dataFile());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(rows, null, 2));
}

export type RepoResult<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

/** その店舗のメニュー（作った順）。表が無い環境では空 */
export async function listRichMenus(storeId: string): Promise<LineRichMenu[]> {
  if (isLocal()) return readLocal().filter((r) => r.store_id === storeId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const { data, error } = await client().from(TABLE).select('*').eq('store_id', storeId).order('created_at', { ascending: true }).limit(200);
  if (error) {
    if (isMissingRichMenuSchema(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r: Record<string, unknown>) => normalizeRow(r));
}

/** 店舗の中の 1 件（ほかの店舗のものは null） */
export async function getRichMenu(storeId: string, id: string): Promise<LineRichMenu | null> {
  if (isLocal()) return readLocal().find((r) => r.id === id && r.store_id === storeId) ?? null;
  const { data, error } = await client().from(TABLE).select('*').eq('id', id).eq('store_id', storeId).maybeSingle();
  if (error) {
    if (isMissingRichMenuSchema(error)) return null;
    throw new Error(error.message);
  }
  return data ? normalizeRow(data) : null;
}

export async function insertRichMenu(storeId: string, input: RichMenuInput): Promise<RepoResult<LineRichMenu>> {
  const now = new Date().toISOString();
  if (isLocal()) {
    const rows = readLocal();
    const row = normalizeRow({ id: randomUUID(), store_id: storeId, ...input, status: 'draft', created_at: now, updated_at: now });
    rows.push(row);
    writeLocal(rows);
    return { data: row };
  }
  const { data, error } = await client()
    .from(TABLE)
    .insert({ store_id: storeId, name: input.name, size: input.size, image_url: input.image_url, areas: input.areas, chat_bar_text: input.chat_bar_text, open_by_default: input.open_by_default, rule: input.rule ?? null })
    .select('*')
    .single();
  if (error) return { error: isMissingRichMenuSchema(error) ? RICH_MENU_SCHEMA_MISSING_MESSAGE : `保存に失敗しました: ${error.message}` };
  return { data: normalizeRow(data) };
}

export type RichMenuPatch = Partial<
  Pick<LineRichMenu, 'name' | 'size' | 'image_url' | 'areas' | 'chat_bar_text' | 'open_by_default' | 'status' | 'line_rich_menu_id' | 'is_default' | 'dirty' | 'last_error' | 'published_at' | 'rule'>
>;

/**
 * 更新する。onlyIfStatus を渡すと、その状態のときだけ更新する（反映の処理が重ならないようにする確保）。
 * 条件に合わず更新できなかったときは data: null
 */
export async function updateRichMenu(storeId: string, id: string, patch: RichMenuPatch, opts: { onlyIfStatus?: RichMenuStatus[]; onlyIfUpdatedAt?: string } = {}): Promise<RepoResult<LineRichMenu | null>> {
  const now = new Date().toISOString();
  if (isLocal()) {
    const rows = readLocal();
    const index = rows.findIndex((r) => r.id === id && r.store_id === storeId);
    if (index === -1) return { data: null };
    if (opts.onlyIfStatus && !opts.onlyIfStatus.includes(rows[index].status)) return { data: null };
    if (opts.onlyIfUpdatedAt && rows[index].updated_at !== opts.onlyIfUpdatedAt) return { data: null };
    rows[index] = normalizeRow({ ...rows[index], ...patch, updated_at: now });
    writeLocal(rows);
    return { data: rows[index] };
  }
  let query = client().from(TABLE).update({ ...patch, updated_at: now }).eq('id', id).eq('store_id', storeId);
  if (opts.onlyIfStatus) query = query.in('status', opts.onlyIfStatus);
  if (opts.onlyIfUpdatedAt) query = query.eq('updated_at', opts.onlyIfUpdatedAt);
  const { data, error } = await query.select('*').maybeSingle();
  if (error) return { error: isMissingRichMenuSchema(error) ? RICH_MENU_SCHEMA_MISSING_MESSAGE : `保存に失敗しました: ${error.message}` };
  return { data: data ? normalizeRow(data) : null };
}

export async function deleteRichMenuRow(storeId: string, id: string): Promise<RepoResult<boolean>> {
  if (isLocal()) {
    const rows = readLocal();
    const next = rows.filter((r) => !(r.id === id && r.store_id === storeId));
    writeLocal(next);
    return { data: next.length !== rows.length };
  }
  const { error } = await client().from(TABLE).delete().eq('id', id).eq('store_id', storeId);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  return { data: true };
}

// ---------------------------------------------------------------------------
// お客様ごとのメニューの設定の記録（このシステムが LINE に設定した人だけを持つ）
// local: data/line_rich_menu_links.json / Supabase: line_rich_menu_links
// ---------------------------------------------------------------------------

const LINKS_TABLE = 'line_rich_menu_links';
const linksFile = () => path.join(process.cwd(), 'data', 'line_rich_menu_links.json');
export const RICH_MENU_LINKS_SCHEMA_MISSING_MESSAGE = 'お客様ごとの切り替えのマイグレーションがまだ適用されていません。運営にお問い合わせください';

type LinkRow = RichMenuLink & { store_id: string };

function isMissingLinksSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const m = (error.message || '').toLowerCase();
  return m.includes(LINKS_TABLE) && (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache'));
}

function readLocalLinks(): LinkRow[] {
  try {
    if (!fs.existsSync(linksFile())) return [];
    const parsed = JSON.parse(fs.readFileSync(linksFile(), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeLocalLinks(rows: LinkRow[]) {
  const dir = path.dirname(linksFile());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(linksFile(), JSON.stringify(rows, null, 2));
}

/** 設定の記録の表があるか（マイグレーションが適用されているか）。local は常に true */
export async function hasRichMenuLinksTable(): Promise<boolean> {
  if (isLocal()) return true;
  const { error } = await client().from(LINKS_TABLE).select('line_user_id').limit(1);
  return !isMissingLinksSchema(error);
}

/** その店舗の設定の記録（1000 件ずつ全件）。表が無い環境では空 */
export async function listRichMenuLinks(storeId: string): Promise<RichMenuLink[]> {
  if (isLocal()) return readLocalLinks().filter((r) => r.store_id === storeId).map(({ line_user_id, menu_id, line_rich_menu_id }) => ({ line_user_id, menu_id, line_rich_menu_id }));
  const rows: RichMenuLink[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await client().from(LINKS_TABLE).select('line_user_id, menu_id, line_rich_menu_id').eq('store_id', storeId).order('line_user_id', { ascending: true }).range(from, from + 999);
    if (error) {
      if (isMissingLinksSchema(error)) return [];
      throw new Error(error.message);
    }
    rows.push(...((data ?? []) as RichMenuLink[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** 設定した人を記録する（同じ人は上書き） */
export async function upsertRichMenuLinks(storeId: string, links: RichMenuLink[]): Promise<string | null> {
  if (links.length === 0) return null;
  if (isLocal()) {
    const ids = new Set(links.map((l) => l.line_user_id));
    writeLocalLinks([...readLocalLinks().filter((r) => !(r.store_id === storeId && ids.has(r.line_user_id))), ...links.map((l) => ({ store_id: storeId, ...l }))]);
    return null;
  }
  const now = new Date().toISOString();
  const { error } = await client()
    .from(LINKS_TABLE)
    .upsert(links.map((l) => ({ store_id: storeId, line_user_id: l.line_user_id, menu_id: l.menu_id, line_rich_menu_id: l.line_rich_menu_id, linked_at: now })), { onConflict: 'store_id,line_user_id' });
  return error ? (isMissingLinksSchema(error) ? RICH_MENU_LINKS_SCHEMA_MISSING_MESSAGE : error.message) : null;
}

/** 設定を外した人の記録を消す */
export async function deleteRichMenuLinks(storeId: string, userIds: string[]): Promise<string | null> {
  if (userIds.length === 0) return null;
  if (isLocal()) {
    const ids = new Set(userIds);
    writeLocalLinks(readLocalLinks().filter((r) => !(r.store_id === storeId && ids.has(r.line_user_id))));
    return null;
  }
  const { error } = await client().from(LINKS_TABLE).delete().eq('store_id', storeId).in('line_user_id', userIds);
  return error ? error.message : null;
}

/** お客様ごとのメニューを公式 LINE に出している店舗（1 日 1 回の見直しの対象） */
export async function listStoresWithRuleMenus(): Promise<string[]> {
  if (isLocal()) return [...new Set(readLocal().filter((m) => m.rule && m.status === 'published').map((m) => m.store_id))];
  const { data, error } = await client().from(TABLE).select('store_id').eq('status', 'published').not('rule', 'is', null).limit(5000);
  if (error) {
    if (isMissingRichMenuSchema(error)) return [];
    throw new Error(error.message);
  }
  return [...new Set(((data ?? []) as Array<{ store_id: string }>).map((r) => r.store_id))];
}
