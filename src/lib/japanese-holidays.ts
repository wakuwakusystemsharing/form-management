/**
 * 日本の祝日判定（1980〜2099 年）の TypeScript 版。
 * 静的 HTML に埋め込む HOLIDAY_RUNTIME_JS（src/lib/multiple-dates-runtime-js.ts）と同じ規則。
 * サーバー側（宿泊モードの料金計算・空き判定）で使う。Vitest で両者の一致を検証している。
 * 祝日タイプの ID は src/lib/holiday-types.ts の HOLIDAY_TYPES と同じ。
 */

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function shift(y: number, m: number, d: number, days: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function calcVernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function calcAutumnalEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function nthWeekday(year: number, month: number, n: number, dayOfWeek: number): number {
  const first = dow(year, month, 1);
  const offset = (dayOfWeek - first + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** 主祝日の type id（祝日でなければ null） */
function primaryHolidayType(y: number, m: number, d: number): string | null {
  if (m === 1 && d === 1) return 'new_year';
  if (m === 1 && d === nthWeekday(y, 1, 2, 1)) return 'coming_of_age';
  if (m === 2 && d === 11) return 'national_foundation';
  if (m === 2 && d === 23) return 'emperor_birthday';
  if (m === 3 && d === calcVernalEquinox(y)) return 'vernal_equinox';
  if (m === 4 && d === 29) return 'showa';
  if (m === 5 && d === 3) return 'constitution';
  if (m === 5 && d === 4) return 'greenery';
  if (m === 5 && d === 5) return 'childrens';
  if (m === 7 && d === nthWeekday(y, 7, 3, 1)) return 'marine';
  if (m === 8 && d === 11) return 'mountain';
  if (m === 9 && d === nthWeekday(y, 9, 3, 1)) return 'respect_for_aged';
  if (m === 9 && d === calcAutumnalEquinox(y)) return 'autumnal_equinox';
  if (m === 10 && d === nthWeekday(y, 10, 2, 1)) return 'sports';
  if (m === 11 && d === 3) return 'culture';
  if (m === 11 && d === 23) return 'labor_thanksgiving';
  return null;
}

/** 振替休日: 当日は祝日ではなく、前を遡って最初の日曜が主祝日（途中が全部祝日） */
function isSubstituteHoliday(y: number, m: number, d: number): boolean {
  if (primaryHolidayType(y, m, d)) return false;
  let cur = { y, m, d };
  for (let safety = 0; safety < 10; safety++) {
    cur = shift(cur.y, cur.m, cur.d, -1);
    if (dow(cur.y, cur.m, cur.d) === 0) return !!primaryHolidayType(cur.y, cur.m, cur.d);
    if (!primaryHolidayType(cur.y, cur.m, cur.d)) return false;
  }
  return false;
}

/** 国民の休日: 当日が祝日でも日曜でもなく、前後とも「主祝日 or 振替」 */
function isNationalDay(y: number, m: number, d: number): boolean {
  if (primaryHolidayType(y, m, d)) return false;
  if (dow(y, m, d) === 0) return false;
  const yd = shift(y, m, d, -1);
  const td = shift(y, m, d, 1);
  const yIs = !!primaryHolidayType(yd.y, yd.m, yd.d) || isSubstituteHoliday(yd.y, yd.m, yd.d);
  const tIs = !!primaryHolidayType(td.y, td.m, td.d) || isSubstituteHoliday(td.y, td.m, td.d);
  return yIs && tIs;
}

/** 祝日タイプ（主祝日 / 'substitute' / 'national_day'）。祝日でなければ null。date は "YYYY-MM-DD" */
export function getEffectiveHolidayType(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { y, m, d } = parts(date);
  const t = primaryHolidayType(y, m, d);
  if (t) return t;
  if (isSubstituteHoliday(y, m, d)) return 'substitute';
  if (isNationalDay(y, m, d)) return 'national_day';
  return null;
}

export function isJapaneseHoliday(date: string): boolean {
  return getEffectiveHolidayType(date) !== null;
}

/** 「祝日を予約不可にする」の判定（静的 HTML の shouldBlockAsHolidayWith と同じ） */
export function isHolidayBlocked(
  cs: { holidays_as_closed?: boolean; excluded_holiday_types?: string[] } | null | undefined,
  date: string
): boolean {
  if (!cs || !cs.holidays_as_closed) return false;
  const type = getEffectiveHolidayType(date);
  if (!type) return false;
  return !(cs.excluded_holiday_types || []).includes(type);
}
