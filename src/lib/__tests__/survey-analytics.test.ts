import { describe, expect, it } from 'vitest';
import { computeCustomerSurveyStats, computeSurveyAnalytics, splitChoiceAnswer, type SurveyAnalyticsForm, type SurveyAnalyticsResponse } from '@/lib/survey-analytics';
import type { SurveyQuestion } from '@/types/survey';

const NOW = new Date('2026-11-26T03:00:00Z');
const q = (patch: Partial<SurveyQuestion>): SurveyQuestion => ({ id: 'q', type: 'text', title: '質問', required: false, ...patch });
const opts = (...labels: string[]) => labels.map((l) => ({ label: l, value: l }));

const FORM_A: SurveyAnalyticsForm = {
  id: 'A',
  name: 'カウンセリング',
  questions: [
    q({ id: 'q1', type: 'radio', title: 'きっかけ', options: opts('紹介', 'SNS', 'チラシ'), allow_other: true }),
    q({ id: 'q2', type: 'checkbox', title: '気になること', options: opts('肩こり', '腰痛', 'むくみ') }),
    q({ id: 'q3', type: 'textarea', title: 'ご要望' }),
    q({ id: 'q4', type: 'birthday', title: 'お誕生日' }),
    q({ id: 'q5', type: 'address', title: 'ご住所' }),
    q({ id: 'q6', type: 'date', title: '希望日' }),
  ],
};
const FORM_B: SurveyAnalyticsForm = { id: 'B', name: '満足度', questions: [q({ id: 'b1', type: 'select', title: '満足度', options: opts('満足', '普通', '不満') })] };

let seq = 0;
const res = (form: string, user: string | null, at: string, answers: Record<string, unknown>): SurveyAnalyticsResponse => ({ id: `r${++seq}`, survey_form_id: form, line_user_id: user, submitted_at: at, answers });

const RESPONSES = [
  res('A', 'U1', '2026-11-01T01:00:00Z', { きっかけ: '紹介', 気になること: '肩こり, 腰痛', ご要望: '静かな席', お誕生日: '1990-04-05', ご住所: '〒150-0001 東京都渋谷区神宮前1-2-3', ご紹介者: '田中さん' }),
  res('A', 'U2', '2026-11-02T02:00:00Z', { きっかけ: 'SNS', 気になること: '肩こり', ご要望: '', お誕生日: '2000-12-31', ご住所: '神奈川県横浜市1-1' }),
  res('A', 'U1', '2026-11-10T15:30:00Z', { きっかけ: 'その他（看板）', 気になること: '', ご要望: '窓ぎわ' }),
  res('A', null, '2026-10-31T16:00:00Z', { きっかけ: '紹介', ご紹介者: '田中さん' }),
  res('B', 'U3', '2026-11-05T03:00:00Z', { 満足度: '満足' }),
  res('B', 'U1', '2026-09-01T03:00:00Z', { 満足度: '不満' }),
];

describe('選択式の回答を分ける', () => {
  it('複数選択は ", " で分ける。その他（理由）は「その他」にまとめる', () => {
    expect(splitChoiceAnswer('checkbox', '肩こり, 腰痛', opts('肩こり', '腰痛'))).toEqual(['肩こり', '腰痛']);
    expect(splitChoiceAnswer('radio', 'その他（看板）', opts('紹介'))).toEqual(['その他']);
    expect(splitChoiceAnswer('checkbox', ['肩こり', '肩こり'], opts('肩こり'))).toEqual(['肩こり']);
    expect(splitChoiceAnswer('radio', '', opts('紹介'))).toEqual([]);
  });

  it('名前に ", " を含む選択肢は、分けずにそのまま数える', () => {
    expect(splitChoiceAnswer('checkbox', '首, 肩', opts('首, 肩', '腰'))).toEqual(['首, 肩']);
    expect(splitChoiceAnswer('radio', '首, 肩', opts('腰'))).toEqual(['首, 肩']);
  });
});

