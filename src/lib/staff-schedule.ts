/**
 * スタッフごとの「希望日時設定」（カレンダー表示モードの受付時間・予約ルールをスタッフ単位で上書き）
 *
 * - `staff_selection.staff[].schedule` に、営業時間・ルールタブの一部項目をスタッフ用に保存する
 * - 項目ごとに「フォームの設定を使う（undefined）/ このスタッフ用に設定（値あり）」を切り替える
 * - 判定は静的 HTML の埋め込み JS（`STAFF_SCHEDULE_RUNTIME_JS` の `mergeStaffSchedule`）と
 *   ここの `mergeStaffSchedule` で同じ規則にする。DB 非依存（Vitest 対象）
 * - 第三希望日時モードでは使わない（カレンダー表示モードのみ）
 */
import type { BusinessHours, FormConfig, SpecialBusinessDay, StaffScheduleSettings } from '@/types/form';
import { sanitizeBlockedTimeWeekdays, sanitizeExtraMinutes, sanitizeSpecialBusinessDays } from './form-normalizer';
import { sanitizeConditionalAdvanceRules } from './advance-rules';

export type CalendarSettings = FormConfig['calendar_settings'];

/** 上書きできる項目（編集 UI の並び順）。companion は同時に上書きされる付随キー */
export const STAFF_SCHEDULE_ITEMS: Array<{
  key: keyof StaffScheduleSettings;
  label: string;
  companion?: keyof StaffScheduleSettings;
  group: 'calendar' | 'rules';
}> = [
  { key: 'business_hours', label: '営業時間設定（曜日別）', group: 'calendar' },
  { key: 'holiday_hours', label: '祝日の営業時間', group: 'calendar' },
  { key: 'special_business_days', label: '臨時営業日', group: 'calendar' },
  { key: 'blocked_times', label: 'デフォルトで✕にする時間帯', companion: 'blocked_time_weekdays', group: 'calendar' },
  { key: 'time_interval', label: '時間間隔', group: 'calendar' },
  { key: 'extra_minutes', label: '追加で表示する分', group: 'calendar' },
  { key: 'min_advance_days', label: '予約受付開始日', group: 'rules' },
  { key: 'min_advance_hours', label: '予約受付開始時間', group: 'rules' },
  { key: 'conditional_advance_rules', label: '条件付き予約受付開始時間設定', group: 'rules' },
  { key: 'advance_booking_days', label: '事前予約可能日数', group: 'rules' },
  { key: 'holidays_as_closed', label: '祝日を予約不可にする', companion: 'excluded_holiday_types', group: 'rules' },
  { key: 'allow_exceed_business_hours', label: '営業時間を超える予約を許可', group: 'rules' },
];

const TIME_INTERVALS = [10, 15, 20, 30, 45, 60, 120] as const;
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function normTime(t: unknown, fallback: string): string {
  if (typeof t !== 'string') return fallback;
  const m = TIME_RE.exec(t.trim());
  if (!m) return fallback;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return fallback;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function normBusinessHours(raw: unknown): BusinessHours | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, { open?: unknown; close?: unknown; closed?: unknown } | undefined>;
  const out: BusinessHours = {};
  for (const day of DAY_KEYS) {
    const d = src[day];
    out[day] = {
      open: normTime(d?.open, '09:00'),
      close: normTime(d?.close, '18:00'),
      closed: d?.closed === true,
    };
  }
  return out;
}

function normNonNegativeInt(v: unknown, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(Math.floor(n), max);
}

/**
 * 保存前 / 読み取り時の正規化。上書きが 1 つも無ければ undefined（= フォームの設定どおり）
 * 不正な値は「フォームの設定を使う」に戻す
 */
export function normalizeStaffSchedule(raw: unknown): StaffScheduleSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: StaffScheduleSettings = {};

  const bh = normBusinessHours(r.business_hours);
  if (bh) out.business_hours = bh;

  if (r.holiday_hours && typeof r.holiday_hours === 'object') {
    const hh = r.holiday_hours as { enabled?: unknown; open?: unknown; close?: unknown };
    out.holiday_hours = { enabled: hh.enabled === true, open: normTime(hh.open, '09:00'), close: normTime(hh.close, '18:00') };
  }

  if (Array.isArray(r.special_business_days)) out.special_business_days = sanitizeSpecialBusinessDays(r.special_business_days);

  if (Array.isArray(r.blocked_times)) {
    out.blocked_times = [...new Set(r.blocked_times
      .map((t) => (typeof t === 'string' ? normTime(t, '') : ''))
      .filter((t): t is string => !!t))];
    out.blocked_time_weekdays = sanitizeBlockedTimeWeekdays(r.blocked_time_weekdays);
  }

  if (typeof r.time_interval === 'number' && (TIME_INTERVALS as readonly number[]).includes(r.time_interval)) {
    out.time_interval = r.time_interval as StaffScheduleSettings['time_interval'];
  }

  if (Array.isArray(r.extra_minutes)) out.extra_minutes = sanitizeExtraMinutes(r.extra_minutes);

  const mad = normNonNegativeInt(r.min_advance_days, 365);
  if (mad !== undefined) out.min_advance_days = mad;
  const mah = normNonNegativeInt(r.min_advance_hours, 168);
  if (mah !== undefined) out.min_advance_hours = mah;
  if (Array.isArray(r.conditional_advance_rules)) out.conditional_advance_rules = sanitizeConditionalAdvanceRules(r.conditional_advance_rules);

  const abd = normNonNegativeInt(r.advance_booking_days, 365);
  if (abd !== undefined && abd >= 1) out.advance_booking_days = abd;

  if (typeof r.holidays_as_closed === 'boolean') {
    out.holidays_as_closed = r.holidays_as_closed;
    out.excluded_holiday_types = Array.isArray(r.excluded_holiday_types)
      ? r.excluded_holiday_types.filter((x): x is string => typeof x === 'string')
      : [];
  }

  if (typeof r.allow_exceed_business_hours === 'boolean') out.allow_exceed_business_hours = r.allow_exceed_business_hours;

  return Object.keys(out).length > 0 ? out : undefined;
}

