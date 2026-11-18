/**
 * 空き待ち（キャンセル待ち）の純粋ロジック。DB・API に依存しない（Vitest 対象）
 *
 * - 設定: `calendar_settings.waitlist = { enabled, max_per_user, deadline_hours }`（未設定 = OFF）。
 *   使えるのは LINE フォーム × カレンダー表示モードだけ
 * - お客様は予約カレンダーの満席（✕）の時間を 1 つ選んで登録する（1 登録 = 1 つの日時）
 * - 枠が空いたら登録者全員に LINE で知らせ（waiting → notified）、先に予約した人で埋まったら
 *   予約しなかった人におわびを送って空き待ちを続ける（notified → waiting）
 *
 * サーバー側の処理は `waitlist-service.ts`、カードは `waitlist-flex.ts`、フォーム側は `waitlist-runtime-js.ts`
 */

export const WAITLIST_KEYWORD = '空き待ち確認';
export const WAITLIST_POSTBACK_PREFIX = 'wl:';
/** 空き待ちの登録後にフォームが LINE へ送るメッセージの 1 行目（Webhook が受付のカードを返す） */
export const WAITLIST_MESSAGE_HEAD = '【空き待ち登録】';

export const WAITLIST_DEFAULT_MAX_PER_USER = 3;
export const WAITLIST_MAX_PER_USER_LIMIT = 10;
export const WAITLIST_DEFAULT_DEADLINE_HOURS = 1;
/** 受付締切の選択肢（予約日時の何時間前まで知らせるか。0 = 開始時刻まで） */
export const WAITLIST_DEADLINE_OPTIONS = [0, 1, 2, 3, 6, 12, 24, 48] as const;
/** 送信に失敗したとき、この回数で「送信できない」扱い（inactive）にする */
export const WAITLIST_MAX_SEND_FAILURES = 2;

export type WaitlistStatus = 'waiting' | 'notified' | 'fulfilled' | 'expired' | 'cancelled' | 'inactive';
export const WAITLIST_ACTIVE_STATUSES: WaitlistStatus[] = ['waiting', 'notified'];

export const WAITLIST_STATUS_LABELS: Record<WaitlistStatus, string> = {
  waiting: '空き待ち中',
  notified: '空きをお知らせ済み',
  fulfilled: '予約済み',
  expired: '期限切れ',
  cancelled: '取り消し',
  inactive: '送信できず終了',
};

export type WaitlistNotificationType = 'slot_opened' | 'slot_filled';

/** 保存する形（`calendar_settings.waitlist`） */
export interface WaitlistSettings {
  enabled: boolean;
  /** 1 人が同時に登録できる件数（1〜10） */
  max_per_user: number;
  /** 予約日時の何時間前まで空きを知らせるか（これを過ぎた枠は知らせない・登録も受け付けない） */
  deadline_hours: number;
}

export interface WaitlistEntry {
  id: string;
  store_id: string;
  form_id: string;
  customer_id: string | null;
  line_user_id: string;
  customer_name: string | null;
  /** 希望日 YYYY-MM-DD / 希望時刻 HH:MM（日本時間） */
  reservation_date: string;
  reservation_time: string;
  duration_minutes: number;
  selected_menus: unknown[];
  selected_options: unknown[];
  menu_text: string | null;
  /** 指名したスタッフ（null = 指名なし / スタッフ選択なし） */
  staff_id: string | null;
  staff_name: string | null;
  status: WaitlistStatus;
  notified_at: string | null;
  notify_count: number;
  fail_count: number;
  created_at: string;
  updated_at: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 設定を既定値で補う（ON / OFF は入力どおり） */
export function resolveWaitlistSettings(calendarSettings: { waitlist?: unknown } | null | undefined): WaitlistSettings {
  const raw = calendarSettings && typeof calendarSettings.waitlist === 'object' && calendarSettings.waitlist
    ? (calendarSettings.waitlist as Record<string, unknown>)
    : {};
  return {
    enabled: raw.enabled === true,
    max_per_user: clamp(toInt(raw.max_per_user, WAITLIST_DEFAULT_MAX_PER_USER), 1, WAITLIST_MAX_PER_USER_LIMIT),
    deadline_hours: clamp(toInt(raw.deadline_hours, WAITLIST_DEFAULT_DEADLINE_HOURS), 0, 24 * 30),
  };
}

/** 保存用に整える（normalizeForm が使う）。未設定なら undefined（キーを持たない） */
export function sanitizeWaitlistSettings(raw: unknown): WaitlistSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return resolveWaitlistSettings({ waitlist: raw });
}