describe('アンケートの分析', () => {
  it('回答数・回答した人数・2 回以上答えた人・フォーム別', () => {
    const a = computeSurveyAnalytics(RESPONSES, [FORM_A, FORM_B], { now: NOW });
    expect(a.summary).toMatchObject({ total: 6, respondents: 4, repeat_respondents: 1, anonymous: 1, linked_customers: null, last_submitted_at: '2026-11-10T15:30:00Z' });
    expect(a.by_form).toEqual([
      { form_id: 'A', name: 'カウンセリング', count: 4, respondents: 3, last_submitted_at: '2026-11-10T15:30:00Z' },
      { form_id: 'B', name: '満足度', count: 2, respondents: 2, last_submitted_at: '2026-11-05T03:00:00Z' },
    ]);
    expect(a.questions).toBeNull();
  });

  it('期間は回答した日（日本時間）。10/31 16:00 UTC は 11/1', () => {
    const a = computeSurveyAnalytics(RESPONSES, [FORM_A, FORM_B], { dateFrom: '2026-11-01', dateTo: '2026-11-30', now: NOW });
    expect(a.summary.total).toBe(5);
    expect(a.monthly).toEqual([{ month: '2026-11', count: 5 }]);
    expect(a.daily.find((d) => d.date === '2026-11-01')?.count).toBe(2);
    // 11/10 15:30 UTC = 11/11 00:30 JST（水曜・0 時台）
    expect(a.daily.find((d) => d.date === '2026-11-11')?.count).toBe(1);
    expect(a.hourly[0].count).toBe(1);
    expect(a.weekday.find((w) => w.label === '水')?.count).toBe(1);
  });

  it('フォームで絞り込んでも、フォーム別の一覧は全フォームぶん。回答 0 件のフォームも出す', () => {
    const a = computeSurveyAnalytics(RESPONSES, [FORM_A, FORM_B, { id: 'C', name: '新しいアンケート', questions: [] }], { formId: 'B', now: NOW });
    expect(a.summary.total).toBe(2);
    expect(a.by_form.map((f) => [f.form_id, f.count])).toEqual([['A', 4], ['B', 2], ['C', 0]]);
  });

  it('消えたフォームの回答は「削除されたアンケート」', () => {
    const a = computeSurveyAnalytics([res('X', 'U9', '2026-11-01T00:00:00Z', {})], [FORM_A], { now: NOW });
    expect(a.by_form.find((f) => f.form_id === 'X')?.name).toBe('削除されたアンケート');
  });

  it('回答者のうち顧客として登録されている人数', () => {
    expect(computeSurveyAnalytics(RESPONSES, [FORM_A, FORM_B], { customerLineIds: ['U1', 'U3', 'U8'], now: NOW }).summary.linked_customers).toBe(2);
  });

  describe('質問ごとの集計（フォームを 1 つ選んだとき）', () => {
    const a = computeSurveyAnalytics(RESPONSES, [FORM_A, FORM_B], { formId: 'A', now: NOW });
    const stat = (title: string) => a.questions!.find((s) => s.title === title)!;

    it('単一選択: 選択肢ごとの数と割合。選ばれなかった選択肢も 0 件で出す', () => {
      expect(stat('きっかけ')).toMatchObject({ kind: 'choice', answered: 4, answer_rate: 100 });
      expect(stat('きっかけ').rows).toEqual([
        { label: '紹介', count: 2, percent: 50 },
        { label: 'SNS', count: 1, percent: 25 },
        { label: 'その他', count: 1, percent: 25 },
        { label: 'チラシ', count: 0, percent: 0 },
      ]);
    });

    it('複数選択: 分母は、その質問に答えた回答数', () => {
      expect(stat('気になること')).toMatchObject({ answered: 2, answer_rate: 50 });
      expect(stat('気になること').rows).toEqual([
        { label: '肩こり', count: 2, percent: 100 },
        { label: '腰痛', count: 1, percent: 50 },
        { label: 'むくみ', count: 0, percent: 0 },
      ]);
    });

    it('自由記述: 回答数と、最近の回答（新しい順）', () => {
      expect(stat('ご要望')).toMatchObject({ kind: 'text', answered: 2 });
      expect(stat('ご要望').samples?.map((s) => s.text)).toEqual(['窓ぎわ', '静かな席']);
    });

    it('誕生日: 年代と平均年齢', () => {
      const s = stat('お誕生日');
      expect(s.kind).toBe('age');
      expect(s.rows?.filter((r) => r.count > 0)).toEqual([{ label: '20代', count: 1, percent: 50 }, { label: '30代', count: 1, percent: 50 }]);
      // 1990-04-05 → 36 歳 / 2000-12-31 → 25 歳（2026-11-26 時点）
      expect(s.average_age).toBe(30.5);
    });

    it('住所: 都道府県', () => {
      expect(stat('ご住所').rows).toEqual([{ label: '東京都', count: 1, percent: 50 }, { label: '神奈川県', count: 1, percent: 50 }]);
    });

    it('日付などは回答数だけ', () => {
      expect(stat('希望日')).toMatchObject({ kind: 'other', answered: 0, answer_rate: 0 });
    });

    it('質問の一覧に無い回答（追加質問など）は「そのほかの回答項目」', () => {
      expect(stat('ご紹介者')).toMatchObject({ extra: true, kind: 'choice', answered: 2 });
      expect(stat('ご紹介者').rows).toEqual([{ label: '田中さん', count: 2, percent: 100 }]);
    });
  });

  it('壊れた回答（日時が読めない）は数えない', () => {
    expect(computeSurveyAnalytics([res('A', 'U1', 'x', {})], [FORM_A], { now: NOW }).summary.total).toBe(0);
  });
});

