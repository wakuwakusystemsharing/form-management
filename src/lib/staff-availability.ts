/**
 * スタッフ選択の空き判定（サーバー側の再確認用）。
 *
 * 予約 API はもともと Google の freeBusy で空きを再確認していたが、freeBusy は
 * 「予定あり（Busy）」の予定しか返さず、Google カレンダーの終日予定は既定で
 * 「予定なし（Free）」扱いのため、終日の「予約不可」を入れたスタッフが空き扱いになり
 * 「指名なし」でそのスタッフに割り当てられる事象が起きた。
 * ここではフォーム画面と同じ「予定一覧（events.list）」を使い、終日予定は JST の 1 日全体を
 * 埋まり扱いにする。DB・API に依存しない純粋ロジック（Vitest 対象）。
 */

export interface CalendarEventLike {
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  summary?: string | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 終日予定の日付（YYYY-MM-DD）を JST 0:00 の ISO 文字列にする */
export function jstDateStartIso(date: string): string {
  return `${date}T00:00:00+09:00`;
}

/** 予定の開始 / 終了を Date にする。終日予定（date）は JST 0:00 〜 終了日（排他）の JST 0:00 */
export function resolveEventRange(event: CalendarEventLike): { start: Date; end: Date } | null {
  const startRaw = event.start?.dateTime || (event.start?.date && DATE_ONLY.test(event.start.date) ? jstDateStartIso(event.start.date) : '');
  const endRaw = event.end?.dateTime || (event.end?.date && DATE_ONLY.test(event.end.date) ? jstDateStartIso(event.end.date) : '');
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

/** 「営業日」イベント（営業時間を表すだけで、埋まりではない） */
export function isBusinessDayEvent(event: CalendarEventLike): boolean {
  return (event.summary || '').includes('営業日');
}

/** 予定が予約枠 [slotStart, slotEnd) と重なるか（営業日イベントは常に false） */
export function eventOverlapsSlot(event: CalendarEventLike, slotStart: Date, slotEnd: Date): boolean {
  if (isBusinessDayEvent(event)) return false;
  const range = resolveEventRange(event);
  if (!range) return false;
  return range.start < slotEnd && slotStart < range.end;
}

/**
 * カレンダーごとの予定一覧から、予約枠と重なる予定があるカレンダー ID の集合を返す。
 * 取得に失敗したカレンダー（null）は安全側で埋まり扱い。
 */
export function busyCalendarIdsFromEvents(
  eventsByCalendar: Record<string, CalendarEventLike[] | null>,
  slotStart: Date,
  slotEnd: Date
): Set<string> {
  const busy = new Set<string>();
  for (const [calendarId, events] of Object.entries(eventsByCalendar)) {
    if (!events) {
      busy.add(calendarId);
      continue;
    }
    if (events.some((ev) => eventOverlapsSlot(ev, slotStart, slotEnd))) busy.add(calendarId);
  }
  return busy;
}

/**
 * 空き状況 API がフォームへ返す開始 / 終了文字列。終日予定の日付だけの値は
 * JST 0:00 の ISO にする（ブラウザが `new Date('YYYY-MM-DD')` を UTC 0:00 = JST 9:00 と解釈し、
 * 当日 9:00 より前が空き・翌日 9:00 までが埋まりになるずれを防ぐ）
 */
export function normalizeEventTimeForClient(
  value: { dateTime?: string | null; date?: string | null } | null | undefined
): string {
  if (!value) return '';
  if (value.dateTime) return value.dateTime;
  if (value.date && DATE_ONLY.test(value.date)) return jstDateStartIso(value.date);
  return value.date || '';
}

/**
 * 予約枠 [slotStart, slotEnd) と重なる予定の数（営業日イベントは数えない。終日予定は JST の 1 日全体）。
 * フォーム画面が「同時刻に埋まるイベント数」の〇✕を描くときと同じ数え方。
 */
export function countEventsOverlappingSlot(events: CalendarEventLike[], slotStart: Date, slotEnd: Date): number {
  return events.reduce((acc, ev) => acc + (eventOverlapsSlot(ev, slotStart, slotEnd) ? 1 : 0), 0);
}

/** `calendar_settings.max_concurrent_events` を 1 以上の整数に正規化（未設定・不正は 1） */
export function resolveMaxConcurrentEvents(calendarSettings: { max_concurrent_events?: unknown } | null | undefined): number {
  const raw = calendarSettings?.max_concurrent_events;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/**
 * 店舗カレンダーの空き再確認に使う予約枠。
 * 所要時間があればその長さ、無ければフォームの時間間隔ぶん（画面の判定と同じ。既定 30 分）。
 */
export function resolveReservationSlotWindow(
  reservationDate: string,
  reservationTime: string,
  totalDurationMinutes: unknown,
  calendarSettings: { time_interval?: unknown } | null | undefined
): { slotStart: Date; slotEnd: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reservationDate) || !/^\d{2}:\d{2}$/.test(reservationTime)) return null;
  const slotStart = new Date(`${reservationDate}T${reservationTime}:00+09:00`);
  if (Number.isNaN(slotStart.getTime())) return null;
  const duration = Number(totalDurationMinutes);
  const interval = Number(calendarSettings?.time_interval);
  const width = duration > 0 ? duration : (interval > 0 ? interval : 30);
  return { slotStart, slotEnd: new Date(slotStart.getTime() + width * 60 * 1000) };
}

/** 同時刻の予定数が上限に達しているか（count >= max で埋まり） */
export function isSlotFull(events: CalendarEventLike[], slotStart: Date, slotEnd: Date, maxConcurrent: number): boolean {
  return countEventsOverlappingSlot(events, slotStart, slotEnd) >= maxConcurrent;
}
