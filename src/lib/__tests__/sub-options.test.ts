import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import {
  findMissingRequiredSubOptions,
  flattenConfigSubOptions,
  flattenSubOptions,
  hasSubOptions,
  normalizeSubOptions,
  resolveSubOptionsLabel,
  subOptionsFieldsToSave,
  SUB_OPTIONS_RUNTIME_JS,
  syncSubOptionSelection,
  toSubOptionsEditorValue,
} from '../sub-options';
import type { Form, FormConfig } from '@/types/form';

/** メニューオプション（複数・任意）/ メニューオプション（1 つだけ・必須）/ カテゴリー共通オプション に追加のオプションを持つフォーム */
function buildForm(): Form {
  return normalizeForm({
    id: 'form_subopt',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false },
        categories: [
          {
            id: 'cat1',
            name: 'カット',
            menus: [
              {
                id: 'menu1',
                name: 'カット',
                price: 3000,
                duration: 60,
                options: [
                  {
                    id: 'opt_spa', name: 'ヘッドスパ', price: 1000, duration: 10,
                    sub_options_mode: 'single', sub_options_required: true, sub_options_label: 'コースの長さ',
                    sub_options: [
                      { id: 'so_15', name: '15分', price: 500, duration: 15 },
                      { id: 'so_30', name: '30分', price: 900, duration: 30 },
                    ],
                  },
                  {
                    id: 'opt_tr', name: 'トリートメント', price: 2000, duration: 20,
                    sub_options: [
                      { id: 'so_a', name: '炭酸', price: 300, duration: 5 },
                      { id: 'so_b', name: 'アロマ', price: 0, duration: 0 },
                    ],
                  },
                  { id: 'opt_plain', name: '眉カット', price: 500, duration: 5 },
                ],
              },
            ],
            options: [
              { id: 'cop1', name: '駐車場', price: 0, duration: 0, sub_options: [{ id: 'so_p', name: '大型車', price: 200, duration: 0 }] },
            ],
          },
        ],
      },
    },
  });
}

function flatConfig(): FormConfig {
  return flattenConfigSubOptions(JSON.parse(JSON.stringify(buildForm().config)));
}

describe('sub-options: 設定の整形と展開', () => {
  it('normalizeSubOptions: 名前の無い行・重複 ID を除き、料金と時間は 0 以上の整数', () => {
    expect(
      normalizeSubOptions([
        { id: 'a', name: ' A ', price: '500', duration: -3, hide_price: true },
        { id: 'a', name: '重複' },
        { id: 'b', name: '' },
        null,
        { id: 'c', name: 'C', price: 12.9, duration: 30, description: ' 説明 ' },
      ])
    ).toEqual([
      { id: 'a', name: 'A', price: 500, duration: 0, hide_price: true },
      { id: 'c', name: 'C', price: 12, duration: 30, description: '説明' },
    ]);
    expect(normalizeSubOptions(undefined)).toEqual([]);
    expect(normalizeSubOptions(Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: 'x' })))).toHaveLength(20);
    expect(resolveSubOptionsLabel('')).toBe('追加オプション');
    expect(resolveSubOptionsLabel(' 長さ ')).toBe('長さ');
  });

  it('flattenSubOptions: 親のすぐ後ろに、親の ID と表示名を持つ通常のオプションとして並べる。2 回かけても同じ', () => {
    const options = buildForm().config.menu_structure.categories[0].menus[0].options!;
    const flat = flattenSubOptions(options);
    expect(flat.map((o) => o.id)).toEqual(['opt_spa', 'so_15', 'so_30', 'opt_tr', 'so_a', 'so_b', 'opt_plain']);
    expect(flat[1]).toMatchObject({ id: 'so_15', name: 'ヘッドスパ（15分）', sub_label: '15分', parent_option_id: 'opt_spa', price: 500, duration: 15 });
    expect(flattenSubOptions(flat).map((o) => o.id)).toEqual(flat.map((o) => o.id));
    expect(hasSubOptions(buildForm().config)).toBe(true);
    const cfg = flatConfig();
    expect(cfg.menu_structure.categories[0].options.map((o) => o.id)).toEqual(['cop1', 'so_p']);
  });

  it('編集欄の値: 追加のオプションが無ければ項目を持たない。既定値（複数・任意・見出しなし）は保存しない', () => {
    expect(subOptionsFieldsToSave(toSubOptionsEditorValue(null))).toEqual({ sub_options: undefined, sub_options_mode: undefined, sub_options_required: undefined, sub_options_label: undefined });
    const v = toSubOptionsEditorValue({ id: 'o', name: 'o', sub_options: [{ id: 's', name: 'S', price: 1, duration: 2 }] });
    expect(v).toMatchObject({ sub_options_mode: 'multiple', sub_options_required: false, sub_options_label: '' });
    expect(subOptionsFieldsToSave(v)).toEqual({ sub_options: [{ id: 's', name: 'S', price: 1, duration: 2 }], sub_options_mode: undefined, sub_options_required: undefined, sub_options_label: undefined });
    expect(subOptionsFieldsToSave({ ...v, sub_options_mode: 'single', sub_options_required: true, sub_options_label: ' 長さ ' })).toMatchObject({ sub_options_mode: 'single', sub_options_required: true, sub_options_label: '長さ' });
  });
});

