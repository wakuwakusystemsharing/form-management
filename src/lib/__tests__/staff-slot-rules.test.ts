import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import { filterNoPreferenceStaffByRules, isNoPreferenceAssignable, isSlotBookableForSettings } from '../staff-slot-rules';
import type { Form, FormConfig } from '@/types/form';

const day = (open = '09:30', close = '20:00', closed = false) => ({ open, close, closed });
const week = (d = day()) => ({ monday: d, tuesday: d, wednesday: d, thursday: d, friday: d, saturday: d, sunday: d });

const cs = (patch: Record<string, unknown> = {}) => ({
  booking_mode: 'calendar',
  business_hours: week(),
  advance_booking_days: 60,
  min_advance_days: 0,
  min_advance_hours: 0,
  ...patch,
}) as unknown as FormConfig['calendar_settings'];

// 2026-11-16（月）20:33 JST
const NOW = new Date('2026-11-16T20:33:00+09:00');
const slot = (date: string, time: string, durationMinutes = 120) => ({ date, time, durationMinutes, now: NOW });

describe('isSlotBookableForSettings（日本時間で判定）', () => {
  it('事前予約可能日数: 60 日なら 44 日先は可、30 日なら不可。ちょうど 30 日先は可', () => {
    expect(isSlotBookableForSettings(cs(), slot('2026-12-30', '11:00'))).toBe(true);
    expect(isSlotBookableForSettings(cs({ advance_booking_days: 30 }), slot('2026-12-30', '11:00'))).toBe(false);
    expect(isSlotBookableForSettings(cs({ advance_booking_days: 30 }), slot('2026-12-16', '11:00'))).toBe(true);
    expect(isSlotBookableForSettings(cs({ advance_booking_days: 30 }), slot('2026-12-17', '11:00'))).toBe(false);
  });

  it('営業時間・定休・営業時間超過', () => {
    const evening = cs({ business_hours: { ...week(day('18:00', '20:01')), thursday: day('09:30', '18:00', true) } });
    expect(isSlotBookableForSettings(evening, slot('2026-11-18', '11:00', 60))).toBe(false); // 営業時間前
    expect(isSlotBookableForSettings(evening, slot('2026-11-18', '18:00', 60))).toBe(true);
    expect(isSlotBookableForSettings(evening, slot('2026-11-18', '19:30', 60))).toBe(false); // 閉店を超える
    expect(isSlotBookableForSettings({ ...evening, allow_exceed_business_hours: true }, slot('2026-11-18', '19:30', 60))).toBe(true);
    expect(isSlotBookableForSettings(evening, slot('2026-11-19', '18:00', 60))).toBe(false); // 木曜定休
    expect(isSlotBookableForSettings({ ...evening, allow_exceed_business_hours: true }, slot('2026-11-18', '20:00', 300))).toBe(false); // 翌日にまたがる
  });

  it('予約受付開始日・予約受付開始時間・条件付き予約受付開始時間', () => {
    expect(isSlotBookableForSettings(cs({ min_advance_days: 2 }), slot('2026-11-17', '11:00'))).toBe(false);
    expect(isSlotBookableForSettings(cs({ min_advance_days: 2 }), slot('2026-11-18', '11:00'))).toBe(true);
    // 過去・N 時間以内
    expect(isSlotBookableForSettings(cs(), slot('2026-11-16', '10:00'))).toBe(false);
    expect(isSlotBookableForSettings(cs({ min_advance_hours: 24 }), slot('2026-11-17', '11:00'))).toBe(false);
    expect(isSlotBookableForSettings(cs({ min_advance_hours: 12 }), slot('2026-11-17', '11:00'))).toBe(true);
    // 15:00 以降は 2 日後の 09:30 から（いま 20:33 なので当てはまる）
    const rule = cs({ conditional_advance_rules: [{ id: 'a', from_time: '15:00', min_days: 2, start_time: '11:00' }] });
    expect(isSlotBookableForSettings(rule, slot('2026-11-17', '12:00'))).toBe(false);
    expect(isSlotBookableForSettings(rule, slot('2026-11-18', '10:00'))).toBe(false);
    expect(isSlotBookableForSettings(rule, slot('2026-11-18', '11:00'))).toBe(true);
    // 21:00 以降のルールは、いまは当てはまらない
    const later = cs({ conditional_advance_rules: [{ id: 'b', from_time: '21:00', min_days: 2 }] });
    expect(isSlotBookableForSettings(later, slot('2026-11-17', '12:00'))).toBe(true);
  });

  it('✕にする時間帯（曜日指定つき）・祝日・臨時営業日', () => {
    const blocked = cs({ blocked_times: ['12:00', '9:30'], blocked_time_weekdays: { '12:00': [3] } });
    expect(isSlotBookableForSettings(blocked, slot('2026-11-18', '12:00', 30))).toBe(false); // 水曜
    expect(isSlotBookableForSettings(blocked, slot('2026-11-19', '12:00', 30))).toBe(true); // 木曜
    expect(isSlotBookableForSettings(blocked, slot('2026-11-19', '09:30', 30))).toBe(false); // 毎日
    // 11/23 勤労感謝の日
    const holiday = cs({ holidays_as_closed: true, excluded_holiday_types: [] });
    expect(isSlotBookableForSettings(holiday, slot('2026-11-23', '11:00'))).toBe(false);
    expect(isSlotBookableForSettings({ ...holiday, excluded_holiday_types: ['labor_thanksgiving'] }, slot('2026-11-23', '11:00'))).toBe(true);
    // 臨時営業日は祝日・定休より優先
    const special = cs({
      holidays_as_closed: true,
      business_hours: week(day('09:30', '20:00', true)),
      special_business_days: [{ date: '2026-11-23', open: '10:00', close: '15:00' }],
    });
    expect(isSlotBookableForSettings(special, slot('2026-11-23', '11:00'))).toBe(true);
    expect(isSlotBookableForSettings(special, slot('2026-11-23', '16:00', 30))).toBe(false);
    expect(isSlotBookableForSettings(special, slot('2026-11-24', '11:00'))).toBe(false);
    // 祝日の営業時間
    const hh = cs({ holiday_hours: { enabled: true, open: '13:00', close: '18:00' } });
    expect(isSlotBookableForSettings(hh, slot('2026-11-23', '11:00', 30))).toBe(false);
    expect(isSlotBookableForSettings(hh, slot('2026-11-23', '13:00', 30))).toBe(true);
  });

  it('サーバーの時刻帯に依らない（UTC の日付が前日でも日本時間の今日で数える）', () => {
    // 日本時間 11/17 08:00 = UTC 11/16 23:00
    const now = new Date('2026-11-17T08:00:00+09:00');
    expect(isSlotBookableForSettings(cs({ advance_booking_days: 1 }), { date: '2026-11-18', time: '11:00', durationMinutes: 60, now })).toBe(true);
    expect(isSlotBookableForSettings(cs({ advance_booking_days: 1 }), { date: '2026-11-19', time: '11:00', durationMinutes: 60, now })).toBe(false);
  });

  it('不正な日付・時刻は不可', () => {
    expect(isSlotBookableForSettings(cs(), slot('2026/12/30', '11:00'))).toBe(false);
    expect(isSlotBookableForSettings(cs(), slot('2026-12-30', '1100'))).toBe(false);
  });
});

