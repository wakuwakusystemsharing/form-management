/**
 * 第三希望日時選択（multiple_dates）の設定の既定値と正規化（純粋ロジック）
 *
 * 予約フォームの `calendar_settings.multiple_dates_settings` と、
 * アンケートの質問型「第三希望日時選択」（`SurveyQuestion.multiple_dates`）で同じ設定を使う。
 */
import type { MultipleDatesSettings, SpecialBusinessDay } from '@/types/form';
import { sanitizeExtraMinutes, sanitizeSpecialBusinessDays } from './form-normalizer';

export const TIME_INTERVALS = [10, 15, 20, 30, 45, 60, 120] as const;
export type TimeInterval = (typeof TIME_INTERVALS)[number];

export type WeekdayHoursEntry = NonNullable<MultipleDatesSettings['weekday_hours']>[string];
export type HolidayHoursEntry = NonNullable<MultipleDatesSettings['holiday_hours']>;
export type ExtraSlot = { label: string; after: string };

/** 曜日別の受付時間の既定値（日曜のみ定休） */
export function createDefaultWeekdayHours(): NonNullable<MultipleDatesSettings['weekday_hours']> {
  return {
    '0': { open: '09:00', close: '18:00', closed: true },
    '1': { open: '09:00', close: '18:00', closed: false },
    '2': { open: '09:00', close: '18:00', closed: false },
    '3': { open: '09:00', close: '18:00', closed: false },
    '4': { open: '09:00', close: '18:00', closed: false },
    '5': { open: '09:00', close: '18:00', closed: false },
    '6': { open: '09:00', close: '18:00', closed: false },
  };
}

export function createDefaultMultipleDatesSettings(): MultipleDatesSettings {
  return {
    time_interval: 30,
    extra_minutes: [],
    date_range_days: 30,
    exclude_weekdays: [0],
    start_time: '09:00',
    end_time: '18:00',
    weekday_hours: createDefaultWeekdayHours(),
    holiday_hours: { enabled: false, open: '09:00', close: '18:00', custom: false, custom_slots: [], extra_slots: [] },
    special_business_days: [],
    required_choices: [1, 2, 3],
    visible_choices: [1, 2, 3],
    blocked_times: [],
    blocked_time_weekdays: {},
  };
}

function isTimeInterval(v: unknown): v is TimeInterval {
  return (TIME_INTERVALS as readonly number[]).includes(v as number);
}

function strTime(v: unknown, fallback: string): string {
  return typeof v === 'string' && v ? v : fallback;
}

function sanitizeExtraSlots(v: unknown): ExtraSlot[] {
  return Array.isArray(v)
    ? v.filter((x): x is ExtraSlot => !!x && typeof x === 'object' && typeof (x as { label?: unknown }).label === 'string' && typeof (x as { after?: unknown }).after === 'string')
    : [];
}

function sanitizeChoices(v: unknown, fallback: number[]): number[] {
  const arr = Array.isArray(v) ? v.filter((n): n is number => n === 1 || n === 2 || n === 3) : fallback;
  return [...new Set(arr)].sort();
}

/**
 * 保存データを欠損なく補完する。フォーム設定・アンケートの質問どちらの読み取りでも通す
 * （予約フォームの normalizeForm() と同じ規則）
 */