/**
 * そのフォームで空き待ちが動くか: ON + LINE フォーム + カレンダー表示モード。
 * （第三希望日時・宿泊・Web フォームでは使わない）
 */
export function isWaitlistActive(
  config: { form_type?: unknown; calendar_settings?: { booking_mode?: unknown; waitlist?: unknown } | null } | null | undefined
): boolean {
  if (!config || config.form_type === 'web') return false;
  const cs = config.calendar_settings;
  if (!cs || (cs.booking_mode || 'calendar') !== 'calendar') return false;
  return resolveWaitlistSettings(cs).enabled;
}

export function isValidWaitlistDate(date: unknown): date is string {
  return typeof date === 'string' && DATE_RE.test(date);
}

export function isValidWaitlistTime(time: unknown): time is string {
  return typeof time === 'string' && TIME_RE.test(time);
}

/** 枠の開始時刻（日本時間）のミリ秒。形式が不正なら NaN */
export function waitlistSlotStartMs(date: string, time: string): number {
  if (!DATE_RE.test(date) || !TIME_RE.test(String(time).slice(0, 5))) return NaN;
  return Date.parse(`${date}T${String(time).slice(0, 5)}:00+09:00`);
}

/** 枠の開始時刻を過ぎたか（過ぎた空き待ちは自動で終了する） */
export function isWaitlistSlotPast(date: string, time: string, now: Date): boolean {
  const start = waitlistSlotStartMs(date, time);
  return Number.isNaN(start) || start <= now.getTime();
}

/** 受付締切（開始の N 時間前）より前か。過ぎた枠は知らせない・登録も受け付けない */
export function isBeforeWaitlistDeadline(settings: Pick<WaitlistSettings, 'deadline_hours'>, date: string, time: string, now: Date): boolean {
  const start = waitlistSlotStartMs(date, time);
  if (Number.isNaN(start)) return false;
  return now.getTime() < start - settings.deadline_hours * 3600000;
}

/**
 * 枠の状態:
 * open = いま予約できる / full = 受付はしているが埋まっている / closed = 営業時間外・受付期間外など /
 * unknown = カレンダーの予定を取得できず判断できない（何も送らない）
 */
export type WaitlistSlotState = 'open' | 'full' | 'closed' | 'unknown';

export type WaitlistAction = 'expire' | 'notify' | 'apologize' | 'none';

/**
 * 見回りで、その空き待ちに何をするか。
 * - 開始時刻を過ぎた → 終了（expire）
 * - 空き待ち中で、枠が空いていて、受付締切の前 → 空きを知らせる（notify）
 * - お知らせ済みで、枠がまた埋まった → おわびを送って空き待ちに戻す（apologize）
 * 判断できないとき（unknown）や、受付していない時間（closed）は何もしない
 */
export function decideWaitlistAction(
  entry: Pick<WaitlistEntry, 'status' | 'reservation_date' | 'reservation_time'>,
  state: WaitlistSlotState,
  settings: Pick<WaitlistSettings, 'deadline_hours'>,
  now: Date
): WaitlistAction {
  if (entry.status !== 'waiting' && entry.status !== 'notified') return 'none';
  if (isWaitlistSlotPast(entry.reservation_date, entry.reservation_time, now)) return 'expire';
  if (entry.status === 'waiting') {
    return state === 'open' && isBeforeWaitlistDeadline(settings, entry.reservation_date, entry.reservation_time, now) ? 'notify' : 'none';
  }
  return state === 'full' ? 'apologize' : 'none';
}

