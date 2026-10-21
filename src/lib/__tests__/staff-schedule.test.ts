import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import {
  STAFF_SCHEDULE_ITEMS,
  countStaffScheduleOverrides,
  hasStaffSchedules,
  mergeStaffSchedule,
  normalizeStaffSchedule,
} from '../staff-schedule';
import type { Form, FormConfig } from '@/types/form';

const weekdays = (open: string, close: string, closedDays: string[] = []) => {
  const out: Record<string, { open: string; close: string; closed: boolean }> = {};
  for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    out[d] = { open, close, closed: closedDays.includes(d) };
  }
  return out;
};

const baseCs: FormConfig['calendar_settings'] = {
  booking_mode: 'calendar',
  business_hours: weekdays('09:00', '18:00', ['sunday']),
  advance_booking_days: 30,
  min_advance_days: 0,
  min_advance_hours: 0,
  time_interval: 30,
  blocked_times: ['12:00'],
  blocked_time_weekdays: {},
  holidays_as_closed: false,
  excluded_holiday_types: [],
  allow_exceed_business_hours: false,
} as FormConfig['calendar_settings'];

describe('normalizeStaffSchedule', () => {
  it('上書きが無ければ undefined。不正値は「フォームの設定を使う」に戻す', () => {
    expect(normalizeStaffSchedule(undefined)).toBeUndefined();
    expect(normalizeStaffSchedule({})).toBeUndefined();
    expect(normalizeStaffSchedule({ time_interval: 25, min_advance_days: -1, advance_booking_days: 0, holidays_as_closed: 'yes' })).toBeUndefined();
  });

  it('各項目を検証して保持し、付随キーもそろえる', () => {
    const sc = normalizeStaffSchedule({
      business_hours: { monday: { open: '10:00', close: '19:00', closed: false }, sunday: { closed: true } },
      holiday_hours: { enabled: true, open: '9:00', close: '15:00' },
      special_business_days: [{ date: '2026-11-03', open: '10:00', close: '12:00' }],
      blocked_times: ['13:00', '9:30', 'x'],
      blocked_time_weekdays: { '13:00': [1, 2, 9] },
      time_interval: 60,
      extra_minutes: [10, 70],
      min_advance_days: 1,
      min_advance_hours: 2.9,
      advance_booking_days: 14,
      holidays_as_closed: true,
      allow_exceed_business_hours: true,
    })!;
    expect(sc.business_hours?.monday).toEqual({ open: '10:00', close: '19:00', closed: false });
    expect(sc.business_hours?.sunday).toEqual({ open: '09:00', close: '18:00', closed: true });
    expect(sc.business_hours?.tuesday).toEqual({ open: '09:00', close: '18:00', closed: false });
    expect(sc.holiday_hours).toEqual({ enabled: true, open: '09:00', close: '15:00' });
    expect(sc.special_business_days).toEqual([{ date: '2026-11-03', open: '10:00', close: '12:00' }]);
    expect(sc.blocked_times).toEqual(['13:00', '09:30']);
    expect(sc.blocked_time_weekdays).toEqual({ '13:00': [1, 2] });
    expect(sc.time_interval).toBe(60);
    expect(sc.extra_minutes).toEqual([10]);
    expect(sc.min_advance_days).toBe(1);
    expect(sc.min_advance_hours).toBe(2);
    expect(sc.advance_booking_days).toBe(14);
    expect(sc.holidays_as_closed).toBe(true);
    expect(sc.excluded_holiday_types).toEqual([]);
    expect(sc.allow_exceed_business_hours).toBe(true);
    expect(countStaffScheduleOverrides(sc)).toBe(STAFF_SCHEDULE_ITEMS.length);
  });

  it('normalizeForm がスタッフの希望日時設定を正規化し、無いスタッフにはキーを付けない', () => {
    const form = normalizeForm({
      id: 'f', store_id: 's',
      config: {
        staff_selection: {
          enabled: true,
          staff: [
            { id: 'a', name: 'A', calendar_id: 'cal-a', schedule: { min_advance_days: 2, time_interval: 99 } },
            { id: 'b', name: 'B', calendar_id: 'cal-b', schedule: {} },
          ],
        },
      },
    });
    const staff = form.config.staff_selection!.staff;
    expect(staff[0].schedule).toEqual({ min_advance_days: 2 });
    expect('schedule' in staff[1]).toBe(false);
    expect(hasStaffSchedules(form.config.staff_selection)).toBe(true);
    expect(hasStaffSchedules({ enabled: false, staff: staff as never })).toBe(false);
  });
});

