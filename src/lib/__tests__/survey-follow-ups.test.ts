import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { StaticLotteryGenerator } from '@/lib/static-generator-lottery';
import { normalizeLotteryForm } from '@/lib/lottery-normalizer';
import {
  FOLLOW_UP_OTHER_VALUE,
  SURVEY_FOLLOW_UP_MAX_DEPTH,
  countFollowUpsDeep,
  followUpDepth,
  followUpResponseKeyCandidates,
  followUpTitle,
  getEnabledFollowUps,
  getOptionFollowUps,
  normalizeQuestionFollowUps,
  resolveFollowUpResponseKey,
  setOptionFollowUps,
} from '@/lib/survey-follow-ups';
import { FOLLOW_UP_RUNTIME_JS, renderFollowUpBlocksHtml } from '@/lib/survey-follow-up-runtime-js';
import { collectSurveyOptionTags, countTaggedOptions } from '@/lib/survey-tags';
import type { SurveyConfig, SurveyQuestion, SurveyQuestionOption } from '@/types/survey';

type FuWindow = Window & {
  fuCollect: (qid: string, parentTitle: string, options: unknown, selectedIdx: number[], path: number[], answers: Record<string, string>, display: Record<string, string> | null) => { error: string; title: string } | null;
  fuCollectState: (qid: string, options: unknown, path: number[], state: Record<string, unknown>) => Record<string, unknown>;
  fuRestoreState: (qid: string, options: unknown, path: number[], state: Record<string, unknown>) => void;
  eval: (code: string) => unknown;
  FORM_CONFIG: { entry_rules: { pre_questions: SurveyQuestion[] } };
  collectAnswers: () => { answers?: Record<string, string>; error?: string };
  submitForm: () => Promise<void>;
  alert: (msg: string) => void;
};

async function loadDom(html: string) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return { w: dom.window as unknown as FuWindow, doc: dom.window.document };
}

function click(doc: Document, el: Element | null) {
  if (!el) throw new Error('element not found');
  (el as HTMLElement).dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
}

/** 質問 q2「来店のきっかけ」: 紹介 → 追加質問 2 つ（ご紹介者 / 関係[radio] → 友人 → 追加質問「お友達のお名前」）。Instagram → 追加質問 1 つ */
const nestedQuestion: SurveyQuestion = {
  id: 'q2', type: 'radio', title: '来店のきっかけ', required: false, options: [
    {
      label: '紹介', value: '紹介', tags: ['紹介'],
      follow_ups: [
        { enabled: true, title: 'ご紹介者', type: 'text', required: true },
        {
          enabled: true, title: 'ご紹介者との関係', type: 'radio', options: [
            {
              label: '友人', value: '友人', tags: ['友人紹介'],
              follow_ups: [{ enabled: true, title: 'お友達のお名前', type: 'text' }],
            },
            { label: '家族', value: '家族', tags: ['家族紹介'] },
          ],
        },
        { enabled: false, title: '無効な追加質問', type: 'text' },
      ],
    },
    { label: 'Instagram', value: 'Instagram', follow_up: { enabled: true, title: 'アカウント名', type: 'text' } },
    { label: 'その他', value: 'その他' },
  ],
};

const surveyConfig: SurveyConfig = {
  basic_info: { title: 'ご来店アンケート', liff_id: '', theme_color: '#3B82F6' },
  questions: [
    { id: 'q1', type: 'text', title: 'お名前', required: false },
    { ...nestedQuestion, restore_enabled: true },
  ],
  ui_settings: { submit_button_text: '送信', theme_color: '#3B82F6' },
} as SurveyConfig;