export type WaitlistRegisterBlock = 'invalid' | 'past' | 'deadline' | 'limit' | 'duplicate';

/** 登録できるか（枠が満席かどうかはサーバーがカレンダーを見て別に確認する） */
export function checkWaitlistRegistration(args: {
  settings: WaitlistSettings;
  date: unknown;
  time: unknown;
  staffId: string | null;
  formId: string;
  /** その人の、いま有効な空き待ち（同じ店舗） */
  activeEntries: Array<Pick<WaitlistEntry, 'form_id' | 'reservation_date' | 'reservation_time' | 'staff_id'>>;
  now: Date;
}): { ok: true } | { ok: false; reason: WaitlistRegisterBlock; error: string } {
  const { settings, date, time, now } = args;
  if (!isValidWaitlistDate(date) || !isValidWaitlistTime(time)) return { ok: false, reason: 'invalid', error: '日時の形式が正しくありません' };
  if (isWaitlistSlotPast(date, time, now)) return { ok: false, reason: 'past', error: 'この日時は過ぎているため、空き待ちを登録できません。' };
  if (!isBeforeWaitlistDeadline(settings, date, time, now)) {
    return { ok: false, reason: 'deadline', error: `空き待ちの受付は、ご希望日時の ${settings.deadline_hours} 時間前までです。` };
  }
  const same = args.activeEntries.some(
    (e) => e.form_id === args.formId && e.reservation_date === date && String(e.reservation_time).slice(0, 5) === time && (e.staff_id || null) === (args.staffId || null)
  );
  if (same) return { ok: false, reason: 'duplicate', error: 'この日時はすでに空き待ちに登録済みです。' };
  if (args.activeEntries.length >= settings.max_per_user) {
    return { ok: false, reason: 'limit', error: `空き待ちは ${settings.max_per_user} 件まで登録できます。不要な空き待ちを取り消してからお試しください。` };
  }
  return { ok: true };
}

/** 取り消しボタンの data（例: `wl:x:{空き待ちID}`） */
export function buildWaitlistCancelPostback(entryId: string): string {
  return `${WAITLIST_POSTBACK_PREFIX}x:${entryId}`;
}

export function isWaitlistPostback(data: string | null | undefined): boolean {
  return typeof data === 'string' && data.startsWith(WAITLIST_POSTBACK_PREFIX);
}

export function parseWaitlistPostback(data: string | null | undefined): { kind: 'cancel'; entryId: string } | null {
  if (!isWaitlistPostback(data)) return null;
  const parts = String(data).slice(WAITLIST_POSTBACK_PREFIX.length).split(':');
  if (parts.length !== 2 || parts[0] !== 'x' || !ID_RE.test(parts[1])) return null;
  return { kind: 'cancel', entryId: parts[1] };
}

/** 空きのお知らせから開く予約フォームの URL（LIFF ID が無ければ null） */
export function buildWaitlistBookingUrl(liffId: string | null | undefined, entryId: string): string | null {
  const id = (liffId || '').trim();
  if (id.length < 10) return null;
  return `https://liff.line.me/${id}?waitlist=${encodeURIComponent(entryId)}`;
}

/** メニュー名の表示（保存した文言 → 選んだメニューの名前） */
export function waitlistMenuText(entry: Pick<WaitlistEntry, 'menu_text' | 'selected_menus'>): string {
  if (entry.menu_text && entry.menu_text.trim()) return entry.menu_text.trim();
  const list = Array.isArray(entry.selected_menus) ? (entry.selected_menus as Array<{ menu_name?: string; submenu_name?: string }>) : [];
  return list
    .map((m) => (m?.submenu_name ? `${m.menu_name || ''} > ${m.submenu_name}` : m?.menu_name || ''))
    .filter(Boolean)
    .join('、');
}