describe('mergeStaffSchedule', () => {
  it('上書きがある項目だけスタッフの値になり、付随キーも一緒に置き換わる', () => {
    const merged = mergeStaffSchedule(baseCs, { min_advance_days: 3, blocked_times: ['15:00'] });
    expect(merged.min_advance_days).toBe(3);
    expect(merged.blocked_times).toEqual(['15:00']);
    expect(merged.blocked_time_weekdays).toEqual({});
    expect(merged.business_hours).toBe(baseCs.business_hours);
    expect(merged.advance_booking_days).toBe(30);
    expect(mergeStaffSchedule(baseCs, undefined)).toBe(baseCs);
  });

  it('祝日を予約不可の上書きは除外リストも一緒に置き換わる', () => {
    const withExcluded = mergeStaffSchedule({ ...baseCs, holidays_as_closed: true, excluded_holiday_types: ['new_year'] }, { holidays_as_closed: false });
    expect(withExcluded.holidays_as_closed).toBe(false);
    expect(withExcluded.excluded_holiday_types).toEqual([]);
  });
});

// ---- 静的 HTML（カレンダー表示モード）の判定
type Ctx = { staffId: string | null; cs: FormConfig['calendar_settings']; max: Date; minDate: Date };
type BookingForm = {
  state: { selectedStaffId: string; selectedMenu: { id: string } | null; selectedMenus?: Record<string, string[]>; selectedOptions?: Record<string, string[]> };
  getRuleContexts: () => Array<{ staffId: string | null; cs: FormConfig['calendar_settings'] }>;
  getPrimaryCalendarSettings: () => FormConfig['calendar_settings'];
  getDayBusinessHoursFor: (cs: unknown, date: Date) => { open: string; close: string; closed: boolean } | undefined;
  getDayBusinessHours: (date: Date) => { open: string; close: string; closed: boolean } | undefined;
  isBlockedTimeSlotFor: (cs: unknown, time: string, dayOfWeek: number) => boolean;
  evaluateSlotRules: (ctx: Ctx, date: Date, time: string, dayOfWeek: number, slotStart: Date, slotEnd: Date, now: Date) => { ok: boolean; isPast: boolean };
};

function buildForm(staffSchedules: boolean): Form {
  return normalizeForm({
    id: 'form_staff',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'スタッフ予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: baseCs,
      menu_structure: {
        structure_type: 'simple',
        categories: [{ id: 'c1', name: 'カット', display_name: 'カット', selection_mode: 'single', options: [], menus: [
          { id: 'm1', name: 'カット', price: 3000, duration: 60 },
          { id: 'm2', name: 'カラー', price: 8000, duration: 120 },
        ] }],
      },
      staff_selection: {
        enabled: true,
        allow_no_preference: true,
        staff: [
          { id: 'sa', name: '佐藤', calendar_id: 'cal-a', ...(staffSchedules ? { schedule: { business_hours: weekdays('13:00', '20:00', ['sunday', 'monday']), min_advance_days: 1, allow_exceed_business_hours: true, blocked_times: ['15:00'], blocked_time_weekdays: { '15:00': [2] } } } : {}) },
          { id: 'sb', name: '鈴木', calendar_id: 'cal-b', hidden_menu_ids: ['m2'] },
        ],
      },
    },
  });
}

async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return dom.window as unknown as { bookingForm: BookingForm; document: Document };
}

const ctxOf = (bf: BookingForm, c: { staffId: string | null; cs: FormConfig['calendar_settings'] }, today: Date): Ctx => {
  const max = new Date(today); max.setDate(today.getDate() + (c.cs.advance_booking_days ?? 30)); max.setHours(23, 59, 59, 999);
  const minDate = new Date(today); minDate.setDate(today.getDate() + (c.cs.min_advance_days || 0));
  return { ...c, max, minDate };
};