describe('survey-follow-ups（純粋ロジック）', () => {
  it('旧形式 follow_up と新形式 follow_ups の両方を読める', () => {
    expect(getOptionFollowUps({ label: 'a', value: 'a' })).toEqual([]);
    expect(getOptionFollowUps({ label: 'a', value: 'a', follow_up: { enabled: true, title: 'x', type: 'text' } })).toHaveLength(1);
    expect(getOptionFollowUps(nestedQuestion.options![0])).toHaveLength(3);
    expect(getEnabledFollowUps(nestedQuestion.options![0])).toHaveLength(2);
  });

  it('setOptionFollowUps は follow_ups に統一し、旧 follow_up を消す（空なら両方消す）', () => {
    const opt: SurveyQuestionOption = { label: 'a', value: 'a', follow_up: { enabled: true, title: 'x', type: 'text' } };
    const next = setOptionFollowUps(opt, [{ enabled: true, title: 'y', type: 'text' }]);
    expect(next.follow_up).toBeUndefined();
    expect(next.follow_ups).toHaveLength(1);
    const empty = setOptionFollowUps(opt, []);
    expect(empty.follow_up).toBeUndefined();
    expect(empty.follow_ups).toBeUndefined();
  });

  it('normalizeQuestionFollowUps は入れ子も含めて新形式に揃える', () => {
    const [q] = normalizeQuestionFollowUps([nestedQuestion]);
    expect(q.options![1].follow_up).toBeUndefined();
    expect(q.options![1].follow_ups).toHaveLength(1);
    expect(q.options![0].follow_ups).toHaveLength(3);
  });

  it('件数・深さ・上限', () => {
    expect(countFollowUpsDeep(nestedQuestion.options)).toBe(4); // ご紹介者 / 関係 / お友達のお名前 / アカウント名（無効は数えない）
    expect(followUpDepth(nestedQuestion.options)).toBe(2);
    expect(SURVEY_FOLLOW_UP_MAX_DEPTH).toBe(3);
  });

  it('タイトルの既定と回答キーの重複回避', () => {
    expect(followUpTitle({ enabled: true, title: '  ', type: 'text' }, '来店のきっかけ', '紹介')).toBe('来店のきっかけ（紹介）');
    const used = new Set(['ご紹介者', 'ご紹介者（紹介）']);
    expect(resolveFollowUpResponseKey('ご紹介者', '紹介', (k) => used.has(k))).toBe('ご紹介者（紹介） 2');
    expect(resolveFollowUpResponseKey('ご紹介者', '紹介', () => false)).toBe('ご紹介者');
    expect(followUpResponseKeyCandidates('A', 'x', 2)).toEqual(['A', 'A（x）', 'A（x） 2', 'A（x） 3']);
  });
});

describe('renderFollowUpBlocksHtml / FOLLOW_UP_RUNTIME_JS', () => {
  const render = { labelClass: 'follow-up-label', buttonGroupClass: 'button-group', textAs: 'textarea' as const };

  it('複数・入れ子の追加質問を描画し、入れ子は親ブロックの中に入る。無効なものは出さない', () => {
    const html = renderFollowUpBlocksHtml('q2', '来店のきっかけ', nestedQuestion.options, render);
    expect(html).toContain('id="followup-q2-0-0"');
    expect(html).toContain('id="fu-q2-0-0"');
    expect(html).toContain('id="followup-q2-0-1"');
    expect(html).toContain('id="fu-container-q2-0-1"');
    expect(html).toContain('id="followup-q2-0-1-0-0"'); // 入れ子（関係 → 友人 → お友達のお名前）
    expect(html).toContain('data-fu-depth="2"');
    expect(html).toContain('id="followup-q2-1-0"'); // 旧形式 follow_up
    expect(html).not.toContain('無効な追加質問');
    // 入れ子ブロックは親ブロック（followup-q2-0-1）の内側
    const parentStart = html.indexOf('id="followup-q2-0-1"');
    const childStart = html.indexOf('id="followup-q2-0-1-0-0"');
    expect(childStart).toBeGreaterThan(parentStart);
  });

  it('埋め込み JS にバッククォートを含まない（抽選フォームの制約）', () => {
    expect(FOLLOW_UP_RUNTIME_JS).not.toContain('`');
    expect(FOLLOW_UP_RUNTIME_JS).not.toContain('${');
  });
});

