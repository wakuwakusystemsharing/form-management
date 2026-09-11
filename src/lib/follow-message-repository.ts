/**
 * フォローメッセージ配信予定（キュー）の作成・更新（サーバー専用: fs / Supabase に依存）
 *
 * 設計: docs/フォローメッセージ機能_実装設計.md / 監査対応: docs/リマインダー・フォローメッセージ_送信動作監査レポート_完全版.md
 * - 予約成立時: scheduleFollowMessageForReservation()（同じ顧客の未送信行を superseded にして作り直す。Supabase は DB 関数で 1 トランザクション）
 * - 予約キャンセル時: cancelFollowMessageForReservation() → restoreFollowMessageForUser()（差し替えられていた予定を復活）
 * - 予約日の変更時: rescheduleFollowMessageForReservation()（予約日が変わったときだけ呼ぶ）
 * - 店舗設定の変更時: applyFollowSettingsToScheduledRows() / フォロー ON 時: backfillFollowMessagesForStore()
 * - 顧客詳細の表示用: getFollowMessageSummariesByReservationIds() / getReminderLogSummariesByReservationIds()
 *
 * 呼び出し元の処理（予約作成など）を止めないよう、公開関数は例外を投げず null / false / 0 を返す。
 * 実際の送信は Supabase Edge Function `send-follow-messages` が行う（local では送信しない）。
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import type { FollowMessage, FollowMessageSummary, ReminderLogSummary } from '@/types/follow-message';
import type { Store } from '@/types/store';
import {
  computeScheduledAt,
  normalizeFollowBase,
  normalizeFollowDaysAfter,
  normalizeFollowTime,
  resolveBaseDate,
  toJstDateString,
} from '@/lib/follow-message-scheduler';

const DATA_DIR = path.join(process.cwd(), 'data');
const FOLLOW_FILE = path.join(DATA_DIR, 'follow_messages.json');
const REMINDER_LOG_FILE = path.join(DATA_DIR, 'reminder_logs.json');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');

export interface FollowReservationInput {
  id: string;
  store_id: string;
  line_user_id?: string | null;
  customer_id?: string | null;
  reservation_date?: string | null;
  created_at?: string | null;
  status?: string | null;
}

export type StoreFollowSettings = Pick<Store, 'follow_enabled' | 'follow_base' | 'follow_days_after' | 'follow_time'>;

// ---------------------------------------------------------------------------
// 共通
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

function generateId(): string {
  return `fm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function loadStoreFollowSettings(storeId: string): Promise<StoreFollowSettings | null> {
  if (isLocal()) {
    const stores = readJsonFile<Store>(STORES_FILE);
    return stores.find((s) => s.id === storeId) || null;
  }
  const client = createAdminClient();
  if (!client) return null;
  const { data, error } = await (client as any)
    .from('stores')
    .select('follow_enabled,follow_base,follow_days_after,follow_time')
    .eq('id', storeId)
    .maybeSingle();
  if (error) {
    console.error('[follow-message] store lookup error:', error.message);
    return null;
  }
  return (data as StoreFollowSettings) || null;
}

/**
 * 店舗設定と予約から配信予定（基準日・送信時刻）を計算。対象外なら null
 * @param allowPast true のとき、計算結果が過去でも返す（既存予定の計算し直し用。次回実行で送られる）
 */
export function computeFollowSchedule(
  store: StoreFollowSettings | null,
  reservation: Pick<FollowReservationInput, 'line_user_id' | 'reservation_date' | 'created_at'>,
  now: Date,
  allowPast = false
): { baseDate: string; scheduledAt: string } | null {
  if (!store || store.follow_enabled !== true) return null;
  if (!reservation.line_user_id) return null;
  const baseDate = resolveBaseDate(reservation, normalizeFollowBase(store.follow_base), now);
  if (!baseDate) return null;
  const scheduledAt = computeScheduledAt(baseDate, normalizeFollowDaysAfter(store.follow_days_after), normalizeFollowTime(store.follow_time));
  if (!scheduledAt) return null;
  // 既に過ぎた予定（過去日の手動登録など）は新規には作らない
  if (!allowPast && new Date(scheduledAt).getTime() <= now.getTime()) return null;
  return { baseDate, scheduledAt };
}

// ---------------------------------------------------------------------------
// 予約成立時: 同じ顧客の未送信行を差し替えて作成
// ---------------------------------------------------------------------------

