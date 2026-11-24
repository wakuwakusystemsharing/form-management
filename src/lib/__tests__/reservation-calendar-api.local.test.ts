/**
 * 予約カレンダーの API（ローカル JSON モード）
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let route: typeof import('@/app/api/stores/[storeId]/reservations/calendar/route');

const row = (id: string, storeId: string, date: string, time: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  store_id: storeId,
  form_id: 'form1',
  customer_name: `お客様 ${id}`,
  customer_phone: '090-0000-0000',
  selected_menus: [],
  reservation_date: date,
  reservation_time: time,
  status: 'confirmed',
  ...extra,
});

const get = async (storeId: string, query: string) => {
  const res = await route.GET(new Request(`http://localhost/api/stores/${storeId}/reservations/calendar${query}`), { params: Promise.resolve({ storeId }) });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reservation-calendar-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'data', 'reservations.json'),
    JSON.stringify([
      row('before', 'st0001', '2026-10-31', '23:30'),
      row('first', 'st0001', '2026-11-01', '00:15'),
      row('late', 'st0001', '2026-11-30', '23:30'),
      row('early', 'st0001', '2026-11-30', '09:00'),
      row('after', 'st0001', '2026-12-01', '00:00'),
      row('cancelled', 'st0001', '2026-11-15', '10:00', { status: 'cancelled' }),
      row('untimed', 'st0001', '2026-11-15', null),
      row('stay', 'st0001', '2026-10-30', '15:00', { checkout_date: '2026-11-02' }),
      row('stayout', 'st0001', '2026-10-28', '15:00', { checkout_date: '2026-10-31' }),
      row('other', 'st0002', '2026-11-15', '10:00'),
    ])
  );
  route = await import('@/app/api/stores/[storeId]/reservations/calendar/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/stores/{storeId}/reservations/calendar', () => {
  it('期間に掛かる予約だけを、日付 → 時刻の順で返す（月初の 0 時台・月末の深夜を含む）', async () => {
    const { status, body } = await get('st0001', '?from=2026-11-01&to=2026-11-30');
    expect(status).toBe(200);
    expect(body.reservations.map((r: { id: string }) => r.id)).toEqual(['stay', 'first', 'untimed', 'cancelled', 'early', 'late']);
    expect(body).toMatchObject({ from: '2026-11-01', to: '2026-11-30', busy: [], google: 'none' });
  });

  it('期間より前にチェックインした宿泊も、チェックアウト日が期間に入れば返す', async () => {
    const ids = (await get('st0001', '?from=2026-11-01&to=2026-11-30')).body.reservations.map((r: { id: string }) => r.id);
    expect(ids).toContain('stay');
    expect(ids).not.toContain('stayout');
  });

  it('他の店舗の予約は返さない', async () => {
    const a = (await get('st0001', '?from=2026-11-15&to=2026-11-15')).body.reservations.map((r: { id: string }) => r.id);
    expect(a).not.toContain('other');
    const b = (await get('st0002', '?from=2026-11-15&to=2026-11-15')).body.reservations.map((r: { id: string }) => r.id);
    expect(b).toEqual(['other']);
  });

  it('期間の指定がおかしいと 400', async () => {
    expect((await get('st0001', '')).status).toBe(400);
    expect((await get('st0001', '?from=2026-11-30&to=2026-11-01')).status).toBe(400);
    expect((await get('st0001', '?from=2026-11-01&to=2027-01-02')).status).toBe(400); // 63 日
    expect((await get('st0001', '?from=2026-02-30&to=2026-03-01')).status).toBe(400);
  });
});
