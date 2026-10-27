/**
 * 宿泊モード（booking_mode = 'stay'）のサーバー専用処理（fs / Supabase / Google カレンダーに依存。クライアントから import しない）
 *
 * - 空き状況: 予約 DB + 店舗カレンダー（+ stay_settings.block_calendar_ids）→ 夜ごとの状態（src/lib/stay-availability.ts）
 * - 予約の挿入: Supabase は DB 関数 stay_insert_reservation_checked（同じ夜の二重予約を防ぐ）、local は JSON 内で同じ判定
 * 設計: docs/旅館用予約フォーム検討資料/旅館用予約フォーム_実装設計.md
 */
import fs from 'fs';
import path from 'path';
import type { Form, StaySettings } from '@/types/form';
import { getAppEnvironment } from './env';
import { createAdminClient } from './supabase';
import { listCalendarEvents } from './google-calendar';
import { normalizeForm } from './form-normalizer';
import { isHolidayBlocked, isJapaneseHoliday } from './japanese-holidays';
import {
  addDays,
  buildNightStatus,
  jstMs,
  occupiedCountByNight,
  type NightStatusMap,
  type StayCalendarEvent,
  type StayReservationRow,
} from './stay-availability';
import { sanitizeStaySettings, type GuestCounts } from './stay-pricing';

const DATA_DIR = path.join(process.cwd(), 'data');

type FormConfig = Form['config'];

/** フォーム設定（normalize 済み）。store_id が一致しなければ null */
export async function loadStayFormConfig(storeId: string, formId: string): Promise<FormConfig | null> {
  if (!formId || !storeId) return null;
  if (getAppEnvironment() === 'local') {
    try {
      if (!fs.existsSync(DATA_DIR)) return null;
      const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('forms') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
          const found = Array.isArray(arr) ? arr.find((f: { id?: string }) => f?.id === formId) : null;
          if (found) {
            const normalized = normalizeForm(found);
            return normalized.store_id === storeId ? normalized.config : null;
          }
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.error('[stay] loadStayFormConfig local error:', e);
    }
    return null;
  }
  const client = createAdminClient();
  if (!client) return null;
   
  const { data, error } = await (client as any)
    .from('reservation_forms')
    .select('id, store_id, config, draft_config')
    .eq('id', formId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (error || !data) return null;
  return normalizeForm(data).config;
}

/** 店舗カレンダー ID（未連携 / local は null） */
export async function loadStoreCalendarId(storeId: string): Promise<string | null> {
  if (getAppEnvironment() === 'local') return null;
  const client = createAdminClient();
  if (!client) return null;
   
  const { data } = await (client as any).from('stores').select('google_calendar_id').eq('id', storeId).maybeSingle();
  return data?.google_calendar_id || null;
}

/** local の予約 JSON（全件） */
export function readLocalReservations(): Array<Record<string, unknown>> {
  const file = path.join(DATA_DIR, 'reservations.json');
  if (!fs.existsSync(file)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 期間に掛かる宿泊予約（キャンセル除く）。from 〜 to は夜の範囲（含む） */
export async function loadStayReservations(
  storeId: string,
  from: string,
  to: string,
  excludeReservationId?: string | null
): Promise<StayReservationRow[]> {
  const pick = (r: Record<string, unknown>): StayReservationRow => ({
    reservation_date: String(r.reservation_date || ''),
    checkout_date: typeof r.checkout_date === 'string' ? r.checkout_date : null,
    status: typeof r.status === 'string' ? r.status : null,
  });
  if (getAppEnvironment() === 'local') {
    return readLocalReservations()
      .filter((r) => r.store_id === storeId && typeof r.checkout_date === 'string' && r.status !== 'cancelled' && r.id !== excludeReservationId)
      .filter((r) => String(r.checkout_date) > from && String(r.reservation_date) <= to)
      .map(pick);
  }
  const client = createAdminClient();
  if (!client) return [];
   
  let q = (client as any)
    .from('reservations')
    .select('id, reservation_date, checkout_date, status')
    .eq('store_id', storeId)
    .not('checkout_date', 'is', null)
    .neq('status', 'cancelled')
    .gt('checkout_date', from)
    .lte('reservation_date', to);
  if (excludeReservationId) q = q.neq('id', excludeReservationId);
  const { data, error } = await q;
  if (error) {
    console.error('[stay] loadStayReservations error:', error);
    return [];
  }
  return (data || []).map(pick);
}

/** 店舗カレンダー + 追加カレンダーの予定（夜の窓に掛かる範囲）。取得に失敗したカレンダーがあれば degraded */
export async function loadStayCalendarEvents(
  storeId: string,
  calendarIds: string[],
  settings: Pick<StaySettings, 'check_in_time' | 'check_out_time'>,
  from: string,
  to: string
): Promise<{ events: StayCalendarEvent[]; degraded: boolean }> {
  const ids = [...new Set(calendarIds.filter((id) => typeof id === 'string' && id.trim()))];
  if (ids.length === 0 || getAppEnvironment() === 'local') return { events: [], degraded: false };
  const startIso = new Date(jstMs(from, settings.check_in_time)).toISOString();
  const endIso = new Date(jstMs(addDays(to, 1), settings.check_out_time)).toISOString();
  let degraded = false;
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const items = await listCalendarEvents(id, startIso, endIso, storeId);
        return items
          .map((e) => ({ start: e.start?.dateTime || e.start?.date || '', end: e.end?.dateTime || e.end?.date || '' }))
          .filter((e) => e.start && e.end);
      } catch (err) {
        degraded = true;
        console.error(`[stay] calendar events error (calendar=${id}):`, err instanceof Error ? err.message : err);
        return [] as StayCalendarEvent[];
      }
    })
  );
  return { events: results.flat(), degraded };
}

