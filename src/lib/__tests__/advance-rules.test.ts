import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import { describeAdvanceRule, resolveEarliestBookable, sanitizeConditionalAdvanceRules } from '../advance-rules';
import { mergeStaffSchedule, normalizeStaffSchedule } from '../staff-schedule';
import type { Form, FormConfig } from '@/types/form';

const at = (iso: string) => new Date(iso);

describe('sanitizeConditionalAdvanceRules', () => {
  it('不正な行を除き、時刻を HH:MM に正規化し、id を補う', () => {
    const out = sanitizeConditionalAdvanceRules([
      { id: 'r1', from_time: '15:0', min_days: 2 },
      { from_time: '9:00', until_time: '25:00', min_days: '1', start_time: '9:30' },
      { min_days: -1 },
      null, 'x',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: 'r1', min_days: 2 }); // '15:0' は不正 → 条件なし
    expect(out[1]).toMatchObject({ from_time: '09:00', min_days: 1, start_time: '09:30' });
    expect(out[1].until_time).toBeUndefined();
    expect(out[1].id).toMatch(/^car_/);
    expect(sanitizeConditionalAdvanceRules(undefined)).toEqual([]);
  });
});

describe('resolveEarliestBookable', () => {
  it('例1: 常に 2 日後の 09:30 から', () => {
    const cs = { min_advance_days: 0, conditional_advance_rules: [{ id: 'a', min_days: 2, start_time: '09:30' }] };
    expect(resolveEarliestBookable(cs, at('2026-10-21T10:00:00'))).toEqual({ days: 2, start_time: '09:30' });
  });

  it('例2: 15:00 までは翌日 OK、15:00 以降は 2 日後から', () => {
    const cs = { min_advance_days: 1, conditional_advance_rules: [{ id: 'a', from_time: '15:00', min_days: 2 }] };
    expect(resolveEarliestBookable(cs, at('2026-10-21T14:59:00'))).toEqual({ days: 1, start_time: null });
    expect(resolveEarliestBookable(cs, at('2026-10-21T15:00:00'))).toEqual({ days: 2, start_time: null });
  });

  it('until_time / 複数ルール: いちばん先になるものを採用。同じ日数なら遅い開始時刻', () => {
    const cs = {
      min_advance_days: 1,
      conditional_advance_rules: [
        { id: 'a', until_time: '12:00', min_days: 1, start_time: '10:00' },
        { id: 'b', from_time: '12:00', until_time: '18:00', min_days: 1, start_time: '13:00' },
        { id: 'c', from_time: '18:00', min_days: 3 },
      ],
    };
    expect(resolveEarliestBookable(cs, at('2026-10-21T08:00:00'))).toEqual({ days: 1, start_time: '10:00' });
    expect(resolveEarliestBookable(cs, at('2026-10-21T12:00:00'))).toEqual({ days: 1, start_time: '13:00' });
    expect(resolveEarliestBookable(cs, at('2026-10-21T20:00:00'))).toEqual({ days: 3, start_time: null });
    // 予約受付開始日の方が先ならそちら（ルールの開始時刻は無視）
    expect(resolveEarliestBookable({ min_advance_days: 5, conditional_advance_rules: cs.conditional_advance_rules }, at('2026-10-21T08:00:00'))).toEqual({ days: 5, start_time: null });
    expect(resolveEarliestBookable(undefined, at('2026-10-21T08:00:00'))).toEqual({ days: 0, start_time: null });
  });

  it('説明文', () => {
    expect(describeAdvanceRule({ id: 'a', min_days: 2, start_time: '09:30' })).toBe('常に、2日後の 09:30から予約可能');
    expect(describeAdvanceRule({ id: 'a', from_time: '15:00', min_days: 2 })).toBe('現在時刻が 15:00 以降のとき、2日後から予約可能');
    expect(describeAdvanceRule({ id: 'a', until_time: '12:00', min_days: 0 })).toBe('現在時刻が 12:00 より前のとき、当日から予約可能');
  });

  it('スタッフの希望日時設定でも上書きできる', () => {
    const sc = normalizeStaffSchedule({ conditional_advance_rules: [{ min_days: 3, start_time: '10:00' }] })!;
    expect(sc.conditional_advance_rules).toHaveLength(1);
    const merged = mergeStaffSchedule({ min_advance_days: 0, conditional_advance_rules: [{ id: 'f', min_days: 1 }] } as FormConfig['calendar_settings'], sc);
    expect(resolveEarliestBookable(merged, at('2026-10-21T08:00:00'))).toEqual({ days: 3, start_time: '10:00' });
  });
});

