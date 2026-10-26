import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import type { SurveyConfig, SurveyQuestion } from '@/types/survey';

type SvWindow = Window & {
  svGetHiddenQuestionIds: () => string[];
  submitForm: () => Promise<void>;
  alert: (msg: string) => void;
  liff: { isInClient: () => boolean };
};

function buildConfig(questions: SurveyQuestion[]): SurveyConfig {
  return {
    basic_info: { title: 'テストアンケート', liff_id: '', theme_color: '#3B82F6' },
    questions,
    ui_settings: { submit_button_text: '送信' },
  } as unknown as SurveyConfig;
}

const q1: SurveyQuestion = {
  id: 'q1', type: 'radio', title: '来店のきっかけ', required: false, allow_other: true, options: [
    {
      label: '紹介', value: '紹介',
      follow_ups: [{ enabled: true, title: 'ご紹介者との関係', type: 'radio', options: [{ label: '友人', value: '友人' }, { label: '家族', value: '家族' }] }],
    },
    { label: 'Instagram', value: 'Instagram' },
  ],
};
const q2: SurveyQuestion = { id: 'q2', type: 'text', title: '紹介者特典の希望', required: true, hidden_by_default: true, show_triggers: [{ question_id: 'q1', value: '紹介' }] };
const q3: SurveyQuestion = { id: 'q3', type: 'text', title: 'お友達へのメッセージ', required: false, hidden_by_default: true, show_triggers: [{ question_id: 'q1', path: [0, 0], value: '友人' }] };
const q4: SurveyQuestion = { id: 'q4', type: 'text', title: 'その他の内容', required: false, hidden_by_default: true, show_triggers: [{ question_id: 'q1', value: '__other__' }] };

function render(questions: SurveyQuestion[]) {
  return new StaticSurveyGenerator().generateHTML(buildConfig(questions), '', '');
}

async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  const w = dom.window as unknown as SvWindow;
  const alerts: string[] = [];
  w.alert = (m: string) => { alerts.push(m); };
  w.liff = { isInClient: () => false };
  return { doc: dom.window.document, w, alerts, errors };
}

function click(doc: Document, el: Element | null) {
  if (!el) throw new Error('element not found');
  (el as HTMLElement).dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
}
const button = (doc: Document, qid: string, label: string) =>
  Array.from(doc.querySelectorAll(`#container-${qid} .choice-button`)).find((b) => b.textContent === label) || null;

describe('アンケート: 質問の画像', () => {
  const withImage = (position: SurveyQuestion['image_position']): SurveyQuestion => ({
    id: 'qi', type: 'text', title: '画像つき', required: false, description: '説明', image_url: 'https://example.com/a.png', image_position: position,
  });
  const wrapOf = (html: string) => {
    const start = html.indexOf('id="qwrap-qi"');
    return html.slice(start, html.indexOf('</div>', html.indexOf('id="qi"')) + 6);
  };

  it('above: 質問名の上', () => {
    const w = wrapOf(render([withImage('above')]));
    expect(w.indexOf('question-image')).toBeLessThan(w.indexOf('<label'));
    expect(w).toContain('src="https://example.com/a.png"');
  });
  it('middle: 説明文の下・入力欄の上', () => {
    const w = wrapOf(render([withImage('middle')]));
    expect(w.indexOf('question-image')).toBeGreaterThan(w.indexOf('field-description'));
    expect(w.indexOf('question-image')).toBeLessThan(w.indexOf('id="qi"'));
  });
  it('below: 入力欄の下', () => {
    const w = wrapOf(render([withImage('below')]));
    expect(w.indexOf('question-image')).toBeGreaterThan(w.indexOf('id="qi"'));
  });
  it('http(s) 以外は出さない', () => {
    expect(render([{ ...withImage('above'), image_url: 'javascript:alert(1)' }])).not.toContain('<div class="question-image">');
  });
});

describe('アンケート: 質問の表示トリガー', () => {
  it('初期は非表示。選択肢・追加質問の選択肢・その他 をトリガーに表示 / 非表示が切り替わる', async () => {
    const { doc, w, errors } = await loadDom(render([q1, q2, q3, q4]));
    expect(errors).toEqual([]);
    const wrap = (id: string) => doc.getElementById('qwrap-' + id) as HTMLElement;
    expect(wrap('q2').style.display).toBe('none');
    expect(w.svGetHiddenQuestionIds()).toEqual(['q2', 'q3', 'q4']);

    click(doc, button(doc, 'q1', '紹介'));
    expect(wrap('q2').style.display).toBe('');
    expect(wrap('q3').style.display).toBe('none');

    // 追加質問「ご紹介者との関係」で 友人 を選ぶ → q3 表示
    click(doc, Array.from(doc.querySelectorAll('#fu-container-q1-0-0 .choice-button')).find((b) => b.textContent === '友人') || null);
    expect(wrap('q3').style.display).toBe('');

    // Instagram に切り替え → q2 / q3 非表示（追加質問が隠れるので友人の選択は数えない）
    click(doc, button(doc, 'q1', 'Instagram'));
    expect(wrap('q2').style.display).toBe('none');
    expect(wrap('q3').style.display).toBe('none');

    click(doc, button(doc, 'q1', 'その他'));
    expect(wrap('q4').style.display).toBe('');
  });

  it('非表示の必須質問は送信時にチェックされず、回答にも含まれない', async () => {
    const { doc, w, alerts } = await loadDom(render([q1, q2]));
    click(doc, button(doc, 'q1', 'Instagram'));
    await w.submitForm();
    // q2（必須）は非表示なので「入力してください」にならず、送信内容の確認アラートまで進む
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toContain('送信内容');
    expect(alerts[0]).toContain('【来店のきっかけ】');
    expect(alerts[0]).not.toContain('紹介者特典の希望');
  });

  it('表示中の必須質問は従来どおりチェックされる', async () => {
    const { doc, w, alerts } = await loadDom(render([q1, q2]));
    click(doc, button(doc, 'q1', '紹介'));
    await w.submitForm();
    expect(alerts).toEqual(['紹介者特典の希望を入力してください。']);
  });
});
