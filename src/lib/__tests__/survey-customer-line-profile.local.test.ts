/**
 * アンケートの回答をきっかけに、顧客の LINE のアイコン画像を入れる（local = JSON。プロフィールの取得は差し替え）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let mod: typeof import('@/lib/survey-customer-fields-apply');

const STORE = 'st0001';
const FORM = 'survey000001';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const customers = () => JSON.parse(fs.readFileSync(dataFile('customers.json'), 'utf-8')) as Array<Record<string, unknown>>;
const writeCustomers = (rows: unknown[]) => fs.writeFileSync(dataFile('customers.json'), JSON.stringify(rows));
const PROFILE = { displayName: 'はなこ', pictureUrl: 'https://profile.line-scdn.net/abc', statusMessage: 'こんにちは', language: 'ja' };
const apply = (loadProfile: import('@/lib/survey-customer-fields-apply').SurveyLineProfileLoader, lineDisplayName: string | null = null) =>
  mod.applySurveyCustomerFields({ storeId: STORE, surveyFormId: FORM, responses: { お誕生日: '1990-04-05' }, lineUserId: 'U1', lineDisplayName, loadProfile });

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-profile-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile(`surveys_${STORE}.json`), JSON.stringify([{ id: FORM, store_id: STORE, config: { questions: [{ id: 'q1', type: 'birthday', title: 'お誕生日', required: false }] } }]));
  mod = await import('@/lib/survey-customer-fields-apply');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => writeCustomers([]));

describe('アンケートをきっかけに LINE のアイコン画像を入れる', () => {
  it('顧客を作るとき、プロフィールのアイコン画像・表示名を入れる', async () => {
    const load = vi.fn(async () => PROFILE);
    await apply(load);
    expect(load).toHaveBeenCalledWith(STORE, 'U1');
    expect(customers()[0]).toMatchObject({ line_user_id: 'U1', name: 'はなこ', line_display_name: 'はなこ', line_picture_url: PROFILE.pictureUrl, line_status_message: 'こんにちは', line_language: 'ja', birthday: '1990-04-05' });
  });

  it('アイコン画像の無い顧客は、次に回答したときに入る（回答で変わる項目が無くても）', async () => {
    writeCustomers([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子', birthday: '1990-04-05', line_display_name: '前の表示名', line_picture_url: null }]);
    const result = await apply(async () => PROFILE);
    expect(result).toMatchObject({ customerId: 'c1', created: false, fields: [] });
    expect(customers()[0]).toMatchObject({ name: '山田 花子', line_display_name: '前の表示名', line_picture_url: PROFILE.pictureUrl });
  });

  it('アイコン画像のある顧客では、LINE に問い合わせない', async () => {
    writeCustomers([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子', line_picture_url: 'https://profile.line-scdn.net/old' }]);
    const load = vi.fn(async () => PROFILE);
    await apply(load);
    expect(load).not.toHaveBeenCalled();
    expect(customers()[0]).toMatchObject({ line_picture_url: 'https://profile.line-scdn.net/old', birthday: '1990-04-05' });
  });

  it('プロフィールを取れなくても（友だちでない・失敗）、回答は顧客に入る', async () => {
    await apply(async () => null, 'フォームの表示名');
    expect(customers()[0]).toMatchObject({ name: 'フォームの表示名', birthday: '1990-04-05' });
    expect(customers()[0].line_picture_url ?? null).toBeNull();
    writeCustomers([]);
    await apply(async () => {
      throw new Error('LINE に届かない');
    });
    expect(customers()[0]).toMatchObject({ name: 'LINE 友だち', birthday: '1990-04-05' });
  });

  it('local では LINE と通信しない', async () => {
    expect(await mod.loadSurveyLineProfile(STORE, 'U1')).toBeNull();
  });
});
