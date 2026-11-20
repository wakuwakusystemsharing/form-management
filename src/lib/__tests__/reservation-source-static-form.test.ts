/**
 * 予約フォーム（静的 HTML）が、流入経路の合言葉（URL の ?src=）を読んで予約と一緒に送ること
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import { SOURCE_CODE_PATTERN } from '../reservation-sources';
import type { Form } from '@/types/form';

type BookingForm = { sourceCode: string; getSourceCode: () => string };

const hours = { open: '09:00', close: '18:00', closed: false };

function buildForm(): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: { structure_type: 'category_based', categories: [{ id: 'cat1', name: 'カット', menus: [{ id: 'm1', name: 'カット', price: 4000, duration: 60 }] }] },
      calendar_settings: {
        booking_mode: 'calendar',
        business_hours: { monday: hours, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: hours },
        advance_booking_days: 60,
      },
    },
  } as never);
}

async function open(html: string, search: string): Promise<BookingForm> {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: `https://example.com/form${search}` });
  const win = dom.window as unknown as { fetch: unknown; alert: unknown; bookingForm: BookingForm };
  win.alert = () => {};
  win.fetch = async () => ({ ok: true, json: async () => [] }) as Response;
  await new Promise((r) => setTimeout(r, 60));
  return win.bookingForm;
}

describe('予約フォームの流入経路', () => {
  const form = buildForm();
  const generator = new StaticReservationGenerator();
  const html = generator.generateHTML(form.config, form.id, form.store_id);

  it('埋め込みの規則は、サーバー側の合言葉の規則と同じ', () => {
    expect(html).toContain(`/${SOURCE_CODE_PATTERN.source}/.test(v)`);
    expect(html).toContain('source_code: this.sourceCode || this.getSourceCode() || null');
  });

  it('?src= が無ければ空（今までどおり）', async () => {
    expect((await open(html, '')).sourceCode).toBe('');
  });

  it('URL の ?src= を読む（ほかのパラメータがあっても）', async () => {
    expect((await open(html, '?src=abcd2345')).sourceCode).toBe('abcd2345');
    expect((await open(html, '?foo=1&src=abcd2345&bar=2')).sourceCode).toBe('abcd2345');
  });

  it('LIFF 経由（liff.state）の ?src= も読む', async () => {
    expect((await open(html, `?liff.state=${encodeURIComponent('?src=abcd2345')}`)).sourceCode).toBe('abcd2345');
    expect((await open(html, `?liff.state=${encodeURIComponent('/path?src=abcd2345')}`)).sourceCode).toBe('abcd2345');
  });

  it('形のおかしい合言葉は読まない', async () => {
    expect((await open(html, '?src=ABCD2345')).sourceCode).toBe('');
    expect((await open(html, '?src=abc')).sourceCode).toBe('');
    expect((await open(html, `?src=${encodeURIComponent('<script>')}`)).sourceCode).toBe('');
  });

  it('プレビューと店舗側手動予約フォームでは読まない', async () => {
    const preview = generator.generateHTML(form.config, form.id, form.store_id, 'preview');
    const manual = generator.generateHTML(form.config, form.id, form.store_id, 'manual');
    expect((await open(preview, '?src=abcd2345')).sourceCode).toBe('');
    expect((await open(manual, '?src=abcd2345')).sourceCode).toBe('');
  });
});