describe('sub-options: 選択の整合（TS 版と埋め込み JS が同じ結果）', () => {
  const runtime = new Function(`${SUB_OPTIONS_RUNTIME_JS}; return { soSync: soSync, soMissingRequired: soMissingRequired };`)() as {
    soSync: (c: unknown, s: unknown, id?: string | null) => unknown[];
    soMissingRequired: (c: unknown, s: unknown) => string[];
  };
  const cases: Array<{ name: string; state: { selectedOptions?: Record<string, string[]>; selectedCategoryOptions?: Record<string, string[]> }; clicked?: string; after: unknown; removed: string[]; missing: string[] }> = [
    {
      name: '1 つだけ: 別の追加のオプションを選ぶと前のものが外れる',
      state: { selectedOptions: { menu1: ['opt_spa', 'so_15', 'so_30'] } },
      clicked: 'so_30',
      after: { selectedOptions: { menu1: ['opt_spa', 'so_30'] } },
      removed: ['so_15'],
      missing: [],
    },
    {
      name: '複数: いくつ選んでも外れない',
      state: { selectedOptions: { menu1: ['opt_tr', 'so_a', 'so_b'] } },
      clicked: 'so_b',
      after: { selectedOptions: { menu1: ['opt_tr', 'so_a', 'so_b'] } },
      removed: [],
      missing: [],
    },
    {
      name: '親を外すと、その追加のオプションも外れる（他の親の分は残る）',
      state: { selectedOptions: { menu1: ['so_15', 'opt_tr', 'so_a'] }, selectedCategoryOptions: { cat1: ['so_p'] } },
      clicked: 'opt_spa',
      after: { selectedOptions: { menu1: ['opt_tr', 'so_a'] }, selectedCategoryOptions: { cat1: [] } },
      removed: ['so_15', 'so_p'],
      missing: [],
    },
    {
      name: '必須: 親だけ選んで追加のオプションが無いと未選択として挙がる',
      state: { selectedOptions: { menu1: ['opt_spa', 'opt_tr', 'opt_plain'] } },
      after: { selectedOptions: { menu1: ['opt_spa', 'opt_tr', 'opt_plain'] } },
      removed: [],
      missing: ['ヘッドスパ'],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const config = flatConfig();
      const tsState = JSON.parse(JSON.stringify(c.state));
      const jsState = JSON.parse(JSON.stringify(c.state));
      const tsRemoved = syncSubOptionSelection(config, tsState, c.clicked);
      const jsRemoved = runtime.soSync(config, jsState, c.clicked);
      expect(tsState).toEqual(c.after);
      expect(jsState).toEqual(c.after);
      expect(tsRemoved.map((r) => r.id)).toEqual(c.removed);
      expect(jsRemoved).toEqual(tsRemoved);
      expect(findMissingRequiredSubOptions(config, tsState)).toEqual(c.missing);
      expect(runtime.soMissingRequired(config, jsState)).toEqual(c.missing);
    });
  }
});

// ---------------------------------------------------------------------------
// 生成した予約フォームを実際に動かす
// ---------------------------------------------------------------------------

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
type BookingForm = {
  state: { selectedOptions: Record<string, string[]>; selectedCategoryOptions: Record<string, string[]> };
  buildSelectionPayload: () => { selectedOptions: Array<{ option_id?: string; option_name?: string; name?: string; price?: number }>; totalPrice: number; totalDuration: number; menuMessageText: string };
};

