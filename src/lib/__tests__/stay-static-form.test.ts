/**
 * 宿泊モードの静的 HTML（予約フォーム）を JSDOM で動かす: カレンダー描画 → チェックイン / アウトのタップ → 見積もり表示
 * 空き状況 API は window.fetch を差し替えて返す
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { normalizeForm } from '@/lib/form-normalizer';
import { createDefaultStaySettings } from '@/lib/stay-pricing';
import { buildCancelPolicyText } from '@/lib/cancel-rules';

function stayForm(overrides: Record<string, unknown> = {}) {
  const stay = createDefaultStaySettings();
  stay.pricing.long_stay_discounts = [{ min_nights: 3, type: 'percent', value: 10 }];
  return normalizeForm({
    id: 'stayform01',
    store_id: 'st0001',
    config: {
      form_type: 'line',
      basic_info: { form_name: '宿泊予約', store_name: '宿', liff_id: '', theme_color: '#1b2a4e' },
      menu_structure: { structure_type: 'category_based', categories: [], menus: [] },
      calendar_settings: { booking_mode: 'stay', min_advance_days: 0, advance_booking_days: 365, stay_settings: stay },
      cancel_rules: { show_policy_on_form: true, policy_text: '', fee_tiers: [{ days_before: 7, percent: 0 }, { days_before: 2, percent: 50 }, { days_before: 0, percent: 100 }] },
      ...overrides,
    },
  });
}

/** 翌月の 1 日 〜 末日 + 1 の空き状況（10 日と 20 日の夜は埋まり） */
function buildAvailability(from: string, to: string) {
  const nights: Record<string, { available: boolean; remaining: number; price: number | null; reason?: string }> = {};
  const [y, m, d] = from.split('-').map(Number);
  let cur = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(`${to}T00:00:00Z`).getTime();
  while (cur.getTime() <= end) {
    const key = cur.toISOString().slice(0, 10);
    const day = cur.getUTCDate();
    const full = day === 10 || day === 20;
    nights[key] = full ? { available: false, remaining: 0, price: 20000, reason: 'full' } : { available: true, remaining: 1, price: cur.getUTCDay() === 6 ? 26000 : 20000 };
    cur = new Date(cur.getTime() + 86400000);
  }
  return nights;
}

async function loadStayDom(html: string) {
  const errors: string[] = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e && (e as Error).message || e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://example.com/' });
  const calls: string[] = [];
  // 空き状況 API の差し替え（LIFF SDK は読み込まれないので initializeLIFF は失敗して続行する）
  (dom.window as unknown as { fetch: unknown }).fetch = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const from = u.searchParams.get('from') || '';
    const to = u.searchParams.get('to') || '';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        nights: buildAvailability(from, to),
        settings: { check_in_time: '15:00', check_out_time: '10:00', check_in_time_options: [], min_nights: 1, max_nights: 7, show_price_on_calendar: true, price_note: '税込', long_stay_discounts: [{ min_nights: 3, type: 'percent', value: 10 }] },
        calendar_degraded: false,
      }),
    };
  };
  await new Promise((r) => setTimeout(r, 300));
  return { dom, errors, calls };
}

describe('宿泊モードの静的 HTML', () => {
  it('人数欄・カレンダー・自動生成したキャンセル規定を含み、埋め込み JS が構文エラーなく動く', async () => {
    const form = stayForm();
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);
    expect(html).toContain('id="stay-guest-adult"');
    expect(html).toContain('id="stay-guest-child"');
    expect(html).toContain('id="stay-calendars"');
    expect(html).toContain('チェックイン 15:00 以降');
    // キャンセル規定は fee_tiers から自動生成（改行は <br>）
    expect(html).toContain(buildCancelPolicyText(form.config.cancel_rules!).split('\n')[0]);
    expect(html).toContain('const PREVIEW_MODE = false;');

    const { dom, errors, calls } = await loadStayDom(html);
    expect(errors.filter((e) => /SyntaxError|ReferenceError|TypeError/.test(e))).toEqual([]);
    const doc = dom.window.document;
    // メニューが無いフォームなので日時欄は最初から表示され、空き状況を取りに行く
    expect((doc.getElementById('datetime-field') as HTMLElement).style.display).not.toBe('none');
    expect(calls.some((u) => u.includes('/api/stores/st0001/stay/availability?form_id=stayform01'))).toBe(true);
    const days = Array.from(doc.querySelectorAll('.stay-day[data-date]'));
    expect(days.length).toBeGreaterThan(27);
    expect(doc.querySelectorAll('.stay-day-full').length).toBeGreaterThan(0);
    dom.window.close();
  });

  it('チェックイン → チェックアウトをタップすると見積もり（泊数・割引・合計）と要約が出る', async () => {
    const form = stayForm();
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);
    const { dom } = await loadStayDom(html);
    const doc = dom.window.document;
    const okDays = Array.from(doc.querySelectorAll('.stay-day-ok[data-date]')) as HTMLButtonElement[];
    // 連続して空いている 3 泊を探す（10 日・20 日は埋まっている）
    const dates = okDays.map((b) => b.dataset.date!);
    let ci = '';
    for (let i = 0; i + 3 < dates.length; i++) {
      const a = new Date(`${dates[i]}T00:00:00Z`).getTime();
      if (new Date(`${dates[i + 3]}T00:00:00Z`).getTime() - a === 3 * 86400000) { ci = dates[i]; break; }
    }
    expect(ci).not.toBe('');
    const co = new Date(new Date(`${ci}T00:00:00Z`).getTime() + 3 * 86400000).toISOString().slice(0, 10);

    (doc.querySelector(`.stay-day[data-date="${ci}"]`) as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(doc.getElementById('stay-hint')!.textContent).toContain('チェックアウトする日');
    expect(doc.querySelector(`.stay-day[data-date="${co}"]`)!.className).toContain('stay-day-can-out');

    (doc.querySelector(`.stay-day[data-date="${co}"]`) as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    const quote = doc.getElementById('stay-quote-head')!.textContent || '';
    expect(quote).toContain('3泊');
    expect(quote).toContain('6歳以上 1名');
    expect(quote).toContain('連泊割引');
    expect(quote).toContain('税込');
    // 要約（ご予約内容）にも宿泊日が出る
    const summary = doc.getElementById('summary-content')!.textContent || '';
    expect(summary).toContain('ご宿泊日');
    expect(summary).toContain('3泊');
    // 内訳
    expect(doc.querySelectorAll('#stay-quote-detail .stay-quote-line').length).toBe(5); // 3 泊 + 割引 + 合計
    dom.window.close();
  });

  it('プレビューは API を呼ばず埋め込み設定で料金を描く', async () => {
    const form = stayForm();
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    expect(html).toContain('const PREVIEW_MODE = true;');
    const { dom, calls } = await loadStayDom(html);
    expect(calls.filter((u) => u.includes('/stay/availability'))).toEqual([]);
    const labels = Array.from(dom.window.document.querySelectorAll('.stay-day-ok .stay-day-label')).map((e) => e.textContent);
    expect(labels).toContain('¥14,000'); // 既定の料金表 1 名
    dom.window.close();
  });
});
