/**
 * 店舗側手動予約フォーム: 予約カレンダーの空いている所から開いたとき（?date=&time=）に日時を選んだ状態にする
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

function buildForm(calendarSettings: Record<string, unknown> = {}): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: { booking_mode: 'calendar', ...calendarSettings },
    },
  });
}

async function loadDom(html: string, url: string) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    url,
    beforeParse(window) {
      // 空き状況・お客様一覧の取得は失敗させる（通信しない）
      (window as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'));
    },
  });
  await new Promise((r) => setTimeout(r, 1200));
  return dom;
}

const manualHtml = (calendarSettings: Record<string, unknown> = {}) => new StaticReservationGenerator().generateHTML(buildForm(calendarSettings).config, 'form_test', 'st0001', 'manual');

describe('手動予約フォームの日時の入力済み表示', () => {
  it('埋め込んだ JavaScript が構文として正しい', () => {
    const dom = new JSDOM(manualHtml());
    const scripts = Array.from(dom.window.document.querySelectorAll('script:not([src])')).map((s) => s.textContent || '');
    expect(scripts.join('\n')).toContain('applyManualPrefill()');
    scripts.forEach((code) => {
      expect(() => new Function(code)).not.toThrow();
    });
  });

  it('?date= と ?time= があると、案内を出す（選べない時間なら選ばずに知らせる）', async () => {
    const dom = await loadDom(manualHtml(), 'https://example.com/api/stores/st0001/forms/form_test/manual-form?date=2026-12-01&time=10:00');
    const note = dom.window.document.getElementById('manual-prefill-note');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('12/1（火）10:00');
    // お客様選択の欄より上に出す
    const field = dom.window.document.getElementById('manual-customer-field');
    expect(field?.previousElementSibling?.id).toBe('manual-prefill-note');
    dom.window.close();
  });

  it('日時の指定が無い・形がおかしいときは何もしない', async () => {
    for (const query of ['', '?date=2026-12-01', '?date=2026/12/01&time=10:00', '?date=2026-12-01&time=10時']) {
      const dom = await loadDom(manualHtml(), `https://example.com/manual-form${query}`);
      expect(dom.window.document.getElementById('manual-prefill-note'), query).toBeNull();
      dom.window.close();
    }
  }, 30000);

  it('カレンダー表示モード以外のフォームでは何もしない', async () => {
    const html = manualHtml({ booking_mode: 'multiple_dates' });
    const dom = await loadDom(html, 'https://example.com/manual-form?date=2026-12-01&time=10:00');
    expect(dom.window.document.getElementById('manual-prefill-note')).toBeNull();
    dom.window.close();
  });

  it('通常の予約フォームでは呼ばない', async () => {
    const html = new StaticReservationGenerator().generateHTML(buildForm().config, 'form_test', 'st0001', 'preview');
    const dom = await loadDom(html, 'https://example.com/form?date=2026-12-01&time=10:00');
    expect(dom.window.document.getElementById('manual-prefill-note')).toBeNull();
    dom.window.close();
  });
});
