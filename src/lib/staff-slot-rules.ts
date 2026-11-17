/**
 * スタッフ選択「指名なし」の自動割当で、サーバー側が候補スタッフを絞るための純粋ロジック。
 *
 * 予約 API はもともとカレンダーの予定だけを見て割り当てていたため、
 * - スタッフごとの希望日時設定（営業時間・事前予約可能日数など）を満たさないスタッフ
 * - 指名なしでは受けたくないスタッフ
 * にも割り当てられていた。ここでは静的 HTML の `evaluateSlotRules`（`static-generator-reservation.ts`）と
 * 同じ規則を日本時間で判定する。**直すときは両方**。DB・API に依存しない（Vitest 対象）
 *
 * 見ないもの: カレンダーの予定（`staff-availability.ts`）、メニュー / オプションの対応時間設定
 */
import type { FormConfig, StaffScheduleSettings } from '@/types/form';
import { resolveEarliestBookable } from './advance-rules';
import { getEffectiveHolidayType, isHolidayBlocked } from './japanese-holidays';
import { mergeStaffSchedule } from './staff-schedule';

type CalendarSettings = FormConfig['calendar_settings'];

export interface SlotRuleInput {
  /** 予約日 YYYY-MM-DD（日本時間） */
  date: string;
  /** 予約時刻 HH:MM（日本時間） */
  time: string;
  /** 所要時間（分）。不明なら 0 */
  durationMinutes: number;
  /** 判定時刻 */
  now: Date;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toMinutes(t: unknown, fallback: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof t === 'string' && t ? t : fallback);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
}

function normalizeTime(t: unknown): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof t === 'string' ? t : '');
  return m ? `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2]}` : '';
}

/** 指名なしの自動割当の対象か（未設定 = 対象） */
export function isNoPreferenceAssignable(member: { no_preference_assignable?: boolean } | null | undefined): boolean {
  return !!member && member.no_preference_assignable !== false;
}

/** 当日の営業時間: 臨時営業日 > 祝日の営業時間 > 曜日設定（静的 HTML の getDayBusinessHoursFor と同じ） */
export function dayBusinessHours(
  cs: CalendarSettings | null | undefined,
  date: string,
  dayOfWeek: number
): { hours: { open?: string; close?: string; closed?: boolean } | undefined; special: boolean } {
  const sp = (cs?.special_business_days || []).find(
    (e) => e && e.date === date && typeof e.open === 'string' && typeof e.close === 'string'
  );
  if (sp) return { hours: { open: sp.open, close: sp.close, closed: false }, special: true };
  const hh = cs?.holiday_hours;
  if (hh && hh.enabled === true && getEffectiveHolidayType(date)) {
    return { hours: { open: hh.open || '09:00', close: hh.close || '18:00', closed: false }, special: false };
  }
  return { hours: cs?.business_hours?.[DAY_NAMES[dayOfWeek]], special: false };
}

/**
 * その日時が、指定したカレンダー設定（フォーム設定にスタッフの希望日時設定を重ねたもの）で予約できるか。
 * 受付期間（事前予約可能日数・予約受付開始日・条件付き予約受付開始時間・予約受付開始時間）/ 営業時間 / 定休 /
 * 営業時間超過 / ✕にする時間帯 / 祝日 を見る
 */
export function isSlotBookableForSettings(cs: CalendarSettings | null | undefined, input: SlotRuleInput): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return false;
  const slotStartMs = Date.parse(`${input.date}T${input.time}:00+09:00`);
  if (Number.isNaN(slotStartMs)) return false;
  const [y, mo, d] = input.date.split('-').map(Number);
  const dateUtc = Date.UTC(y, mo - 1, d);
  const dayOfWeek = new Date(dateUtc).getUTCDay();
  const slotMin = toMinutes(input.time, '00:00');
  const duration = Number.isFinite(input.durationMinutes) && input.durationMinutes > 0 ? input.durationMinutes : 0;

  // 日本時間の「今日」から数えた日数
  const jstNow = new Date(input.now.getTime() + JST_OFFSET_MS);
  const todayUtc = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate());
  const dayDiff = Math.round((dateUtc - todayUtc) / 86400000);

  // 予約可能期間（予約受付開始日〜事前予約可能日数）
  const maxDays = cs?.advance_booking_days ?? 30;
  // resolveEarliestBookable は Date のローカル時刻を見るので、ローカル時刻 = 日本時間 になる Date を渡す
  const jstAsLocal = new Date(input.now.getTime() + JST_OFFSET_MS + input.now.getTimezoneOffset() * 60000);
  const earliest = resolveEarliestBookable(cs, jstAsLocal);
  if (dayDiff > maxDays || dayDiff < earliest.days) return false;
  // 条件付き予約受付開始時間: 最初に予約できる日は、その開始時刻より前は不可
  if (dayDiff === earliest.days && earliest.start_time) {
    const startMin = toMinutes(earliest.start_time, '00:00');
    if (!Number.isNaN(startMin) && slotMin < startMin) return false;
  }

  // 予約受付開始時間（現在から N 時間後より前は不可）
  const mah = cs?.min_advance_hours;
  const minAdvanceMs = (typeof mah === 'number' && mah > 0 ? mah : 0) * 3600000;
  if (slotStartMs < input.now.getTime() + minAdvanceMs) return false;

  // 終了が翌日になる予約は不可
  if (slotMin + duration >= 24 * 60) return false;

  const { hours, special } = dayBusinessHours(cs, input.date, dayOfWeek);
  if (hours?.closed === true) return false;
  if (hours) {
    const openMin = toMinutes(hours.open, '09:00');
    const closeMin = toMinutes(hours.close, '18:00');
    if (!(slotMin >= openMin && slotMin < closeMin)) return false;
    // 営業時間超過
    if (!(cs?.allow_exceed_business_hours || false) && slotMin + duration > closeMin) return false;
  }

  // デフォルトで✕にする時間帯（曜日指定があればその曜日だけ）
  const blockedList = (cs?.blocked_times || []).map(normalizeTime).filter(Boolean);
  if (blockedList.includes(input.time)) {
    let days: number[] | null = null;
    for (const [t, list] of Object.entries(cs?.blocked_time_weekdays || {})) {
      if (normalizeTime(t) === input.time && Array.isArray(list) && list.length > 0) days = list;
    }
    if (!days || days.includes(dayOfWeek)) return false;
  }

  // 祝日を予約不可にする（臨時営業日は対象外）
  if (!special && isHolidayBlocked(cs, input.date)) return false;

  return true;
}

/**
 * 指名なしの自動割当の候補を「対象にする」設定と、スタッフごとの希望日時設定で絞る。
 * カレンダーの空き・メニュー対応は呼び出し側で見る
 */
export function filterNoPreferenceStaffByRules<T extends { no_preference_assignable?: boolean; schedule?: StaffScheduleSettings }>(
  staff: T[],
  formCalendarSettings: CalendarSettings | null | undefined,
  input: SlotRuleInput
): T[] {
  return staff.filter(
    (m) =>
      isNoPreferenceAssignable(m) &&
      isSlotBookableForSettings(mergeStaffSchedule((formCalendarSettings || {}) as CalendarSettings, m.schedule), input)
  );
}
