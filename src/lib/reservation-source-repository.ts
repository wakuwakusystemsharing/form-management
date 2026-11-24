/**
 * 流入経路の保存先 — サーバー専用（fs / Supabase に依存。クライアントから import しない）
 *
 * - local 環境は data/reservation_sources.json（+ 既存の data/forms_{storeId}.json）、それ以外は reservation_sources テーブル
 * - テーブルは API（service_role）からだけ読み書きする（RLS のポリシーは作らない）
 * - **予約の受付を止めない**: 予約から呼ぶ関数（resolveActiveSourceCode / attachReservationSource）は例外を投げず、
 *   テーブルや列が未適用の環境では「経路なし」として扱う
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeForm } from '@/lib/form-normalizer';
import { getReservationFormName } from '@/lib/form-display-name';
import type { FormConfig, StaticDeploy } from '@/types/form';
import { generateSourceCode, pickSourceCode, type ReservationSource, type SourceForm } from '@/lib/reservation-sources';
import { fetchAllRows } from '@/lib/supabase-fetch-all';
import type { SourceStatsOptions, SourceStatsReservation } from '@/lib/reservation-source-stats';

const TABLE = 'reservation_sources';
const DATA_DIR = path.join(process.cwd(), 'data');
const localFile = () => path.join(DATA_DIR, 'reservation_sources.json');
const isLocal = () => getAppEnvironment() === 'local';

export interface StoreFormSummary extends SourceForm {
  id: string;
  name: string;
}

function readLocal(): ReservationSource[] {
  try {
    if (!fs.existsSync(localFile())) return [];
    const data = JSON.parse(fs.readFileSync(localFile(), 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLocal(rows: ReservationSource[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(localFile(), JSON.stringify(rows, null, 2));
}

function client(): any {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c;
}

function toSource(row: any): ReservationSource {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    form_id: String(row.form_id),
    name: String(row.name ?? ''),
    code: String(row.code),
    active: row.active !== false,
    click_count: Number(row.click_count) || 0,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? row.created_at ?? ''),
  };
}

function toFormSummary(raw: any): StoreFormSummary {
  const normalized = normalizeForm(raw);
  return {
    id: String(raw.id),
    name: getReservationFormName(normalized) || 'フォーム',
    config: normalized.config as FormConfig,
    staticDeploy: ((raw.static_deploy as StaticDeploy | null) || null),
  };
}

/** テーブル / 列が無い（マイグレーション未適用）ときのエラーか */
export function isMissingSourceSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205' || error.code === 'PGRST204') return true;
  const msg = (error.message || '').toLowerCase();
  return (msg.includes(TABLE) || msg.includes('source_code')) && (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache'));
}

export const SOURCE_SCHEMA_MISSING_MESSAGE = '流入経路のデータベース更新（マイグレーション）がまだ適用されていません';

// ---------------------------------------------------------------------------
// 経路
// ---------------------------------------------------------------------------

