/**
 * 料金の幅（¥5,000〜¥7,000）と、料金の表示の自由入力
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import {
  PRICE_RANGE_RUNTIME_JS,
  formatTotalPrice,
  formatYenRange,
  hasPriceRange,
  itemPriceText,
  normalizePriceLabel,
  priceSpread,
  reservationTotalPriceText,
  resolvePriceMax,
  sanitizePriceMax,
} from '../price-range';
import { buildAdminReservationRows, buildReservationDetailItems } from '../reservation-detail-items';
import { buildMenuInfoText } from '../menu-info-text';
import { normalizeSubOptions } from '../sub-options';
import type { Form } from '@/types/form';

describe('price-range: 純粋ロジック', () => {
  it('上限は、料金より大きいときだけ使う', () => {
    expect(resolvePriceMax({ price: 5000, price_max: 7000 })).toBe(7000);
    expect(resolvePriceMax({ price: 5000, price_max: 5000 })).toBe(5000);
    expect(resolvePriceMax({ price: 5000, price_max: 3000 })).toBe(5000);
    expect(resolvePriceMax({ price: 5000 })).toBe(5000);
    expect(resolvePriceMax(null)).toBe(0);
    expect(hasPriceRange({ price: 5000, price_max: 7000 })).toBe(true);
    expect(hasPriceRange({ price: 5000, price_max: 4000 })).toBe(false);
  });

  it('保存する値: 上限は料金より大きいときだけ、自由入力は 1 行・40 文字まで', () => {
    expect(sanitizePriceMax('5,000', '7,000')).toBe(7000);
    expect(sanitizePriceMax(5000, 5000)).toBeUndefined();
    expect(sanitizePriceMax(5000, '')).toBeUndefined();
    expect(normalizePriceLabel('  ¥5,000〜\n要相談 ')).toBe('¥5,000〜 要相談');
    expect(normalizePriceLabel('')).toBeUndefined();
    expect(normalizePriceLabel('あ'.repeat(60))).toHaveLength(40);
  });

  it('フォームに出す文字', () => {
    expect(formatYenRange(5000, 7000)).toBe('¥5,000〜¥7,000');
    expect(formatYenRange(5000, 0)).toBe('¥5,000');
    expect(itemPriceText({ price: 5000, price_max: 7000 })).toBe('¥5,000〜¥7,000');
    expect(itemPriceText({ price: 1000, price_max: 2000 }, { plus: true })).toBe('+¥1,000〜¥2,000');
    expect(itemPriceText({ price: 5000 })).toBe('¥5,000');
    expect(itemPriceText({ price: 0 })).toBe('');
    expect(itemPriceText({ price: 0 }, { plus: true, zeroText: '無料' })).toBe('無料');
    expect(itemPriceText({ price: 0, price_max: 3000 })).toBe('¥0〜¥3,000');
    // 自由入力があれば、金額の代わりにそれを出す
    expect(itemPriceText({ price: 5000, price_max: 7000, price_label: '要相談' }, { plus: true })).toBe('要相談');
    expect(itemPriceText({ price: 0, price_label: '¥5,000〜' })).toBe('¥5,000〜');
    // 料金を非表示にしていれば、何も出さない
    expect(itemPriceText({ price: 5000, price_max: 7000, price_label: '要相談', hide_price: true })).toBe('');
  });

  it('合計金額: 選んだ項目の「上限 − 下限」を足して幅にする', () => {
    const menus = [{ price: 5000, price_max: 7000 }, { price: 3000 }];
    const options = [{ price: 1000, price_max: 1500 }, { price: 500, price_max: 100 }];
    expect(priceSpread(menus, options)).toBe(2500);
    expect(formatTotalPrice(9500, 2500)).toBe('¥9,500〜¥12,000');
    expect(formatTotalPrice(9500, 0)).toBe('¥9,500');
    expect(reservationTotalPriceText({ customer_info: { total_price: 9500 }, selected_menus: menus, selected_options: options })).toBe('¥9,500〜¥12,000');
    expect(reservationTotalPriceText({ customer_info: {}, selected_menus: menus })).toBe('');
  });

  it('埋め込み JS は TS 版と同じ結果になる', () => {
    const rt = new Function(`${PRICE_RANGE_RUNTIME_JS}; return { prMax: prMax, prRange: prRange, prItemText: prItemText };`)() as {
      prMax: (i: unknown) => number;
      prRange: (a: unknown, b: unknown) => string;
      prItemText: (i: unknown, plus: boolean, zero: string) => string;
    };
    const items = [
      { price: 5000, price_max: 7000 },
      { price: 5000, price_max: 4000 },
      { price: 0 },
      { price: 0, price_max: 3000 },
      { price: 5000, price_label: ' 要相談 ' },
      { price: 5000, price_max: 7000, hide_price: true },
      { price: undefined, price_max: 2000 },
    ];
    for (const item of items) {
      expect(rt.prMax(item)).toBe(resolvePriceMax(item));
      expect(rt.prItemText(item, false, '')).toBe(itemPriceText(item));
      expect(rt.prItemText(item, true, '無料')).toBe(itemPriceText(item, { plus: true, zeroText: '無料' }));
    }
    expect(rt.prRange(6000, 8000)).toBe(formatYenRange(6000, 8000));
    expect(rt.prRange(6000, 6000)).toBe(formatYenRange(6000, 6000));
  });

  it('オプションのオプション: 上限と自由入力を保ったまま整える', () => {
    expect(normalizeSubOptions([{ id: 'a', name: 'A', price: 500, price_max: 900, price_label: ' 500円〜 ' }, { id: 'b', name: 'B', price: 500, price_max: 300 }])).toEqual([
      { id: 'a', name: 'A', price: 500, duration: 0, price_max: 900, price_label: '500円〜' },
      { id: 'b', name: 'B', price: 500, duration: 0 },
    ]);
  });
});

describe('price-range: メール・管理画面・メニュー情報コピー', () => {
  const reservation = {
    reservation_date: '2026-12-01',
    reservation_time: '10:00',
    customer_name: '山田',
    customer_phone: '09000000000',
    selected_menus: [{ menu_id: 'm1', menu_name: 'カラー', price: 5000, price_max: 7000 }],
    selected_options: [{ option_name: 'トリートメント', menu_id: 'm1', price: 1000, price_max: 2000, duration: 10 }],
    customer_info: { total_price: 6000, total_duration: 70 },
  };

  it('合計金額とオプションの料金を幅で出す', () => {
    const items = buildReservationDetailItems({}, reservation);
    expect(items.find((i) => i.label === '合計金額')?.value).toBe('¥6,000〜¥9,000');
    expect(items.find((i) => i.label === 'メニュー')?.value).toContain('トリートメント ¥1,000〜¥2,000');
    const rows = buildAdminReservationRows({}, reservation);
    expect(rows.find((i) => i.label === '合計金額')?.value).toBe('¥6,000〜¥9,000');
  });

  it('幅の無い予約は今までどおり', () => {
    const plain = { ...reservation, selected_menus: [{ menu_id: 'm1', menu_name: 'カット', price: 5000 }], selected_options: [], customer_info: { total_price: 5000 } };
    expect(buildReservationDetailItems({}, plain).find((i) => i.label === '合計金額')?.value).toBe('¥5,000');
  });

  it('メニュー情報コピー: 幅・自由入力・必須を載せる', () => {
    const text = buildMenuInfoText({
      formName: 'テスト',
      categories: [
        {
          id: 'c1', name: 'カラー', display_name: 'カラー', selection_mode: 'single', options: [],
          menus: [
            {
              id: 'm1', name: 'カラー', price: 5000, price_max: 7000, price_label: '¥5,000〜', duration: 60, options_required: true,
              options: [{ id: 'o1', name: 'トリートメント', price: 1000, price_max: 2000, duration: 10, required: true }],
            },
          ],
        },
      ],
    });
    expect(text).toContain('・カラー　5,000円〜7,000円（表示: ¥5,000〜） / 60分');
    expect(text).toContain('〔オプション：1 つ以上必須〕');
    expect(text).toContain('＋ トリートメント　+1,000円〜2,000円 / +10分 【このメニューを選んだら必須】');
  });
});

// ---------------------------------------------------------------------------
// 生成した予約フォーム
// ---------------------------------------------------------------------------

function buildForm(): Form {
  return normalizeForm({
    id: 'form_range',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      reservation_summary: { show_total_price: true },
      menu_structure: {
        structure_type: 'category_based',
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false },
        categories: [
          {
            id: 'cat1',
            name: 'カラー',
            menus: [
              {
                id: 'menu1', name: 'カラー', price: 5000, price_max: 7000, duration: 60,
                options: [
                  { id: 'opt_a', name: 'トリートメント', price: 1000, price_max: 2000, duration: 10 },
                  { id: 'opt_b', name: 'ケア', price: 0, price_label: '<b>要相談</b>', duration: 0, sub_options: [{ id: 'so_1', name: '追加', price: 300, price_max: 800, duration: 0 }] },
                  { id: 'opt_c', name: '無料のもの', price: 0, duration: 0 },
                ],
              },
              { id: 'menu2', name: 'カット', price: 4000, duration: 30 },
              { id: 'menu3', name: 'パーマ', has_submenu: true, sub_menu_items: [{ id: 'sub1', name: 'ショート', price: 8000, price_max: 10000, duration: 90 }] },
            ],
            options: [{ id: 'cop1', name: '指名ケア', price: 500, price_max: 1500, duration: 0 }],
          },
        ],
      },
    },
  });
}
function render(form: Form) {
  return new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
}
async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return { dom, errors };
}
type Payload = {
  selectedMenus: Array<{ price: number; price_max?: number }>;
  selectedOptions: Array<{ option_id: string; price: number; price_max?: number }>;
  totalPrice: number;
  totalPriceMax: number;
  menuMessageText: string;
};
type BookingForm = { buildSelectionPayload: () => Payload; updateSummary: () => void };

describe('予約フォーム: 料金の幅', () => {
  it('ボタンに「¥5,000〜¥7,000」と出す。自由入力はそのまま（HTML として解釈しない）。幅の無い料金は今までどおり', () => {
    const html = render(buildForm());
    expect(html).toContain('<div class="menu-item-price">¥5,000〜¥7,000</div>');
    expect(html).toContain('<div class="menu-item-price">¥4,000</div>');
    expect(html).toContain('+¥1,000〜¥2,000');
    expect(html).toContain('&lt;b&gt;要相談&lt;/b&gt;');
    expect(html).not.toContain('><b>要相談</b><');
    expect(html).toContain('>無料<');
    expect(html).toContain('+¥300〜¥800');
    expect(html).toContain('+¥500〜¥1,500');
  });

  it('合計金額は「下限の合計〜上限の合計」。予約データには幅のある項目だけ上限を残す', async () => {
    const { dom, errors } = await loadDom(render(buildForm()));
    expect(errors).toEqual([]);
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    (doc.querySelector('.menu-item[data-menu-id="menu1"]') as HTMLElement).click();
    const click = (sel: string) => (doc.querySelector(sel) as HTMLElement).click();
    click('.menu-option-item[data-option-id="opt_a"]');
    click('.menu-option-item[data-option-id="opt_b"]');
    click('.menu-option-item[data-option-id="so_1"]');
    click('.menu-option-item[data-option-id="opt_c"]');
    click('.category-option-item[data-option-id="cop1"]');
    const p = bf.buildSelectionPayload();
    expect(p.totalPrice).toBe(5000 + 1000 + 0 + 300 + 0 + 500);
    expect(p.totalPriceMax).toBe(7000 + 2000 + 0 + 800 + 0 + 1500);
    expect(p.selectedMenus[0]).toMatchObject({ price: 5000, price_max: 7000 });
    expect(p.selectedOptions.map((o) => [o.option_id, o.price, o.price_max])).toEqual([
      ['opt_a', 1000, 2000],
      ['opt_b', 0, undefined],
      ['so_1', 300, 800],
      ['opt_c', 0, undefined],
      ['cop1', 500, 1500],
    ]);
    expect(p.menuMessageText).toContain('トリートメント ¥1,000〜¥2,000');
    bf.updateSummary();
    expect(doc.getElementById('summary-content')!.textContent).toContain('合計金額: ¥6,800〜¥11,300');
  });

  it('幅の無いメニューだけなら、合計は今までどおり 1 つの金額', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    (doc.querySelector('.menu-item[data-menu-id="menu2"]') as HTMLElement).click();
    const p = bf.buildSelectionPayload();
    expect(p.totalPrice).toBe(4000);
    expect(p.totalPriceMax).toBe(4000);
    expect(p.selectedMenus[0].price_max).toBeUndefined();
    bf.updateSummary();
    const text = doc.getElementById('summary-content')!.textContent || '';
    expect(text).toContain('合計金額: ¥4,000');
    expect(text).not.toContain('〜');
  });

  it('サブメニューの幅も、ボタンと合計に出る', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    (doc.querySelector('.menu-item[data-menu-id="menu3"]') as HTMLElement).click();
    const sub = doc.querySelector('.submenu-item') as HTMLElement;
    expect(sub.textContent).toContain('¥8,000〜¥10,000');
    sub.click();
    const p = bf.buildSelectionPayload();
    expect([p.totalPrice, p.totalPriceMax]).toEqual([8000, 10000]);
  });
});
