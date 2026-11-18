import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import { ADDITIONAL_QUESTION_MAX_DEPTH, countAdditionalQuestionsDeep, flattenAdditionalQuestions } from '../additional-question-tree';
import { countReservationMaxLineMessages } from '../extra-messages';
import { buildAdminReservationRows } from '../reservation-detail-items';
import type { AdditionalQuestion, Form } from '@/types/form';

/** 追加質問の追加質問（3 段 + 上限を超える 4 段目） */
function nestedQuestions(prefix: string): AdditionalQuestion[] {
  return [
    {
      id: `${prefix}1`, type: 'radio', title: '車の種類', required: false,
      options: [
        {
          label: '普通車', value: '普通車',
          additional_questions: [
            {
              id: `${prefix}2`, type: 'checkbox', title: '気になる点', required: true,
              options: [
                {
                  label: '傷', value: '傷',
                  additional_questions: [
                    {
                      id: `${prefix}3`, type: 'select', title: '傷の場所', required: false,
                      options: [
                        { label: '前', value: '前', additional_questions: [{ id: `${prefix}4`, type: 'text', title: '上限を超える質問', required: false }] },
                        { label: '後ろ', value: '後ろ' },
                      ],
                    },
                  ],
                },
                { label: '汚れ', value: '汚れ' },
              ],
            },
            { id: `${prefix}2b`, type: 'text', title: 'ナンバー', required: false },
          ],
        },
        { label: '軽自動車', value: '軽自動車' },
      ],
    },
  ];
}

function buildForm(): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        categories: [{
          id: 'c1', name: 'c1', display_name: 'カテゴリ', selection_mode: 'single', options: [],
          menus: [{ id: 'm1', name: '洗車', price: 1000, duration: 30, additional_questions: nestedQuestions('mq') }],
        }],
      },
      custom_fields: [
        {
          id: 'cf1', type: 'radio', title: '駐車場の利用', required: false,
          options: [
            { label: 'はい', value: 'はい', additional_questions: nestedQuestions('fq') },
            { label: 'いいえ', value: 'いいえ' },
          ],
        },
      ],
    },
  } as unknown as Form);
}

function render(form: Form, mode?: 'manual' | 'preview') {
  return new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, mode);
}

type BookingFormLike = {
  state: { customFields: Record<string, unknown> };
  getAdditionalQuestionEntries(): Array<{ field: { id: string }; ownerType: string; ownerId: string; ownerValue?: string }>;
};

async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  const doc = dom.window.document;
  const form = (dom.window as unknown as { bookingForm: BookingFormLike }).bookingForm;
  const fire = (el: Element, type: string) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  const pickRadio = (fieldId: string, value: string) => {
    doc.querySelectorAll<HTMLInputElement>(`input[name="custom-field-${fieldId}"]`).forEach((r) => { r.checked = r.value === value; });
    fire(doc.querySelector(`input[name="custom-field-${fieldId}"][value="${value}"]`)!, 'change');
  };
  const setCheck = (fieldId: string, value: string, on: boolean) => {
    const cb = doc.querySelector<HTMLInputElement>(`input[data-field-id="${fieldId}"][data-field-type="checkbox"][value="${value}"]`)!;
    cb.checked = on;
    fire(cb, 'change');
  };
  const shown = (id: string) => (doc.getElementById(`aq-wrap-${id}`) as HTMLElement).style.display !== 'none';
  return { dom, doc, form, errors, fire, pickRadio, setCheck, shown };
}