export interface StayNightStatusResult {
  status: NightStatusMap;
  settings: StaySettings;
  calendar_degraded: boolean;
}

/** 期間の夜ごとの状態（空き・残り・料金） */
export async function getStayNightStatus(args: {
  storeId: string;
  config: FormConfig;
  from: string;
  to: string;
  counts: GuestCounts;
  now?: Date;
  excludeReservationId?: string | null;
}): Promise<StayNightStatusResult> {
  const cs = args.config.calendar_settings;
  const settings = sanitizeStaySettings(cs?.stay_settings);
  const storeCalendarId = await loadStoreCalendarId(args.storeId);
  const calendarIds = [storeCalendarId || '', ...(settings.block_calendar_ids || [])].filter(Boolean);
  const [reservations, cal] = await Promise.all([
    loadStayReservations(args.storeId, args.from, args.to, args.excludeReservationId),
    loadStayCalendarEvents(args.storeId, calendarIds, settings, args.from, args.to),
  ]);
  const occupied = occupiedCountByNight({ from: args.from, to: args.to }, reservations, cal.events, settings);
  const status = buildNightStatus(
    { from: args.from, to: args.to },
    occupied,
    settings,
    cs,
    args.now ?? new Date(),
    isJapaneseHoliday,
    (d) => isHolidayBlocked(cs, d),
    args.counts
  );
  return { status, settings, calendar_degraded: cal.degraded };
}

/** 指定の夜がすべて空いているか（予約 + カレンダー予定。受付期間などは見ない） */
export async function checkStayNightsFree(args: {
  storeId: string;
  settings: StaySettings;
  nights: string[];
  excludeReservationId?: string | null;
}): Promise<{ ok: boolean; night?: string; calendar_degraded: boolean }> {
  if (args.nights.length === 0) return { ok: false, calendar_degraded: false };
  const from = args.nights[0];
  const to = args.nights[args.nights.length - 1];
  const storeCalendarId = await loadStoreCalendarId(args.storeId);
  const calendarIds = [storeCalendarId || '', ...(args.settings.block_calendar_ids || [])].filter(Boolean);
  const [reservations, cal] = await Promise.all([
    loadStayReservations(args.storeId, from, to, args.excludeReservationId),
    loadStayCalendarEvents(args.storeId, calendarIds, args.settings, from, to),
  ]);
  const occupied = occupiedCountByNight({ from, to }, reservations, cal.events, args.settings);
  const roomCount = Math.max(1, args.settings.room_count || 1);
  for (const n of args.nights) {
    if ((occupied.get(n) || 0) >= roomCount) return { ok: false, night: n, calendar_degraded: cal.degraded };
  }
  return { ok: true, calendar_degraded: cal.degraded };
}

/**
 * Supabase: DB 関数で「同じ夜の有効予約数 < room_count」を確認してから INSERT（ロック付き）。
 * 返り値 ok=false のときは reason = 'stay_full' | 'invalid'
 */
export async function insertStayReservationChecked(
  row: Record<string, unknown>,
  roomCount: number
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; reason: string }> {
  const client = createAdminClient();
  if (!client) return { ok: false, reason: 'no_client' };
   
  const { data, error } = await (client as any).rpc('stay_insert_reservation_checked', {
    p_row: row,
    p_room_count: Math.max(1, roomCount || 1),
  });
  if (error) {
    console.error('[stay] stay_insert_reservation_checked error:', error);
    return { ok: false, reason: error.message || 'rpc_error' };
  }
  if (!data || data.ok !== true) return { ok: false, reason: (data && data.reason) || 'unknown' };
  return { ok: true, row: data.row as Record<string, unknown> };
}

/** 宿泊以外の予約と同じ形式の ID（reservations.id の既定値 = ハイフン無しの UUID） */
export function newStayReservationId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
