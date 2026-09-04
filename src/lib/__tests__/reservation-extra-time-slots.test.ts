import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

type BookingForm = {
  insertExtraSlots: (visible: string[], all: string[], extra: Array<{ label: string; after: string }>) => string[];
  populateTimeOptions: (index: number, settings: unknown, dateStr: string) => void;
};

function buildForm(): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: {
        booking_mode: 'multiple_dates',
        multiple_dates_settings: {
          time_interval: 60,
          date_range_days: 30,
          exclude_weekdays: [],
          start_time: '09:00',
          end_time: '12:00',
          blocked_times: ['11:00'],
          // 祝日は 10:00〜12:00 + 「祝日は午前のみ」を先頭に
          holiday_hours: { enabled: true, open: '10:00', close: '12:00', extra_slots: [{ label: '祝日は午前のみ', after: 'start' }] },
          weekday_hours: {
            // 2026-09-07 は月曜
            '1': {
              open: '09:00', close: '12:00', closed: false,
              extra_slots: [
                { label: '午前中', after: 'start' },
                { label: '10時台', after: '10:00' },
                { label: '11時ごろ', after: '11:00' },
                { label: '午後', after: 'end' },
                { label: '  ', after: 'end' },
              ],
            },
          },
        },
      },
    },
  });
}

async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return dom;
}

describe('予約フォーム（第三希望日時モード）: 追加の時間帯', () => {
  it('insertExtraSlots: 先頭 / 指定時刻の後 / 末尾、消えている時刻の後は次の時刻の前', async () => {
    const form = buildForm();
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const dom = await loadDom(html);
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    const all = ['09:00', '10:00', '11:00'];
    const visible = ['09:00', '10:00']; // 11:00 は✕で消えている
    const out = bf.insertExtraSlots(visible, all, [
      { label: '午前中', after: 'start' },
      { label: '10時台', after: '10:00' },
      { label: '11時ごろ', after: '11:00' },
      { label: '午後', after: 'end' },
      { label: '', after: 'end' },
    ]);
    expect(out).toEqual(['午前中', '09:00', '10:00', '10時台', '11時ごろ', '午後']);
  });

  it('populateTimeOptions: 時間のプルダウンに追加の時間帯が差し込まれる', async () => {
    const form = buildForm();
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const dom = await loadDom(html);
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    const settings = form.config.calendar_settings.multiple_dates_settings;
    bf.populateTimeOptions(1, settings, '2026-09-07');
    const select = dom.window.document.getElementById('date1_time') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['', '午前中', '09:00', '10:00', '10時台', '11時ごろ', '午後']);
  });

  it('祝日の受付時間にも追加の時間帯が差し込まれる（2026-09-21 敬老の日）', async () => {
    const form = buildForm();
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const dom = await loadDom(html);
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    const settings = form.config.calendar_settings.multiple_dates_settings;
    bf.populateTimeOptions(1, settings, '2026-09-21');
    const select = dom.window.document.getElementById('date1_time') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['', '祝日は午前のみ', '10:00']);
  });
});