/** 上書きしている項目数（編集画面のボタン表示用。付随キーは数えない） */
export function countStaffScheduleOverrides(schedule: StaffScheduleSettings | null | undefined): number {
  if (!schedule) return 0;
  return STAFF_SCHEDULE_ITEMS.filter((item) => schedule[item.key] !== undefined && schedule[item.key] !== null).length;
}

/** スタッフ選択の中に「希望日時設定」を持つスタッフが 1 人でもいるか */
export function hasStaffSchedules(staffSelection: FormConfig['staff_selection'] | null | undefined): boolean {
  if (!staffSelection || staffSelection.enabled !== true) return false;
  return (staffSelection.staff || []).some((m) => countStaffScheduleOverrides(m.schedule) > 0);
}

/**
 * フォームのカレンダー設定にスタッフの上書きを重ねる（静的 HTML の `mergeStaffSchedule` と同じ規則）
 * - 上書きがある項目だけスタッフの値に置き換える。付随キーも一緒に置き換える（未設定なら空）
 * - 第三希望日時の設定など、上書き対象外の項目はフォームの値のまま
 */
export function mergeStaffSchedule(cs: CalendarSettings, schedule: StaffScheduleSettings | null | undefined): CalendarSettings {
  if (!schedule) return cs;
  const out: CalendarSettings = { ...cs };
  for (const item of STAFF_SCHEDULE_ITEMS) {
    const v = schedule[item.key];
    if (v === undefined || v === null) continue;
    (out as Record<string, unknown>)[item.key] = v;
    if (item.companion) {
      const cv = schedule[item.companion];
      (out as Record<string, unknown>)[item.companion] = cv === undefined || cv === null
        ? (item.companion === 'blocked_time_weekdays' ? {} : [])
        : cv;
    }
  }
  return out;
}

/** 編集画面でスタッフ用に設定を始めるときの初期値（フォームの現在値をコピー） */
export function pickFormValueForStaffItem(cs: CalendarSettings, key: keyof StaffScheduleSettings): unknown {
  switch (key) {
    case 'business_hours': return JSON.parse(JSON.stringify(cs.business_hours || {}));
    case 'holiday_hours': return { enabled: cs.holiday_hours?.enabled === true, open: cs.holiday_hours?.open || '09:00', close: cs.holiday_hours?.close || '18:00' };
    case 'special_business_days': return [...(cs.special_business_days || [])] as SpecialBusinessDay[];
    case 'blocked_times': return [...(cs.blocked_times || [])];
    case 'blocked_time_weekdays': return { ...(cs.blocked_time_weekdays || {}) };
    case 'time_interval': return cs.time_interval || 30;
    case 'extra_minutes': return [...(cs.extra_minutes || [])];
    case 'min_advance_days': return cs.min_advance_days ?? 0;
    case 'min_advance_hours': return cs.min_advance_hours ?? 0;
    case 'conditional_advance_rules': return (cs.conditional_advance_rules || []).map((r) => ({ ...r }));
    case 'advance_booking_days': return cs.advance_booking_days || 30;
    case 'holidays_as_closed': return cs.holidays_as_closed === true;
    case 'excluded_holiday_types': return [...(cs.excluded_holiday_types || [])];
    case 'allow_exceed_business_hours': return cs.allow_exceed_business_hours === true;
    default: return undefined;
  }
}

/**
 * 静的 HTML に埋め込む共通ロジック（バッククォート不使用）
 * - mergeStaffSchedule(cs, schedule): 上の TS 版と同じ
 */
export const STAFF_SCHEDULE_RUNTIME_JS = `
// ========== スタッフごとの希望日時設定（共通ロジック）==========
var STAFF_SCHEDULE_KEYS = [
    ['business_hours', null], ['holiday_hours', null], ['special_business_days', null],
    ['blocked_times', 'blocked_time_weekdays'], ['time_interval', null], ['extra_minutes', null],
    ['min_advance_days', null], ['min_advance_hours', null], ['conditional_advance_rules', null], ['advance_booking_days', null],
    ['holidays_as_closed', 'excluded_holiday_types'], ['allow_exceed_business_hours', null]
];
// フォームのカレンダー設定にスタッフの上書きを重ねる（上書きがある項目だけスタッフの値。付随キーも一緒に置き換える）
function mergeStaffSchedule(cs, schedule) {
    if (!schedule || typeof schedule !== 'object') return cs;
    var out = Object.assign({}, cs || {});
    for (var i = 0; i < STAFF_SCHEDULE_KEYS.length; i++) {
        var key = STAFF_SCHEDULE_KEYS[i][0];
        var companion = STAFF_SCHEDULE_KEYS[i][1];
        var v = schedule[key];
        if (v === undefined || v === null) continue;
        out[key] = v;
        if (companion) {
            var cv = schedule[companion];
            out[companion] = (cv === undefined || cv === null) ? (companion === 'blocked_time_weekdays' ? {} : []) : cv;
        }
    }
    return out;
}
// スタッフが希望日時設定を 1 項目でも持っているか
function staffHasSchedule(member) {
    var s = member && member.schedule;
    if (!s || typeof s !== 'object') return false;
    for (var i = 0; i < STAFF_SCHEDULE_KEYS.length; i++) {
        var v = s[STAFF_SCHEDULE_KEYS[i][0]];
        if (v !== undefined && v !== null) return true;
    }
    return false;
}
`;
