import { describe, expect, it } from 'vitest';
import {
  computeHiddenSurveyQuestionIds,
  decodeTriggerKey,
  encodeTriggerKey,
  findFollowUpByPath,
  listSurveyTriggerChoices,
  sanitizeSurveyShowTriggers,
} from '@/lib/survey-visibility';
import type { SurveyQuestion } from '@/types/survey';

const q1: SurveyQuestion = {
  id: 'q1', type: 'radio', title: '来店のきっかけ', required: false, allow_other: true, options: [
    {
      label: '紹介', value: '紹介',
      follow_ups: [
        { enabled: true, title: 'ご紹介者との関係', type: 'radio', allow_other: true, options: [{ label: '友人', value: '友人' }, { label: '家族', value: '家族' }] },
        { enabled: false, title: '無効な追加質問', type: 'radio', options: [{ label: 'X', value: 'X' }] },
        { enabled: true, title: 'ご紹介者のお名前', type: 'text' },
      ],
    },
    { label: 'Instagram', value: 'Instagram' },
  ],
};
const q2: SurveyQuestion = { id: 'q2', type: 'text', title: '紹介者特典の希望', required: true, hidden_by_default: true, show_triggers: [{ question_id: 'q1', value: '紹介' }] };
const q3: SurveyQuestion = {
  id: 'q3', type: 'textarea', title: 'お友達へのメッセージ', required: false, hidden_by_default: true,
  show_triggers: [{ question_id: 'q1', path: [0, 0], value: '友人' }, { question_id: 'q2', value: 'x' }],
};

describe('survey-visibility: トリガー候補の列挙', () => {
  it('質問自身の選択肢 + 有効な追加質問（選択型）の選択肢 + その他 を列挙する', () => {
    const choices = listSurveyTriggerChoices(q1);
    expect(choices.map((c) => c.label)).toEqual([
      '紹介',
      '紹介 › ご紹介者との関係: 友人',
      '紹介 › ご紹介者との関係: 家族',
      '紹介 › ご紹介者との関係: その他',
      'Instagram',
      'その他',
    ]);
    expect(choices[1].path).toEqual([0, 0]);
    expect(choices[3].value).toBe('__other__');
    expect(choices[5]).toMatchObject({ path: [], value: '__other__' });
  });

  it('選択肢を持たない質問は候補なし', () => {
    expect(listSurveyTriggerChoices(q2)).toEqual([]);
  });

  it('key は path + value を往復できる', () => {
    const key = encodeTriggerKey([0, 0], '友人');
    expect(decodeTriggerKey(key)).toEqual({ path: [0, 0], value: '友人' });
    expect(decodeTriggerKey('broken')).toBeNull();
  });

  it('findFollowUpByPath は有効な追加質問だけを数えた index でたどる', () => {
    expect(findFollowUpByPath(q1, [0, 0])?.title).toBe('ご紹介者との関係');
    expect(findFollowUpByPath(q1, [0, 1])?.title).toBe('ご紹介者のお名前');
    expect(findFollowUpByPath(q1, [5, 0])).toBeNull();
  });
});

describe('survey-visibility: 設定の正規化', () => {
  it('存在しない質問・自分自身・空の値を除き、空 path は省く', () => {
    const out = sanitizeSurveyShowTriggers(
      [
        { question_id: 'q1', value: '紹介', path: [] },
        { question_id: 'q3', value: 'self' },
        { question_id: 'nope', value: 'x' },
        { question_id: 'q1', value: '' },
        { question_id: 'q1', path: [0, 0], value: '友人' },
        'junk',
      ],
      'q3',
      [q1, q2, q3],
    );
    expect(out).toEqual([{ question_id: 'q1', value: '紹介' }, { question_id: 'q1', path: [0, 0], value: '友人' }]);
  });
});

describe('survey-visibility: 非表示判定', () => {
  const questions = [q1, q2, q3];
  const sel = (map: Record<string, string[]>) => (qid: string, path: number[]) => map[qid + ':' + path.join('-')] || [];

  it('トリガー未成立なら非表示、成立すれば表示', () => {
    expect(computeHiddenSurveyQuestionIds(questions, sel({}))).toEqual(['q2', 'q3']);
    expect(computeHiddenSurveyQuestionIds(questions, sel({ 'q1:': ['紹介'] }))).toEqual(['q3']);
  });

  it('追加質問の選択肢もトリガーになる（any）', () => {
    expect(computeHiddenSurveyQuestionIds(questions, sel({ 'q1:': ['紹介'], 'q1:0-0': ['友人'] }))).toEqual([]);
  });

  it('all モードはすべて成立したときだけ表示', () => {
    const strict: SurveyQuestion = { ...q3, show_triggers_mode: 'all' };
    expect(computeHiddenSurveyQuestionIds([q1, q2, strict], sel({ 'q1:': ['紹介'], 'q1:0-0': ['友人'] }))).toEqual(['q3']);
    expect(computeHiddenSurveyQuestionIds([q1, q2, strict], sel({ 'q1:': ['紹介'], 'q1:0-0': ['友人'], 'q2:': ['x'] }))).toEqual([]);
  });

  it('トリガー元の質問が非表示なら連鎖して非表示', () => {
    const q4: SurveyQuestion = { id: 'q4', type: 'text', title: '連鎖', required: false, hidden_by_default: true, show_triggers: [{ question_id: 'q2', value: 'x' }] };
    // q2 は q1=紹介 が無いので非表示 → q2 の選択値があっても q4 は非表示
    expect(computeHiddenSurveyQuestionIds([q1, q2, q4], sel({ 'q2:': ['x'] }))).toEqual(['q2', 'q4']);
    expect(computeHiddenSurveyQuestionIds([q1, q2, q4], sel({ 'q1:': ['紹介'], 'q2:': ['x'] }))).toEqual([]);
  });

  it('トリガーが 1 件も無い非表示質問は常に非表示', () => {
    const q5: SurveyQuestion = { id: 'q5', type: 'text', title: 'なし', required: false, hidden_by_default: true, show_triggers: [] };
    expect(computeHiddenSurveyQuestionIds([q5], sel({}))).toEqual(['q5']);
  });
});