export async function listSources(storeId: string): Promise<ReservationSource[]> {
  if (isLocal()) {
    return readLocal().filter((r) => r.store_id === storeId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const { data, error } = await client().from(TABLE).select('*').eq('store_id', storeId).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1000);
  if (error) {
    if (isMissingSourceSchema(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(toSource);
}

export async function getSourceById(storeId: string, id: string): Promise<ReservationSource | null> {
  if (isLocal()) return readLocal().find((r) => r.store_id === storeId && r.id === id) ?? null;
  const { data, error } = await client().from(TABLE).select('*').eq('store_id', storeId).eq('id', id).maybeSingle();
  if (error) {
    if (isMissingSourceSchema(error)) return null;
    throw new Error(error.message);
  }
  return data ? toSource(data) : null;
}

/** 合言葉から経路を探す（店舗を問わない。`/s/{code}` 用）。見つからない・読めないときは null */
export async function getSourceByCode(code: string): Promise<ReservationSource | null> {
  if (!pickSourceCode(code)) return null;
  try {
    if (isLocal()) return readLocal().find((r) => r.code === code) ?? null;
    const { data, error } = await client().from(TABLE).select('*').eq('code', code).maybeSingle();
    if (error || !data) return null;
    return toSource(data);
  } catch {
    return null;
  }
}

/** 経路を作る。合言葉が既にあれば作り直す（5 回まで）。失敗時は { error } */
export async function insertSource(input: { store_id: string; form_id: string; name: string }, now: Date = new Date()): Promise<{ source: ReservationSource } | { error: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row: ReservationSource = {
      id: randomUUID(),
      store_id: input.store_id,
      form_id: input.form_id,
      name: input.name,
      code: generateSourceCode(),
      active: true,
      click_count: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    if (isLocal()) {
      const rows = readLocal();
      if (rows.some((r) => r.code === row.code)) continue;
      writeLocal([...rows, row]);
      return { source: row };
    }
    const { data, error } = await client().from(TABLE).insert(row).select('*').single();
    if (!error && data) return { source: toSource(data) };
    if (isMissingSourceSchema(error)) return { error: SOURCE_SCHEMA_MISSING_MESSAGE };
    if (error?.code === '23505') continue; // 合言葉の重複 → 作り直す
    console.error('[reservation-source] 作成エラー:', error?.message);
    return { error: '経路の作成に失敗しました' };
  }
  return { error: '経路の作成に失敗しました（もう一度お試しください）' };
}

export async function updateSource(storeId: string, id: string, patch: { name?: string; form_id?: string; active?: boolean }, now: Date = new Date()): Promise<ReservationSource | null> {
  const clean: Record<string, unknown> = { updated_at: now.toISOString() };
  if (patch.name !== undefined) clean.name = patch.name;
  if (patch.form_id !== undefined) clean.form_id = patch.form_id;
  if (patch.active !== undefined) clean.active = patch.active;
  if (isLocal()) {
    const rows = readLocal();
    const i = rows.findIndex((r) => r.store_id === storeId && r.id === id);
    if (i < 0) return null;
    rows[i] = { ...rows[i], ...(clean as Partial<ReservationSource>) };
    writeLocal(rows);
    return rows[i];
  }
  const { data, error } = await client().from(TABLE).update(clean).eq('store_id', storeId).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSource(data) : null;
}

/** 「読まれた数」を 1 増やす（失敗しても何もしない。リダイレクトを止めない） */
export async function incrementSourceClick(code: string): Promise<void> {
  try {
    if (isLocal()) {
      const rows = readLocal();
      const i = rows.findIndex((r) => r.code === code);
      if (i < 0) return;
      rows[i] = { ...rows[i], click_count: (rows[i].click_count || 0) + 1 };
      writeLocal(rows);
      return;
    }
    // 読んでから足して書く、だと同時に開かれたとき数がずれるので DB の関数で足す
    await client().rpc('reservation_source_increment_click', { p_code: code });
  } catch (e) {
    console.warn('[reservation-source] click count error:', e);
  }
}

// ---------------------------------------------------------------------------
// フォーム（経路が開く先）
// ---------------------------------------------------------------------------

export async function listStoreForms(storeId: string): Promise<StoreFormSummary[]> {
  if (isLocal()) {
    try {
      const file = path.join(DATA_DIR, `forms_${storeId}.json`);
      if (!fs.existsSync(file)) return [];
      const forms = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return Array.isArray(forms) ? forms.map(toFormSummary) : [];
    } catch {
      return [];
    }
  }
  const { data, error } = await client().from('reservation_forms').select('id, store_id, config, draft_config, static_deploy, created_at').eq('store_id', storeId).order('created_at', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toFormSummary);
}

export async function getStoreForm(storeId: string, formId: string): Promise<StoreFormSummary | null> {
  try {
    if (isLocal()) return (await listStoreForms(storeId)).find((f) => f.id === formId) ?? null;
    const { data, error } = await client().from('reservation_forms').select('id, store_id, config, draft_config, static_deploy').eq('store_id', storeId).eq('id', formId).maybeSingle();
    if (error || !data) return null;
    return toFormSummary(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 集計用の予約
// ---------------------------------------------------------------------------

const STATS_COLUMNS = 'id, form_id, status, reservation_date, selected_menus, selected_options, customer_info, stay_price_total, source_code';

/**
 * 流入経路の集計に使う予約を返す。
 * - 経路のある予約: 全期間（予約率を累計で出すため。経路のある予約だけなので件数は少ない）
 * - 経路の無い予約: 指定した期間・フォームのものだけ（「経路なし」の件数用）
 * 絞り込みそのものは computeSourceStats が行う（ここでは読む量を減らすだけ）。
 * 列が未適用の環境では空を返す
 */
export async function listReservationsForSourceStats(storeId: string, opts: SourceStatsOptions = {}): Promise<SourceStatsReservation[]> {
  if (isLocal()) {
    try {
      const file = path.join(DATA_DIR, 'reservations.json');
      if (!fs.existsSync(file)) return [];
      const rows = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return Array.isArray(rows) ? rows.filter((r: any) => r && r.store_id === storeId) : [];
    } catch {
      return [];
    }
  }
  const c = client();
  try {
    const sourced = await fetchAllRows<SourceStatsReservation>((from, to) =>
      c.from('reservations').select(STATS_COLUMNS).eq('store_id', storeId).not('source_code', 'is', null).order('id', { ascending: true }).range(from, to)
    );
    const unsourced = await fetchAllRows<SourceStatsReservation>((from, to) => {
      let q = c.from('reservations').select(STATS_COLUMNS).eq('store_id', storeId).is('source_code', null);
      if (opts.dateFrom) q = q.gte('reservation_date', opts.dateFrom);
      if (opts.dateTo) q = q.lte('reservation_date', opts.dateTo);
      if (opts.formId) q = q.eq('form_id', opts.formId);
      return q.order('id', { ascending: true }).range(from, to);
    });
    return [...sourced, ...unsourced];
  } catch (e) {
    if (isMissingSourceSchema({ message: e instanceof Error ? e.message : String(e) })) return [];
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 予約から呼ぶ（例外を投げない）
// ---------------------------------------------------------------------------

/**
 * フォームが送ってきた合言葉を確かめる。その店舗の、有効な経路のものだけを返す（それ以外は null）。
 * 経路が停止中・別の店舗のもの・形がおかしい・テーブルが無い → null（予約はそのまま受け付ける）
 */
export async function resolveActiveSourceCode(storeId: string, raw: unknown): Promise<string | null> {
  const code = pickSourceCode(raw);
  if (!code || !storeId) return null;
  const source = await getSourceByCode(code);
  if (!source || source.store_id !== storeId || !source.active) return null;
  return source.code;
}

/**
 * 予約に経路を記録する（Supabase。予約を保存した**あと**に別の更新として行う）。
 * 予約の保存そのものに列を足さないのは、列が未適用の環境で予約が保存できなくなるのを避けるため。
 * 失敗しても何もしない（予約は成功のまま）
 */
export async function attachReservationSource(storeId: string, reservationId: string, code: string | null): Promise<void> {
  if (!code || !reservationId || isLocal()) return;
  try {
    const { error } = await client().from('reservations').update({ source_code: code }).eq('id', reservationId).eq('store_id', storeId);
    if (error && !isMissingSourceSchema(error)) console.warn('[reservation-source] 予約への記録に失敗:', error.message);
  } catch (e) {
    console.warn('[reservation-source] 予約への記録エラー:', e);
  }
}
