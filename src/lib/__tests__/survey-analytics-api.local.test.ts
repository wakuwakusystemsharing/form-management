/**
 * アンケートの分析 API・顧客分析のアンケート API（local = JSON）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let analytics: typeof import('@/app/api/stores/[storeId]/surveys/analytics/route');
let customerSurvey: typeof import('@/app/api/stores/[storeId]/customers/survey-analytics/route');

const STORE = 'st0001';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const params = { params: Promise.resolve({ storeId: STORE }) };
const get = async (qs = '') => {
  const res = await analytics.GET(new Request(`http://localhost/api/stores/${STORE}/surveys/analytics${qs}`), params);
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-analytics-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(
    dataFile(`surveys_${STORE}.json`),
    JSON.stringify([
      { id: 'A', store_id: STORE, config: { basic_info: { title: 'カウンセリング' }, questions: [{ id: 'q1', type: 'radio', title: 'きっかけ', required: false, options: [{ label: '紹介', value: '紹介' }, { label: 'SNS', value: 'SNS' }] }] } },
      { id: 'B', store_id: STORE, config: { basic_info: { title: '満足度' }, questions: [] } },
    ])
  );
  fs.writeFileSync(
    dataFile('survey_responses.json'),
    JSON.stringify([
      { id: 'r1', store_id: STORE, survey_form_id: 'A', line_user_id: 'U1', submitted_at: '2026-11-01T01:00:00Z', responses: { きっかけ: '紹介' } },
      { id: 'r2', store_id: STORE, survey_form_id: 'A', line_user_id: 'U2', submitted_at: '2026-11-02T01:00:00Z', responses: { きっかけ: 'SNS' } },
      { id: 'r3', store_id: STORE, survey_form_id: 'B', line_user_id: 'U1', submitted_at: '2026-10-02T01:00:00Z', responses: {} },
      { id: 'r4', store_id: 'st0002', survey_form_id: 'Z', line_user_id: 'U9', submitted_at: '2026-11-02T01:00:00Z', responses: { きっかけ: '紹介' } },
    ])
  );
  fs.writeFileSync(
    dataFile('customers.json'),
    JSON.stringify([
      { id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子', total_visits: 4, total_spent: 20000 },
      { id: 'c2', store_id: STORE, line_user_id: 'U5', name: '佐藤', total_visits: 1, total_spent: 5000 },
      { id: 'c3', store_id: STORE, line_user_id: 'U2', name: '友だち', line_friend_only: true },
      { id: 'c4', store_id: 'st0002', line_user_id: 'U9', name: '別の店の人' },
    ])
  );
  analytics = await import('@/app/api/stores/[storeId]/surveys/analytics/route');
  customerSurvey = await import('@/app/api/stores/[storeId]/customers/survey-analytics/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/stores/{storeId}/surveys/analytics', () => {
  it('その店舗の回答だけを集計する。フォームの一覧と、顧客として登録されている回答者の数を返す', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.summary).toMatchObject({ total: 3, respondents: 2, linked_customers: 1 });
    expect(body.forms).toEqual([{ id: 'A', name: 'カウンセリング' }, { id: 'B', name: '満足度' }]);
    expect(body.by_form.map((f: { form_id: string; count: number }) => [f.form_id, f.count])).toEqual([['A', 2], ['B', 1]]);
    expect(body.questions).toBeNull();
  });

  it('期間（回答した日）とフォームで絞り込む。フォームを選ぶと質問ごとの集計が付く', async () => {
    const { body } = await get('?date_from=2026-11-01&date_to=2026-11-30&form_id=A');
    expect(body.summary.total).toBe(2);
    expect(body.period).toEqual({ date_from: '2026-11-01', date_to: '2026-11-30' });
    expect(body.questions[0]).toMatchObject({ title: 'きっかけ', kind: 'choice', answered: 2 });
    expect(body.questions[0].rows).toEqual([{ label: '紹介', count: 1, percent: 50 }, { label: 'SNS', count: 1, percent: 50 }]);
  });

  it('LINE のユーザー ID・お客様の名前を返さない', async () => {
    const text = JSON.stringify((await get('?form_id=A')).body);
    expect(text).not.toMatch(/"U1"|"U2"|line_user_id|山田/);
  });

  it('日付の形がおかしいときは 400', async () => {
    const { status, body } = await get('?date_from=2026/11/01');
    expect(status).toBe(400);
    expect(body.error).toContain('YYYY-MM-DD');
  });
});

describe('GET /api/stores/{storeId}/customers/survey-analytics', () => {
  it('友だちだけの顧客・ほかの店舗の顧客は数えない', async () => {
    const res = await customerSurvey.GET(new Request(`http://localhost/api/stores/${STORE}/customers/survey-analytics`), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total_customers: 2, line_linked: 2, responded: 1, response_rate: 50, unregistered_respondents: 1, total_responses: 3, form_count: 2 });
    expect(body.compare.responded).toEqual({ customers: 1, avg_visits: 4, avg_spent: 20000 });
    expect(JSON.stringify(body)).not.toMatch(/山田|"U1"/);
  });
});
