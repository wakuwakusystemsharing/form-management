/**
 * フォローメッセージ配信予定（キュー）の作成・更新（サーバー専用: fs / Supabase に依存）
 *
 * 設計: docs/フォローメッセージ機能_実装設計.md
 * - 予約成立時: scheduleFollowMessageForReservation()（同じ顧客の未送信行を superseded にして作り直す）
 * - 予約キャンセル時: cancelFollowMessageForReservation()
 * - 予約日時の変更時: rescheduleFollowMessageForReservation()
 * - 顧客詳細の表示用: getFollowMessageSummariesByReservationIds()
 *
 * 呼び出し元の処理（予約作成など）を止めないよう、公開関数は例外を投げず null / false を返す。
 * 実際の送信は Supabase Edge Function `send-follow-messages` が行う（local では送信しない）。
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import type { FollowMessage, FollowMessageSummary } from '@/types/follow-message';
import type { Store } from '@/types/store';
import {
  computeScheduledAt,
  normalizeFollowBase,
  normalizeFollowDaysAfter,
  normalizeFollowTime,
  resolveBaseDate,
} from '@/lib/follow-message-scheduler';

const DATA_DIR = path.join(process.cwd(), 'data');
const FOLLOW_FILE = path.join(DATA_DIR, 'follow_messages.json');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');

export interface FollowReservationInput {
  id: string;
  store_id: string;
  line_user_id?: string | null;
  customer_id?: string | null;
  reservation_date?: string | null;
  created_at?: string | null;
  status?: string | null;
}

type StoreFollowSettings = Pick<Store, 'follow_enabled' | 'follow_base' | 'follow_days_after' | 'follow_time'>;

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

/** 店舗設定と予約から配信予定（基準日・送信時刻）を計算。対象外なら null */
function computeSchedule(
  store: StoreFollowSettings | null,
  reservation: FollowReservationInput,
  now: Date
): { baseDate: string; scheduledAt: string } | null {
  if (!store || store.follow_enabled !== true) return null;
  if (!reservation.line_user_id) return null;
  const baseDate = resolveBaseDate(reservation, normalizeFollowBase(store.follow_base), now);
  if (!baseDate) return null;
  const scheduledAt = computeScheduledAt(baseDate, normalizeFollowDaysAfter(store.follow_days_after), normalizeFollowTime(store.follow_time));
  if (!scheduledAt) return null;
  // 既に過ぎた予定（過去日の手動登録など）は作らない
  if (new Date(scheduledAt).getTime() <= now.getTime()) return null;
  return { baseDate, scheduledAt };
}

// ---------------------------------------------------------------------------
// 予約成立時: 同じ顧客の未送信行を差し替えて作成
// ---------------------------------------------------------------------------

/**
 * 予約成立時にフォロー配信予定を作る。
 * - 店舗のフォローが OFF / LINE ユーザー ID が無い / 予定が過去 → 何もしない（null）
 * - 同じ店舗・同じ LINE ユーザーの未送信（scheduled）行は superseded にする
 * - この予約の行が既にある場合: sent なら触らない。それ以外は scheduled に作り直す（キャンセル → 復元にも対応）
 */
export async function scheduleFollowMessageForReservation(
  reservation: FollowReservationInput,
  now: Date = new Date()
): Promise<FollowMessage | null> {
  try {
    if (!reservation?.id || !reservation.store_id) return null;
    if (reservation.status === 'cancelled') return null;
    const store = await loadStoreFollowSettings(reservation.store_id);
    const schedule = computeSchedule(store, reservation, now);
    if (!schedule) return null;
    const nowIso = now.toISOString();
    const lineUserId = reservation.line_user_id as string;

    if (isLocal()) {
      const rows = readJsonFile<FollowMessage>(FOLLOW_FILE);
      rows.forEach((r) => {
        if (r.store_id === reservation.store_id && r.line_user_id === lineUserId && r.reservation_id !== reservation.id && r.status === 'scheduled') {
          r.status = 'superseded';
          r.updated_at = nowIso;
        }
      });
      const existing = rows.find((r) => r.reservation_id === reservation.id);
      if (existing) {
        if (existing.status === 'sent') { writeJsonFile(FOLLOW_FILE, rows); return existing; }
        Object.assign(existing, {
          line_user_id: lineUserId,
          customer_id: reservation.customer_id ?? existing.customer_id ?? null,
          base_date: schedule.baseDate,
          scheduled_at: schedule.scheduledAt,
          status: 'scheduled',
          skip_reason: null,
          attempt_count: 0,
          last_error: null,
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
    const db = client as any;

    // 1. 同じ顧客の未送信行を差し替え
    const { error: supersedeError } = await db
      .from('follow_messages')
      .update({ status: 'superseded', updated_at: nowIso })
      .eq('store_id', reservation.store_id)
      .eq('line_user_id', lineUserId)
      .eq('status', 'scheduled')
      .neq('reservation_id', reservation.id);
    if (supersedeError) console.error('[follow-message] supersede error:', supersedeError.message);

    // 2. この予約の行を作成 / 作り直し
    const { data: existing } = await db
      .from('follow_messages')
      .select('id,status')
      .eq('reservation_id', reservation.id)
      .maybeSingle();
    if (existing?.status === 'sent') return null;

    const values = {
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
      sent_at: null,
      updated_at: nowIso,
    };
    const query = existing
      ? db.from('follow_messages').update(values).eq('id', existing.id)
      : db.from('follow_messages').insert([values]);
    const { data, error } = await query.select().single();
    if (error) {
      console.error('[follow-message] schedule error:', error.message);
      return null;
    }
    return data as FollowMessage;
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

// ---------------------------------------------------------------------------
// 予約内容（日時）の変更時
// ---------------------------------------------------------------------------

/**
 * 予約日時が変わったとき、未送信（scheduled）の行だけ予定を計算し直す。
 * 送信済み・差替済み・取消済みの行は触らない。行が無ければ何もしない（成立時に対象外だった予約）。
 */
export async function rescheduleFollowMessageForReservation(
  reservation: FollowReservationInput,
  now: Date = new Date()
): Promise<boolean> {
  try {
    if (!reservation?.id || reservation.status === 'cancelled') return false;
    const store = await loadStoreFollowSettings(reservation.store_id);
    const schedule = computeSchedule(store, reservation, now);
    const nowIso = now.toISOString();

    if (isLocal()) {
      const rows = readJsonFile<FollowMessage>(FOLLOW_FILE);
      const row = rows.find((r) => r.reservation_id === reservation.id && r.status === 'scheduled');
      if (!row) return false;
      if (schedule) {
        row.base_date = schedule.baseDate;
        row.scheduled_at = schedule.scheduledAt;
      } else {
        row.status = 'skipped';
        row.skip_reason = 'store_disabled';
      }
      row.updated_at = nowIso;
      writeJsonFile(FOLLOW_FILE, rows);
      return true;
    }

    const client = createAdminClient();
    if (!client) return false;
    const patch = schedule
      ? { base_date: schedule.baseDate, scheduled_at: schedule.scheduledAt, updated_at: nowIso }
      : { status: 'skipped', skip_reason: 'store_disabled', updated_at: nowIso };
    const { error } = await (client as any)
      .from('follow_messages')
      .update(patch)
      .eq('reservation_id', reservation.id)
      .eq('status', 'scheduled');
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
      const { data, error } = await (client as any)
        .from('follow_messages')
        .select('reservation_id,status,skip_reason,scheduled_at,sent_at')
        .in('reservation_id', ids);
      if (error) {
        console.error('[follow-message] summaries error:', error.message);
        return result;
      }
      rows = data || [];
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
