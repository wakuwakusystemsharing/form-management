import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

/** 追加質問の「選択したボタンのすぐ下に表示する」（show_below_choice）の検証用フォーム */
function buildForm(): Form {
  return normalizeForm({
    id: 'form_inline',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      custom_fields: [
        {
          id: 'cf1',
          type: 'radio',
          title: '駐車場の利用',
          required: false,
          options: [
            {
              label: 'はい', value: 'はい',
              additional_questions: [
                { id: 'fq_inline', type: 'text', title: '車種', required: false, show_below_choice: true },
                { id: 'fq_normal', type: 'text', title: 'ナンバー', required: false },
              ],
            },
            { label: 'いいえ', value: 'いいえ' },
          ],
        },
        {
          id: 'cf2',
          type: 'select',
          title: '担当希望',
          required: false,
          options: [
            { label: '佐藤', value: '佐藤', additional_questions: [{ id: 'fq_sel', type: 'text', title: '指名理由', required: false, show_below_choice: true }] },
            { label: '鈴木', value: '鈴木' },
          ],
        },
      ],
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
                additional_questions: [{ id: 'mq_inline', type: 'text', title: '前回の施術', required: false, show_below_choice: true }],
                options: [
                  {
                    id: 'opt1', name: 'トリートメント', price: 1000, duration: 15,
                    additional_questions: [{ id: 'oq_inline', type: 'text', title: '髪質', required: false, show_below_choice: true }],
                  },
                ],
              },
            ],
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

describe('予約フォーム: 追加質問「選択したボタンのすぐ下に表示する」', () => {
  it('ON の追加質問だけ data-aq-inline が付く', () => {
    const html = render(buildForm());
    expect(html).toMatch(/id="aq-wrap-fq_inline"[^>]*data-aq-inline="1"/);
    expect(html).toMatch(/id="aq-wrap-mq_inline"[^>]*data-aq-inline="1"/);
    expect(html).toMatch(/id="aq-wrap-oq_inline"[^>]*data-aq-inline="1"/);
    expect(html).not.toMatch(/id="aq-wrap-fq_normal"[^>]*data-aq-inline/);
  });

  it('単一選択: 選んだ選択肢のすぐ下に移動し、OFF の質問は従来位置のまま', async () => {
    const { dom, errors } = await loadDom(render(buildForm()));
    expect(errors).toEqual([]);
    const doc = dom.window.document;
    const yes = doc.querySelector('input[name="custom-field-cf1"][value="はい"]') as HTMLInputElement;
    yes.checked = true;
    yes.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const inlineWrap = doc.getElementById('aq-wrap-fq_inline') as HTMLElement;
    const normalWrap = doc.getElementById('aq-wrap-fq_normal') as HTMLElement;
    expect(inlineWrap.style.display).toBe('');
    expect(normalWrap.style.display).toBe('');
    // 「はい」のラベルの直後（「いいえ」より前）に入る
    const yesLabel = yes.closest('.choice-label') as HTMLElement;
    expect(yesLabel.nextElementSibling).toBe(inlineWrap);
    expect(inlineWrap.parentElement?.classList.contains('custom-field-radios')).toBe(true);
    // OFF の質問は項目全体の後ろ（選択肢の列の外）
    expect(normalWrap.parentElement?.classList.contains('custom-field-radios')).toBe(false);

    // 入力は従来どおり state に入る
    const input = doc.getElementById('custom-field-fq_inline') as HTMLInputElement;
    input.value = 'プリウス';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const bf = (dom.window as unknown as { bookingForm: { state: { customFields: Record<string, unknown> } } }).bookingForm;
    expect(bf.state.customFields.fq_inline).toBe('プリウス');
  });

  it('ドロップダウン: プルダウンのすぐ下に移動する', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const sel = doc.getElementById('custom-field-cf2') as HTMLSelectElement;
    sel.value = '佐藤';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const wrap = doc.getElementById('aq-wrap-fq_sel') as HTMLElement;
    expect(wrap.style.display).toBe('');
    expect(sel.nextElementSibling).toBe(wrap);
  });

  it('メニュー / オプション: ボタンのすぐ下に移動する', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const menuBtn = doc.querySelector('.menu-item[data-menu-id="menu1"]') as HTMLElement;
    menuBtn.click();
    const menuWrap = doc.getElementById('aq-wrap-mq_inline') as HTMLElement;
    expect(menuWrap.style.display).toBe('');
    // メニューボタン + オプション欄をまとめた div の直後
    expect(menuBtn.parentElement?.nextElementSibling).toBe(menuWrap);

    const optBtn = doc.querySelector('.menu-option-item[data-option-id="opt1"]') as HTMLElement;
    optBtn.click();
    const optWrap = doc.getElementById('aq-wrap-oq_inline') as HTMLElement;
    expect(optWrap.style.display).toBe('');
    expect(optBtn.nextElementSibling).toBe(optWrap);
  });
});