describe('予約フォーム（カレンダー表示モード）: スタッフごとの希望日時設定', () => {
  it('希望日時設定を持つスタッフがいなければ、設定の組はフォームの設定 1 つ（従来どおり）', async () => {
    const form = buildForm(false);
    const w = await loadDom(new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview'));
    const bf = w.bookingForm;
    bf.state.selectedStaffId = 'sa';
    const ctxs = bf.getRuleContexts();
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0].staffId).toBeNull();
    expect(ctxs[0].cs.business_hours?.monday.open).toBe('09:00');
  });

  it('指名ありはそのスタッフの設定、指名なしは対応できる各スタッフの設定になる', async () => {
    const form = buildForm(true);
    const w = await loadDom(new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview'));
    const bf = w.bookingForm;

    bf.state.selectedStaffId = 'sa';
    const named = bf.getRuleContexts();
    expect(named.map((c) => c.staffId)).toEqual(['sa']);
    expect(named[0].cs.business_hours?.tuesday).toEqual({ open: '13:00', close: '20:00', closed: false });
    expect(named[0].cs.min_advance_days).toBe(1);
    expect(named[0].cs.advance_booking_days).toBe(30); // 上書きしていない項目はフォームの値
    expect(bf.getPrimaryCalendarSettings().min_advance_days).toBe(1);

    bf.state.selectedStaffId = 'none';
    const none = bf.getRuleContexts();
    expect(none.map((c) => c.staffId)).toEqual(['sa', 'sb']);
    expect(none[1].cs.business_hours?.tuesday.open).toBe('09:00'); // 鈴木は上書き無し
    expect(bf.getPrimaryCalendarSettings().min_advance_days).toBe(0);

    // 鈴木が非表示にしているメニュー（m2）を選ぶと、指名なしでも鈴木は候補から外れる
    bf.state.selectedMenu = { id: 'm2' };
    expect(bf.getRuleContexts().map((c) => c.staffId)).toEqual(['sa']);
  });

  it('スロットの判定は設定の組ごとに行われる（営業時間 / 受付開始日 / ✕にする時間帯の曜日指定 / 営業時間超過）', async () => {
    const form = buildForm(true);
    const w = await loadDom(new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview'));
    const bf = w.bookingForm;
    const now = new Date('2026-10-20T08:00:00'); // 火曜 08:00
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    bf.state.selectedStaffId = 'none';
    const [ctxA, ctxB] = bf.getRuleContexts().map((c) => ctxOf(bf, c, today));

    const slot = (date: string, time: string, durationMin = 60) => {
      const d = new Date(`${date}T00:00:00`);
      const [h, m] = time.split(':').map(Number);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
      const end = new Date(start.getTime() + durationMin * 60000);
      return { d, start, end, dow: d.getDay() };
    };

    // 火曜 10:00（今日）: 佐藤は 13:00 開始 + 受付開始日 1 日後で ✕、鈴木（フォーム設定）は 〇
    let s = slot('2026-10-20', '10:00');
    expect(bf.evaluateSlotRules(ctxA, s.d, '10:00', s.dow, s.start, s.end, now).ok).toBe(false);
    expect(bf.evaluateSlotRules(ctxB, s.d, '10:00', s.dow, s.start, s.end, now).ok).toBe(true);

    // 水曜 14:00（明日）: 佐藤 〇（13:00〜20:00）、鈴木 〇
    s = slot('2026-10-21', '14:00');
    expect(bf.evaluateSlotRules(ctxA, s.d, '14:00', s.dow, s.start, s.end, now).ok).toBe(true);
    expect(bf.evaluateSlotRules(ctxB, s.d, '14:00', s.dow, s.start, s.end, now).ok).toBe(true);

    // 水曜 19:30 + 60 分: 佐藤は営業時間超過を許可しているので 〇、鈴木は 18:00 を過ぎているので ✕
    s = slot('2026-10-21', '19:30');
    expect(bf.evaluateSlotRules(ctxA, s.d, '19:30', s.dow, s.start, s.end, now).ok).toBe(true);
    expect(bf.evaluateSlotRules(ctxB, s.d, '19:30', s.dow, s.start, s.end, now).ok).toBe(false);

    // 佐藤の ✕にする時間帯 15:00 は火曜だけ。火曜は受付開始日の都合で来週で確認
    s = slot('2026-10-27', '15:00');
    expect(bf.evaluateSlotRules(ctxA, s.d, '15:00', s.dow, s.start, s.end, now).ok).toBe(false);
    s = slot('2026-10-28', '15:00');
    expect(bf.evaluateSlotRules(ctxA, s.d, '15:00', s.dow, s.start, s.end, now).ok).toBe(true);
    // フォームの ✕にする時間帯 12:00 は佐藤には引き継がれない（上書き済み）が、鈴木には効く
    expect(bf.isBlockedTimeSlotFor(ctxA.cs, '12:00', 3)).toBe(false);
    expect(bf.isBlockedTimeSlotFor(ctxB.cs, '12:00', 3)).toBe(true);

    // 月曜は佐藤が休み、鈴木は出勤
    s = slot('2026-10-26', '14:00');
    expect(bf.evaluateSlotRules(ctxA, s.d, '14:00', s.dow, s.start, s.end, now).ok).toBe(false);
    expect(bf.evaluateSlotRules(ctxB, s.d, '14:00', s.dow, s.start, s.end, now).ok).toBe(true);

    // 従来の getDayBusinessHours はフォームの設定を返す
    expect(bf.getDayBusinessHours(new Date('2026-10-21T00:00:00'))?.open).toBe('09:00');
  });
});
