import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { normalizeForm } from '@/lib/form-normalizer';
import type { SurveyConfig, SurveyQuestion } from '@/types/survey';
import type { Form } from '@/types/form';

async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return { dom, doc: dom.window.document, w: dom.window as unknown as Record<string, unknown>, errors };
}

function click(doc: Document, el: Element | null) {
  if (!el) throw new Error('element not found');
  (el as HTMLElement).dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
}

const msg = (text: string) => ({ enabled: true, text });

describe('アンケート: 選択肢ごとの送信時の追加メッセージ', () => {
  const q1: SurveyQuestion = {
    id: 'q1', type: 'radio', title: '来店のきっかけ', required: false,
    options: [
      {
        label: '紹介', value: '紹介', extra_message: msg('紹介特典のご案内'),
        follow_ups: [
          { enabled: true, title: 'どなたから', type: 'checkbox', options: [{ label: '友人', value: '友人', extra_message: msg('友人紹介ありがとうございます') }, { label: '家族', value: '家族' }] },
        ],
      },
      { label: 'Instagram', value: 'Instagram', extra_message: { enabled: false, text: '送らない' } },
    ],
  };
  const q2: SurveyQuestion = {
    id: 'q2', type: 'checkbox', title: '気になること', required: false,
    options: [{ label: '肌', value: '肌', extra_message: msg('肌ケアのご案内') }, { label: '髪', value: '髪', extra_message: msg('ヘアケアのご案内') }],
  };
  const q3: SurveyQuestion = {
    id: 'q3', type: 'select', title: '非表示の質問', required: false, hidden_by_default: true,
    show_triggers: [{ question_id: 'q1', value: 'Instagram' }],
    options: [{ label: 'A', value: 'A', extra_message: msg('Aのご案内') }],
  };
  const render = (questions: SurveyQuestion[]) => {
    const config = { basic_info: { title: 'テスト', liff_id: '', theme_color: '#3B82F6' }, questions, ui_settings: { submit_button_text: '送信' } } as unknown as SurveyConfig;
    return new StaticSurveyGenerator().generateHTML(config, 'survey_test', 'st0001');
  };
  const button = (doc: Document, qid: string, label: string) =>
    Array.from(doc.querySelectorAll(`#container-${qid} .choice-button`)).find((b) => b.textContent === label) || null;

  it('共通 JS が埋め込まれ、選んだ選択肢（入れ子の追加質問も）の文言を上から順に集める', async () => {
    const html = render([q1, q2, q3]);
    expect(html).toContain('function xmCapMessages');
    expect(html).toContain('function svCollectExtraMessages');
    const { doc, w, errors } = await loadDom(html);
    expect(errors).toEqual([]);
    const collect = w.svCollectExtraMessages as () => string[];
    expect(collect()).toEqual([]);

    click(doc, button(doc, 'q1', '紹介'));
    expect(collect()).toEqual(['紹介特典のご案内']);
    // 追加質問「どなたから」の「友人」を選ぶ
    const fuBtn = Array.from(doc.querySelectorAll('#fu-container-q1-0-0 .choice-button')).find((b) => b.textContent === '友人') || null;
    click(doc, fuBtn);
    expect(collect()).toEqual(['紹介特典のご案内', '友人紹介ありがとうございます']);

    click(doc, button(doc, 'q2', '髪'));
    click(doc, button(doc, 'q2', '肌'));
    expect(collect()).toEqual(['紹介特典のご案内', '友人紹介ありがとうございます', '肌ケアのご案内', 'ヘアケアのご案内']);
  });

  it('OFF の追加メッセージは送らず、非表示の質問の選択は数えない。表示されたら数える', async () => {
    const { doc, w } = await loadDom(render([q1, q3]));
    const collect = w.svCollectExtraMessages as () => string[];
    const select = doc.getElementById('q3') as HTMLSelectElement;
    select.value = 'A';
    select.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    // q3 は q1 = Instagram のときだけ表示 → まだ非表示なので数えない
    expect(collect()).toEqual([]);
    click(doc, button(doc, 'q1', 'Instagram'));
    expect(collect()).toEqual(['Aのご案内']);
  });

  it('xmCapMessages は本文 + 2 通目 + 追加メッセージを 5 通に収める', async () => {
    const { w } = await loadDom(render([q1]));
    const cap = w.xmCapMessages as (l: string[]) => string[];
    expect(cap(['本文', '2通目', 'a', 'b', 'c', 'd'])).toEqual(['本文', '2通目', 'a', 'b', 'c\n\nd']);
    expect(cap(['本文', 'a', 'a'])).toEqual(['本文', 'a']);
  });
});

