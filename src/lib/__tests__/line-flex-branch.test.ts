import { describe, expect, it } from 'vitest';
import {
  buildPostbackData,
  choiceLink,
  hasBranchLinks,
  instrumentFlexBranches,
  isBranchLink,
  nextLink,
  normalizeBranchTags,
  parseChoiceLink,
  parseNextLink,
  parsePostbackData,
  summarizeBranchAnswers,
} from '@/lib/line-flex-branch';
import {
  buildScenarioFlex,
  buildScenarioNodeFlex,
  collectScenarioChoices,
  defaultScenarioData,
  describeScenario,
  listScenarioNodes,
  updateScenarioQuestion,
  updateScenarioResult,
  validateScenario,
} from '@/lib/line-flex-scenario';
import { buildTemplateFlex, isFlexActionUrl, validateFlexContents } from '@/lib/line-flex-templates';
import type { FlexContainer, ScenarioData } from '@/types/line-flex';

const MSG = 'abcdefghij12';
const OTHER = 'otherotherot';

describe('分岐ボタンのリンク先の書き方', () => {
  it('next: メッセージ ID とタグを往復できる', () => {
    expect(nextLink(OTHER)).toBe(`next:${OTHER}`);
    const link = nextLink(OTHER, ['カット', 'A&B', 'カット']);
    expect(parseNextLink(link)).toEqual({ messageId: OTHER, tags: ['カット', 'A&B'] });
    expect(parseNextLink('next:short')).toBeNull();
    expect(parseNextLink('https://example.com')).toBeNull();
  });
  it('choice: / isBranchLink / ボタンのリンク先として通る', () => {
    expect(parseChoiceLink(choiceLink('c1'))).toBe('c1');
    expect(parseChoiceLink('choice:a b')).toBeNull();
    expect(isBranchLink(nextLink(OTHER))).toBe(true);
    expect(isBranchLink('https://a')).toBe(false);
    expect(isFlexActionUrl(nextLink(OTHER, ['x']))).toBe(true);
    expect(isFlexActionUrl('next:bad')).toBe(false);
  });
  it('タグは 30 文字・5 個まで、重複と空は除く', () => {
    expect(normalizeBranchTags('a, b、a,,c')).toEqual(['a', 'b', 'c']);
    expect(normalizeBranchTags(['1', '2', '3', '4', '5', '6'])).toHaveLength(5);
    expect(normalizeBranchTags(['x'.repeat(40)])[0]).toHaveLength(30);
  });
  it('postback の data を往復できる。形式が違うものは対象外', () => {
    expect(parsePostbackData(buildPostbackData(MSG, 'b1'))).toEqual({ messageId: MSG, key: 'b1' });
    expect(parsePostbackData('lf:short:b1')).toBeNull();
    expect(parsePostbackData(`lf:${MSG}:b1:extra`)).toBeNull();
    expect(parsePostbackData('action=cancel')).toBeNull();
  });
});

describe('instrumentFlexBranches', () => {
  const contents: FlexContainer = {
    type: 'bubble',
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'button', action: { type: 'uri', label: 'はい', uri: nextLink(OTHER, ['興味あり']) } },
        { type: 'button', action: { type: 'uri', label: '予約', uri: 'https://liff.line.me/1-a' } },
        { type: 'button', action: { type: 'uri', label: '選択肢', uri: choiceLink('c1') } },
      ],
    },
  };
  it('next: / choice: のボタンを postback に置き換え、対応表を作る。https のボタンはそのまま', () => {
    expect(hasBranchLinks(contents)).toBe(true);
    const r = instrumentFlexBranches(contents, MSG, { showText: true, choices: { c1: { label: '選択肢', question: '質問', tags: ['t'], next: { type: 'node', key: 'q1' } } } });
    const buttons = (r.contents.footer as { contents: Array<{ action: Record<string, unknown> }> }).contents.map((b) => b.action);
    expect(buttons[0]).toEqual({ type: 'postback', label: 'はい', data: `lf:${MSG}:b1`, displayText: 'はい' });
    expect(buttons[1]).toEqual({ type: 'uri', label: '予約', uri: 'https://liff.line.me/1-a' });
    expect(buttons[2]).toEqual({ type: 'postback', label: '選択肢', data: `lf:${MSG}:c1`, displayText: '選択肢' });
    expect(r.branches).toEqual({
      b1: { label: 'はい', question: '', tags: ['興味あり'], next: { type: 'message', id: OTHER } },
      c1: { label: '選択肢', question: '質問', tags: ['t'], next: { type: 'node', key: 'q1' } },
    });
    expect(r.nextIndex).toBe(1);
    // 元の contents は変えない
    expect(hasBranchLinks(contents)).toBe(true);
    expect(hasBranchLinks(r.contents)).toBe(false);
  });
  it('トーク表示 OFF なら displayText を付けない。番号は続きから振れる', () => {
    const r = instrumentFlexBranches(contents, MSG, { showText: false, startIndex: 3 });
    const first = (r.contents.footer as { contents: Array<{ action: Record<string, unknown> }> }).contents[0].action;
    expect(first.displayText).toBeUndefined();
    expect(first.data).toBe(`lf:${MSG}:b4`);
  });
});

