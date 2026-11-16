import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import {
  DEFAULT_FEW_LEFT_LABEL,
  SLOT_MARK_RUNTIME_JS,
  maxFewLeftCount,
  resolveFewLeftMark,
  sanitizeFewLeftMark,
  slotMarkOf,
  usesStaffCalendars,
} from '../slot-mark';
import type { Form } from '@/types/form';

describe('予約が一定数で△で表示する: 純粋ロジック', () => {
  it('同時刻に埋まるイベント数が 2 以上で ON のときだけ有効', () => {
    expect(resolveFewLeftMark({ max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1 } }))
      .toEqual({ enabled: true, count: 1, label: DEFAULT_FEW_LEFT_LABEL });
    expect(resolveFewLeftMark({ max_concurrent_events: 1, few_left_mark: { enabled: true, count: 1 } }).enabled).toBe(false);
    expect(resolveFewLeftMark({ max_concurrent_events: 3, few_left_mark: { enabled: false, count: 1 } }).enabled).toBe(false);
    expect(resolveFewLeftMark({ max_concurrent_events: 3 }).enabled).toBe(false);
    expect(resolveFewLeftMark(null).enabled).toBe(false);
  });

  it('件数は 1 〜 同時刻に埋まるイベント数 − 1 に収める', () => {
    expect(maxFewLeftCount(2)).toBe(1);
    expect(maxFewLeftCount(5)).toBe(4);
    expect(maxFewLeftCount(1)).toBe(1);
    expect(resolveFewLeftMark({ max_concurrent_events: 3, few_left_mark: { enabled: true, count: 9 } }).count).toBe(2);
    expect(resolveFewLeftMark({ max_concurrent_events: 3, few_left_mark: { enabled: true, count: 0 } }).count).toBe(1);
    expect(resolveFewLeftMark({ max_concurrent_events: 5, few_left_mark: { enabled: true, count: '3' } }).count).toBe(3);
  });

  it('△ の説明は空なら「残りわずか」、20 文字まで', () => {
    expect(resolveFewLeftMark({ max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1, label: ' あと少し ' } }).label).toBe('あと少し');
    expect(resolveFewLeftMark({ max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1, label: '  ' } }).label).toBe(DEFAULT_FEW_LEFT_LABEL);
    expect(resolveFewLeftMark({ max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1, label: 'あ'.repeat(30) } }).label).toHaveLength(20);
  });

  it('記号: 予約できない = ✕、予定が件数以上 = △、それ以外 = 〇', () => {
    const mark = resolveFewLeftMark({ max_concurrent_events: 3, few_left_mark: { enabled: true, count: 2 } });
    expect(slotMarkOf(true, 0, mark)).toBe('ok');
    expect(slotMarkOf(true, 1, mark)).toBe('ok');
    expect(slotMarkOf(true, 2, mark)).toBe('few');
    expect(slotMarkOf(false, 3, mark)).toBe('ng');
    expect(slotMarkOf(false, 0, mark)).toBe('ng');
    // OFF / スタッフ選択を使うフォーム（null）では △ にしない
    expect(slotMarkOf(true, 2, resolveFewLeftMark({ max_concurrent_events: 3 }))).toBe('ok');
    expect(slotMarkOf(true, 2, null)).toBe('ok');
  });

  it('保存用の正規化: 未設定はキーを持たず、件数だけ範囲に収める', () => {
    expect(sanitizeFewLeftMark(undefined, 3)).toBeUndefined();
    expect(sanitizeFewLeftMark({ enabled: true, count: 9, label: ' 残り1枠 ' }, 3)).toEqual({ enabled: true, count: 2, label: '残り1枠' });
    expect(sanitizeFewLeftMark({ enabled: true, count: 2 }, 1)).toEqual({ enabled: true, count: 1 });
    expect(sanitizeFewLeftMark({ enabled: 'yes' }, 3)).toEqual({ enabled: false, count: 1 });
  });

  it('スタッフごとのカレンダーを使うフォームの判定', () => {
    const staff = [{ name: 'A', calendar_id: 'a@example.com' }];
    expect(usesStaffCalendars({ staff_selection: { enabled: true, staff }, calendar_settings: { booking_mode: 'calendar' } })).toBe(true);
    expect(usesStaffCalendars({ staff_selection: { enabled: false, staff } })).toBe(false);
    expect(usesStaffCalendars({ staff_selection: { enabled: true, staff: [{ name: 'A' }] } })).toBe(false);
    expect(usesStaffCalendars({ staff_selection: { enabled: true, staff }, calendar_settings: { booking_mode: 'multiple_dates' } })).toBe(false);
    expect(usesStaffCalendars(null)).toBe(false);
  });

  it('埋め込み JS は TS 版と同じ結果になる', () => {
    const dom = new JSDOM(`<html><body><script>${SLOT_MARK_RUNTIME_JS}</script></body></html>`, { runScripts: 'dangerously' });
    const w = dom.window as unknown as { resolveFewLeftMark: typeof resolveFewLeftMark; slotMarkOf: typeof slotMarkOf };
    const settings = [
      { max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1 } },
      { max_concurrent_events: 1, few_left_mark: { enabled: true, count: 1 } },
      { max_concurrent_events: 4, few_left_mark: { enabled: true, count: 9, label: ' あと少し ' } },
      { max_concurrent_events: 4, few_left_mark: { enabled: true, count: '2', label: 'あ'.repeat(30) } },
      { max_concurrent_events: 3 },
      null,
    ];
    for (const cs of settings) {
      expect(w.resolveFewLeftMark(cs)).toEqual(resolveFewLeftMark(cs));
      for (const n of [0, 1, 2, 3]) {
        expect(w.slotMarkOf(true, n, w.resolveFewLeftMark(cs))).toBe(slotMarkOf(true, n, resolveFewLeftMark(cs)));
      }
    }
    expect(SLOT_MARK_RUNTIME_JS).not.toContain('`');
    expect(SLOT_MARK_RUNTIME_JS).not.toContain('\\');
  });
});

