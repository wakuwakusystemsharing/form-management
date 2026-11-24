/**
 * PATCH /api/reservations/{id} の expected_updated_at（予約カレンダーのドラッグで使う）
 * 画面を開いたあとに、ほかの人が予約を変更していたら保存しない。
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let route: typeof import('@/app/api/reservations/[reservationId]/route');

const UPDATED_AT = '2026-11-20T03:00:00.000Z';
const file = () => path.join(tmpDir, 'data', 'reservations.json');
const read = () => JSON.parse(fs.readFileSync(file(), 'utf-8')) as Array<Record<string, unknown>>;

const patch = async (body: Record<string, unknown>) => {
  const res = await route.PATCH(
    new Request('http://localhost/api/reservations/resv1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ reservationId: 'resv1' }) }
  );
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reservation-stale-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(
    file(),
    JSON.stringify([
      {
        id: 'resv1',
        store_id: 'st0001',
        form_id: 'form1',
        customer_name: '山田 花子',
        customer_phone: '090-0000-0000',
        selected_menus: [{ menu_name: 'カット', duration: 60 }],
        selected_options: [],
        reservation_date: '2026-11-25',
        reservation_time: '09:00',
        status: 'confirmed',
        customer_info: {},
        created_at: UPDATED_AT,
        updated_at: UPDATED_AT,
      },
    ])
  );
  route = await import('@/app/api/reservations/[reservationId]/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('PATCH /api/reservations/{id} の expected_updated_at', () => {
  it('画面が持っている更新日時が古いと 409（何も書き換えない）', async () => {
    const { status, body } = await patch({ reservation_date: '2026-11-27', reservation_time: '14:00', expected_updated_at: '2026-11-19T00:00:00.000Z' });
    expect(status).toBe(409);
    expect(body.code).toBe('stale');
    expect(body.error).toContain('他の人');
    expect(read()[0]).toMatchObject({ reservation_date: '2026-11-25', reservation_time: '09:00', updated_at: UPDATED_AT });
  });

  it('更新日時が合っていれば保存し、更新日時が新しくなる', async () => {
    const { status, body } = await patch({ reservation_date: '2026-11-27', reservation_time: '14:00', expected_updated_at: UPDATED_AT });
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: 'resv1', reservation_date: '2026-11-27', reservation_time: '14:00' });
    expect(read()[0].updated_at).not.toBe(UPDATED_AT);
  });

  it('同じ画面からもう一度（古い更新日時のまま）送ると 409', async () => {
    expect((await patch({ reservation_date: '2026-11-28', reservation_time: '10:00', expected_updated_at: UPDATED_AT })).status).toBe(409);
  });

  it('expected_updated_at を付けなければ今までどおり保存する', async () => {
    const { status } = await patch({ reservation_date: '2026-11-28', reservation_time: '10:00' });
    expect(status).toBe(200);
    expect(read()[0]).toMatchObject({ reservation_date: '2026-11-28', reservation_time: '10:00' });
  });
});