// ---- 静的 HTML
type Ctx = { staffId: string | null; cs: FormConfig['calendar_settings']; max: Date; minDate: Date; startTime: string | null };
type BookingForm = {
  getMinAdvanceDays: () => number;
  getEarliestBookableStart: () => { date: string; time: string } | null;
  getRuleContexts: () => Array<{ staffId: string | null; cs: FormConfig['calendar_settings'] }>;
  evaluateSlotRules: (ctx: Ctx, date: Date, time: string, dayOfWeek: number, slotStart: Date, slotEnd: Date, now: Date) => { ok: boolean; isPast: boolean };
  populateDateOptions: (index: number, settings: unknown) => void;
  populateTimeOptions: (index: number, settings: unknown, dateStr: string) => void;
};

const allWeek = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, { open: '09:00', close: '18:00', closed: false }]));

function buildForm(mode: 'calendar' | 'multiple_dates'): Form {
  return normalizeForm({
    id: 'form_adv', store_id: 'st0001', form_type: 'line',
    config: {
      basic_info: { form_name: '条件付き', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: {
        booking_mode: mode,
        business_hours: allWeek,
        min_advance_days: 0,
        advance_booking_days: 30,
        time_interval: 30,
        conditional_advance_rules: [{ id: 'a', min_days: 2, start_time: '09:30' }],
        multiple_dates_settings: {
          time_interval: 30, date_range_days: 10, exclude_weekdays: [], start_time: '09:00', end_time: '12:00',
          weekday_hours: Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, { open: '09:00', close: '12:00', closed: false }])),
        },
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

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('予約フォーム: 条件付き予約受付開始時間', () => {
  it('カレンダー表示モード: 2 日後の 09:30 より前は✕、09:30 以降は〇', async () => {
    const form = buildForm('calendar');
    const w = await loadDom(new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview'));
    const bf = w.bookingForm;
    const now = new Date(); now.setHours(8, 0, 0, 0);
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const [c] = bf.getRuleContexts();
    const minDate = new Date(today); minDate.setDate(today.getDate() + 2);
    const max = new Date(today); max.setDate(today.getDate() + 30); max.setHours(23, 59, 59, 999);
    const ctx: Ctx = { ...c, max, minDate, startTime: '09:30' };
    const check = (d: Date, time: string) => {
      const [h, m] = time.split(':').map(Number);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
      return bf.evaluateSlotRules(ctx, d, time, d.getDay(), start, new Date(start.getTime() + 30 * 60000), now).ok;
    };
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 3);
    expect(check(tomorrow, '10:00')).toBe(false);   // 2 日後より前
    expect(check(minDate, '09:00')).toBe(false);    // 最初の日の 09:30 より前
    expect(check(minDate, '09:30')).toBe(true);
    expect(check(minDate, '10:00')).toBe(true);
    expect(check(dayAfter, '09:00')).toBe(true);    // 翌日以降は営業開始から
    expect(bf.getMinAdvanceDays()).toBe(2);
    expect(bf.getEarliestBookableStart()).toEqual({ date: ymd(minDate), time: '09:30' });
  });

  it('第三希望日時モード: 日付は 2 日後から、最初の日の時間は 09:30 から', async () => {
    const form = buildForm('multiple_dates');
    const w = await loadDom(new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview'));
    const bf = w.bookingForm;
    const settings = form.config.calendar_settings.multiple_dates_settings;
    bf.populateDateOptions(1, settings);
    const daySelect = w.document.getElementById('date1_day') as HTMLSelectElement;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const minDate = new Date(today); minDate.setDate(today.getDate() + 2);
    expect(daySelect.options[1].value).toBe(ymd(minDate));

    bf.populateTimeOptions(1, settings, ymd(minDate));
    const timeSelect = w.document.getElementById('date1_time') as HTMLSelectElement;
    expect(Array.from(timeSelect.options).map((o) => o.value)).toEqual(['', '09:30', '10:00', '10:30', '11:00', '11:30']);

    const later = new Date(minDate); later.setDate(minDate.getDate() + 1);
    bf.populateTimeOptions(1, settings, ymd(later));
    expect(Array.from(timeSelect.options).map((o) => o.value)[1]).toBe('09:00');
  });
});