// ---- 生成した予約フォームのカレンダー ----

type BookingForm = {
  state: { selectedDate: string; selectedTime: string };
  recheckSelectedSlot: () => Promise<boolean>;
  handleDateTimeSelect: (date: string, time: string, ok: boolean) => void;
};

function buildForm(calendar: Record<string, unknown>, extra: Record<string, unknown> = {}): Form {
  const day = { open: '09:00', close: '18:00', closed: false };
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: {
        booking_mode: 'calendar',
        business_hours: { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day },
        advance_booking_days: 60,
        ...calendar,
      },
      ...extra,
    },
  });
}

const generate = (form: Form) => new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);

/** 7 日後の日付（YYYY-MM-DD）と、その日の時刻の予定を作る関数 */
function target() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const event = (from: string, to: string, title = '予約') => {
    const at = (hm: string) => {
      const x = new Date(d);
      x.setHours(Number(hm.split(':')[0]), Number(hm.split(':')[1]), 0, 0);
      return x.toISOString();
    };
    return { title, summary: title, startTime: at(from), endTime: at(to) };
  };
  return { date, event };
}

/** フォームを読み込み、対象日の週を表示した状態にして、セルを取る関数を返す */
async function openCalendar(html: string, events: unknown[], date: string) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/' });
  const win = dom.window as unknown as { fetch: unknown; bookingForm: BookingForm };
  win.fetch = async () => ({ ok: true, json: async () => events }) as Response;
  await new Promise((r) => setTimeout(r, 80));
  const bf = win.bookingForm;
  // 予定の無い時間を選んでから再確認を呼ぶと、その週の空き状況を取り直してカレンダーを描き直す
  bf.state.selectedDate = date;
  bf.state.selectedTime = '17:00';
  await bf.recheckSelectedSlot();
  const cell = (time: string) => dom.window.document.querySelector(`.calendar-cell[data-date="${date}"][data-time="${time}"]`) as HTMLElement;
  return { doc: dom.window.document, bf, cell };
}

