/**
 * PATCH /api/reservations/{id} の担当スタッフの変更（予約カレンダーのスタッフごとの列で、別の列に落としたとき）
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let route: typeof import('@/app/api/reservations/[reservationId]/route');

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reservation-staff-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'data', 'forms_st0001.json'),
    JSON.stringify([
      {
        id: 'form1',
        store_id: 'st0001',
        config: {
          form_type: 'line',
          basic_info: { form_name: 'テスト', store_name: 'テスト店', liff_id: '' },
          staff_selection: {
            enabled: true,
            staff: [
              { id: 'stf_sato', name: '佐藤', calendar_id: 'sato@example.com' },
              { id: 'stf_suzuki', name: '鈴木', calendar_id: 'suzuki@example.com' },
            ],
          },
        },
      },
    ])
  );
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
        customer_info: { nomination_fee: 500, total_price: 4500 },
        staff_id: 'stf_sato',
        staff_name: '佐藤',
        created_at: '2026-11-20T03:00:00.000Z',
        updated_at: '2026-11-20T03:00:00.000Z',
      },
    ])
  );
  route = await import('@/app/api/reservations/[reservationId]/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('PATCH /api/reservations/{id} の担当スタッフの変更', () => {
  it('日時と担当を一緒に変えられる（名前はフォームのスタッフから引く）', async () => {
    const { status, body } = await patch({ reservation_date: '2026-11-25', reservation_time: '11:00', staff_id: 'stf_suzuki' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ reservation_time: '11:00', staff_id: 'stf_suzuki', staff_name: '鈴木' });
    expect(read()[0]).toMatchObject({ staff_id: 'stf_suzuki', staff_name: '鈴木', reservation_time: '11:00' });
  });

  it('指名料・合計金額は変えない', async () => {
    expect((read()[0].customer_info as Record<string, unknown>)).toMatchObject({ nomination_fee: 500, total_price: 4500 });
  });

  it('その予約のフォームに居ないスタッフには変えられない（何も書き換えない）', async () => {
    const { status, body } = await patch({ staff_id: 'stf_unknown' });
    expect(status).toBe(400);
    expect(body.error).toContain('担当スタッフ');
    expect(read()[0]).toMatchObject({ staff_id: 'stf_suzuki', staff_name: '鈴木' });
  });
});