describe('予約フォーム: 選択肢ごとの送信時の追加メッセージ', () => {
  function buildForm(): Form {
    return normalizeForm({
      id: 'form_test',
      store_id: 'st0001',
      form_type: 'line',
      config: {
        basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
        menu_structure: {
          categories: [
            {
              id: 'c1', name: 'カット', display_name: 'カット', selection_mode: 'single',
              menus: [
                {
                  id: 'm1', name: 'カット', price: 5000, duration: 60, extra_message: msg('カットのご案内'),
                  options: [{ id: 'o1', name: 'シャンプー', price: 500, duration: 10, extra_message: msg('シャンプーのご案内') }],
                  additional_questions: [{ id: 'aq1', type: 'radio', title: '仕上がり', required: false, options: [{ label: '軽め', value: '軽め', extra_message: msg('軽めのご案内') }] }],
                },
                {
                  id: 'm2', name: 'カラー', has_submenu: true,
                  sub_menu_items: [{ id: 's1', name: 'フル', price: 8000, duration: 90, extra_message: msg('フルカラーのご案内') }, { id: 's2', name: 'リタッチ', price: 5000, duration: 60 }],
                },
              ],
              options: [{ id: 'co1', name: 'トリートメント', price: 1000, duration: 10, extra_message: msg('トリートメントのご案内') }],
            },
          ],
        },
        custom_fields: [
          {
            id: 'cf1', type: 'radio', title: '駐車場', required: false,
            options: [
              { label: 'はい', value: 'はい', extra_message: msg('駐車場のご案内'), additional_questions: [{ id: 'aq2', type: 'select', title: '車種', required: false, options: [{ label: '大型', value: '大型', extra_message: msg('大型車のご案内') }] }] },
              { label: 'いいえ', value: 'いいえ', extra_message: { enabled: false, text: '送らない' } },
            ],
          },
          { id: 'cf2', type: 'checkbox', title: '非表示', required: false, hidden_by_default: true, show_triggers: [{ type: 'gender', value: 'male' }], options: [{ label: 'X', value: 'X', extra_message: msg('Xのご案内') }] },
        ],
      },
    });
  }
  type BookingForm = {
    state: Record<string, unknown>;
    collectExtraMessages: () => string[];
  };

  it('共通 JS が埋め込まれ、選択状態に応じた文言をフォーム上の順で集める', async () => {
    const form = buildForm();
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    expect(html).toContain('function xmCapMessages');
    const { w, errors } = await loadDom(html);
    expect(errors).toEqual([]);
    const bf = w.bookingForm as BookingForm;
    expect(bf.collectExtraMessages()).toEqual([]);

    bf.state.selectedMenu = { id: 'm1' };
    bf.state.selectedOptions = { m1: ['o1'] };
    bf.state.selectedCategoryOptions = { c1: ['co1'] };
    bf.state.customFields = { aq1: '軽め', cf1: 'はい', aq2: '大型', cf2: ['X'] };
    // cf2 は性別 = 男性 のときだけ表示 → 非表示なので数えない
    expect(bf.collectExtraMessages()).toEqual([
      'カットのご案内', 'シャンプーのご案内', 'トリートメントのご案内', '駐車場のご案内', '軽めのご案内', '大型車のご案内',
    ]);

    // サブメニュー: 選んだサブメニューの文言だけ
    bf.state.selectedMenu = { id: 'm2' };
    bf.state.selectedSubmenu = { id: 's1' };
    bf.state.selectedOptions = {};
    bf.state.selectedCategoryOptions = {};
    bf.state.customFields = { cf1: 'いいえ' };
    expect(bf.collectExtraMessages()).toEqual(['フルカラーのご案内']);
    bf.state.selectedSubmenu = { id: 's2' };
    expect(bf.collectExtraMessages()).toEqual([]);
  });

  it('追加質問の選択は親が選ばれているときだけ数える', async () => {
    const form = buildForm();
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const { w } = await loadDom(html);
    const bf = w.bookingForm as BookingForm;
    // m1 を選んでいないので aq1 は非表示扱い、cf1 = いいえ なので aq2 も非表示扱い
    bf.state.customFields = { aq1: '軽め', cf1: 'いいえ', aq2: '大型' };
    expect(bf.collectExtraMessages()).toEqual([]);
  });
});
