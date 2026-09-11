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

// ---------------------------------------------------------------------------
// リマインダー用（Edge Function send-reminders と同じ判定。変更時は両方を合わせること）
// ---------------------------------------------------------------------------

export const REMINDER_DEFAULT_TIME = '19:00';
export const REMINDER_DEFAULT_DAYS_BEFORE = 1;
export const REMINDER_MAX_ATTEMPTS = 3;

export function normalizeReminderTime(value: unknown): string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):00$/.test(value) ? value : REMINDER_DEFAULT_TIME;
}

export function normalizeReminderDaysBefore(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : NaN;
  return n >= 1 && n <= 30 ? n : REMINDER_DEFAULT_DAYS_BEFORE;
}

/**
 * 店舗の送信時刻に達しているか（現在の HH:MM >= reminder_time）。
 * 完全一致ではなく「以降」にすることで、cron が 1 回止まっても同じ日のうちなら次の回で回収できる。
 */
export function isReminderTimeReached(reminderTime: unknown, currentHHMM: string): boolean {
  const t = normalizeReminderTime(reminderTime);
  return /^\d{2}:\d{2}$/.test(currentHHMM) && currentHHMM >= t;
}

/** 今日（JST）+ days_before = リマインド対象の予約日 */
export function reminderTargetDate(todayJst: string, daysBefore: unknown): string {
  return addDays(todayJst, normalizeReminderDaysBefore(daysBefore));
}

/**
 * LINE の X-Line-Retry-Key は UUID 形式が必須。
 * ハイフン無しの 32 桁 hex（follow_messages.id）はハイフンを入れて UUID にし、UUID はそのまま、それ以外は null。
 */
export function toLineRetryKey(id: string | null | undefined): string | null {
  if (!id) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id.toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(id)) {
    const s = id.toLowerCase();
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
  return null;
}

/**
 * リマインダーの送信予定時刻: 予約日 - daysBefore 日 の reminderTime（JST）を UTC ISO で返す。
 * （顧客詳細の「送信予定」表示用。実際の送信は Edge Function が「今日 + N 日 = 予約日」で判定する）
 */
export function computeReminderScheduledAt(reservationDate: string, daysBefore: unknown, reminderTime: unknown): string | null {
  if (!isDateString(reservationDate)) return null;
  const [y, m, d] = reservationDate.split('-').map((s) => parseInt(s, 10));
  const hour = parseInt(normalizeReminderTime(reminderTime).slice(0, 2), 10);
  const utcMs = Date.UTC(y, m - 1, d - normalizeReminderDaysBefore(daysBefore), hour, 0, 0) - JST_OFFSET_MINUTES * 60 * 1000;
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** 予定時刻を「9/18（木）12:00」の形にする（JST） */
export function formatJstShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const jst = new Date(dt.getTime() + JST_OFFSET_MINUTES * 60 * 1000);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${weekdays[jst.getUTCDay()]}）${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}