describe('追加質問の入れ子: 純粋ロジック', () => {
  it('親 → 子 の順に並べ、上限の段数を超えた質問は含めない', () => {
    const nodes = flattenAdditionalQuestions(nestedQuestions('q'));
    expect(ADDITIONAL_QUESTION_MAX_DEPTH).toBe(3);
    expect(nodes.map((n) => `${n.question.id}:${n.depth}`)).toEqual(['q1:1', 'q2:2', 'q3:3', 'q2b:2']);
    expect(nodes[2].parent).toMatchObject({ value: '傷' });
    expect(nodes[2].parent?.question.id).toBe('q2');
    expect(nodes[2].path).toEqual(['q1', 'q2']);
  });

  it('選択肢を持たない回答タイプの下に残った追加質問は使わない', () => {
    const list = [{ id: 'a', type: 'text', title: 'a', required: false, options: [{ label: 'x', value: 'x', additional_questions: [{ id: 'b', type: 'text', title: 'b', required: false }] }] }];
    expect(flattenAdditionalQuestions(list).map((n) => n.question.id)).toEqual(['a']);
  });

  it('編集画面のボタンの件数は、入れ子の下も数える', () => {
    expect(countAdditionalQuestionsDeep(nestedQuestions('q'))).toBe(5);
    expect(countAdditionalQuestionsDeep(undefined)).toBe(0);
  });

  it('LINE の送信数の上限: 入れ子の選択肢の追加メッセージも数える', () => {
    const msg = { enabled: true, text: 'x' };
    const config = normalizeForm({
      id: 'f', store_id: 's', form_type: 'line',
      config: {
        basic_info: { form_name: 'f', store_name: 's', liff_id: '', theme_color: '#000000' },
        custom_fields: [{
          id: 'cf1', type: 'radio', title: 'cf', required: false,
          options: [{
            label: 'a', value: 'a',
            additional_questions: [{
              id: 'q1', type: 'radio', title: 'q1', required: false,
              options: [{
                label: 'p', value: 'p', extra_message: msg,
                additional_questions: [{ id: 'q2', type: 'checkbox', title: 'q2', required: false, options: [{ label: 'x', value: 'x', extra_message: msg }, { label: 'y', value: 'y', extra_message: msg }] }],
              }],
            }],
          }],
        }],
      },
    } as unknown as Form).config;
    // 本文 1 + p 1 + q2 の x と y で 2
    expect(countReservationMaxLineMessages(config)).toBe(4);
  });

  it('管理画面の予約詳細: 入れ子の追加質問も質問名で表示する', () => {
    const form = buildForm();
    const rows = buildAdminReservationRows(form.config, {
      customer_name: '山田', customer_phone: '090', reservation_date: '2026-12-01', reservation_time: '10:00',
      customer_info: { custom_fields: { cf1: 'はい', fq1: '普通車', fq2: ['傷'], fq3: '前', mq3: '後ろ' } },
    } as never);
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(['車の種類', '気になる点', '傷の場所']));
    expect(rows.filter((r) => r.label === '傷の場所').map((r) => r.value).sort()).toEqual(['前', '後ろ']);
  });
});