/**
 * 予約成立時にフォロー配信予定を作る。
 * - 店舗のフォローが OFF / LINE ユーザー ID が無い / 予定が過去 → 何もしない（null）
 * - 同じ店舗・同じ LINE ユーザーの未送信（scheduled / failed）行は superseded にする
 * - この予約の行が既にある場合: sent / sending なら触らない。それ以外は scheduled に作り直す（キャンセル → 復元にも対応）
 * Supabase では DB 関数 follow_message_schedule で 1 トランザクションにして競合・欠落を防ぐ
 */
export async function scheduleFollowMessageForReservation(
  reservation: FollowReservationInput,
  now: Date = new Date()
): Promise<FollowMessage | null> {
  try {
    if (!reservation?.id || !reservation.store_id) return null;
    if (reservation.status === 'cancelled') return null;
    const store = await loadStoreFollowSettings(reservation.store_id);
    const schedule = computeFollowSchedule(store, reservation, now);
    if (!schedule) return null;
    const nowIso = now.toISOString();
    const lineUserId = reservation.line_user_id as string;

    if (isLocal()) {
      const rows = readJsonFile<FollowMessage>(FOLLOW_FILE);
      rows.forEach((r) => {
        if (r.store_id === reservation.store_id && r.line_user_id === lineUserId && r.reservation_id !== reservation.id
          && (r.status === 'scheduled' || r.status === 'failed')) {
          r.status = 'superseded';
          r.updated_at = nowIso;
        }
      });
      const existing = rows.find((r) => r.reservation_id === reservation.id);
      if (existing) {
        if (existing.status === 'sent' || existing.status === 'sending') { writeJsonFile(FOLLOW_FILE, rows); return existing; }
        Object.assign(existing, {
          line_user_id: lineUserId,
          customer_id: reservation.customer_id ?? existing.customer_id ?? null,
          base_date: schedule.baseDate,
          scheduled_at: schedule.scheduledAt,
          status: 'scheduled',
          skip_reason: null,
          attempt_count: 0,
          last_error: null,
          claimed_at: null,
          sent_at: null,
          updated_at: nowIso,
        });
        writeJsonFile(FOLLOW_FILE, rows);
        return existing;
      }
      const row: FollowMessage = {
        id: generateId(),
        store_id: reservation.store_id,
        reservation_id: reservation.id,
        line_user_id: lineUserId,
        customer_id: reservation.customer_id ?? null,
        base_date: schedule.baseDate,
        scheduled_at: schedule.scheduledAt,
        status: 'scheduled',
        skip_reason: null,
        attempt_count: 0,
        last_error: null,
        claimed_at: null,
        sent_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      rows.push(row);
      writeJsonFile(FOLLOW_FILE, rows);
      return row;
    }

    const client = createAdminClient();
    if (!client) return null;
    const { data, error } = await (client as any).rpc('follow_message_schedule', {
      p_store_id: reservation.store_id,
      p_reservation_id: reservation.id,
      p_line_user_id: lineUserId,
      p_customer_id: reservation.customer_id ?? null,
      p_base_date: schedule.baseDate,
      p_scheduled_at: schedule.scheduledAt,
    });
    if (error) {
      console.error('[follow-message] schedule error:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return (row as FollowMessage) || null;
  } catch (e) {
    console.error('[follow-message] schedule failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// キャンセル時
// ---------------------------------------------------------------------------

/** 予約キャンセル時: 未送信行を cancelled にする */
export async function cancelFollowMessageForReservation(reservationId: string, now: Date = new Date()): Promise<boolean> {
  try {
    if (!reservationId) return false;
    const nowIso = now.toISOString();
    if (isLocal()) {
      const rows = readJsonFile<FollowMessage>(FOLLOW_FILE);
      let changed = false;
      rows.forEach((r) => {
        if (r.reservation_id === reservationId && (r.status === 'scheduled' || r.status === 'failed')) {
          r.status = 'cancelled';
          r.skip_reason = 'reservation_cancelled';
          r.updated_at = nowIso;
          changed = true;
        }
      });
      if (changed) writeJsonFile(FOLLOW_FILE, rows);
      return changed;
    }
    const client = createAdminClient();
    if (!client) return false;
    const { error } = await (client as any)
      .from('follow_messages')
      .update({ status: 'cancelled', skip_reason: 'reservation_cancelled', updated_at: nowIso })
      .eq('reservation_id', reservationId)
      .in('status', ['scheduled', 'failed']);
    if (error) {
      console.error('[follow-message] cancel error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[follow-message] cancel failed:', e);
    return false;
  }
}

/**
 * 再予約がキャンセルされたとき: 同じ顧客の superseded 行のうち、元の予約が有効で予定が未来のものを 1 件だけ scheduled に戻す。
 * 既に有効な予定（scheduled / sending）があれば何もしない。
 */
export async function restoreFollowMessageForUser(
  storeId: string,
  lineUserId: string | null | undefined,
  now: Date = new Date()
): Promise<FollowMessage | null> {
  try {
    if (!storeId || !lineUserId) return null;
    if (isLocal()) {
      const rows = readJsonFile<FollowMessage>(FOLLOW_FILE);
      const mine = rows.filter((r) => r.store_id === storeId && r.line_user_id === lineUserId);
      if (mine.some((r) => r.status === 'scheduled' || r.status === 'sending')) return null;
      const reservations = readJsonFile<{ id: string; status?: string }>(RESERVATIONS_FILE);
      const candidate = mine
        .filter((r) => r.status === 'superseded' && new Date(r.scheduled_at).getTime() > now.getTime())
        .filter((r) => {
          const rsv = reservations.find((x) => x.id === r.reservation_id);
          return rsv && rsv.status !== 'cancelled';
        })
        .sort((a, b) => b.base_date.localeCompare(a.base_date) || b.updated_at.localeCompare(a.updated_at))[0];
      if (!candidate) return null;
      candidate.status = 'scheduled';
      candidate.skip_reason = null;
      candidate.updated_at = now.toISOString();
      writeJsonFile(FOLLOW_FILE, rows);
      return candidate;
    }
    const client = createAdminClient();
    if (!client) return null;
    const { data, error } = await (client as any).rpc('follow_message_restore_for_user', {
      p_store_id: storeId,
      p_line_user_id: lineUserId,
    });
    if (error) {
      console.error('[follow-message] restore error:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return (row as FollowMessage) || null;
  } catch (e) {
    console.error('[follow-message] restore failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 予約日の変更時
// ---------------------------------------------------------------------------

/**
 * 予約日が変わったとき、未送信（scheduled / failed）の行だけ予定を計算し直す。
 * 計算結果が過去でも scheduled のまま残す（次回実行で送られる）。店舗が OFF になっていれば skipped / store_disabled。
 * 送信済み・差替済み・取消済みの行は触らない。行が無ければ何もしない（成立時に対象外だった予約）。
 */
export async function rescheduleFollowMessageForReservation(
  reservation: FollowReservationInput,
  now: Date = new Date()
): Promise<boolean> {
  try {
    if (!reservation?.id || reservation.status === 'cancelled') return false;
    const store = await loadStoreFollowSettings(reservation.store_id);
    const schedule = computeFollowSchedule(store, reservation, now, true);
    const nowIso = now.toISOString();
    const patch = schedule
      ? { base_date: schedule.baseDate, scheduled_at: schedule.scheduledAt, updated_at: nowIso }
      : { status: 'skipped' as const, skip_reason: (store?.follow_enabled === true ? 'no_line_user' : 'store_disabled') as FollowMessage['skip_reason'], updated_at: nowIso };

    if (isLocal()) {
      const rows = readJsonFile<FollowMessage>(FOLLOW_FILE);
      const row = rows.find((r) => r.reservation_id === reservation.id && (r.status === 'scheduled' || r.status === 'failed'));
      if (!row) return false;
      Object.assign(row, patch);
      writeJsonFile(FOLLOW_FILE, rows);
      return true;
    }

    const client = createAdminClient();
    if (!client) return false;
    const { error } = await (client as any)
      .from('follow_messages')
      .update(patch)
      .eq('reservation_id', reservation.id)
      .in('status', ['scheduled', 'failed']);
    if (error) {
      console.error('[follow-message] reschedule error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[follow-message] reschedule failed:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 店舗設定の変更時
// ---------------------------------------------------------------------------

type ReservationLite = { id: string; store_id: string; line_user_id?: string | null; customer_id?: string | null; reservation_date?: string | null; created_at?: string | null; status?: string | null };

async function loadReservationsByIds(ids: string[]): Promise<ReservationLite[]> {
  if (ids.length === 0) return [];
  if (isLocal()) {
    return readJsonFile<ReservationLite>(RESERVATIONS_FILE).filter((r) => ids.includes(r.id));
  }
  const client = createAdminClient();
  if (!client) return [];
  const out: ReservationLite[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await (client as any)
      .from('reservations')
      .select('id,store_id,line_user_id,customer_id,reservation_date,created_at,status')
      .in('id', ids.slice(i, i + 500));
    if (error) { console.error('[follow-message] reservations lookup error:', error.message); return out; }
    out.push(...(data || []));
  }
  return out;
}

/**
 * 店舗のフォロー設定（基準日・何日後・時刻）が変わったとき、その店舗の未送信（scheduled / failed）行をすべて新設定で計算し直す。
 * 計算結果が過去なら次回実行で送られる。OFF に変わった場合は行を触らない（送信時に store_disabled で見送られる）。
 * @returns 更新した行数
 */
export async function applyFollowSettingsToScheduledRows(storeId: string, now: Date = new Date()): Promise<number> {
  try {
    if (!storeId) return 0;
    const store = await loadStoreFollowSettings(storeId);
    if (!store || store.follow_enabled !== true) return 0;
    const nowIso = now.toISOString();

    if (isLocal()) {
      const rows = readJsonFile<FollowMessage>(FOLLOW_FILE);
      const targets = rows.filter((r) => r.store_id === storeId && (r.status === 'scheduled' || r.status === 'failed'));
      const reservations = await loadReservationsByIds(targets.map((r) => r.reservation_id));
      let count = 0;
      targets.forEach((row) => {
        const rsv = reservations.find((x) => x.id === row.reservation_id);
        if (!rsv) return;
        const schedule = computeFollowSchedule(store, { line_user_id: row.line_user_id, reservation_date: rsv.reservation_date, created_at: rsv.created_at }, now, true);
        if (!schedule) return;
        if (schedule.baseDate !== row.base_date || schedule.scheduledAt !== row.scheduled_at) {
          row.base_date = schedule.baseDate; row.scheduled_at = schedule.scheduledAt; row.updated_at = nowIso; count++;
        }
      });
      if (count > 0) writeJsonFile(FOLLOW_FILE, rows);
      return count;
    }

    const client = createAdminClient();
    if (!client) return 0;
    const { data: targets, error } = await (client as any)
      .from('follow_messages')
      .select('id,reservation_id,line_user_id,base_date,scheduled_at')
      .eq('store_id', storeId)
      .in('status', ['scheduled', 'failed']);
    if (error) { console.error('[follow-message] settings apply lookup error:', error.message); return 0; }
    const rows: Array<{ id: string; reservation_id: string; line_user_id: string; base_date: string; scheduled_at: string }> = targets || [];
    const reservations = await loadReservationsByIds(rows.map((r) => r.reservation_id));
    let count = 0;
    for (const row of rows) {
      const rsv = reservations.find((x) => x.id === row.reservation_id);
      if (!rsv) continue;
      const schedule = computeFollowSchedule(store, { line_user_id: row.line_user_id, reservation_date: rsv.reservation_date, created_at: rsv.created_at }, now, true);
      if (!schedule) continue;
      if (schedule.baseDate === row.base_date && new Date(schedule.scheduledAt).getTime() === new Date(row.scheduled_at).getTime()) continue;
      const { error: upErr } = await (client as any)
        .from('follow_messages')
        .update({ base_date: schedule.baseDate, scheduled_at: schedule.scheduledAt, updated_at: nowIso })
        .eq('id', row.id)
        .in('status', ['scheduled', 'failed']);
      if (upErr) console.error('[follow-message] settings apply update error:', upErr.message); else count++;
    }
    return count;
  } catch (e) {
    console.error('[follow-message] settings apply failed:', e);
    return 0;
  }
}

/**
 * フォローを ON にしたとき: その店舗の未来の予約（LINE 経由・未キャンセル・予約日が今日以降）で予定行が無いものに予定を作る。
 * 予約日の昇順で処理するので、同じ顧客に複数あれば最新の予約が残る。
 * @returns 作成した行数
 */
export async function backfillFollowMessagesForStore(storeId: string, now: Date = new Date()): Promise<number> {
  try {
    if (!storeId) return 0;
    const store = await loadStoreFollowSettings(storeId);
    if (!store || store.follow_enabled !== true) return 0;
    const today = toJstDateString(now);

    let reservations: ReservationLite[] = [];
    if (isLocal()) {
      reservations = readJsonFile<ReservationLite>(RESERVATIONS_FILE).filter((r) =>
        r.store_id === storeId && r.line_user_id && r.status !== 'cancelled' && typeof r.reservation_date === 'string' && r.reservation_date >= today);
    } else {
      const client = createAdminClient();
      if (!client) return 0;
      for (let from = 0; ; from += 1000) {
        const { data, error } = await (client as any)
          .from('reservations')
          .select('id,store_id,line_user_id,customer_id,reservation_date,created_at,status')
          .eq('store_id', storeId)
          .neq('status', 'cancelled')
          .not('line_user_id', 'is', null)
          .gte('reservation_date', today)
          .order('reservation_date', { ascending: true })
          .range(from, from + 999);
        if (error) { console.error('[follow-message] backfill lookup error:', error.message); return 0; }
        reservations.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
    }
    reservations = reservations
      .filter((r) => r.line_user_id)
      .sort((a, b) => String(a.reservation_date).localeCompare(String(b.reservation_date)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
    if (reservations.length === 0) return 0;

    const existing = await getFollowMessageSummariesByReservationIds(reservations.map((r) => r.id));
    let created = 0;
    for (const r of reservations) {
      if (existing[r.id]) continue;
      const row = await scheduleFollowMessageForReservation({
        id: r.id, store_id: r.store_id, line_user_id: r.line_user_id, customer_id: r.customer_id ?? null,
        reservation_date: r.reservation_date, created_at: r.created_at, status: r.status,
      }, now);
      if (row) created++;
    }
    return created;
  } catch (e) {
    console.error('[follow-message] backfill failed:', e);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 表示用
// ---------------------------------------------------------------------------

/** 予約 ID ごとのフォロー状態（顧客詳細の予約履歴に同梱） */
export async function getFollowMessageSummariesByReservationIds(
  reservationIds: string[]
): Promise<Record<string, FollowMessageSummary>> {
  const result: Record<string, FollowMessageSummary> = {};
  try {
    const ids = Array.from(new Set((reservationIds || []).filter(Boolean)));
    if (ids.length === 0) return result;
    let rows: Array<Pick<FollowMessage, 'reservation_id' | 'status' | 'skip_reason' | 'scheduled_at' | 'sent_at'>> = [];
    if (isLocal()) {
      rows = readJsonFile<FollowMessage>(FOLLOW_FILE).filter((r) => ids.includes(r.reservation_id));
    } else {
      const client = createAdminClient();
      if (!client) return result;
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await (client as any)
          .from('follow_messages')
          .select('reservation_id,status,skip_reason,scheduled_at,sent_at')
          .in('reservation_id', ids.slice(i, i + 500));
        if (error) {
          console.error('[follow-message] summaries error:', error.message);
          return result;
        }
        rows.push(...(data || []));
      }
    }
    rows.forEach((r) => {
      result[r.reservation_id] = {
        status: r.status,
        skip_reason: r.skip_reason ?? null,
        scheduled_at: r.scheduled_at,
        sent_at: r.sent_at ?? null,
      };
    });
  } catch (e) {
    console.error('[follow-message] summaries failed:', e);
  }
  return result;
}

/** 予約 ID ごとのリマインダー送信記録（最新の対象日のもの。顧客詳細の予約履歴に同梱） */
export async function getReminderLogSummariesByReservationIds(
  reservationIds: string[]
): Promise<Record<string, ReminderLogSummary>> {
  const result: Record<string, ReminderLogSummary> = {};
  try {
    const ids = Array.from(new Set((reservationIds || []).filter(Boolean)));
    if (ids.length === 0) return result;
    type Row = { reservation_id: string; target_date: string; status: ReminderLogSummary['status']; skip_reason: string | null; sent_at: string | null; last_error: string | null };
    let rows: Row[] = [];
    if (isLocal()) {
      rows = readJsonFile<Row>(REMINDER_LOG_FILE).filter((r) => ids.includes(r.reservation_id));
    } else {
      const client = createAdminClient();
      if (!client) return result;
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await (client as any)
          .from('reminder_logs')
          .select('reservation_id,target_date,status,skip_reason,sent_at,last_error')
          .in('reservation_id', ids.slice(i, i + 500));
        if (error) {
          console.error('[reminder-log] summaries error:', error.message);
          return result;
        }
        rows.push(...(data || []));
      }
    }
    rows.forEach((r) => {
      const prev = result[r.reservation_id];
      if (prev && prev.target_date > r.target_date) return;
      result[r.reservation_id] = {
        status: r.status,
        target_date: r.target_date,
        skip_reason: r.skip_reason ?? null,
        sent_at: r.sent_at ?? null,
        last_error: r.last_error ?? null,
      };
    });
  } catch (e) {
    console.error('[reminder-log] summaries failed:', e);
  }
  return result;
}