describe('アンケート静的 HTML: 複数・入れ子の追加質問', () => {
  const gen = new StaticSurveyGenerator();

  it('選択に応じて追加質問の表示が切り替わり、入れ子は親の選択肢を選んだときだけ表示される', async () => {
    const html = gen.generateHTML(surveyConfig, 'sv1', 'st1');
    const { doc } = await loadDom(html);
    const block = (id: string) => doc.getElementById(id) as HTMLElement;
    expect(block('followup-q2-0-0').style.display).toBe('none');

    // 「紹介」を選ぶ → 追加質問 2 つが表示、入れ子はまだ非表示
    click(doc, doc.querySelector('#container-q2 .choice-button[data-opt-index="0"]'));
    expect(block('followup-q2-0-0').style.display).toBe('block');
    expect(block('followup-q2-0-1').style.display).toBe('block');
    expect(block('followup-q2-0-1-0-0').style.display).toBe('none');
    expect(block('followup-q2-1-0').style.display).toBe('none');

    // 関係で「友人」を選ぶ → 入れ子の追加質問が表示
    click(doc, doc.querySelector('#fu-container-q2-0-1 .choice-button[data-opt-index="0"]'));
    expect(block('followup-q2-0-1-0-0').style.display).toBe('block');

    // 「家族」に変える → 入れ子は非表示
    click(doc, doc.querySelector('#fu-container-q2-0-1 .choice-button[data-opt-index="1"]'));
    expect(block('followup-q2-0-1-0-0').style.display).toBe('none');

    // 親を「Instagram」に変える → 紹介の追加質問はすべて非表示、Instagram の追加質問が表示
    click(doc, doc.querySelector('#container-q2 .choice-button[data-opt-index="1"]'));
    expect(block('followup-q2-0-0').style.display).toBe('none');
    expect(block('followup-q2-0-1').style.display).toBe('none');
    expect(block('followup-q2-1-0').style.display).toBe('block');
  });

  it('fuCollect: 回答を親の直後の順で集め、必須未入力はエラー、入れ子の回答も含む', async () => {
    const html = gen.generateHTML(surveyConfig, 'sv1', 'st1');
    const { w, doc } = await loadDom(html);
    const q = (w.eval('SURVEY_QUESTIONS') as SurveyQuestion[])[1];
    click(doc, doc.querySelector('#container-q2 .choice-button[data-opt-index="0"]'));

    // 必須のご紹介者が空 → エラー
    const answers1: Record<string, string> = { '来店のきっかけ': '紹介' };
    const r1 = w.fuCollect('q2', q.title, q.options, [0], [], answers1, null);
    expect(r1?.error).toBe('ご紹介者を入力してください。');

    (doc.getElementById('fu-q2-0-0') as HTMLTextAreaElement).value = '山田';
    click(doc, doc.querySelector('#fu-container-q2-0-1 .choice-button[data-opt-index="0"]'));
    (doc.getElementById('fu-q2-0-1-0-0') as HTMLTextAreaElement).value = '鈴木';
    const answers2: Record<string, string> = { '来店のきっかけ': '紹介' };
    const r2 = w.fuCollect('q2', q.title, q.options, [0], [], answers2, null);
    expect(r2).toBeNull();
    expect(Object.keys(answers2)).toEqual(['来店のきっかけ', 'ご紹介者', 'ご紹介者との関係', 'お友達のお名前']);
    expect(answers2['ご紹介者との関係']).toBe('友人');
    expect(answers2['お友達のお名前']).toBe('鈴木');
  });

  it('復元用の状態は入れ子も含めて保存・復元できる', async () => {
    const html = gen.generateHTML(surveyConfig, 'sv1', 'st1');
    const { w, doc } = await loadDom(html);
    const q = (w.eval('SURVEY_QUESTIONS') as SurveyQuestion[])[1];
    (doc.getElementById('fu-q2-0-0') as HTMLTextAreaElement).value = '山田';
    click(doc, doc.querySelector('#fu-container-q2-0-1 .choice-button[data-opt-index="0"]'));
    (doc.getElementById('fu-q2-0-1-0-0') as HTMLTextAreaElement).value = '鈴木';
    const state = w.fuCollectState('q2', q.options, [], {});
    expect(state['q2-0-0']).toEqual({ v: '山田' });
    expect(state['q2-0-1']).toEqual({ sel: ['友人'] });
    expect(state['q2-0-1-0-0']).toEqual({ v: '鈴木' });

    // 別の DOM に復元
    const { w: w2, doc: doc2 } = await loadDom(html);
    w2.fuRestoreState('q2', (w2.eval('SURVEY_QUESTIONS') as SurveyQuestion[])[1].options, [], state);
    expect((doc2.getElementById('fu-q2-0-0') as HTMLTextAreaElement).value).toBe('山田');
    expect(doc2.querySelector('#fu-container-q2-0-1 .choice-button[data-opt-index="0"]')!.classList.contains('selected')).toBe(true);
    expect((doc2.getElementById('fu-q2-0-1-0-0') as HTMLTextAreaElement).value).toBe('鈴木');
  });
});

