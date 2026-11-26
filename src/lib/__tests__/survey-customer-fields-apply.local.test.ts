/**
 * アンケートの回答を顧客情報に入れる（local = JSON。送信 API を通して確かめる）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let route: typeof import('@/app/api/surveys/submit/route');

const STORE = 'st0001';
const FORM = 'survey000001';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const customers = () => JSON.parse(fs.readFileSync(dataFile('customers.json'), 'utf-8')) as Array<Record<string, unknown>>;
const writeCustomers = (rows: unknown[]) => fs.writeFileSync(dataFile('customers.json'), JSON.stringify(rows));

const question = (id: string, type: string, title: string, extra: Record<string, unknown> = {}) => ({ id, type, title, required: false, ...extra });
const FORM_ROW = {
  id: FORM,
  store_id: STORE,
  status: 'active',
  config: {
    basic_info: { title: 'カウンセリング', liff_id: '' },
    questions: [
      question('q1', 'text', 'お名前', { customer_field: { target: 'name' } }),
      question('q2', 'birthday', 'お誕生日'),
      question('q3', 'address', 'ご住所'),
      question('q4', 'text', 'お電話番号', { customer_field: { target: 'phone' } }),
      question('q5', 'checkbox', 'アレルギー', { customer_field: { target: 'allergies', overwrite: true } }),
      question('q6', 'radio', 'きっかけ', { options: [{ label: '紹介', value: '紹介', tags: ['紹介'] }, { label: 'SNS', value: 'SNS' }] }),
      question('q7', 'textarea', 'ご要望', { customer_field: { target: 'notes' } }),
    ],
    ui_settings: { submit_button_text: '送信' },
  },
};

const submit = async (responses: Record<string, unknown>, extra: Record<string, unknown> = { line_user_id: 'U1', line_display_name: 'はなこ' }) => {
  const res = await route.POST(new Request('http://localhost/api/surveys/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ survey_form_id: FORM, store_id: STORE, responses, ...extra }) }));
  expect(res.status).toBe(201);
};

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-customer-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: 'テスト店' }]));
  fs.writeFileSync(dataFile(`surveys_${STORE}.json`), JSON.stringify([FORM_ROW]));
  route = await import('@/app/api/surveys/submit/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  writeCustomers([]);
  if (fs.existsSync(dataFile('survey_responses.json'))) fs.rmSync(dataFile('survey_responses.json'));
});

describe('アンケートの回答を顧客情報に入れる', () => {
  it('顧客がまだ居ない回答者は、顧客として登録して回答を入れる。選択肢のタグも付く', async () => {
    await submit({ お名前: '山田 花子', お誕生日: '1990-04-05', ご住所: '〒150-0001 東京都渋谷区神宮前1-2-3', お電話番号: '090-1234-5678', アレルギー: '卵, 小麦', きっかけ: '紹介', ご要望: '静かな席' }, { line_user_id: 'U1', line_display_name: 'はなこ', line_friend_flag: true });
    const rows = customers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      store_id: STORE,
      line_user_id: 'U1',
      name: '山田 花子',
      line_display_name: 'はなこ',
      line_friend_flag: true,
      birthday: '1990-04-05',
      address: '〒150-0001 東京都渋谷区神宮前1-2-3',
      phone: '090-1234-5678',
      allergies: '卵, 小麦',
      notes: 'ご要望: 静かな席',
      tags: ['紹介'],
    });
  });

  it('すでに居る顧客: 空の項目にだけ入れる。上書きの質問は書き換える。メモは足す', async () => {
    writeCustomers([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子', birthday: '1990-04-05', phone: null, address: null, allergies: '卵', notes: '店舗のメモ', tags: ['常連'], line_display_name: 'はなこ' }]);
    await submit({ お名前: '別の名前', お誕生日: '1991-01-01', ご住所: '東京都港区1-1', お電話番号: '09011112222', アレルギー: '小麦', ご要望: '窓ぎわ' });
    expect(customers()).toHaveLength(1);
    expect(customers()[0]).toMatchObject({ id: 'c1', name: '山田 花子', birthday: '1990-04-05', address: '東京都港区1-1', phone: '09011112222', allergies: '小麦', notes: '店舗のメモ\nご要望: 窓ぎわ', tags: ['常連'] });
  });

  it('同じ回答をもう一度送っても、メモは増えない', async () => {
    await submit({ ご要望: '静かな席' });
    await submit({ ご要望: '静かな席' });
    expect(customers()).toHaveLength(1);
    expect(customers()[0].notes).toBe('ご要望: 静かな席');
  });

  it('ほかの顧客が使っている電話番号は入れない', async () => {
    writeCustomers([{ id: 'c9', store_id: STORE, line_user_id: 'U9', name: '別の人', phone: '090-1234-5678' }]);
    await submit({ お名前: '山田 花子', お電話番号: '090-1234-5678' });
    const mine = customers().find((c) => c.line_user_id === 'U1')!;
    expect(mine).toMatchObject({ name: '山田 花子' });
    expect(mine.phone ?? null).toBeNull();
    expect(customers().find((c) => c.id === 'c9')).toMatchObject({ name: '別の人', phone: '090-1234-5678' });
  });

  it('友だちだけの顧客は、回答が入ると通常の顧客になる', async () => {
    writeCustomers([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: 'はなこ', line_display_name: 'はなこ', line_friend_only: true, tags: [] }]);
    await submit({ お名前: '山田 花子', お誕生日: '1990-04-05' });
    expect(customers()[0]).toMatchObject({ id: 'c1', name: '山田 花子', birthday: '1990-04-05', line_friend_only: false });
  });

  it('入れる回答が無いとき・LINE ユーザー ID が無いときは、顧客を作らない', async () => {
    await submit({ きっかけ: 'SNS' });
    expect(customers()).toHaveLength(0);
    await submit({ お名前: '山田 花子', お誕生日: '1990-04-05' }, {});
    expect(customers()).toHaveLength(0);
  });

  it('形のおかしい回答（誕生日・電話番号）は入れない', async () => {
    writeCustomers([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子' }]);
    await submit({ お誕生日: '2999-01-01', お電話番号: 'なし' });
    expect(customers()[0].birthday ?? null).toBeNull();
    expect(customers()[0].phone ?? null).toBeNull();
  });
});
