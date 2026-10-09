/**
 * 寄せ書きウォールのデータアクセス — サーバー専用（fs / Supabase）
 *
 * - local: data/wall_boards.json / wall_posts.json / wall_reports.json / wall_consents.json / wall_moderation_logs.json
 * - staging / production: Supabase（service_role）。投稿の上限判定と通報は DB 関数で 1 トランザクション
 *
 * ここが返す WallPostRow には author_hash が含まれる。API に出す整形は wall-service.ts で行う。
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeWallSettings } from '@/lib/wall-themes';
import { checkWallRate, jstDayStart, WALL_MIN_INTERVAL_SEC } from '@/lib/wall-rules';
import type { WallBoardSettings, WallPostRow, WallPostStatus, WallReportReason, WallTopic } from '@/types/wall';

function isLocal(): boolean {
  return getAppEnvironment() === 'local';
}

function dataFile(name: string): string {
  return path.join(process.cwd(), 'data', name);
}

function readJson<T>(name: string): T[] {
  try {
    const f = dataFile(name);
    if (!fs.existsSync(f)) return [];
    const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJson<T>(name: string, rows: T[]) {
  const dir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataFile(name), JSON.stringify(rows, null, 2));
}

function client() {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c as any;  
}

// ---------------------------------------------------------------------------
// 店舗
// ---------------------------------------------------------------------------

export interface WallStoreInfo {
  id: string;
  name: string;
  theme_color: string | null;
  line_channel_id: string | null;
}

export async function getWallStore(storeId: string): Promise<WallStoreInfo | null> {
  if (isLocal()) {
    const stores = readJson<Record<string, unknown>>('stores.json');
    const s = stores.find((x) => x.id === storeId);
    if (!s) return null;
    return {
      id: storeId,
      name: typeof s.name === 'string' ? s.name : '',
      theme_color: typeof s.theme_color === 'string' ? s.theme_color : null,
      line_channel_id: typeof s.line_channel_id === 'string' ? s.line_channel_id : null,
    };
  }
  // stores の列は環境で差がある（theme_color は local の JSON にしか無い）ため * で取り、あるものだけ使う
  const { data, error } = await client().from('stores').select('*').eq('id', storeId).maybeSingle();
  if (error) throw new Error(`店舗の取得に失敗しました: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    theme_color: typeof row.theme_color === 'string' && row.theme_color ? row.theme_color : null,
    line_channel_id: typeof row.line_channel_id === 'string' && row.line_channel_id ? row.line_channel_id : null,
  };
}

// ---------------------------------------------------------------------------
// ボード設定
// ---------------------------------------------------------------------------

/** ボード設定（行が無ければ既定 = 無効） */
export async function getWallBoard(storeId: string): Promise<WallBoardSettings> {
  if (isLocal()) {
    const row = readJson<Record<string, unknown>>('wall_boards.json').find((r) => r.store_id === storeId);
    return normalizeWallSettings(storeId, row);
  }
  const { data, error } = await client().from('wall_boards').select('*').eq('store_id', storeId).maybeSingle();
  if (error) throw new Error(`ボード設定の取得に失敗しました: ${error.message}`);
  return normalizeWallSettings(storeId, data);
}

export async function saveWallBoard(settings: WallBoardSettings): Promise<WallBoardSettings> {
  const now = new Date().toISOString();
  const row = {
    store_id: settings.store_id,
    enabled: settings.enabled,
    liff_id: settings.liff_id || null,
    moderation: settings.moderation,
    access_mode: settings.access_mode,
    daily_max: settings.daily_max,
    empathy_enabled: settings.empathy_enabled,
    empathy_show_count: settings.empathy_show_count,
    customer_pick_enabled: settings.customer_pick_enabled,
    theme: settings.theme,
    ng_words: settings.ng_words,
    updated_at: now,
  };
  if (isLocal()) {
    const rows = readJson<Record<string, unknown>>('wall_boards.json');
    const idx = rows.findIndex((r) => r.store_id === settings.store_id);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
    else rows.push({ ...row, created_at: now });
    writeJson('wall_boards.json', rows);
    return normalizeWallSettings(settings.store_id, row);
  }
  const { data, error } = await client().from('wall_boards').upsert(row, { onConflict: 'store_id' }).select('*').single();
  if (error) throw new Error(`ボード設定の保存に失敗しました: ${error.message}`);
  return normalizeWallSettings(settings.store_id, data);
}