export function normalizeMultipleDatesSettings(raw: unknown): MultipleDatesSettings {
  const d = createDefaultMultipleDatesSettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const weekdayRaw = r.weekday_hours && typeof r.weekday_hours === 'object' ? (r.weekday_hours as Record<string, unknown>) : null;
  const weekday_hours = createDefaultWeekdayHours();
  if (weekdayRaw) {
    for (const key of Object.keys(weekday_hours)) {
      const w = weekdayRaw[key] as Record<string, unknown> | undefined;
      if (!w || typeof w !== 'object') continue;
      weekday_hours[key] = {
        open: strTime(w.open, '09:00'),
        close: strTime(w.close, '18:00'),
        closed: w.closed === true,
        custom: w.custom === true,
        custom_slots: Array.isArray(w.custom_slots) ? w.custom_slots.filter((x): x is string => typeof x === 'string') : [],
        extra_slots: sanitizeExtraSlots(w.extra_slots),
      };
    }
  } else if (Array.isArray(r.exclude_weekdays)) {
    // レガシー: exclude_weekdays + start_time / end_time から曜日別を組み立てる
    const excluded = r.exclude_weekdays.filter((n): n is number => typeof n === 'number');
    for (const key of Object.keys(weekday_hours)) {
      weekday_hours[key] = {
        open: strTime(r.start_time, '09:00'),
        close: strTime(r.end_time, '18:00'),
        closed: excluded.includes(Number(key)),
      };
    }
  }

  const hh = r.holiday_hours && typeof r.holiday_hours === 'object' ? (r.holiday_hours as Record<string, unknown>) : {};
  const required = sanitizeChoices(r.required_choices, d.required_choices!);
  if (!required.includes(1)) required.unshift(1);
  const visible = sanitizeChoices(r.visible_choices, d.visible_choices!);

  const blockedWeekdays: Record<string, number[]> = {};
  if (r.blocked_time_weekdays && typeof r.blocked_time_weekdays === 'object') {
    for (const [time, days] of Object.entries(r.blocked_time_weekdays as Record<string, unknown>)) {
      if (!/^\d{1,2}:\d{2}$/.test(time) || !Array.isArray(days)) continue;
      const valid = [...new Set(days.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
      if (valid.length > 0) blockedWeekdays[time] = valid;
    }
  }

  return {
    time_interval: isTimeInterval(r.time_interval) ? r.time_interval : d.time_interval,
    extra_minutes: sanitizeExtraMinutes(r.extra_minutes),
    date_range_days: typeof r.date_range_days === 'number' && Number.isFinite(r.date_range_days) && r.date_range_days > 0 ? Math.floor(r.date_range_days) : d.date_range_days,
    exclude_weekdays: Object.entries(weekday_hours).filter(([, h]) => h.closed).map(([k]) => Number(k)),
    start_time: strTime(r.start_time, d.start_time),
    end_time: strTime(r.end_time, d.end_time),
    weekday_hours,
    holiday_hours: {
      enabled: hh.enabled === true,
      open: strTime(hh.open, '09:00'),
      close: strTime(hh.close, '18:00'),
      custom: hh.custom === true,
      custom_slots: Array.isArray(hh.custom_slots) ? hh.custom_slots.filter((x): x is string => typeof x === 'string') : [],
      extra_slots: sanitizeExtraSlots(hh.extra_slots),
    },
    special_business_days: sanitizeSpecialBusinessDays(r.special_business_days) as SpecialBusinessDay[],
    required_choices: [...new Set(required)].sort(),
    visible_choices: visible.length > 0 ? visible : [1, 2, 3],
    blocked_times: Array.isArray(r.blocked_times) ? r.blocked_times.filter((x): x is string => typeof x === 'string' && /^\d{1,2}:\d{2}$/.test(x)) : [],
    blocked_time_weekdays: blockedWeekdays,
  };
}

/** 表示する希望（1〜3）。未設定 = 全て表示。最低 1 つ */
export function getVisibleChoices(settings: Pick<MultipleDatesSettings, 'visible_choices'> | null | undefined): number[] {
  const vc = sanitizeChoices(settings?.visible_choices, [1, 2, 3]);
  return vc.length > 0 ? vc : [1, 2, 3];
}

/** 必須の希望（1〜3）。未設定 = 全て必須。第一希望は常に必須 */
export function getRequiredChoices(settings: Pick<MultipleDatesSettings, 'required_choices'> | null | undefined): number[] {
  const rc = sanitizeChoices(settings?.required_choices, [1, 2, 3]);
  if (!rc.includes(1)) rc.unshift(1);
  return [...new Set(rc)].sort();
}