describe('予約フォームのカレンダー: 〇 △ ✕', () => {
  it('同時刻に埋まるイベント数 2・△ 1: 予定 0 件 = 〇、1 件 = △、2 件 = ✕', async () => {
    const form = buildForm({ max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1 } });
    const { date, event } = target();
    const { cell, bf } = await openCalendar(generate(form), [
      event('12:00', '12:30'),
      event('13:00', '13:30'),
      event('13:00', '13:30', 'Googleカレンダーの予定'),
    ], date);

    expect(cell('11:00').textContent).toBe('○');
    expect(cell('11:00').dataset.mark).toBe('ok');

    expect(cell('12:00').textContent).toBe('△');
    expect(cell('12:00').dataset.mark).toBe('few');
    expect(cell('12:00').classList.contains('few')).toBe(true);
    expect(cell('12:00').classList.contains('unavailable')).toBe(false);

    expect(cell('13:00').textContent).toBe('×');
    expect(cell('13:00').classList.contains('unavailable')).toBe(true);

    // △ の時間帯も予約できる
    cell('12:00').click();
    expect(bf.state.selectedDate).toBe(date);
    expect(bf.state.selectedTime).toBe('12:00');
  });

  it('同時刻に埋まるイベント数 3・△ 2: 1 件はまだ 〇、2 件で △', async () => {
    const form = buildForm({ max_concurrent_events: 3, few_left_mark: { enabled: true, count: 2 } });
    const { date, event } = target();
    const { cell } = await openCalendar(generate(form), [
      event('12:00', '12:30'),
      event('13:00', '13:30'), event('13:00', '13:30'),
      event('14:00', '14:30'), event('14:00', '14:30'), event('14:00', '14:30'),
    ], date);
    expect(cell('12:00').textContent).toBe('○');
    expect(cell('13:00').textContent).toBe('△');
    expect(cell('14:00').textContent).toBe('×');
  });

  it('OFF（既定）のフォームは従来どおり 〇 と ✕ だけで、凡例にも △ を出さない', async () => {
    const form = buildForm({ max_concurrent_events: 2 });
    const html = generate(form);
    expect(html).not.toContain('legend-item-few');
    const { date, event } = target();
    const { cell } = await openCalendar(html, [event('12:00', '12:30')], date);
    expect(cell('12:00').textContent).toBe('○');
    expect(cell('12:00').classList.contains('few')).toBe(false);
  });

  it('同時刻に埋まるイベント数が 1 のときは ON でも △ にならない', async () => {
    const form = buildForm({ max_concurrent_events: 1, few_left_mark: { enabled: true, count: 1 } });
    const html = generate(form);
    expect(html).not.toContain('legend-item-few');
    const { date, event } = target();
    const { cell } = await openCalendar(html, [event('12:00', '12:30')], date);
    expect(cell('11:00').textContent).toBe('○');
    expect(cell('12:00').textContent).toBe('×');
  });

  it('ON のフォームは凡例に △ の説明を出す（文言は店舗が変えられる。HTML はエスケープ）', () => {
    const base = generate(buildForm({ max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1 } }));
    expect(base).toContain('<span class="legend-marker marker-few">△</span><span>残りわずか</span>');
    const custom = generate(buildForm({ max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1, label: '<残り1枠>' } }));
    expect(custom).toContain('<span class="legend-marker marker-few">△</span><span>&lt;残り1枠&gt;</span>');
  });

  it('スタッフ選択（スタッフごとのカレンダー）を使うフォームでは凡例に △ を出さない', () => {
    const form = buildForm(
      { max_concurrent_events: 2, few_left_mark: { enabled: true, count: 1 } },
      { staff_selection: { enabled: true, staff: [{ id: 's1', name: 'スタッフA', calendar_id: 'a@example.com' }] } },
    );
    expect(generate(form)).not.toContain('legend-item-few');
  });

  it('normalizeForm: 未設定のフォームは few_left_mark を持たず、設定は件数を範囲に収めて残す', () => {
    expect(buildForm({ max_concurrent_events: 2 }).config.calendar_settings.few_left_mark).toBeUndefined();
    expect(buildForm({ max_concurrent_events: 3, few_left_mark: { enabled: true, count: 8, label: 'あと少し' } }).config.calendar_settings.few_left_mark)
      .toEqual({ enabled: true, count: 2, label: 'あと少し' });
  });
});