// ---------------------------------------------------------------------------
// 付箋
// ---------------------------------------------------------------------------

/** 追加列（リアクション・お題・色・飾り・共感数）が無い古い行を補完する */
function withPostDefaults(r: WallPostRow): WallPostRow {
  return {
    ...r,
    reaction: r.reaction ?? null,
    reaction_at: r.reaction_at ?? null,
    topic_id: r.topic_id ?? null,
    note_color: r.note_color ?? null,
    note_deco: r.note_deco ?? null,
    empathy_count: Number(r.empathy_count) || 0,
  };
}

function sortNewest(a: WallPostRow, b: WallPostRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function beforeCursor(r: WallPostRow, cursor: { created_at: string; id: string } | null): boolean {
  if (!cursor) return true;
  const t = new Date(r.created_at).getTime();
  const c = new Date(cursor.created_at).getTime();
  return t < c || (t === c && r.id < cursor.id);
}

export interface ListPostsParams {
  storeId: string;
  statuses: WallPostStatus[];
  cursor: { created_at: string; id: string } | null;
  limit: number;
  reportedOnly?: boolean;
  /** お題で絞り込み */
  topicId?: string;
  /** 本人の付箋だけ（自分の付箋一覧） */
  authorHash?: string;
  /** 本文の部分一致 */
  search?: string;
  /** ID で絞り込み（あとで読むの照会） */
  ids?: string[];
}

/** 新しい順に limit + 1 件まで返す（呼び出し側で次ページの有無を判定） */
export async function listWallPosts(params: ListPostsParams): Promise<WallPostRow[]> {
  const { storeId, statuses, cursor, limit, reportedOnly, topicId, authorHash, search, ids } = params;
  const needle = search ? search.normalize('NFKC').toLowerCase() : '';
  if (isLocal()) {
    return readJson<WallPostRow>('wall_posts.json')
      .map(withPostDefaults)
      .filter((r) => r.store_id === storeId && statuses.includes(r.status) && beforeCursor(r, cursor) && (!reportedOnly || r.report_count > 0)
        && (!topicId || r.topic_id === topicId) && (!authorHash || r.author_hash === authorHash)
        && (!needle || r.body.normalize('NFKC').toLowerCase().includes(needle)) && (!ids || ids.includes(r.id)))
      .sort(sortNewest)
      .slice(0, limit + 1);
  }
  let q = client()
    .from('wall_posts')
    .select('*')
    .eq('store_id', storeId)
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (reportedOnly) q = q.gt('report_count', 0);
  if (topicId) q = q.eq('topic_id', topicId);
  if (authorHash) q = q.eq('author_hash', authorHash);
  if (ids) q = q.in('id', ids);
  if (needle) q = q.ilike('body', `%${needle.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  if (cursor) q = q.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt."${cursor.id}")`);
  const { data, error } = await q;
  if (error) throw new Error(`付箋の取得に失敗しました: ${error.message}`);
  return ((data || []) as WallPostRow[]).map(withPostDefaults);
}

export async function getWallPost(storeId: string, postId: string): Promise<WallPostRow | null> {
  if (isLocal()) {
    const r = readJson<WallPostRow>('wall_posts.json').find((r) => r.id === postId && r.store_id === storeId);
    return r ? withPostDefaults(r) : null;
  }
  const { data, error } = await client().from('wall_posts').select('*').eq('id', postId).eq('store_id', storeId).maybeSingle();
  if (error) throw new Error(`付箋の取得に失敗しました: ${error.message}`);
  return data ? withPostDefaults(data as WallPostRow) : null;
}

export interface InsertPostParams {
  storeId: string;
  authorHash: string;
  now: Date;
  /** この店舗の 1 日の枚数（wall_boards.daily_max） */
  dailyMax: number;
  post: { id: string; body: string; status: WallPostStatus; pending_reason: WallPostRow['pending_reason']; ng_hits: string[]; topic_id: string | null; note_color: string | null; note_deco: string | null };
}

export type InsertPostResult =
  | { ok: true; post: WallPostRow }
  | { ok: false; reason: 'daily' }
  | { ok: false; reason: 'interval'; retry_after: number }
  | { ok: false; reason: 'board_missing' };

/** 1 日の上限と前回からの間隔を確認して挿入する（DB 関数で 1 トランザクション） */
export async function insertWallPostChecked(params: InsertPostParams): Promise<InsertPostResult> {
  const { storeId, authorHash, now, post, dailyMax } = params;
  if (isLocal()) {
    const boards = readJson<Record<string, unknown>>('wall_boards.json');
    if (!boards.some((b) => b.store_id === storeId)) return { ok: false, reason: 'board_missing' };
    const rows = readJson<WallPostRow>('wall_posts.json');
    const mine = rows.filter((r) => r.store_id === storeId && r.author_hash === authorHash).map((r) => r.created_at);
    const rate = checkWallRate(mine, now, dailyMax);
    if (!rate.ok) return rate;
    const ts = now.toISOString();
    const row: WallPostRow = {
      id: post.id, store_id: storeId, body: post.body, status: post.status, pending_reason: post.pending_reason,
      ng_hits: post.ng_hits, author_hash: authorHash, report_count: 0, hidden_reason: null, hidden_at: null, hidden_by: null,
      reaction: null, reaction_at: null, topic_id: post.topic_id, note_color: post.note_color, note_deco: post.note_deco, empathy_count: 0,
      created_at: ts, updated_at: ts,
    };
    rows.push(row);
    writeJson('wall_posts.json', rows);
    return { ok: true, post: row };
  }
  const { data, error } = await client().rpc('wall_insert_post_checked', {
    p_store_id: storeId,
    p_author_hash: authorHash,
    p_day_start: jstDayStart(now).toISOString(),
    p_daily_max: dailyMax,
    p_min_interval_sec: WALL_MIN_INTERVAL_SEC,
    p_post: post,
  });
  if (error) throw new Error(`付箋の保存に失敗しました: ${error.message}`);
  const r = data as { ok: boolean; reason?: string; retry_after?: number; post?: WallPostRow };
  if (r.ok && r.post) return { ok: true, post: withPostDefaults(r.post) };
  if (r.reason === 'interval') return { ok: false, reason: 'interval', retry_after: Math.max(1, Number(r.retry_after) || 1) };
  if (r.reason === 'daily') return { ok: false, reason: 'daily' };
  return { ok: false, reason: 'board_missing' };
}

export type WallPostPatch = Partial<Pick<WallPostRow, 'status' | 'pending_reason' | 'report_count' | 'hidden_reason' | 'hidden_at' | 'hidden_by' | 'reaction' | 'reaction_at'>>;

export async function updateWallPost(storeId: string, postId: string, patch: WallPostPatch): Promise<WallPostRow | null> {
  const updated_at = new Date().toISOString();
  if (isLocal()) {
    const rows = readJson<WallPostRow>('wall_posts.json');
    const idx = rows.findIndex((r) => r.id === postId && r.store_id === storeId);
    if (idx < 0) return null;
    rows[idx] = { ...rows[idx], ...patch, updated_at };
    writeJson('wall_posts.json', rows);
    return withPostDefaults(rows[idx]);
  }
  const { data, error } = await client().from('wall_posts').update({ ...patch, updated_at }).eq('id', postId).eq('store_id', storeId).select('*').maybeSingle();
  if (error) throw new Error(`付箋の更新に失敗しました: ${error.message}`);
  return data ? withPostDefaults(data as WallPostRow) : null;
}

// ---------------------------------------------------------------------------
// 通報
// ---------------------------------------------------------------------------

export type AddReportResult =
  | { ok: true; duplicated: boolean; status: WallPostStatus; report_count: number }
  | { ok: false; reason: 'not_found' };

interface WallReportRow {
  id: string;
  store_id: string;
  post_id: string;
  reason: WallReportReason;
  reporter_hash: string;
  created_at: string;
}

export async function addWallReport(params: { storeId: string; postId: string; reporterHash: string; reason: WallReportReason; threshold: number }): Promise<AddReportResult> {
  const { storeId, postId, reporterHash, reason, threshold } = params;
  if (isLocal()) {
    const posts = readJson<WallPostRow>('wall_posts.json');
    const idx = posts.findIndex((r) => r.id === postId && r.store_id === storeId);
    if (idx < 0) return { ok: false, reason: 'not_found' };
    const reports = readJson<WallReportRow>('wall_reports.json');
    if (reports.some((r) => r.post_id === postId && r.reporter_hash === reporterHash)) {
      return { ok: true, duplicated: true, status: posts[idx].status, report_count: posts[idx].report_count };
    }
    const now = new Date().toISOString();
    reports.push({ id: `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, store_id: storeId, post_id: postId, reason, reporter_hash: reporterHash, created_at: now });
    writeJson('wall_reports.json', reports);
    const count = posts[idx].report_count + 1;
    const status: WallPostStatus = posts[idx].status === 'published' && count >= threshold ? 'review' : posts[idx].status;
    posts[idx] = { ...posts[idx], report_count: count, status, updated_at: now };
    writeJson('wall_posts.json', posts);
    return { ok: true, duplicated: false, status, report_count: count };
  }
  const { data, error } = await client().rpc('wall_add_report', {
    p_store_id: storeId, p_post_id: postId, p_reporter_hash: reporterHash, p_reason: reason, p_threshold: threshold,
  });
  if (error) throw new Error(`通報の保存に失敗しました: ${error.message}`);
  const r = data as { ok: boolean; duplicated?: boolean; status?: WallPostStatus; report_count?: number };
  if (!r.ok) return { ok: false, reason: 'not_found' };
  return { ok: true, duplicated: !!r.duplicated, status: r.status as WallPostStatus, report_count: Number(r.report_count) || 0 };
}

/** 付箋ごとの通報理由の件数（全期間） */
export async function countWallReportReasons(postIds: string[]): Promise<Record<string, Record<WallReportReason, number>>> {
  const out: Record<string, Record<WallReportReason, number>> = {};
  const empty = (): Record<WallReportReason, number> => ({ abuse: 0, personal_info: 0, advertising: 0, other: 0 });
  postIds.forEach((id) => { out[id] = empty(); });
  if (postIds.length === 0) return out;
  let rows: Array<{ post_id: string; reason: WallReportReason }>;
  if (isLocal()) {
    rows = readJson<WallReportRow>('wall_reports.json').filter((r) => postIds.includes(r.post_id));
  } else {
    const { data, error } = await client().from('wall_reports').select('post_id, reason').in('post_id', postIds);
    if (error) throw new Error(`通報の取得に失敗しました: ${error.message}`);
    rows = data || [];
  }
  rows.forEach((r) => { if (out[r.post_id] && r.reason in out[r.post_id]) out[r.post_id][r.reason] += 1; });
  return out;
}

// ---------------------------------------------------------------------------
// 同意
// ---------------------------------------------------------------------------

interface WallConsentRow { store_id: string; author_hash: string; terms_version: string; agreed_at: string }

export async function hasWallConsent(storeId: string, authorHash: string, termsVersion: string): Promise<boolean> {
  if (isLocal()) {
    return readJson<WallConsentRow>('wall_consents.json').some((r) => r.store_id === storeId && r.author_hash === authorHash && r.terms_version === termsVersion);
  }
  const { data, error } = await client().from('wall_consents').select('store_id').eq('store_id', storeId).eq('author_hash', authorHash).eq('terms_version', termsVersion).maybeSingle();
  if (error) throw new Error(`同意の確認に失敗しました: ${error.message}`);
  return !!data;
}

export async function saveWallConsent(storeId: string, authorHash: string, termsVersion: string): Promise<void> {
  if (isLocal()) {
    const rows = readJson<WallConsentRow>('wall_consents.json');
    if (!rows.some((r) => r.store_id === storeId && r.author_hash === authorHash && r.terms_version === termsVersion)) {
      rows.push({ store_id: storeId, author_hash: authorHash, terms_version: termsVersion, agreed_at: new Date().toISOString() });
      writeJson('wall_consents.json', rows);
    }
    return;
  }
  const { error } = await client().from('wall_consents').upsert({ store_id: storeId, author_hash: authorHash, terms_version: termsVersion }, { onConflict: 'store_id,author_hash,terms_version', ignoreDuplicates: true });
  if (error) throw new Error(`同意の保存に失敗しました: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 操作記録・集計
// ---------------------------------------------------------------------------

export async function logWallModeration(row: { store_id: string; post_id: string; action: 'publish' | 'hide'; reason: 'terms_violation' | null; actor_user_id: string | null; actor_email: string | null; actor_role: string | null }): Promise<void> {
  try {
    if (isLocal()) {
      const rows = readJson<Record<string, unknown>>('wall_moderation_logs.json');
      rows.push({ id: `mod_${Date.now().toString(36)}`, ...row, created_at: new Date().toISOString() });
      writeJson('wall_moderation_logs.json', rows);
      return;
    }
    await client().from('wall_moderation_logs').insert(row);
  } catch (e) {
    console.warn('[wall] moderation log failed:', e instanceof Error ? e.message : e);
  }
}

export async function countWallStats(storeId: string, since: Date): Promise<{ week_posts: number; pending: number; review: number }> {
  if (isLocal()) {
    const rows = readJson<WallPostRow>('wall_posts.json').filter((r) => r.store_id === storeId);
    return {
      week_posts: rows.filter((r) => new Date(r.created_at) >= since).length,
      pending: rows.filter((r) => r.status === 'pending').length,
      review: rows.filter((r) => r.status === 'review').length,
    };
  }
  const c = client();
  const [w, p, r] = await Promise.all([
    c.from('wall_posts').select('id', { count: 'exact', head: true }).eq('store_id', storeId).gte('created_at', since.toISOString()),
    c.from('wall_posts').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'pending'),
    c.from('wall_posts').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'review'),
  ]);
  return { week_posts: w.count || 0, pending: p.count || 0, review: r.count || 0 };
}

// ---------------------------------------------------------------------------
// 共感（押した人は hash のみ）
// ---------------------------------------------------------------------------

interface WallEmpathyRow { id: string; store_id: string; post_id: string; empathizer_hash: string; created_at: string }

export type ToggleEmpathyResult = { ok: true; empathized: boolean; count: number } | { ok: false; reason: 'not_found' };

/** 押す / 取り消す（公開中の付箋のみ。DB 関数で 1 トランザクション） */
export async function toggleWallEmpathy(storeId: string, postId: string, hash: string): Promise<ToggleEmpathyResult> {
  if (isLocal()) {
    const posts = readJson<WallPostRow>('wall_posts.json');
    const idx = posts.findIndex((r) => r.id === postId && r.store_id === storeId);
    if (idx < 0 || posts[idx].status !== 'published') return { ok: false, reason: 'not_found' };
    let rows = readJson<WallEmpathyRow>('wall_empathies.json');
    const existing = rows.findIndex((r) => r.post_id === postId && r.empathizer_hash === hash);
    let empathized: boolean;
    if (existing >= 0) {
      rows = rows.filter((_, i) => i !== existing);
      empathized = false;
    } else {
      rows.push({ id: `emp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, store_id: storeId, post_id: postId, empathizer_hash: hash, created_at: new Date().toISOString() });
      empathized = true;
    }
    writeJson('wall_empathies.json', rows);
    const count = rows.filter((r) => r.post_id === postId).length;
    posts[idx] = { ...withPostDefaults(posts[idx]), empathy_count: count, updated_at: new Date().toISOString() };
    writeJson('wall_posts.json', posts);
    return { ok: true, empathized, count };
  }
  const { data, error } = await client().rpc('wall_toggle_empathy', { p_store_id: storeId, p_post_id: postId, p_hash: hash });
  if (error) throw new Error(`共感の保存に失敗しました: ${error.message}`);
  const r = data as { ok: boolean; empathized?: boolean; count?: number };
  if (!r.ok) return { ok: false, reason: 'not_found' };
  return { ok: true, empathized: !!r.empathized, count: Number(r.count) || 0 };
}

/** 閲覧者が共感済みの付箋 ID */
export async function getEmpathizedPostIds(postIds: string[], hash: string): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  if (isLocal()) {
    return new Set(readJson<WallEmpathyRow>('wall_empathies.json').filter((r) => r.empathizer_hash === hash && postIds.includes(r.post_id)).map((r) => r.post_id));
  }
  const { data, error } = await client().from('wall_empathies').select('post_id').eq('empathizer_hash', hash).in('post_id', postIds);
  if (error) throw new Error(`共感の取得に失敗しました: ${error.message}`);
  return new Set(((data || []) as Array<{ post_id: string }>).map((r) => r.post_id));
}

// ---------------------------------------------------------------------------
// お題
// ---------------------------------------------------------------------------

function sortTopics(a: WallTopic, b: WallTopic): number {
  return a.starts_on < b.starts_on ? 1 : a.starts_on > b.starts_on ? -1 : a.id < b.id ? 1 : -1;
}

export async function listWallTopics(storeId: string): Promise<WallTopic[]> {
  if (isLocal()) {
    return readJson<WallTopic>('wall_topics.json').filter((t) => t.store_id === storeId).sort(sortTopics);
  }
  const { data, error } = await client().from('wall_topics').select('*').eq('store_id', storeId).order('starts_on', { ascending: false });
  if (error) throw new Error(`お題の取得に失敗しました: ${error.message}`);
  return (data || []) as WallTopic[];
}

export async function saveWallTopic(topic: WallTopic): Promise<WallTopic> {
  if (isLocal()) {
    const rows = readJson<WallTopic>('wall_topics.json');
    const idx = rows.findIndex((t) => t.id === topic.id && t.store_id === topic.store_id);
    if (idx >= 0) rows[idx] = topic;
    else rows.push(topic);
    writeJson('wall_topics.json', rows);
    return topic;
  }
  const { data, error } = await client().from('wall_topics').upsert(topic, { onConflict: 'id' }).select('*').single();
  if (error) throw new Error(`お題の保存に失敗しました: ${error.message}`);
  return data as WallTopic;
}

export async function deleteWallTopic(storeId: string, topicId: string): Promise<boolean> {
  if (isLocal()) {
    const rows = readJson<WallTopic>('wall_topics.json');
    const next = rows.filter((t) => !(t.id === topicId && t.store_id === storeId));
    if (next.length === rows.length) return false;
    writeJson('wall_topics.json', next);
    const posts = readJson<WallPostRow>('wall_posts.json').map((p) => (p.topic_id === topicId ? { ...p, topic_id: null } : p));
    writeJson('wall_posts.json', posts);
    return true;
  }
  const { data, error } = await client().from('wall_topics').delete().eq('id', topicId).eq('store_id', storeId).select('id');
  if (error) throw new Error(`お題の削除に失敗しました: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// 見どころ（本文と日時だけ。投稿者情報は読まない）
// ---------------------------------------------------------------------------

export async function listWallPostsForInsights(storeId: string, since: Date): Promise<Array<{ body: string; created_at: string; status: string }>> {
  if (isLocal()) {
    return readJson<WallPostRow>('wall_posts.json')
      .filter((r) => r.store_id === storeId && new Date(r.created_at) >= since)
      .map((r) => ({ body: r.body, created_at: r.created_at, status: r.status }));
  }
  const { data, error } = await client().from('wall_posts').select('body, created_at, status').eq('store_id', storeId).gte('created_at', since.toISOString()).limit(5000);
  if (error) throw new Error(`付箋の取得に失敗しました: ${error.message}`);
  return (data || []) as Array<{ body: string; created_at: string; status: string }>;
}
