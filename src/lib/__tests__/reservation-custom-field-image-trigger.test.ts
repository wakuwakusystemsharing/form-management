import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

type CF = NonNullable<Form['config']['custom_fields']>[number];
type BF = {
  state: { customFields: Record<string, unknown> };
  getHiddenCustomFieldIds: () => string[];
  applyCustomFieldVisibility: () => void;
};

/**
 * cf_src（単一選択）: はい / いいえ
 * cf_dep: cf_src = はい のときだけ表示（必須）
 * cf_chain: cf_dep の選択肢 A が選ばれたら表示（連鎖）
 * cf_and: cf_src = はい かつ メニュー menu1 のとき表示（all）
 */
function buildForm(extraFields: CF[] = []): Form {
  return normalizeForm({
    id: 'form_vis',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      custom_fields: [
        { id: 'cf_src', type: 'radio', title: '駐車場の利用', required: false, options: [{ label: 'はい', value: 'はい' }, { label: 'いいえ', value: 'いいえ' }] },
        {
          id: 'cf_dep', type: 'radio', title: '車種', required: true,
          options: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }],
          hidden_by_default: true,
          show_triggers: [{ type: 'custom_field', field_id: 'cf_src', value: 'はい' }],
        },
        {
          id: 'cf_chain', type: 'text', title: 'ナンバー', required: false,
          hidden_by_default: true,
          show_triggers: [{ type: 'custom_field', field_id: 'cf_dep', value: 'A' }],
        },
        {
          id: 'cf_and', type: 'text', title: '両方', required: false,
          hidden_by_default: true, show_triggers_mode: 'all',
          show_triggers: [{ type: 'custom_field', field_id: 'cf_src', value: 'はい' }, { type: 'menu', value: 'menu1' }],
        },
        ...extraFields,
      ],
      menu_structure: {
        structure_type: 'category_based',
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false },
        categories: [{ id: 'cat1', name: 'カット', menus: [{ id: 'menu1', name: 'カット', price: 3000, duration: 60 }] }],
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
  const w = dom.window as unknown as Window & { bookingForm: BF };
  return { dom, doc: dom.window.document, w, errors };
}

const pick = (dom: JSDOM, fieldId: string, value: string) => {
  const input = dom.window.document.querySelector(`input[name="custom-field-${fieldId}"][value="${value}"]`) as HTMLInputElement;
  input.checked = true;
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

describe('予約フォーム: カスタム項目の画像', () => {
  const img = (position: CF['image_position']) => buildForm([
    { id: 'cf_img', type: 'text', title: '画像つき', required: false, description: '説明', image_url: 'https://example.com/a.png', image_position: position },
  ]);
  const wrapOf = (html: string) => {
    const start = html.indexOf('id="custom-field-wrap-cf_img"');
    const end = html.indexOf('</div>\n', html.indexOf('id="custom-field-cf_img"'));
    return html.slice(start, end + 6);
  };

  it('above: 質問名の上に画像', () => {
    const w = wrapOf(render(img('above')));
    expect(w.indexOf('custom-field-image')).toBeLessThan(w.indexOf('<label'));
    expect(w).toContain('src="https://example.com/a.png"');
  });

  it('middle: 説明文の下・入力欄の上', () => {
    const w = wrapOf(render(img('middle')));
    expect(w.indexOf('custom-field-image')).toBeGreaterThan(w.indexOf('custom-field-desc'));
    expect(w.indexOf('custom-field-image')).toBeLessThan(w.indexOf('id="custom-field-cf_img"'));
  });

  it('below: 入力欄の下', () => {
    const w = wrapOf(render(img('below')));
    expect(w.indexOf('custom-field-image')).toBeGreaterThan(w.indexOf('id="custom-field-cf_img"'));
  });

  it('http(s) 以外の URL は出さない', () => {
    const form = buildForm([{ id: 'cf_img', type: 'text', title: 'x', required: false, image_url: 'javascript:alert(1)' }]);
    expect(render(form)).not.toContain('<div class="custom-field-image">');
  });
});

describe('予約フォーム: カスタム項目の選択肢をトリガーにした表示', () => {
  it('初期は非表示。トリガーの選択肢を選ぶと表示、外すと非表示 + 回答クリア', async () => {
    const { dom, doc, w, errors } = await loadDom(render(buildForm()));
    expect(errors).toEqual([]);
    const dep = doc.getElementById('custom-field-wrap-cf_dep') as HTMLElement;
    expect(dep.style.display).toBe('none');
    expect(w.bookingForm.getHiddenCustomFieldIds()).toEqual(['cf_dep', 'cf_chain', 'cf_and']);

    pick(dom, 'cf_src', 'はい');
    expect(dep.style.display).toBe('');
    expect(w.bookingForm.getHiddenCustomFieldIds()).toEqual(['cf_chain', 'cf_and']);

    pick(dom, 'cf_dep', 'A');
    expect(w.bookingForm.state.customFields.cf_dep).toBe('A');
    expect((doc.getElementById('custom-field-wrap-cf_chain') as HTMLElement).style.display).toBe('');

    pick(dom, 'cf_src', 'いいえ');
    expect(dep.style.display).toBe('none');
    // 非表示になった cf_dep の回答が消えるので、連鎖している cf_chain も非表示
    expect(w.bookingForm.state.customFields.cf_dep).toBeUndefined();
    expect(w.bookingForm.getHiddenCustomFieldIds()).toEqual(['cf_dep', 'cf_chain', 'cf_and']);
  });

  it('all モードはすべてのトリガーが成立したときだけ表示', async () => {
    const { dom, doc, w } = await loadDom(render(buildForm()));
    pick(dom, 'cf_src', 'はい');
    expect(w.bookingForm.getHiddenCustomFieldIds()).toContain('cf_and');
    (doc.querySelector('.menu-item[data-menu-id="menu1"]') as HTMLElement).click();
    expect(w.bookingForm.getHiddenCustomFieldIds()).not.toContain('cf_and');
    expect((doc.getElementById('custom-field-wrap-cf_and') as HTMLElement).style.display).toBe('');
  });
});
