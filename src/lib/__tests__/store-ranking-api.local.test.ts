/**
 * GET /api/stores/ranking の local（JSON）環境での動作確認
 * - data/ の stores / reservations / survey_responses / customers を読んで店舗ごとに集計する
 * - 期間パラメータの検証（不正なら 400）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let route: typeof import('@/app/api/stores/ranking/route');

function dataFile(name: string) {
  return path.join(tmpDir, 'data', name);
}

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranking-api-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: 'st0001', name: 'A店' }, { id: 'st0002', name: 'B店' }]));
  fs.writeFileSync(dataFile('reservations.json'), JSON.stringify([
    { id: 'r1', store_id: 'st0001', status: 'confirmed', reservation_date: '2026-10-05', selected_menus: [{ price: 5000 }], selected_options: [] },
    { id: 'r2', store_id: 'st0001', status: 'cancelled', reservation_date: '2026-10-06', selected_menus: [{ price: 5000 }], selected_options: [] },
    { id: 'r3', store_id: 'st0002', status: 'pending', reservation_date: '2026-09-01', selected_menus: [{ price: 3000 }], selected_options: [] },
  ]));
  fs.writeFileSync(dataFile('survey_responses.json'), JSON.stringify([
    { id: 's1', store_id: 'st0002', submitted_at: '2026-10-02T10:00:00+09:00' },
  ]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([
    { id: 'c1', store_id: 'st0001', line_user_id: 'U1', line_friend_flag: true },
    { id: 'c2', store_id: 'st0001', line_user_id: 'U2', line_friend_flag: false },
  ]));
  route = await import('@/app/api/stores/ranking/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const get = (qs = '') => route.GET(new Request(`http://localhost/api/stores/ranking${qs}`) as never);

describe('GET /api/stores/ranking (local)', () => {
  it('期間指定で店舗ごとの集計を返す', async () => {
    const res = await get('?date_from=2026-10-01&date_to=2026-10-31');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.period).toEqual({ date_from: '2026-10-01', date_to: '2026-10-31' });
    const a = json.rows.find((r: { store_id: string }) => r.store_id === 'st0001');
    const b = json.rows.find((r: { store_id: string }) => r.store_id === 'st0002');
    expect(a).toMatchObject({ store_name: 'A店', reservations: 1, cancelled: 1, cancel_rate: 50, sales: 5000, survey_responses: 0, line_friend_rate: 50 });
    expect(b).toMatchObject({ store_name: 'B店', reservations: 0, sales: 0, survey_responses: 1, line_friend_rate: null });
  });

  it('期間なしは全期間', async () => {
    const json = await (await get()).json();
    expect(json.period).toBeNull();
    expect(json.rows.find((r: { store_id: string }) => r.store_id === 'st0002').reservations).toBe(1);
  });

  it('不正な期間は 400', async () => {
    expect((await get('?date_from=2026-10-31&date_to=2026-10-01')).status).toBe(400);
    expect((await get('?date_from=2026/10/01&date_to=2026-10-31')).status).toBe(400);
    expect((await get('?date_from=2026-10-01')).status).toBe(400);
  });
});