describe('予約フォーム: オプションのオプション', () => {
  it('追加のオプションは親のすぐ下に入れ子で出力され、最初は隠れている。元の設定は書き換えない', () => {
    const form = buildForm();
    const html = render(form);
    expect(html).toMatch(/class="sub-options-container" data-scope="menu" data-owner-id="menu1" data-parent-option-id="opt_spa" style="display:none/);
    expect(html).toMatch(/class="sub-options-container" data-scope="category" data-owner-id="cat1" data-parent-option-id="cop1"/);
    expect(html).toContain('コースの長さ');
    expect(html).toContain('（必須）');
    // 保存されている設定は入れ子のまま（展開するのは生成 HTML の中だけ）
    expect(form.config.menu_structure.categories[0].menus[0].options!.map((o) => o.id)).toEqual(['opt_spa', 'opt_tr', 'opt_plain']);
  });

  it('親を選ぶと表示され、選ぶと料金・時間が合計に足され、予約データとメッセージに「親（追加）」で入る', async () => {
    const { dom, errors } = await loadDom(render(buildForm()));
    expect(errors).toEqual([]);
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    (doc.querySelector('.menu-item[data-menu-id="menu1"]') as HTMLElement).click();
    const box = doc.querySelector('.sub-options-container[data-parent-option-id="opt_spa"]') as HTMLElement;
    expect(box.style.display).toBe('none');
    // 追加のオプションは、親の一覧に同じ階層のボタンとしては出ない（入れ子の中だけ）
    expect(doc.querySelectorAll('.menu-option-item[data-option-id="so_15"]')).toHaveLength(1);
    expect((doc.querySelector('.menu-option-item[data-option-id="so_15"]') as HTMLElement).closest('.sub-options-container')).toBe(box);

    (doc.querySelector('.menu-option-item[data-option-id="opt_spa"]') as HTMLElement).click();
    expect(box.style.display).toBe('block');
    (doc.querySelector('.menu-option-item[data-option-id="so_15"]') as HTMLElement).click();
    expect(bf.state.selectedOptions.menu1).toEqual(['opt_spa', 'so_15']);

    const payload = bf.buildSelectionPayload();
    expect(payload.totalPrice).toBe(3000 + 1000 + 500);
    expect(payload.totalDuration).toBe(60 + 10 + 15);
    expect(payload.selectedOptions.map((o) => o.option_name ?? o.name)).toEqual(['ヘッドスパ', 'ヘッドスパ（15分）']);
    expect(payload.menuMessageText).toContain('ヘッドスパ（15分）');
  });

  it('1 つだけ選べる: 別のものを選ぶと切り替わる。複数選べる: 両方選べる', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    const click = (id: string) => (doc.querySelector(`.menu-option-item[data-option-id="${id}"]`) as HTMLElement).click();
    (doc.querySelector('.menu-item[data-menu-id="menu1"]') as HTMLElement).click();
    click('opt_spa');
    click('so_15');
    click('so_30');
    expect(bf.state.selectedOptions.menu1).toEqual(['opt_spa', 'so_30']);
    // 外れた側のボタンは選択の見た目も戻る
    expect((doc.querySelector('.menu-option-item[data-option-id="so_15"]') as HTMLElement).style.backgroundColor).toBe('white');
    click('opt_tr');
    click('so_a');
    click('so_b');
    expect(bf.state.selectedOptions.menu1).toEqual(['opt_spa', 'so_30', 'opt_tr', 'so_a', 'so_b']);
    expect(bf.buildSelectionPayload().totalPrice).toBe(3000 + 1000 + 900 + 2000 + 300 + 0);
  });

  it('親を外すと、追加のオプションも外れて欄が隠れ、合計から引かれる', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    const click = (id: string) => (doc.querySelector(`.menu-option-item[data-option-id="${id}"]`) as HTMLElement).click();
    (doc.querySelector('.menu-item[data-menu-id="menu1"]') as HTMLElement).click();
    click('opt_tr');
    click('so_a');
    click('opt_tr');
    expect(bf.state.selectedOptions.menu1).toEqual([]);
    expect((doc.querySelector('.sub-options-container[data-parent-option-id="opt_tr"]') as HTMLElement).style.display).toBe('none');
    expect(bf.buildSelectionPayload().totalPrice).toBe(3000);
  });

  it('カテゴリー共通オプションでも同じように動く', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    (doc.querySelector('.menu-item[data-menu-id="menu1"]') as HTMLElement).click();
    const box = doc.querySelector('.sub-options-container[data-parent-option-id="cop1"]') as HTMLElement;
    (doc.querySelector('.category-option-item[data-option-id="cop1"]') as HTMLElement).click();
    expect(box.style.display).toBe('block');
    (doc.querySelector('.category-option-item[data-option-id="so_p"]') as HTMLElement).click();
    expect(bf.state.selectedCategoryOptions.cat1).toEqual(['cop1', 'so_p']);
    expect(bf.buildSelectionPayload().totalPrice).toBe(3000 + 200);
    (doc.querySelector('.category-option-item[data-option-id="cop1"]') as HTMLElement).click();
    expect(bf.state.selectedCategoryOptions.cat1).toEqual([]);
    expect(box.style.display).toBe('none');
  });
});