describe('filterNoPreferenceStaffByRules（指名なしの自動割当の候補）', () => {
  const staff = [
    { id: 'a', name: '紺田' },
    { id: 'b', name: '佐藤', schedule: { advance_booking_days: 30 } },
    { id: 'c', name: '島尻', schedule: { business_hours: week(day('18:00', '20:01')) } },
    { id: 'd', name: '対象外', no_preference_assignable: false },
  ];

  it('受付期間外・営業時間外・対象外のスタッフには割り当てない', () => {
    // 44 日先の 11:00: 佐藤（30 日先まで）・島尻（18:00 から）・対象外 は外れる
    expect(filterNoPreferenceStaffByRules(staff, cs(), slot('2026-12-30', '11:00')).map((m) => m.id)).toEqual(['a']);
    // 2 日先の 18:00（1 時間）: 対象外以外の全員
    expect(filterNoPreferenceStaffByRules(staff, cs(), slot('2026-11-18', '18:00', 60)).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('希望日時設定が無ければフォームの設定で判定する', () => {
    const one: Array<{ id: string; no_preference_assignable?: boolean }> = [{ id: 'a' }];
    expect(filterNoPreferenceStaffByRules(one, cs({ advance_booking_days: 30 }), slot('2026-12-30', '11:00'))).toEqual([]);
    expect(filterNoPreferenceStaffByRules(one, undefined, slot('2026-11-18', '11:00'))).toEqual([{ id: 'a' }]);
  });

  it('isNoPreferenceAssignable: 未設定は対象', () => {
    expect(isNoPreferenceAssignable({})).toBe(true);
    expect(isNoPreferenceAssignable({ no_preference_assignable: true })).toBe(true);
    expect(isNoPreferenceAssignable({ no_preference_assignable: false })).toBe(false);
  });
});

// ---- 正規化と生成した予約フォーム ----

function buildForm(staff: Array<Record<string, unknown>>, ss: Record<string, unknown> = {}): Form {
  const d = { open: '09:00', close: '18:00', closed: false };
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: { booking_mode: 'calendar', business_hours: week(d), advance_booking_days: 60 },
      staff_selection: { enabled: true, required: false, allow_no_preference: true, staff, ...ss },
    },
  });
}

