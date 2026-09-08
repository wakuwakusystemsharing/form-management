/**
 * フォローメッセージの配信予定計算（純粋関数。DB 非依存で Vitest 対象）
 *
 * 設計: docs/フォローメッセージ機能_実装設計.md
 * ※ Supabase Edge Function `send-follow-messages` にも同じ判定（hasRebooking / isReminderSameDay）を
 *   コピーしている。ここを変更したら Edge Function 側も合わせること（Deno から src/ を import できないため）。
 */

export type FollowBase = 'reservation_date' | 'created_at';

export const FOLLOW_DAYS_AFTER_OPTIONS: number[] = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60];
export const FOLLOW_DEFAULT_DAYS_AFTER = 7;
export const FOLLOW_DEFAULT_TIME = '12:00';
export const FOLLOW_DEFAULT_BASE: FollowBase = 'reservation_date';
export const FOLLOW_MAX_ATTEMPTS = 3;

const JST_OFFSET_MINUTES = 9 * 60;

/** Date（UTC 時刻）を JST の YYYY-MM-DD にする */
export function toJstDateString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MINUTES * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isDateString(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function normalizeFollowDaysAfter(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : NaN;
  return n >= 1 && n <= 60 ? n : FOLLOW_DEFAULT_DAYS_AFTER;
}

export function normalizeFollowTime(value: unknown): string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):00$/.test(value) ? value : FOLLOW_DEFAULT_TIME;
}

export function normalizeFollowBase(value: unknown): FollowBase {
  return value === 'created_at' ? 'created_at' : FOLLOW_DEFAULT_BASE;
}

/**
 * 基準日を決める。
 * - reservation_date: 予約日（来店日）
 * - created_at: 予約受付日（created_at を JST の日付に変換。無ければ now）
 */
export function resolveBaseDate(
  reservation: { reservation_date?: string | null; created_at?: string | null },
  base: FollowBase,
  now: Date = new Date()
): string | null {
  if (base === 'created_at') {
    const created = reservation.created_at ? new Date(reservation.created_at) : now;
    return Number.isNaN(created.getTime()) ? toJstDateString(now) : toJstDateString(created);
  }
  return isDateString(reservation.reservation_date) ? reservation.reservation_date : null;
}

/**
 * 基準日 + daysAfter 日 の time（HH:00 JST）を UTC ISO 文字列で返す。
 * 不正な基準日は null。
 */
export function computeScheduledAt(baseDate: string, daysAfter: number, time: string): string | null {
  if (!isDateString(baseDate)) return null;
  const [y, m, d] = baseDate.split('-').map((s) => parseInt(s, 10));
  const hour = parseInt(normalizeFollowTime(time).slice(0, 2), 10);
  // JST の壁時計を UTC として組み立て、JST オフセットを引く
  const utcMs = Date.UTC(y, m - 1, d + normalizeFollowDaysAfter(daysAfter), hour, 0, 0) - JST_OFFSET_MINUTES * 60 * 1000;
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

export interface RebookingCandidate {
  id?: string | null;
  reservation_date?: string | null;
  status?: string | null;
}

/**
 * 「基準日より後」の未キャンセル予約（フォロー元の予約を除く）が 1 件でもあれば再予約あり。
 */
export function hasRebooking(
  reservations: RebookingCandidate[] | null | undefined,
  baseDate: string,
  excludeReservationId: string | null | undefined
): boolean {
  if (!Array.isArray(reservations) || !isDateString(baseDate)) return false;
  return reservations.some((r) => {
    if (!r || r.status === 'cancelled') return false;
    if (excludeReservationId && r.id === excludeReservationId) return false;
    return isDateString(r.reservation_date) && r.reservation_date > baseDate;
  });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * 今日、店舗の予約リマインダーがこの顧客に送られる日か（= reservation_date が 今日 + reminder_days_before の未キャンセル予約がある）。
 * 判定式は Edge Function `send-reminders` と同じ（今日 + N 日）。reminder_enabled 未設定は既定 ON。
 */
export function isReminderSameDay(
  store: { reminder_enabled?: boolean | null; reminder_days_before?: number | null },
  reservations: RebookingCandidate[] | null | undefined,
  todayJst: string
): boolean {
  if (store.reminder_enabled === false) return false;
  if (!Array.isArray(reservations) || !isDateString(todayJst)) return false;
  const n = typeof store.reminder_days_before === 'number' && Number.isFinite(store.reminder_days_before)
    ? Math.floor(store.reminder_days_before) : 1;
  const daysBefore = n >= 1 && n <= 30 ? n : 1;
  const reminderTargetDate = addDays(todayJst, daysBefore);
  return reservations.some((r) => r && r.status !== 'cancelled' && r.reservation_date === reminderTargetDate);
}
