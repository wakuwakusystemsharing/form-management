/**
 * - カテゴリーが 2 つ以上あるとき、フォームを開いた時点ではすべて閉じている
 * - オプション欄の見出しを、メニューごと / カテゴリーごとに変えられる
 * - オプションのオプションの見出しの横の補足（複数選べます / 1つ選べます）を変えられる
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import { normalizeOwnOptionsHeading, resolveOptionsHeading } from '../menu-headings';
import { resolveSubOptionsHint, subOptionsFieldsToSave, toSubOptionsEditorValue } from '../sub-options';
import type { Form } from '@/types/form';

function buildForm(opts: { single?: boolean; globalHeading?: string } = {}): Form {
  const cat1 = {
    id: 'cat1',
    name: 'カット',
    options_heading: 'カットに足せるもの',
    menus: [
      {
        id: 'm1', name: 'カット', price: 3000, duration: 60, options_heading: 'つけたい場合はお選びください',
        options: [
          { id: 'o1', name: 'シャンプー', price: 500, duration: 10, sub_options_hint: 'お好みでどうぞ', sub_options: [{ id: 's1', name: '炭酸', price: 300, duration: 0 }] },
          { id: 'o2', name: 'ブロー', price: 500, duration: 10, sub_options_hint_hidden: true, sub_options: [{ id: 's2', name: '巻き', price: 300, duration: 0 }] },
          { id: 'o3', name: 'セット', price: 500, duration: 10, sub_options_mode: 'single', sub_options: [{ id: 's3', name: 'アップ', price: 300, duration: 0 }] },
        ],
      },
      { id: 'm2', name: 'カラー', price: 5000, duration: 90, options: [{ id: 'o4', name: 'トリートメント', price: 1000, duration: 10 }] },
    ],
    options: [{ id: 'c1', name: '眉カット', price: 500, duration: 5 }],
  };
  const cat2 = {
    id: 'cat2',
    name: 'パーマ',
    menus: [{ id: 'm3', name: 'パーマ', price: 8000, duration: 120 }],
    options: [{ id: 'c2', name: '保湿', price: 500, duration: 5 }],
  };
  return normalizeForm({
    id: 'form_headings',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false, options_heading: opts.globalHeading },
        categories: opts.single ? [cat1] : [cat1, cat2],
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

describe('カテゴリーは最初すべて閉じている', () => {
  it('カテゴリーが 2 つ以上: 1 つ目も閉じている。押すと開く', async () => {
    const { dom, errors } = await loadDom(render(buildForm()));
    expect(errors).toEqual([]);
    const doc = dom.window.document;
    const headers = Array.from(doc.querySelectorAll('.category-header')) as HTMLElement[];
    expect(headers).toHaveLength(2);
    for (const h of headers) expect(h.classList.contains('open')).toBe(false);
    expect((doc.getElementById('category-section-cat1') as HTMLElement).style.display).toBe('none');
    expect((doc.getElementById('category-section-cat2') as HTMLElement).style.display).toBe('none');

    headers[0].click();
    expect(headers[0].classList.contains('open')).toBe(true);
    expect((doc.getElementById('category-section-cat1') as HTMLElement).style.display).toBe('block');
    expect((doc.getElementById('category-section-cat2') as HTMLElement).style.display).toBe('none');
  });

  it('カテゴリーが 1 つだけ: 見出しのボタンは無く、メニューは最初から見えている', async () => {
    const { dom } = await loadDom(render(buildForm({ single: true })));
    const doc = dom.window.document;
    expect(doc.querySelectorAll('.category-header')).toHaveLength(0);
    expect((doc.getElementById('category-section-cat1') as HTMLElement).style.display).toBe('');
  });

  it('メニューを選んだ状態に戻すとき（前回のメニュー・メニュー変更・空き待ち）は、そのカテゴリーを開く', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: { handleRepeatBooking: (o: unknown) => void } }).bookingForm;
    bf.handleRepeatBooking({ selectedMenus: { cat2: ['m3'] }, selectedSubMenus: {}, selectedMenuOptions: {} });
    expect((doc.getElementById('category-section-cat2') as HTMLElement).style.display).toBe('block');
    expect((doc.querySelector('.category-header[data-category-id="cat2"]') as HTMLElement).classList.contains('open')).toBe(true);
    expect((doc.getElementById('category-section-cat1') as HTMLElement).style.display).toBe('none');
  });
});

describe('オプション欄の見出し（メニューごと / カテゴリーごと）', () => {
  it('個別 → 全体 → 既定 の順', () => {
    const form = buildForm({ globalHeading: '全体の見出し' });
    expect(resolveOptionsHeading(form.config, ' 個別 ')).toBe('個別');
    expect(resolveOptionsHeading(form.config, '')).toBe('全体の見出し');
    expect(resolveOptionsHeading(form.config, undefined)).toBe('全体の見出し');
    expect(resolveOptionsHeading(buildForm().config, '   ')).toBe('オプション');
    expect(resolveOptionsHeading(null, 'あ'.repeat(50))).toHaveLength(40);
    expect(normalizeOwnOptionsHeading('  ')).toBeUndefined();
    expect(normalizeOwnOptionsHeading(' a ')).toBe('a');
  });

  it('フォームに出る', async () => {
    const { dom } = await loadDom(render(buildForm({ globalHeading: '全体の見出し' })));
    const doc = dom.window.document;
    const first = (sel: string) => ((doc.querySelector(sel) as HTMLElement).firstElementChild as HTMLElement).textContent?.trim();
    expect(first('#options-m1')).toBe('つけたい場合はお選びください');
    expect(first('#options-m2')).toBe('全体の見出し');
    expect(first('#category-section-cat1 .category-options-section')).toBe('カットに足せるもの');
    expect(first('#category-section-cat2 .category-options-section')).toBe('全体の見出し');
  });

  it('HTML として解釈しない', () => {
    const form = buildForm();
    form.config.menu_structure.categories[0].menus[0].options_heading = '<b>太字</b>';
    const html = render(form);
    expect(html).toContain('&lt;b&gt;太字&lt;/b&gt;');
  });
});

describe('オプションのオプションの補足', () => {
  it('自由に書いた文言 / 表示しない / 既定', () => {
    expect(resolveSubOptionsHint({ sub_options_hint: ' お好みで ' })).toBe('お好みで');
    expect(resolveSubOptionsHint({ sub_options_hint: 'x', sub_options_hint_hidden: true })).toBe('');
    expect(resolveSubOptionsHint({})).toBe('複数選べます');
    expect(resolveSubOptionsHint({ sub_options_mode: 'single' })).toBe('1つ選べます');
    expect(resolveSubOptionsHint(null)).toBe('複数選べます');
  });

  it('フォームに出る', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const hint = (parent: string) => doc.querySelector(`.sub-options-container[data-parent-option-id="${parent}"] .sub-options-hint`)?.textContent ?? null;
    expect(hint('o1')).toBe('お好みでどうぞ');
    expect(hint('o2')).toBeNull();
    expect(hint('o3')).toBe('1つ選べます');
  });

  it('編集欄の値 ⇄ 保存する項目', () => {
    const v = toSubOptionsEditorValue({ id: 'o', name: 'O', sub_options: [{ id: 's', name: 'S', price: 0, duration: 0 }], sub_options_hint: 'ひとこと', sub_options_hint_hidden: true });
    expect(v).toMatchObject({ sub_options_hint: 'ひとこと', sub_options_hint_hidden: true });
    expect(subOptionsFieldsToSave(v)).toMatchObject({ sub_options_hint: 'ひとこと', sub_options_hint_hidden: true });
    const empty = subOptionsFieldsToSave({ ...v, sub_options_hint: '  ', sub_options_hint_hidden: false });
    expect(empty.sub_options_hint).toBeUndefined();
    expect(empty.sub_options_hint_hidden).toBeUndefined();
  });
});