describe('分岐アンケート（scenario）', () => {
  const data = (): ScenarioData => ({
    color: '#112233',
    root: {
      key: 'q0',
      title: '髪の悩みは？',
      text: '選んでください',
      choices: [
        { key: 'c1', label: 'パサつき', tags: ['悩み:パサつき'], then: { type: 'question', question: { key: 'q1', title: '長さは？', choices: [{ key: 'c3', label: 'ロング', then: { type: 'result', result: { key: 'r1', title: 'トリートメントがおすすめ', button: { key: 'b', label: '予約する', url: 'https://liff.line.me/1-a' } } } }, { key: 'c4', label: 'ショート', then: { type: 'none' } }] } } },
        { key: 'c2', label: 'くせ毛', then: { type: 'message', message_id: OTHER } },
      ],
    },
  });

  it('最初の質問のカードが Flex 本体になる（選択肢 = ボタン）', () => {
    const flex = buildScenarioFlex(data())!;
    expect(validateFlexContents(flex)).toBeNull();
    expect(buildTemplateFlex('scenario', data())).toEqual(flex);
    const buttons = (flex.footer as { contents: Array<{ color: string; action: { label: string; uri: string } }> }).contents;
    expect(buttons.map((b) => [b.action.label, b.action.uri])).toEqual([['パサつき', 'choice:c1'], ['くせ毛', 'choice:c2']]);
    expect(buttons[0].color).toBe('#112233');
  });
  it('listScenarioNodes / buildScenarioNodeFlex / describeScenario', () => {
    const nodes = listScenarioNodes(data());
    expect(nodes.map((n) => `${n.kind}:${n.key}:${n.depth}`)).toEqual(['question:q0:1', 'question:q1:2', 'result:r1:3']);
    const result = buildScenarioNodeFlex(data(), 'r1')!;
    expect((result.footer as { contents: Array<{ action: { uri: string } }> }).contents[0].action.uri).toBe('https://liff.line.me/1-a');
    expect(buildScenarioNodeFlex(data(), 'nope')).toBeNull();
    expect(describeScenario(data())).toBe('質問 2 ・ 結果 1');
  });
  it('collectScenarioChoices: 選択肢ごとの質問文・タグ・次', () => {
    expect(collectScenarioChoices(data())).toEqual({
      c1: { label: 'パサつき', question: '髪の悩みは？', tags: ['悩み:パサつき'], next: { type: 'node', key: 'q1' } },
      c3: { label: 'ロング', question: '長さは？', tags: [], next: { type: 'node', key: 'r1' } },
      c4: { label: 'ショート', question: '長さは？', tags: [], next: { type: 'none' } },
      c2: { label: 'くせ毛', question: '髪の悩みは？', tags: [], next: { type: 'message', id: OTHER } },
    });
  });
  it('validateScenario', () => {
    expect(validateScenario(data(), new Set([OTHER]))).toBeNull();
    expect(validateScenario(data(), new Set())).toContain('見つかりません');
    expect(validateScenario(defaultScenarioData())).toBeNull();
    expect(validateScenario(updateScenarioQuestion(data(), 'q0', (q) => ({ ...q, title: ' ' })))).toContain('最初の質問文');
    expect(validateScenario(updateScenarioQuestion(data(), 'q1', (q) => ({ ...q, choices: [] })))).toContain('選択肢を 1 つ以上');
    expect(validateScenario(updateScenarioQuestion(data(), 'q1', (q) => ({ ...q, choices: [{ key: 'x', label: '', then: { type: 'none' } }] })))).toContain('文言');
    expect(validateScenario(updateScenarioResult(data(), 'r1', (r) => ({ ...r, title: '', text: '' })))).toContain('結果');
    expect(validateScenario(null)).toBeTruthy();
  });
  it('深さは 5 段まで', () => {
    let d = defaultScenarioData();
    d = { ...d, root: { key: 'q0', title: 'Q', choices: [{ key: 'c0', label: 'a', then: { type: 'none' } }] } };
    let key = 'q0';
    for (let i = 1; i <= 5; i++) {
      const childKey = `q${i}`;
      d = updateScenarioQuestion(d, key, (q) => ({ ...q, choices: [{ key: `k${i}`, label: 'a', then: { type: 'question', question: { key: childKey, title: 'Q', choices: [{ key: `e${i}`, label: 'a', then: { type: 'none' } }] } } }] }));
      key = childKey;
      expect(validateScenario(d) === null).toBe(i <= 4);
    }
  });
});

describe('summarizeBranchAnswers', () => {
  const branches = {
    c1: { label: 'A', question: '質問 1', tags: [], next: { type: 'none' as const } },
    c2: { label: 'B', question: '質問 1', tags: [], next: { type: 'none' as const } },
    b1: { label: '詳しく', question: '', tags: [], next: { type: 'message' as const, id: OTHER } },
  };
  it('質問ごとに回数と人数をまとめる（同じ人の押し直しは 1 人）。消えた選択肢の回答も残す', () => {
    const rows = [
      { button_key: 'c1', question: '質問 1', label: 'A', line_user_id: 'U1' },
      { button_key: 'c1', question: '質問 1', label: 'A', line_user_id: 'U1' },
      { button_key: 'c1', question: '質問 1', label: 'A', line_user_id: 'U2' },
      { button_key: 'b1', question: '', label: '詳しく', line_user_id: 'U3' },
      { button_key: 'old', question: '質問 1', label: '昔の選択肢', line_user_id: 'U1' },
    ];
    const s = summarizeBranchAnswers(branches, rows);
    expect(s.respondents).toBe(3);
    expect(s.taps).toBe(5);
    expect(s.groups).toEqual([
      { question: '質問 1', choices: [{ key: 'c1', label: 'A', taps: 3, users: 2 }, { key: 'c2', label: 'B', taps: 0, users: 0 }, { key: 'old', label: '昔の選択肢', taps: 1, users: 1, removed: true }] },
      { question: '', choices: [{ key: 'b1', label: '詳しく', taps: 1, users: 1 }] },
    ]);
  });
  it('回答が無くても選択肢は 0 で並ぶ', () => {
    const s = summarizeBranchAnswers(branches, []);
    expect(s.respondents).toBe(0);
    expect(s.groups[0].choices.map((c) => c.users)).toEqual([0, 0]);
  });
});