describe('抽選フォーム静的 HTML: 事前質問の複数・入れ子の追加質問', () => {
  const form = normalizeLotteryForm({
    id: 'form1',
    store_id: 'st1',
    status: 'active',
    config: {
      basic_info: { title: 'くじ', liff_id: '1234567890-abcdefgh', theme_color: '#1b2a4e' },
      prizes: [{ id: 'a', name: 'A賞', probability: 10, stock: null }],
      entry_rules: { limit: 'once', require_friend: false, when_sold_out: 'lose', pre_questions: [nestedQuestion] },
    },
  });

  it('入れ子ブロックを描画し、collectAnswers が入れ子の回答と必須エラーを返す', async () => {
    const html = new StaticLotteryGenerator().generateHTML(form, 'preview');
    expect(html).toContain('id="followup-q2-0-1-0-0"');
    const { w, doc } = await loadDom(html);
    click(doc, doc.querySelector('#choices-q2 .choice-button[data-index="0"]'));
    expect((doc.getElementById('followup-q2-0-0') as HTMLElement).style.display).toBe('block');
    expect(w.collectAnswers().error).toBe('「ご紹介者」を入力してください');

    (doc.getElementById('fu-q2-0-0') as HTMLInputElement).value = '山田';
    click(doc, doc.querySelector('#fu-container-q2-0-1 .choice-button[data-opt-index="0"]'));
    expect((doc.getElementById('followup-q2-0-1-0-0') as HTMLElement).style.display).toBe('block');
    (doc.getElementById('fu-q2-0-1-0-0') as HTMLInputElement).value = '鈴木';
    const result = w.collectAnswers();
    expect(result.error).toBeUndefined();
    expect(result.answers).toEqual({
      '来店のきっかけ': '紹介',
      'ご紹介者': '山田',
      'ご紹介者との関係': '友人',
      'お友達のお名前': '鈴木',
    });
  });
});

describe('survey-tags: 追加質問の選択肢のタグ', () => {
  const config = { questions: [nestedQuestion] } as unknown as SurveyConfig;

  it('親と入れ子の選択肢のタグをまとめて集める', () => {
    expect(collectSurveyOptionTags(config, {
      '来店のきっかけ': '紹介',
      'ご紹介者': '山田',
      'ご紹介者との関係': '友人',
      'お友達のお名前': '鈴木',
    })).toEqual(['紹介', '友人紹介']);
    expect(collectSurveyOptionTags(config, { '来店のきっかけ': '紹介', 'ご紹介者との関係': '家族' })).toEqual(['紹介', '家族紹介']);
    // 親が選ばれていなければ追加質問のタグは付けない
    expect(collectSurveyOptionTags(config, { '来店のきっかけ': 'Instagram', 'ご紹介者との関係': '友人' })).toEqual([]);
  });

  it('同名キーの回避（「（選択肢名）」付き）でも拾う', () => {
    const c = {
      questions: [{
        id: 'q', type: 'radio', title: 'A', required: false, options: [{
          label: 'x', value: 'x',
          follow_ups: [{ enabled: true, title: 'A', type: 'radio', options: [{ label: 'y', value: 'y', tags: ['T'] }] }],
        }],
      }],
    } as unknown as SurveyConfig;
    expect(collectSurveyOptionTags(c, { A: 'x', 'A（x）': 'y' })).toEqual(['T']);
  });

  it('countTaggedOptions は入れ子の選択肢も数える', () => {
    expect(countTaggedOptions(config)).toBe(3);
  });
});