const generate = (form: Form) => new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);

describe('normalizeForm: no_preference_assignable', () => {
  it('対象外（false）のときだけキーを持つ', () => {
    const form = buildForm([
      { id: 's1', name: 'A', calendar_id: 'a@x' },
      { id: 's2', name: 'B', calendar_id: 'b@x', no_preference_assignable: false },
      { id: 's3', name: 'C', calendar_id: 'c@x', no_preference_assignable: true },
    ]);
    const staff = form.config.staff_selection!.staff;
    expect('no_preference_assignable' in staff[0]).toBe(false);
    expect(staff[1].no_preference_assignable).toBe(false);
    expect('no_preference_assignable' in staff[2]).toBe(false);
  });
});

describe('予約フォーム: 指名なしの空き判定', () => {
  type BookingForm = { state: { selectedDate: string; selectedTime: string }; recheckSelectedSlot: () => Promise<boolean> };

  async function open(html: string, events: unknown[], date: string, staffId: string) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/' });
    const win = dom.window as unknown as { fetch: unknown; bookingForm: BookingForm };
    win.fetch = async () => ({ ok: true, json: async () => events }) as Response;
    await new Promise((r) => setTimeout(r, 80));
    (dom.window.document.querySelector(`.staff-button[data-staff-id="${staffId}"]`) as HTMLElement).click();
    const bf = win.bookingForm;
    bf.state.selectedDate = date;
    bf.state.selectedTime = '17:00';
    await bf.recheckSelectedSlot();
    return (time: string) => dom.window.document.querySelector(`.calendar-cell[data-date="${date}"][data-time="${time}"]`) as HTMLElement;
  }

  function target() {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const event = (staff_id: string, from: string, to: string) => {
      const at = (hm: string) => {
        const x = new Date(d);
        x.setHours(Number(hm.split(':')[0]), Number(hm.split(':')[1]), 0, 0);
        return x.toISOString();
      };
      return { title: '予約', summary: '予約', startTime: at(from), endTime: at(to), staff_id };
    };
    return { date, event };
  }

  const staff = [
    { id: 's1', name: '佐藤', calendar_id: 'a@x', no_preference_assignable: false },
    { id: 's2', name: '紺田', calendar_id: 'b@x' },
  ];

  it('対象外のスタッフが空いていても、対象のスタッフが埋まっていれば 指名なし は ✕', async () => {
    const { date, event } = target();
    const cell = await open(generate(buildForm(staff)), [event('s2', '12:00', '13:00')], date, 'none');
    expect(cell('11:00').textContent).toBe('○');
    expect(cell('12:00').textContent).toBe('×');
  });

  it('対象外のスタッフも、指名すれば予約できる', async () => {
    const { date, event } = target();
    const cell = await open(generate(buildForm(staff)), [event('s2', '12:00', '13:00')], date, 's1');
    expect(cell('12:00').textContent).toBe('○');
  });

  it('全員が対象のとき（既定）は従来どおり、誰かが空いていれば 〇', async () => {
    const { date, event } = target();
    const all = staff.map((m) => ({ ...m, no_preference_assignable: undefined }));
    const cell = await open(generate(buildForm(all)), [event('s2', '12:00', '13:00')], date, 'none');
    expect(cell('12:00').textContent).toBe('○');
  });

  it('対象のスタッフが 1 人もいないときは「指名なし」ボタンを出さない', () => {
    const none = staff.map((m) => ({ ...m, no_preference_assignable: false }));
    expect(generate(buildForm(none))).not.toContain('data-staff-id="none"');
    expect(generate(buildForm(staff))).toContain('data-staff-id="none"');
  });
});
