import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm, sanitizeExtraMinutes } from '../form-normalizer';
import type { Form } from '@/types/form';

type BookingForm = {
  addExtraMinuteSlots: (base: number[], start: number, end: number, extra: unknown) => number[];
  generateTimeSlots: (start: string, end: string, interval: number, extra?: number[]) => string[];
  populateTimeOptions: (index: number, settings: unknown, dateStr: string) => void;
};

function buildForm(config: Record<string, unknown> = {}): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      ...config,
    },
  });
}

async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return dom;
}

describe('追加で表示する分', () => {
  it('sanitizeExtraMinutes: 0〜59 の整数だけ、昇順・重複なし', () => {
    expect(sanitizeExtraMinutes([10, '40', 10, 60, -1, 5.5, 'x'])).toEqual([10, 40]);
    expect(sanitizeExtraMinutes(undefined)).toEqual([]);
  });

  it('normalizeForm が両モードの extra_minutes を保持する', () => {
    const form = buildForm({
      calendar_settings: {
        extra_minutes: [10, 'bad'],
        multiple_dates_settings: { time_interval: 30, date_range_days: 30, exclude_weekdays: [], start_time: '09:00', end_time: '12:00', extra_minutes: [45] },
      },
    });
    expect(form.config.calendar_settings.extra_minutes).toEqual([10]);
    expect(form.config.calendar_settings.multiple_dates_settings?.extra_minutes).toEqual([45]);
  });

  it('addExtraMinuteSlots / generateTimeSlots: 30 分間隔 + 10 分 → 毎時 10 分の行が入る', async () => {
    const form = buildForm({
      calendar_settings: {
        booking_mode: 'multiple_dates',
        multiple_dates_settings: {
          time_interval: 30, date_range_days: 30, exclude_weekdays: [], start_time: '09:00', end_time: '11:00', extra_minutes: [10],
          weekday_hours: { '1': { open: '09:00', close: '11:00', closed: false } },
        },
      },
    });
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const dom = await loadDom(html);
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    expect(bf.addExtraMinuteSlots([540, 570, 600], 540, 660, [10])).toEqual([540, 550, 570, 600, 610]);
    expect(bf.generateTimeSlots('09:00', '11:00', 30, [10])).toEqual(['09:00', '09:10', '09:30', '10:00', '10:10', '10:30']);
    expect(bf.generateTimeSlots('09:00', '11:00', 30)).toEqual(['09:00', '09:30', '10:00', '10:30']);

    bf.populateTimeOptions(1, form.config.calendar_settings.multiple_dates_settings, '2026-09-07');
    const values = Array.from((dom.window.document.getElementById('date1_time') as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual(['', '09:00', '09:10', '09:30', '10:00', '10:10', '10:30']);
  });

  it('カレンダー表示モードの HTML にも extra_minutes が埋め込まれる', () => {
    const form = buildForm({ calendar_settings: { booking_mode: 'calendar', time_interval: 30, extra_minutes: [10] } });
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    expect(html).toContain('"extra_minutes": [\n      10\n    ]');
    expect(html).toContain('addExtraMinuteSlots(');
  });
});

describe('店舗側手動予約フォームの項目設定', () => {
  const manualSettings = {
    manual_form_settings: { show_customer_name: false, require_customer_phone: false },
    calendar_settings: { booking_mode: 'calendar', show_customer_name: true, show_customer_phone: true },
  };

  it('normalizeForm が manual_form_settings を保持する（boolean 以外は捨てる）', () => {
    const form = buildForm({ manual_form_settings: { show_customer_name: false, require_customer_phone: 'no' } });
    expect(form.config.manual_form_settings).toEqual({ show_customer_name: false, require_customer_name: undefined, show_customer_phone: undefined, require_customer_phone: undefined });
    expect(buildForm().config.manual_form_settings).toBeUndefined();
  });

  it('手動フォームだけに適用され、通常フォームは変わらない', () => {
    const form = buildForm(manualSettings);
    const gen = new StaticReservationGenerator();
    const manual = gen.generateHTML(form.config, form.id, form.store_id, 'manual');
    const normal = gen.generateHTML(form.config, form.id, form.store_id);

    // 手動: お名前欄なし、電話番号は（任意）
    expect(manual).not.toContain('id="name-field"');
    expect(manual).toContain('電話番号 <span class="optional-mark">（任意）</span>');
    expect(manual).toContain('"customer_phone_optional": true');
    expect(manual).toContain('"show_customer_name": false');

    // 通常: お名前・電話番号とも必須のまま
    expect(normal).toContain('id="name-field"');
    expect(normal).toContain('お名前 <span class="required">*</span>');
    expect(normal).toContain('電話番号 <span class="required">*</span>');
    expect(normal).not.toContain('optional-mark">');
    expect(normal).toContain('"show_customer_name": true');
  });

  it('未設定なら従来どおり（手動フォームはお名前を必ず表示）', () => {
    const form = buildForm({ calendar_settings: { booking_mode: 'calendar', show_customer_name: false } });
    const manual = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'manual');
    expect(manual).toContain('id="name-field"');
    expect(manual).toContain('お名前 <span class="required">*</span>');
  });
});
