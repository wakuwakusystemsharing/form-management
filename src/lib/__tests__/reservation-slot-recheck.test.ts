import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

type BookingForm = {
  state: { selectedDate: string; selectedTime: string; currentWeekStart: Date };
  availabilityCache: Record<string, unknown>;
  recheckSelectedSlot: () => Promise<boolean>;
};

function buildForm(): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: {
        booking_mode: 'calendar',
        max_concurrent_events: 1,
        business_hours: {
          monday: { open: '09:00', close: '18:00', closed: false },
          tuesday: { open: '09:00', close: '18:00', closed: false },
          wednesday: { open: '09:00', close: '18:00', closed: false },
          thursday: { open: '09:00', close: '18:00', closed: false },
          friday: { open: '09:00', close: '18:00', closed: false },
          saturday: { open: '09:00', close: '18:00', closed: false },
          sunday: { open: '09:00', close: '18:00', closed: false },
        },
        advance_booking_days: 60,
      },
    },
  });
}

async function loadDom(html: string, events: unknown[] | null) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  const win = dom.window as unknown as { fetch: unknown; bookingForm: BookingForm; fetchCount: number };
  win.fetchCount = 0;
  win.fetch = async () => {
    win.fetchCount += 1;
    if (!events) throw new Error('network');
    return { ok: true, json: async () => events } as Response;
  };
  await new Promise((r) => setTimeout(r, 80));
  return { dom, win };
}

function nextWeekday(): { date: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date: ymd, time: '15:30' };
}

describe('送信直前の空き再確認（recheckSelectedSlot）', () => {
  const form = buildForm();
  const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);

  it('生成 HTML に再確認が組み込まれ、送信処理から呼ばれる', () => {
    expect(html).toContain('async recheckSelectedSlot()');
    expect(html).toContain('const stillOpen = await this.recheckSelectedSlot();');
  });

  it('同じ枠に予定が入っていれば false（キャッシュを捨てて取り直す）', async () => {
    const { date, time } = nextWeekday();
    const { win } = await loadDom(html, [
      { title: '予約: 宮嶋', summary: '予約: 宮嶋', startTime: `${date}T15:30:00+09:00`, endTime: `${date}T16:00:00+09:00` },
    ]);
    const bf = win.bookingForm;
    bf.availabilityCache = { stale: { availability: [], businessDays: [] } };
    bf.state.selectedDate = date;
    bf.state.selectedTime = time;
    const before = win.fetchCount;
    expect(await bf.recheckSelectedSlot()).toBe(false);
    expect(win.fetchCount).toBeGreaterThan(before);
    expect(bf.state.selectedDate).toBe('');
  });

  it('予定が無ければ true のまま', async () => {
    const { date, time } = nextWeekday();
    const { win } = await loadDom(html, []);
    const bf = win.bookingForm;
    bf.state.selectedDate = date;
    bf.state.selectedTime = time;
    expect(await bf.recheckSelectedSlot()).toBe(true);
    expect(bf.state.selectedDate).toBe(date);
  });

  it('空き状況を取得できないときは止めない（サーバー側の確認に任せる）', async () => {
    const { date, time } = nextWeekday();
    const { win } = await loadDom(html, null);
    const bf = win.bookingForm;
    bf.state.selectedDate = date;
    bf.state.selectedTime = time;
    expect(await bf.recheckSelectedSlot()).toBe(true);
  });
});
