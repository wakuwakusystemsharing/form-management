/**
 * 予約フォームを「変更用」に開いたとき（LINE の「予約を変更」→「メニューを変更」。URL に ?change=予約ID）
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

const RID = '3f2b8c1e-1111-4222-8333-444455556666';

type BookingForm = {
  state: Record<string, any>;
  availabilityCache: Record<string, unknown>;
  loadChangeSource: () => Promise<void>;
  applyChangeSource: () => void;
  fetchAvailability: (d: Date) => Promise<void>;
  handleSubmit: () => Promise<void>;
};

const hours = { open: '09:00', close: '18:00', closed: false };

function buildForm(): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        categories: [
          {
            id: 'cat1',
            name: 'カット',
            menus: [
              { id: 'm1', name: 'カット', price: 4000, duration: 60 },
              { id: 'm2', name: 'カラー', price: 6000, duration: 90 },
            ],
          },
        ],
      },
      calendar_settings: {
        booking_mode: 'calendar',
        business_hours: { monday: hours, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: hours },
        advance_booking_days: 60,
      },
    },
  } as never);
}

async function loadDom(html: string, search: string, source: unknown) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: `https://example.com/form${search}` });
  const win = dom.window as unknown as { fetch: unknown; alert: unknown; bookingForm: BookingForm; urls: string[]; alerts: string[]; document: Document };
  win.urls = [];
  win.alerts = [];
  win.alert = (m: string) => { win.alerts.push(m); };
  win.fetch = async (url: string) => {
    win.urls.push(String(url));
    if (String(url).includes('/api/reservations/change-source')) {
      return source
        ? ({ ok: true, json: async () => ({ reservation: source }) } as Response)
        : ({ ok: false, json: async () => ({ error: '変更の期限を過ぎています。' }) } as Response);
    }
    return { ok: true, json: async () => [] } as Response;
  };
  await new Promise((r) => setTimeout(r, 80));
  return { win, doc: win.document };
}

const SOURCE = {
  id: RID,
  date_text: '11/20（金） 14:00',
  menu_text: 'カラー',
  staff_name: null,
  customer_name: '山田花子',
  customer_phone: '09011112222',
  selected_menus: [{ menu_id: 'm2', menu_name: 'カラー', category_name: 'カット', price: 6000, duration: 90 }],
  selected_options: [],
  gender: null,
  visit_count: null,
  coupon: null,
};

describe('予約フォームを変更用に開く', () => {
  const form = buildForm();
  const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);

  it('?change が無ければ何も変わらない', async () => {
    const { win, doc } = await loadDom(html, '', SOURCE);
    expect(doc.getElementById('change-mode-banner')).toBeNull();
    expect(win.bookingForm.state.changeRequested).toBeFalsy();
    expect(win.urls.some((u) => u.includes('change-source'))).toBe(false);
  });

  it('LINE の情報が取れないときは案内を出して送信できない（別の予約が増えない）', async () => {
    const { win, doc } = await loadDom(html, `?change=${RID}`, SOURCE);
    const banner = doc.getElementById('change-mode-banner');
    expect(banner?.textContent).toContain('ご予約を変更できません');
    expect((doc.getElementById('submit-button') as HTMLButtonElement).disabled).toBe(true);
    await win.bookingForm.handleSubmit();
    expect(win.alerts[0]).toContain('ご予約を変更できません');
    expect(win.urls.some((u) => u.endsWith('/api/reservations'))).toBe(false);
  });

  it('変更元の予約を読み込むと、案内・名前・メニューが入り、空き状況は元の予約を除いて取る', async () => {
    const { win, doc } = await loadDom(html, `?change=${RID}`, SOURCE);
    const bf = win.bookingForm;
    bf.state.lineUserId = 'U123';
    await bf.loadChangeSource();
    bf.applyChangeSource();
    await new Promise((r) => setTimeout(r, 300));

    const source = win.urls.find((u) => u.includes('change-source')) || '';
    expect(source).toContain(`reservation_id=${RID}`);
    expect(source).toContain('line_user_id=U123');

    const banner = doc.getElementById('change-mode-banner');
    expect(banner?.textContent).toContain('現在のご予約：11/20（金） 14:00');
    expect(banner?.textContent).toContain('新しい内容に置き換わります');
    const submit = doc.getElementById('submit-button') as HTMLButtonElement;
    expect(submit.textContent).toBe('予約を変更する');
    expect(submit.disabled).toBe(false);

    expect(bf.state.name).toBe('山田花子');
    expect(bf.state.phone).toBe('09011112222');
    expect(bf.state.selectedMenu?.id).toBe('m2');
    expect(win.alerts).toEqual([]);

    bf.availabilityCache = {};
    await bf.fetchAvailability(new Date());
    const availability = win.urls.filter((u) => u.includes('/calendar/availability')).pop() || '';
    expect(availability).toContain(`exclude_reservation=${RID}`);
  });

  it('期限切れなどで変更できないときは、サーバーの案内文を出して送信できない', async () => {
    const { win, doc } = await loadDom(html, `?change=${RID}`, null);
    const bf = win.bookingForm;
    bf.state.lineUserId = 'U123';
    await bf.loadChangeSource();
    expect(doc.getElementById('change-mode-banner')?.textContent).toContain('変更の期限を過ぎています。');
    expect((doc.getElementById('submit-button') as HTMLButtonElement).disabled).toBe(true);
    expect(bf.state.changeSource).toBeFalsy();
  });

  it('送信内容に変更元の予約 ID を付ける', () => {
    expect(html).toContain('change_reservation_id: this.state.changeSource ? this.state.changeSource.id : null');
    expect(html).toContain("errorData.code === 'change_not_allowed'");
  });
});
