/**
 * 予約カレンダー（予約管理 → カレンダー）の純粋ロジック
 *
 * - 日付は文字列（YYYY-MM-DD）のまま扱い、年・月・日の数字で計算する
 *   （new Date('2026-11-20') や +24 時間の足し算は、端末の時刻設定でずれるので使わない）
 * - 時刻は「その日の 0 時からの分」（0〜1440）で持つ
 * - DB にも画面にも触らない（Vitest の対象）
 */

export type CalendarView = 'month' | 'week' | 'day';
export const CALENDAR_VIEWS: { id: CalendarView; label: string }[] = [
  { id: 'month', label: '月' },
  { id: 'week', label: '週' },
  { id: 'day', label: '日' },
];

/** 1 回に取得できる期間（日数）の上限 */
export const CALENDAR_MAX_RANGE_DAYS = 62;
/** 月表示で 1 日に出す予約の数（それ以上は「ほか N 件」） */
export const MONTH_CELL_MAX_EVENTS = 3;
/** 所要時間が分からない予約の長さ（分） */
export const DEFAULT_EVENT_MINUTES = 60;
/** 日・週表示で、短い予約でも読めるようにする最小の長さ（分） */
export const MIN_EVENT_DISPLAY_MINUTES = 20;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

/** YYYY-MM-DD として正しい日付か（2026-02-30 のような無い日は false） */
export function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = YMD_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new Error(`日付の形が正しくありません: ${ymd}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 暦の上で n 日ずらす（UTC の暦で計算するので、端末の時刻設定に依らない） */
export function addDays(ymd: string, n: number): string {
  const { year, month, day } = parseYmd(ymd);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 月をずらす。日がその月に無いときは月末にする（1/31 → 2/28） */
export function addMonths(ymd: string, n: number): string {
  const { year, month, day } = parseYmd(ymd);
  const total = year * 12 + (month - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return formatYmd(y, m, Math.min(day, daysInMonth(y, m)));
}

/** 曜日（0 = 日 … 6 = 土） */
export function weekdayOf(ymd: string): number {
  const { year, month, day } = parseYmd(ymd);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** a から b までの日数（b が後なら正） */
export function diffDays(a: string, b: string): number {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000);
}

/** いまの日本時間の日付 */
export function jstToday(now: Date = new Date()): string {
  const j = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return formatYmd(j.getUTCFullYear(), j.getUTCMonth() + 1, j.getUTCDate());
}

/** いまの日本時間の「0 時からの分」 */
export function jstNowMinutes(now: Date = new Date()): number {
  const j = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return j.getUTCHours() * 60 + j.getUTCMinutes();
}

/** その日を含む週（日曜始まり）の 7 日 */
export function weekDates(ymd: string): string[] {
  const start = addDays(ymd, -weekdayOf(ymd));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export interface MonthGridDay {
  date: string;
  day: number;
  /** 表示している月の日か（前後の月の日は false） */
  inMonth: boolean;
  weekday: number;
}

/** 月表示のマス（日曜始まり。必要な週の数だけ = 4〜6 週） */
export function buildMonthGrid(year: number, month: number): MonthGridDay[][] {
  const first = formatYmd(year, month, 1);
  const last = formatYmd(year, month, daysInMonth(year, month));
  const start = addDays(first, -weekdayOf(first));
  const end = addDays(last, 6 - weekdayOf(last));
  const weeks: MonthGridDay[][] = [];
  let cur = start;
  while (cur <= end) {
    const week: MonthGridDay[] = [];
    for (let i = 0; i < 7; i++) {
      const p = parseYmd(cur);
      week.push({ date: cur, day: p.day, inMonth: p.year === year && p.month === month, weekday: i });
      cur = addDays(cur, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** 表示に必要な期間（月表示は前後の月の日も含む） */
export function calendarRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    const w = weekDates(anchor);
    return { from: w[0], to: w[6] };
  }
  const { year, month } = parseYmd(anchor);
  const grid = buildMonthGrid(year, month);
  return { from: grid[0][0].date, to: grid[grid.length - 1][6].date };
}

/** 前へ / 次へ */
export function shiftAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  return addMonths(formatYmd(parseYmd(anchor).year, parseYmd(anchor).month, 1), direction);
}

/** 見出し（2026年11月 / 11/22(日) 〜 11/28(土) / 2026年11月24日(火)） */
export function calendarTitle(view: CalendarView, anchor: string): string {
  const p = parseYmd(anchor);
  if (view === 'month') return `${p.year}年${p.month}月`;
  if (view === 'day') return `${p.year}年${p.month}月${p.day}日(${WEEKDAY_LABELS[weekdayOf(anchor)]})`;
  const w = weekDates(anchor);
  const a = parseYmd(w[0]);
  const b = parseYmd(w[6]);
  return `${a.year}年${a.month}/${a.day}(日) 〜 ${b.month}/${b.day}(土)`;
}

/** 期間の指定を確かめる（API 用）。問題があれば日本語の文言を返す */
export function validateCalendarRange(from: unknown, to: unknown): string | null {
  if (!isValidYmd(from) || !isValidYmd(to)) return '期間は YYYY-MM-DD 形式で指定してください';
  if (from > to) return '期間の開始日は終了日より前にしてください';
  if (diffDays(from, to) + 1 > CALENDAR_MAX_RANGE_DAYS) return `期間は ${CALENDAR_MAX_RANGE_DAYS} 日以内で指定してください`;
  return null;
}

// ---------------------------------------------------------------------------
// 時刻
// ---------------------------------------------------------------------------

/** 'HH:MM' / 'HH:MM:SS' → 0 時からの分。時刻として読めなければ null */
export function timeToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

// ---------------------------------------------------------------------------
// 予約 → 画面に置く帯
// ---------------------------------------------------------------------------

/** カレンダーが読む予約の項目（予約一覧の API が返す行と同じ） */
export interface CalendarReservationInput {
  id: string;
  form_id?: string | null;
  customer_name?: string | null;
  reservation_date?: string | null;
  reservation_time?: string | null;
  status?: string | null;
  selected_menus?: unknown;
  selected_options?: unknown;
  customer_info?: unknown;
  staff_id?: string | null;
  staff_name?: string | null;
  menu_name?: string | null;
  checkout_date?: string | null;
  stay_nights?: number | null;
  booking_mode?: string | null;
}

export type CalendarEventKind = 'timed' | 'untimed' | 'stay';

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  /** 開始日（宿泊はチェックイン日） */
  date: string;
  /** 宿泊: チェックアウト日。それ以外は date と同じ */
  endDate: string;
  /** timed だけ。0 時からの分 */
  startMin: number | null;
  endMin: number | null;
  /** 予約の所要時間（分） */
  durationMinutes: number;
  /** お客様の名前 */
  title: string;
  /** メニュー名（「カット、カラー」） */
  subtitle: string;
  staffName: string | null;
  status: string;
  cancelled: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sumDuration(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce((sum: number, item) => {
    const d = Number(asRecord(item).duration);
    return sum + (Number.isFinite(d) && d > 0 ? d : 0);
  }, 0);
}

/**
 * 予約の所要時間（分）。
 * 予約時の合計時間 → メニュー + オプションの所要時間 → 60 分（Google カレンダーの予定を作るときと同じ順）
 */
export function reservationDurationMinutes(r: CalendarReservationInput): number {
  const total = Number(asRecord(r.customer_info).total_duration);
  if (Number.isFinite(total) && total > 0) return Math.floor(total);
  const sum = sumDuration(r.selected_menus) + sumDuration(r.selected_options);
  return sum > 0 ? sum : DEFAULT_EVENT_MINUTES;
}

/** 予約のメニュー名（複数は「、」でつなぐ） */
export function reservationMenuLabel(r: CalendarReservationInput): string {
  const names: string[] = [];
  if (Array.isArray(r.selected_menus)) {
    for (const item of r.selected_menus) {
      const rec = asRecord(item);
      const menu = typeof rec.menu_name === 'string' ? rec.menu_name.trim() : '';
      const sub = typeof rec.submenu_name === 'string' ? rec.submenu_name.trim() : '';
      const name = menu && sub ? `${menu}（${sub}）` : menu || sub;
      if (name) names.push(name);
    }
  }
  if (names.length === 0 && typeof r.menu_name === 'string' && r.menu_name.trim()) names.push(r.menu_name.trim());
  return names.join('、');
}

/** 予約 1 件 → 帯。日付の無い予約は null */
export function toCalendarEvent(r: CalendarReservationInput): CalendarEvent | null {
  if (!r || typeof r.id !== 'string' || !isValidYmd(r.reservation_date)) return null;
  const date = r.reservation_date;
  const status = typeof r.status === 'string' && r.status ? r.status : 'pending';
  const base = {
    id: r.id,
    date,
    title: (typeof r.customer_name === 'string' && r.customer_name.trim()) || 'お客様',
    subtitle: reservationMenuLabel(r),
    staffName: typeof r.staff_name === 'string' && r.staff_name.trim() ? r.staff_name.trim() : null,
    status,
    cancelled: status === 'cancelled',
  };
  // 宿泊（数日にまたがる）
  if (isValidYmd(r.checkout_date) && r.checkout_date > date) {
    const nights = diffDays(date, r.checkout_date);
    return { ...base, kind: 'stay', endDate: r.checkout_date, startMin: null, endMin: null, durationMinutes: nights * 1440, subtitle: base.subtitle || `${nights}泊` };
  }
  const durationMinutes = reservationDurationMinutes(r);
  const startMin = timeToMinutes(r.reservation_time);
  // 時刻の無い予約（日付だけ決まっているもの）
  if (startMin === null || startMin >= 1440) {
    return { ...base, kind: 'untimed', endDate: date, startMin: null, endMin: null, durationMinutes };
  }
  // 日をまたぐ予約は、その日の終わり（24:00）までを描く
  const endMin = Math.min(1440, startMin + durationMinutes);
  return { ...base, kind: 'timed', endDate: date, startMin, endMin, durationMinutes };
}

export function toCalendarEvents(reservations: CalendarReservationInput[], opts: { includeCancelled?: boolean } = {}): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const r of Array.isArray(reservations) ? reservations : []) {
    const ev = toCalendarEvent(r);
    if (!ev) continue;
    if (ev.cancelled && !opts.includeCancelled) continue;
    events.push(ev);
  }
  return events.sort(compareEvents);
}

/** 並び順: 日付 → 時刻（時刻の無いものが先）→ 長いものが先 → ID */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const sa = a.startMin ?? -1;
  const sb = b.startMin ?? -1;
  if (sa !== sb) return sa - sb;
  if (a.durationMinutes !== b.durationMinutes) return b.durationMinutes - a.durationMinutes;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** その日に掛かっている帯か（宿泊はチェックイン日 〜 チェックアウト日） */
export function eventCoversDate(ev: CalendarEvent, date: string): boolean {
  return ev.kind === 'stay' ? ev.date <= date && date <= ev.endDate : ev.date === date;
}

export interface DayEvents {
  /** 時間の決まっている予約（時刻順） */
  timed: CalendarEvent[];
  /** 上の欄に出すもの（宿泊・時間未定） */
  allDay: CalendarEvent[];
}

export function eventsForDate(events: CalendarEvent[], date: string): DayEvents {
  const timed: CalendarEvent[] = [];
  const allDay: CalendarEvent[] = [];
  for (const ev of events) {
    if (!eventCoversDate(ev, date)) continue;
    if (ev.kind === 'timed') timed.push(ev);
    else allDay.push(ev);
  }
  return { timed, allDay };
}

/** 月表示の 1 マス: 上の欄のもの → 時刻順に、決まった数まで。残りは件数だけ */
export function monthCellEvents(events: CalendarEvent[], date: string, max: number = MONTH_CELL_MAX_EVENTS): { shown: CalendarEvent[]; more: number; total: number } {
  const { timed, allDay } = eventsForDate(events, date);
  const all = [...allDay, ...timed];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max), total: all.length };
}

// ---------------------------------------------------------------------------
// 重なりの配置（日・週表示）
// ---------------------------------------------------------------------------

export interface PositionedEvent {
  event: CalendarEvent;
  /** 左から何列目か（0 始まり） */
  column: number;
  /** その重なりのかたまりの列の数 */
  columns: number;
  /** 描くときの開始・終了（短い予約は最小の長さまで伸ばす） */
  startMin: number;
  endMin: number;
}

/**
 * 同じ時間に重なる予約を横に並べる。
 * 重なりでつながったかたまりごとに列を割り当て、かたまりの中の列の数で幅を分ける
 */
export function layoutDayEvents(events: CalendarEvent[], minMinutes: number = MIN_EVENT_DISPLAY_MINUTES): PositionedEvent[] {
  const items = events
    .filter((ev) => ev.kind === 'timed' && ev.startMin !== null && ev.endMin !== null)
    .map((ev) => {
      const startMin = ev.startMin as number;
      const endMin = Math.min(1440, Math.max(ev.endMin as number, startMin + minMinutes));
      return { event: ev, startMin: Math.min(startMin, Math.max(0, endMin - minMinutes)), endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || (a.event.id < b.event.id ? -1 : 1));

  const result: PositionedEvent[] = [];
  let cluster: PositionedEvent[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const flush = () => {
    for (const p of cluster) p.columns = columnEnds.length;
    result.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= item.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.endMin);
    } else {
      columnEnds[column] = item.endMin;
    }
    cluster.push({ event: item.event, column, columns: 1, startMin: item.startMin, endMin: item.endMin });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length > 0) flush();
  return result;
}

// ---------------------------------------------------------------------------
// 予約以外の予定（Google カレンダー）
// ---------------------------------------------------------------------------

/** Google カレンダーの予定のうち、カレンダーが読む項目 */
export interface GoogleEventInput {
  id?: string | null;
  summary?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}

/** 灰色の帯（予約以外の予定）。中身は持たない = 画面には「予定あり」とだけ出す */
export interface BusyBlock {
  date: string;
  startMin: number;
  endMin: number;
  allDay: boolean;
}

function jstParts(iso: string): { date: string; minutes: number } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const j = new Date(t + 9 * 60 * 60 * 1000);
  return { date: formatYmd(j.getUTCFullYear(), j.getUTCMonth() + 1, j.getUTCDate()), minutes: j.getUTCHours() * 60 + j.getUTCMinutes() };
}

/**
 * Google カレンダーの予定 → 日ごとの灰色の帯（日本時間）。
 * - このシステムの予約から作った予定（reservationEventIds）は除く（予約として別に描くため）
 * - 「営業日」の予定は受付時間の印なので除く
 * - 日をまたぐ予定は日ごとに分ける。期間の外は捨てる
 */
export function busyBlocksFromGoogle(events: GoogleEventInput[], opts: { from: string; to: string; reservationEventIds?: Iterable<string> }): BusyBlock[] {
  const skip = new Set(opts.reservationEventIds || []);
  const blocks: BusyBlock[] = [];
  const push = (date: string, startMin: number, endMin: number, allDay: boolean) => {
    if (date < opts.from || date > opts.to || endMin <= startMin) return;
    blocks.push({ date, startMin, endMin, allDay });
  };
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || ev.status === 'cancelled') continue;
    if (ev.id && skip.has(ev.id)) continue;
    if ((ev.summary || '').includes('営業日')) continue;
    // 終日の予定（end.date はその日を含まない）
    if (ev.start?.date && isValidYmd(ev.start.date)) {
      const endExclusive = ev.end?.date && isValidYmd(ev.end.date) && ev.end.date > ev.start.date ? ev.end.date : addDays(ev.start.date, 1);
      for (let d = ev.start.date < opts.from ? opts.from : ev.start.date; d < endExclusive && d <= opts.to; d = addDays(d, 1)) push(d, 0, 1440, true);
      continue;
    }
    const s = ev.start?.dateTime ? jstParts(ev.start.dateTime) : null;
    const e = ev.end?.dateTime ? jstParts(ev.end.dateTime) : null;
    if (!s || !e) continue;
    if (s.date === e.date) {
      push(s.date, s.minutes, e.minutes, false);
      continue;
    }
    if (e.date < s.date) continue;
    push(s.date, s.minutes, 1440, false);
    for (let d = addDays(s.date, 1); d < e.date && d <= opts.to; d = addDays(d, 1)) push(d, 0, 1440, true);
    push(e.date, 0, e.minutes, false);
  }
  return blocks.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startMin - b.startMin || a.endMin - b.endMin));
}

// ---------------------------------------------------------------------------
// 時間の範囲（日・週表示の縦の目盛り）
// ---------------------------------------------------------------------------

export const DEFAULT_START_HOUR = 9;
export const DEFAULT_END_HOUR = 20;

/** 表示する時間の範囲（時）。予約・予定がはみ出すぶんだけ広げる */
export function visibleHourRange(events: CalendarEvent[], busy: BusyBlock[], dates: string[]): { startHour: number; endHour: number } {
  let min = DEFAULT_START_HOUR * 60;
  let max = DEFAULT_END_HOUR * 60;
  const set = new Set(dates);
  for (const ev of events) {
    if (ev.kind !== 'timed' || ev.startMin === null || ev.endMin === null || !set.has(ev.date)) continue;
    min = Math.min(min, ev.startMin);
    max = Math.max(max, ev.endMin);
  }
  for (const b of busy) {
    if (b.allDay || !set.has(b.date)) continue;
    min = Math.min(min, b.startMin);
    max = Math.max(max, b.endMin);
  }
  return { startHour: Math.max(0, Math.floor(min / 60)), endHour: Math.min(24, Math.ceil(max / 60)) };
}

// ---------------------------------------------------------------------------
// 期間に掛かる予約（API 用）
// ---------------------------------------------------------------------------

/** 宿泊の予約を拾うために、期間の開始日より何日前の予約まで読むか */
export const STAY_LOOKBACK_DAYS = 31;

/** その予約が期間（from 〜 to）に掛かっているか。宿泊はチェックアウト日まで */
export function reservationOverlapsRange(r: CalendarReservationInput, from: string, to: string): boolean {
  if (!isValidYmd(r.reservation_date)) return false;
  const start = r.reservation_date;
  const end = isValidYmd(r.checkout_date) && r.checkout_date > start ? r.checkout_date : start;
  return start <= to && end >= from;
}