describe('予約フォーム: 追加質問の追加質問', () => {
  it('入れ子の追加質問は親のすぐ後ろに非表示で描画され、上限を超える段は描画しない', () => {
    const html = render(buildForm());
    const at = (id: string) => html.indexOf(`id="aq-wrap-${id}"`);
    expect(at('fq1')).toBeGreaterThan(0);
    expect(at('fq2')).toBeGreaterThan(at('fq1'));
    expect(at('fq3')).toBeGreaterThan(at('fq2'));
    expect(at('fq2b')).toBeGreaterThan(at('fq3'));
    expect(at('fq4')).toBe(-1);
    expect(at('mq3')).toBeGreaterThan(at('mq1'));
    expect(html.slice(at('fq3'), at('fq3') + 200)).toContain('display:none');
    // カスタム項目の下のものには目印（メニュー変更フォームで隠す対象）が付く
    expect(html).toMatch(/class="aq-field aq-nested aq-followup" id="aq-wrap-fq2" data-owner-field="cf1" data-aq-path=" fq1 "/);
    expect(html).toMatch(/class="aq-field aq-nested" id="aq-wrap-mq3" data-aq-path=" mq1 mq2 "/);
  });

  it('カスタム項目: 選択肢を選ぶたびに 1 段ずつ表示される', async () => {
    const { form, errors, pickRadio, setCheck, shown, doc, fire } = await loadDom(render(buildForm(), 'preview'));
    expect(errors).toEqual([]);
    expect(form.getAdditionalQuestionEntries().filter((e) => e.field.id.startsWith('fq')).map((e) => `${e.field.id}<${e.ownerType}:${e.ownerId}`))
      .toEqual(['fq1<custom_option:cf1', 'fq2<aq_option:fq1', 'fq3<aq_option:fq2', 'fq2b<aq_option:fq1']);
    expect([shown('fq1'), shown('fq2'), shown('fq3')]).toEqual([false, false, false]);

    pickRadio('cf1', 'はい');
    expect([shown('fq1'), shown('fq2'), shown('fq3'), shown('fq2b')]).toEqual([true, false, false, false]);

    pickRadio('fq1', '普通車');
    expect([shown('fq2'), shown('fq3'), shown('fq2b')]).toEqual([true, false, true]);

    setCheck('fq2', '傷', true);
    expect(shown('fq3')).toBe(true);
    const select = doc.getElementById('custom-field-fq3') as HTMLSelectElement;
    select.value = '前';
    fire(select, 'change');
    expect(form.state.customFields).toMatchObject({ cf1: 'はい', fq1: '普通車', fq2: ['傷'], fq3: '前' });
  });

  it('途中の選択を変えると、その下の追加質問はすべて隠れて回答も消える', async () => {
    const { form, pickRadio, setCheck, shown, doc, fire } = await loadDom(render(buildForm(), 'preview'));
    pickRadio('cf1', 'はい');
    pickRadio('fq1', '普通車');
    setCheck('fq2', '傷', true);
    const select = doc.getElementById('custom-field-fq3') as HTMLSelectElement;
    select.value = '後ろ';
    fire(select, 'change');

    // 2 段目の親（fq1）を別の選択肢に
    pickRadio('fq1', '軽自動車');
    expect([shown('fq1'), shown('fq2'), shown('fq3'), shown('fq2b')]).toEqual([true, false, false, false]);
    expect(form.state.customFields.fq2).toBeUndefined();
    expect(form.state.customFields.fq3).toBeUndefined();
    expect(select.value).toBe('');
    expect(doc.querySelector<HTMLInputElement>('input[data-field-id="fq2"][value="傷"]')!.checked).toBe(false);

    // いちばん上のカスタム項目を別の選択肢に
    pickRadio('fq1', '普通車');
    setCheck('fq2', '傷', true);
    pickRadio('cf1', 'いいえ');
    expect([shown('fq1'), shown('fq2'), shown('fq3')]).toEqual([false, false, false]);
    expect(form.state.customFields).toEqual({ cf1: 'いいえ' });
  });

  it('メニューの追加質問でも同じように入れ子で表示される', async () => {
    const { form, pickRadio, setCheck, shown, doc } = await loadDom(render(buildForm(), 'preview'));
    expect(shown('mq1')).toBe(false);
    (doc.querySelector('.menu-item[data-menu-id="m1"]') as HTMLElement).click();
    expect([shown('mq1'), shown('mq2')]).toEqual([true, false]);
    pickRadio('mq1', '普通車');
    expect([shown('mq2'), shown('mq3')]).toEqual([true, false]);
    setCheck('mq2', '傷', true);
    expect(shown('mq3')).toBe(true);
    expect(form.state.customFields).toMatchObject({ mq1: '普通車', mq2: ['傷'] });
  });

  it('「選択したボタンのすぐ下に表示する」: 入れ子の質問は親の質問の選択肢のすぐ下に入る', async () => {
    const form = buildForm();
    const fq1 = form.config.custom_fields![0].options![0].additional_questions![0];
    fq1.options![0].additional_questions![0].show_below_choice = true;
    const { pickRadio, doc } = await loadDom(render(form, 'preview'));
    pickRadio('cf1', 'はい');
    pickRadio('fq1', '普通車');
    const wrap = doc.getElementById('aq-wrap-fq2')!;
    const label = doc.querySelector('input[name="custom-field-fq1"][value="普通車"]')!.closest('.choice-label')!;
    expect(label.nextElementSibling).toBe(wrap);
    expect(wrap.classList.contains('aq-field--inline')).toBe(true);
  });

  it('親が選択肢のすぐ下に移動していても、入れ子の質問は親のすぐ後ろに並ぶ', async () => {
    const form = buildForm();
    form.config.custom_fields![0].options![0].additional_questions![0].show_below_choice = true;
    const { pickRadio, doc } = await loadDom(render(form, 'preview'));
    pickRadio('cf1', 'はい');
    pickRadio('fq1', '普通車');
    const parent = doc.getElementById('aq-wrap-fq1')!;
    expect(doc.querySelector('input[name="custom-field-cf1"][value="はい"]')!.closest('.choice-label')!.nextElementSibling).toBe(parent);
    expect(parent.nextElementSibling).toBe(doc.getElementById('aq-wrap-fq2'));
    expect(doc.getElementById('aq-wrap-fq2')!.nextElementSibling).toBe(doc.getElementById('aq-wrap-fq2b'));
  });

  it('メニュー変更フォームでも、メニューの追加質問の入力欄は隠さない', () => {
    const html = render(buildForm());
    expect(html).toContain('body.menu-change-mode .aq-field:not(.aq-followup) [id^="custom-field-wrap-"] { display: block !important; }');
  });
});
