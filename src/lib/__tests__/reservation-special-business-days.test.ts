import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm, sanitizeSpecialBusinessDays } from '../form-normalizer';
import type { Form } from '@/types/form';

type BookingForm = {
  getWeekdayHours: (settings: unknown, dayOfWeek: number, date: Date) => { open: string; close: string; closed: boolean; special?: boolean };
  isMdDateSelectable: (settings: unknown, date: Date) => boolean;
  populateTimeOptions: (index: number, settings: unknown, dateStr: string) => void;
  getSpecialBusinessHours: (date: Date) => { open: string; close: string; closed: boolean } | null;
  getDayBusinessHours: (date: Date) => { open: string; close: string; closed: boolean } | undefined;
  isCalendarDateBlockedAsHoliday: (date: Date) => boolean;
};

const closedAllWeek = {
  monday: { open: '09:00', close: '18:00', closed: true },
  tuesday: { open: '09:00', close: '18:00', closed: true },
  wednesday: { open: '09:00', close: '18:00', closed: true },
  thursday: { open: '09:00', close: '18:00', closed: true },
  friday: { open: '09:00', close: '18:00', closed: true },
  saturday: { open: '09:00', close: '18:00', closed: true },
  sunday: { open: '09:00', close: '18:00', closed: true },
};

function buildForm(mode: 'calendar' | 'multiple_dates'): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: {
        booking_mode: mode,
        business_hours: closedAllWeek,
        holidays_as_closed: true,
        excluded_holiday_types: [],
        // 2026-09-20 は日曜（定休）、2026-09-21 は敬老の日（祝日を予約不可 ON）
        special_business_days: [
          { date: '2026-09-21', open: '13:00', close: '15:00' },
          { date: '2026-09-20', open: '10:00', close: '12:00' },
        ],
        multiple_dates_settings: {
          time_interval: 60,
          date_range_days: 30,
          exclude_weekdays: [],
          start_time: '09:00',
          end_time: '18:00',
          weekday_hours: {
            '0': { open: '09:00', close: '18:00', closed: true },
            '1': { open: '09:00', close: '18:00', closed: true },
          },
          special_business_days: [
            { date: '2026-09-20', open: '10:00', close: '12:00' },
            { date: '2026-09-21', open: '13:00', close: '15:00' },
          ],
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

describe('sanitizeSpecialBusinessDays', () => {
  it('不正な行を除去し、日付で重複排除して昇順に並べる', () => {
    expect(sanitizeSpecialBusinessDays([
      { date: '2026-09-21', open: '13:00', close: '15:00' },
      { date: '2026-09-20', open: '9:00', close: '12:00' },
      { date: '2026-09-20', open: '10:00', close: '12:00' }, // 重複（先勝ち）
      { date: '2026/09/22', open: '10:00', close: '12:00' }, // 日付形式が不正
      { date: '2026-09-23', open: '', close: '12:00' },      // 時刻が空
      { date: '2026-09-24', open: '12:00', close: '10:00' }, // 終了が開始以前
      null, 'x', 42,
    ])).toEqual([
      { date: '2026-09-20', open: '09:00', close: '12:00' },
      { date: '2026-09-21', open: '13:00', close: '15:00' },
    ]);
    expect(sanitizeSpecialBusinessDays(undefined)).toEqual([]);
  });

  it('normalizeForm が両モードの臨時営業日を補完・正規化する', () => {
    const form = buildForm('calendar');
    expect(form.config.calendar_settings.special_business_days).toEqual([
      { date: '2026-09-20', open: '10:00', close: '12:00' },
      { date: '2026-09-21', open: '13:00', close: '15:00' },
    ]);
    expect(form.config.calendar_settings.multiple_dates_settings?.special_business_days).toHaveLength(2);
    const empty = normalizeForm({ id: 'f', store_id: 's', config: { calendar_settings: { multiple_dates_settings: { time_interval: 30, date_range_days: 30, exclude_weekdays: [], start_time: '09:00', end_time: '18:00' } } } });
    expect(empty.config.calendar_settings.special_business_days).toEqual([]);
    expect(empty.config.calendar_settings.multiple_dates_settings?.special_business_days).toEqual([]);
  });
});

describe('予約フォーム（第三希望日時モード）: 臨時営業日', () => {
  it('定休曜日でも臨時営業日は指定時間で受付する', async () => {
    const form = buildForm('multiple_dates');
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const w = await loadDom(html);
    const settings = form.config.calendar_settings.multiple_dates_settings;
    const sunday = new Date('2026-09-20T00:00:00');
    expect(w.bookingForm.getWeekdayHours(settings, 0, sunday)).toMatchObject({ open: '10:00', close: '12:00', closed: false, special: true });
    // 臨時営業日でない日曜は定休のまま
    expect(w.bookingForm.getWeekdayHours(settings, 0, new Date('2026-09-27T00:00:00')).closed).toBe(true);
    expect(w.bookingForm.isMdDateSelectable(settings, sunday)).toBe(true);
    expect(w.bookingForm.isMdDateSelectable(settings, new Date('2026-09-27T00:00:00'))).toBe(false);

    w.bookingForm.populateTimeOptions(1, settings, '2026-09-20');
    const select = w.document.getElementById('date1_time') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '10:00', '11:00']);
  });

  it('「祝日を予約不可にする」が ON でも臨時営業日として登録した祝日は受付する', async () => {
    const form = buildForm('multiple_dates');
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const w = await loadDom(html);
    const settings = form.config.calendar_settings.multiple_dates_settings;
    expect(w.bookingForm.isMdDateSelectable(settings, new Date('2026-09-21T00:00:00'))).toBe(true);
    // 臨時営業日でない祝日（2026-09-23 秋分の日・水曜 = weekday_hours 未設定でレガシー互換で営業扱い）は ✕
    expect(w.bookingForm.isMdDateSelectable(settings, new Date('2026-09-23T00:00:00'))).toBe(false);
  });
});

describe('予約フォーム（カレンダー表示モード）: 臨時営業日', () => {
  it('定休曜日・予約不可の祝日でも臨時営業日は指定時間で営業扱い', async () => {
    const form = buildForm('calendar');
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const w = await loadDom(html);
    const bf = w.bookingForm;
    expect(bf.getSpecialBusinessHours(new Date('2026-09-20T00:00:00'))).toEqual({ open: '10:00', close: '12:00', closed: false });
    expect(bf.getSpecialBusinessHours(new Date('2026-09-27T00:00:00'))).toBeNull();
    expect(bf.getDayBusinessHours(new Date('2026-09-20T10:00:00'))).toMatchObject({ open: '10:00', close: '12:00', closed: false });
    expect(bf.getDayBusinessHours(new Date('2026-09-27T10:00:00'))?.closed).toBe(true);
    // 祝日ブロックは臨時営業日では無効
    expect(bf.isCalendarDateBlockedAsHoliday(new Date('2026-09-21T13:00:00'))).toBe(false);
    expect(bf.isCalendarDateBlockedAsHoliday(new Date('2026-09-23T10:00:00'))).toBe(true);
  });
});