describe('顧客分析のアンケート', () => {
  const customers = [
    { id: 'c1', line_user_id: 'U1', total_visits: 10, total_spent: 60000 },
    { id: 'c2', line_user_id: 'U2', total_visits: 2, total_spent: 10000 },
    { id: 'c3', line_user_id: 'U5', total_visits: 1, total_spent: 4000 },
    { id: 'c4', line_user_id: null, total_visits: 3, total_spent: 9000 },
  ];
  const seg = (c: { total_visits?: number | null }) => ((c.total_visits ?? 0) >= 10 ? 'vip' : (c.total_visits ?? 0) >= 2 ? 'repeat' : 'new') as 'vip' | 'repeat' | 'new';
  const s = computeCustomerSurveyStats(customers, RESPONSES, [FORM_A, FORM_B], seg);

  it('分母は LINE と連携している顧客', () => {
    expect(s).toMatchObject({ total_customers: 4, line_linked: 3, responded: 2, response_rate: 67, unregistered_respondents: 1 });
  });

  it('アンケートごとの、回答した顧客の数', () => {
    expect(s.by_form).toEqual([{ form_id: 'A', name: 'カウンセリング', customers: 2, rate: 67 }, { form_id: 'B', name: '満足度', customers: 1, rate: 33 }]);
  });

  it('セグメントごとの回答率', () => {
    expect(s.by_segment.find((r) => r.segment === 'vip')).toEqual({ segment: 'vip', label: 'VIP', customers: 1, responded: 1, rate: 100 });
    expect(s.by_segment.find((r) => r.segment === 'new')).toMatchObject({ customers: 1, responded: 0, rate: 0 });
  });

  it('回答した人 / していない人の、平均の来店回数と利用額', () => {
    expect(s.compare.responded).toEqual({ customers: 2, avg_visits: 6, avg_spent: 35000 });
    expect(s.compare.not_responded).toEqual({ customers: 1, avg_visits: 1, avg_spent: 4000 });
  });

  it('LINE と連携した顧客が居ないとき、回答率は null', () => {
    expect(computeCustomerSurveyStats([{ id: 'c', line_user_id: null }], RESPONSES, [FORM_A], seg).response_rate).toBeNull();
  });
});