describe('追加質問の「その他」とテキスト/画像表示', () => {
  const question: SurveyQuestion = {
    id: 'q3', type: 'radio', title: '興味', required: false, options: [
      {
        label: 'あり', value: 'あり',
        follow_ups: [
          {
            enabled: true, title: '気になるメニュー', type: 'checkbox', allow_other: true,
            options: [{ label: 'カラー', value: 'カラー' }, { label: 'パーマ', value: 'パーマ' }],
            content_blocks: [
              { id: 'b1', type: 'text', text: '[color=#ff0000]複数選べます[/color]', anchor: '', position: 'above' },
              { id: 'b2', type: 'image', image_url: 'https://example.com/a.png', anchor: '', position: 'below' },
              { id: 'b3', type: 'text', text: '   ', anchor: '', position: 'below' },
            ],
          },
          { enabled: true, title: '年代', type: 'select', allow_other: true, options: [{ label: '20代', value: '20代' }] },
        ],
      },
    ],
  };
  const config: SurveyConfig = {
    basic_info: { title: 'テスト', liff_id: '', theme_color: '#3B82F6' },
    questions: [question],
    ui_settings: { submit_button_text: '送信', theme_color: '#3B82F6' },
  } as SurveyConfig;

  it('内部値は各ジェネレータの OTHER_OPTION_VALUE と同じ', () => {
    expect(FOLLOW_UP_OTHER_VALUE).toBe(StaticSurveyGenerator.OTHER_OPTION_VALUE);
    expect(FOLLOW_UP_OTHER_VALUE).toBe(StaticLotteryGenerator.OTHER_OPTION_VALUE);
  });

  it('「その他」ボタン / option と理由欄、上下のテキスト・画像ブロックを描画する（空のテキストは出さない）', () => {
    const html = renderFollowUpBlocksHtml('q3', '興味', question.options, { labelClass: 'l', buttonGroupClass: 'g', textAs: 'textarea' });
    expect(html).toContain('data-other="1"');
    expect(html).toContain('id="fu-other-block-q3-0-0"');
    expect(html).toContain('id="fu-other-q3-0-0"');
    expect(html).toContain('<option value="__other__">その他</option>');
    expect(html).toContain('id="fu-other-block-q3-0-1"');
    expect(html).toContain('複数選べます');
    expect(html).toContain('color:#ff0000');
    expect(html).toContain('<img src="https://example.com/a.png"');
    expect((html.match(/content-block-text/g) || []).length).toBe(1);
    // 上のブロックは見出しより前、下のブロックは入力欄より後
    expect(html.indexOf('複数選べます')).toBeLessThan(html.indexOf('気になるメニュー'));
    expect(html.indexOf('a.png')).toBeGreaterThan(html.indexOf('fu-container-q3-0-0'));
  });

  it('その他を選ぶと理由欄が出て、送信値は「その他（理由）」になる（ボタン / ドロップダウン）', async () => {
    const html = new StaticSurveyGenerator().generateHTML(config, 'sv1', 'st1');
    const { w, doc } = await loadDom(html);
    const q = (w.eval('SURVEY_QUESTIONS') as SurveyQuestion[])[0];
    click(doc, doc.querySelector('#container-q3 .choice-button[data-opt-index="0"]'));
    const otherBlock = doc.getElementById('fu-other-block-q3-0-0') as HTMLElement;
    expect(otherBlock.style.display).toBe('none');

    click(doc, doc.querySelector('#fu-container-q3-0-0 .choice-button[data-opt-index="0"]'));
    click(doc, doc.querySelector('#fu-container-q3-0-0 .choice-button[data-other]'));
    expect(otherBlock.style.display).toBe('block');
    (doc.getElementById('fu-other-q3-0-0') as HTMLTextAreaElement).value = 'トリートメント';

    const sel = doc.getElementById('fu-q3-0-1') as HTMLSelectElement;
    sel.value = '__other__';
    sel.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    expect((doc.getElementById('fu-other-block-q3-0-1') as HTMLElement).style.display).toBe('block');

    const answers: Record<string, string> = { '興味': 'あり' };
    expect(w.fuCollect('q3', q.title, q.options, [0], [], answers, null)).toBeNull();
    expect(answers['気になるメニュー']).toBe('カラー, その他（トリートメント）');
    expect(answers['年代']).toBe('その他');

    // 復元状態に理由が含まれる
    const state = w.fuCollectState('q3', q.options, [], {});
    expect(state['q3-0-0']).toEqual({ sel: ['カラー', '__other__'], r: 'トリートメント' });

    // その他を外すと理由欄が消える
    click(doc, doc.querySelector('#fu-container-q3-0-0 .choice-button[data-other]'));
    expect(otherBlock.style.display).toBe('none');
  });
});
