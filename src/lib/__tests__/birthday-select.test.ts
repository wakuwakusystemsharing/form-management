import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { StaticLotteryGenerator } from '@/lib/static-generator-lottery';
import { normalizeForm } from '@/lib/form-normalizer';
import { normalizeLotteryForm } from '@/lib/lottery-normalizer';
import { renderBirthdayFieldHtml } from '@/lib/multiple-dates-runtime-js';
import type { SurveyConfig } from '@/types/survey';

type BdWindow = Window & {
  bdInitAll: () => void;
  bdSyncFromHidden: (el: HTMLInputElement) => void;
  formatDateTimeForDisplay: (v: string) => string;
};

async function loadDom(html: string) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return { w: dom.window as unknown as BdWindow, doc: dom.window.document };
}

function parts(doc: Document, hiddenId: string) {
  const container = doc.querySelector(`.birthday-field[data-birthday-for="${hiddenId}"]`) as HTMLElement;
  const y = container.querySelector('select[data-part="y"]') as HTMLSelectElement;
  const m = container.querySelector('select[data-part="m"]') as HTMLSelectElement;
  const d = container.querySelector('select[data-part="d"]') as HTMLSelectElement;
  const hidden = doc.getElementById(hiddenId) as HTMLInputElement;
  return { container, y, m, d, hidden };
}

function choose(doc: Document, select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
}

describe('renderBirthdayFieldHtml', () => {
  it('hidden + 年 / 月 / 日の 3 つのプルダウンを出力する', () => {
    const html = renderBirthdayFieldHtml('custom-field-bd1', 'data-field-id="bd1"');
    expect(html).toContain('<input type="hidden" id="custom-field-bd1" data-field-id="bd1">');
    expect(html).toContain('data-part="y"');
    expect(html).toContain('data-part="m"');
    expect(html).toContain('data-part="d"');
    expect(html).toContain('<span class="birthday-unit">年</span>');
  });
});

describe('アンケート: 回答タイプ「誕生日選択」', () => {
  const config: SurveyConfig = {
    basic_info: { title: 'お客様情報', liff_id: '', theme_color: '#3B82F6' },
    questions: [
      { id: 'q1', type: 'birthday', title: '生年月日', required: true, restore_enabled: true },
      { id: 'q2', type: 'radio', title: '家族', required: false, options: [
        { label: 'いる', value: 'いる', follow_up: { enabled: true, title: 'お子様の誕生日', type: 'birthday' } },
      ] },
    ],
    ui_settings: { submit_button_text: '送信', theme_color: '#3B82F6' },
  };

  it('年（今年 → 100 年前）・月・日の選択肢が作られ、3 つ選ぶと hidden に YYYY-MM-DD が入る', async () => {
    const html = new StaticSurveyGenerator().generateHTML(config, 'sv1', 'st1');
    const { doc } = await loadDom(html);
    const p = parts(doc, 'q1');
    const thisYear = new Date().getFullYear();
    expect(p.y.options.length).toBe(1 + 101);
    expect(p.y.options[1].value).toBe(String(thisYear));
    expect(p.y.options[p.y.options.length - 1].value).toBe(String(thisYear - 100));
    expect(p.m.options.length).toBe(13);
    expect(p.d.options.length).toBe(32);
    expect(p.hidden.value).toBe('');

    let inputEvents = 0;
    p.hidden.addEventListener('input', () => { inputEvents += 1; });
    choose(doc, p.y, '2001');
    expect(p.hidden.value).toBe(''); // まだ揃っていない
    choose(doc, p.m, '1');
    choose(doc, p.d, '5');
    expect(p.hidden.value).toBe('2001-01-05');
    expect(inputEvents).toBe(1);
  });

  it('2 月を選ぶと日の選択肢が 28 / 29 日までになり、選択中の日が無くなれば値が空に戻る', async () => {
    const html = new StaticSurveyGenerator().generateHTML(config, 'sv1', 'st1');
    const { doc } = await loadDom(html);
    const p = parts(doc, 'q1');
    choose(doc, p.y, '2001');
    choose(doc, p.m, '3');
    choose(doc, p.d, '31');
    expect(p.hidden.value).toBe('2001-03-31');
    choose(doc, p.m, '2');
    expect(p.d.options.length).toBe(29); // 2001 年 2 月 = 28 日 + placeholder
    expect(p.hidden.value).toBe('');
    choose(doc, p.y, '2000');
    expect(p.d.options.length).toBe(30); // うるう年
  });

  it('復元: hidden の値をプルダウンに反映する（追加質問でも同じ部品）', async () => {
    const html = new StaticSurveyGenerator().generateHTML(config, 'sv1', 'st1');
    const { w, doc } = await loadDom(html);
    const p = parts(doc, 'q1');
    p.hidden.value = '1990-12-24';
    w.bdSyncFromHidden(p.hidden);
    expect(p.y.value).toBe('1990');
    expect(p.m.value).toBe('12');
    expect(p.d.value).toBe('24');
    expect(w.formatDateTimeForDisplay(p.hidden.value)).toBe('1990年12月24日');
    // 追加質問側の部品も生成されている
    expect(doc.getElementById('fu-q2-0')).not.toBeNull();
    expect(doc.querySelector('.birthday-field[data-birthday-for="fu-q2-0"]')).not.toBeNull();
  });
});

describe('予約フォーム / 抽選フォーム: 誕生日選択の描画', () => {
  it('予約フォームのカスタムフィールドと追加質問に誕生日選択が出て、選ぶと state に入る', async () => {
    const form = normalizeForm({
      id: 'f1', store_id: 'st1', form_type: 'line',
      config: {
        basic_info: { form_name: '予約', store_name: '店', liff_id: '', theme_color: '#3B82F6' },
        custom_fields: [{ id: 'bd', type: 'birthday', title: '生年月日', required: true, restore_enabled: true }],
      },
    });
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const { doc } = await loadDom(html);
    const p = parts(doc, 'custom-field-bd');
    expect(p.y.options.length).toBeGreaterThan(50);
    choose(doc, p.y, '1985');
    choose(doc, p.m, '7');
    choose(doc, p.d, '9');
    expect(p.hidden.value).toBe('1985-07-09');
    const bf = (doc.defaultView as unknown as { bookingForm: { state: { customFields: Record<string, unknown> } } }).bookingForm;
    expect(bf.state.customFields.bd).toBe('1985-07-09');
  });

  it('抽選フォームの事前質問に誕生日選択が出て、回答に YYYY-MM-DD が入る', async () => {
    const form = normalizeLotteryForm({
      id: 'l1', store_id: 'st1', status: 'active',
      config: {
        basic_info: { title: 'くじ', liff_id: '1234567890-abcdefgh', theme_color: '#1b2a4e' },
        prizes: [{ id: 'a', name: 'A賞', probability: 10, stock: null }],
        entry_rules: { limit: 'once', require_friend: false, when_sold_out: 'lose', pre_questions: [
          { id: 'q1', type: 'birthday', title: '生年月日', required: true },
        ] },
      },
    });
    const html = new StaticLotteryGenerator().generateHTML(form, 'preview');
    const { doc } = await loadDom(html);
    const p = parts(doc, 'q-q1');
    const collect = (doc.defaultView as unknown as { collectAnswers: () => { error?: string; answers?: Record<string, string> } }).collectAnswers;
    expect(collect().error).toContain('生年月日');
    choose(doc, p.y, '1999');
    choose(doc, p.m, '10');
    choose(doc, p.d, '1');
    expect(collect().answers).toEqual({ '生年月日': '1999-10-01' });
  });
});
