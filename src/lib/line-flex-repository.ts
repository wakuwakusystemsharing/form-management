/**
 * 公式 LINE Flex Message のデータアクセス（サーバー専用。fs / Supabase）
 * - local: data/line_flex_messages.json
 * - staging / production: Supabase `line_flex_messages`（service_role）
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import type { LineFlexMessage } from '@/types/line-flex';

const FILE = 'line_flex_messages.json';

function isLocal(): boolean {
  return getAppEnvironment() === 'local';
}
function dataFile(): string {
  return path.join(process.cwd(), 'data', FILE);
}
function readAll(): LineFlexMessage[] {
  try {
    const f = dataFile();
    if (!fs.existsSync(f)) return [];
    const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as LineFlexMessage[]) : [];
  } catch {
    return [];
  }
}
function writeAll(rows: LineFlexMessage[]) {
  const dir = path.dirname(dataFile());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(rows, null, 2));
}
function client() {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c as any;
}

function normalizeRow(row: Record<string, unknown>): LineFlexMessage {
  const parse = <T,>(v: unknown, fallback: T): T => {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as T;
      } catch {
        return fallback;
      }
    }
    return v as T;
  };
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    name: typeof row.name === 'string' ? row.name : '',
    template: (row.template as LineFlexMessage['template']) || 'custom',
    data: parse(row.data, {} as LineFlexMessage['data']),
    flex_override: parse<LineFlexMessage['flex_override']>(row.flex_override, null),
    alt_text: typeof row.alt_text === 'string' ? row.alt_text : '',
    keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    attach_confirm: row.attach_confirm === true,
    attach_reminder: row.attach_reminder === true,
    attach_follow: row.attach_follow === true,
    enabled: row.enabled !== false,
    track_taps: row.track_taps !== false,
    payload: parse<LineFlexMessage['payload']>(row.payload, null),
    links: parse<Record<string, string>>(row.links, {}),
    reply_count: typeof row.reply_count === 'number' ? row.reply_count : 0,
    tap_counts: parse<Record<string, number>>(row.tap_counts, {}),
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

export async function listLineFlexMessages(storeId: string): Promise<LineFlexMessage[]> {
  if (isLocal()) {
    return readAll()
      .filter((r) => r.store_id === storeId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  const { data, error } = await client().from('line_flex_messages').select('*').eq('store_id', storeId).order('updated_at', { ascending: false });
  if (error) throw new Error(`LINE メッセージの取得に失敗しました: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeRow);
}

export async function getLineFlexMessage(storeId: string, id: string): Promise<LineFlexMessage | null> {
  if (isLocal()) {
    return readAll().find((r) => r.store_id === storeId && r.id === id) ?? null;
  }
  const { data, error } = await client().from('line_flex_messages').select('*').eq('store_id', storeId).eq('id', id).maybeSingle();
  if (error) throw new Error(`LINE メッセージの取得に失敗しました: ${error.message}`);
  return data ? normalizeRow(data as Record<string, unknown>) : null;
}

/** 計測リンク用（店舗を問わず ID で引く。返すのは links と track のみ） */
export async function getLineFlexLinkTarget(id: string, key: string): Promise<string | null> {
  if (isLocal()) {
    const row = readAll().find((r) => r.id === id);
    return row?.links?.[key] ?? null;
  }
  const { data, error } = await client().from('line_flex_messages').select('links').eq('id', id).maybeSingle();
  if (error || !data) return null;
  const links = normalizeRow({ id, store_id: '', ...(data as Record<string, unknown>) }).links;
  return links[key] ?? null;
}

export async function insertLineFlexMessage(row: LineFlexMessage): Promise<LineFlexMessage> {
  if (isLocal()) {
    const rows = readAll();
    if (rows.some((r) => r.id === row.id)) throw new Error('同じ ID のメッセージがあります');
    rows.push(row);
    writeAll(rows);
    return row;
  }
  const { data, error } = await client().from('line_flex_messages').insert(toDbRow(row)).select('*').single();
  if (error) throw new Error(`LINE メッセージの保存に失敗しました: ${error.message}`);
  return normalizeRow(data as Record<string, unknown>);
}

export async function updateLineFlexMessage(row: LineFlexMessage): Promise<LineFlexMessage> {
  if (isLocal()) {
    const rows = readAll();
    const i = rows.findIndex((r) => r.id === row.id && r.store_id === row.store_id);
    if (i < 0) throw new Error('メッセージが見つかりません');
    rows[i] = row;
    writeAll(rows);
    return row;
  }
  const { id, store_id, created_at, reply_count, tap_counts, ...rest } = toDbRow(row);
  void created_at; void reply_count; void tap_counts;
  const { data, error } = await client().from('line_flex_messages').update(rest).eq('id', id).eq('store_id', store_id).select('*').single();
  if (error) throw new Error(`LINE メッセージの更新に失敗しました: ${error.message}`);
  return normalizeRow(data as Record<string, unknown>);
}

export async function deleteLineFlexMessage(storeId: string, id: string): Promise<boolean> {
  if (isLocal()) {
    const rows = readAll();
    const next = rows.filter((r) => !(r.id === id && r.store_id === storeId));
    if (next.length === rows.length) return false;
    writeAll(next);
    return true;
  }
  const { data, error } = await client().from('line_flex_messages').delete().eq('id', id).eq('store_id', storeId).select('id');
  if (error) throw new Error(`LINE メッセージの削除に失敗しました: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** 有効で、送信用 payload を持つものだけ（Webhook / 差し込み用） */
export async function listEnabledLineFlexMessages(storeId: string): Promise<LineFlexMessage[]> {
  const rows = await listLineFlexMessages(storeId);
  return rows.filter((r) => r.enabled && r.payload);
}

export async function incrementLineFlexReply(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (isLocal()) {
    const rows = readAll();
    for (const r of rows) if (ids.includes(r.id)) r.reply_count = (r.reply_count ?? 0) + 1;
    writeAll(rows);
    return;
  }
  const { error } = await client().rpc('line_flex_increment_reply', { p_ids: ids });
  if (error) console.warn('[line-flex] reply_count 更新に失敗:', error.message);
}

export async function incrementLineFlexTap(id: string, key: string): Promise<void> {
  if (isLocal()) {
    const rows = readAll();
    const r = rows.find((x) => x.id === id);
    if (r) {
      r.tap_counts = { ...(r.tap_counts ?? {}), [key]: ((r.tap_counts ?? {})[key] ?? 0) + 1 };
      writeAll(rows);
    }
    return;
  }
  const { error } = await client().rpc('line_flex_increment_tap', { p_id: id, p_key: key });
  if (error) console.warn('[line-flex] tap_counts 更新に失敗:', error.message);
}

function toDbRow(row: LineFlexMessage): Record<string, unknown> {
  return {
    id: row.id,
    store_id: row.store_id,
    name: row.name,
    template: row.template,
    data: row.data,
    flex_override: row.flex_override,
    alt_text: row.alt_text,
    keywords: row.keywords,
    attach_confirm: row.attach_confirm,
    attach_reminder: row.attach_reminder,
    attach_follow: row.attach_follow,
    enabled: row.enabled,
    track_taps: row.track_taps,
    payload: row.payload,
    links: row.links,
    reply_count: row.reply_count,
    tap_counts: row.tap_counts,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
