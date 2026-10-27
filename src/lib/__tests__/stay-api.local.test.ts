/**
 * 宿泊モードの予約 API（ローカル JSON モード）の結合テスト
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 *
 * - POST /api/reservations: 宿泊の検証・料金の再計算・同じ夜の二重予約の 409
 * - GET /api/stores/{storeId}/stay/availability: 夜ごとの空きと料金
 * - PATCH /api/reservations/{id}: 日程変更の再計算と重なり、キャンセル時のキャンセル料の記録
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultStaySettings } from '@/lib/stay-pricing';

let tmpDir = '';
let originalCwd = '';
let postRoute: typeof import('@/app/api/reservations/route');
let patchRoute: typeof import('@/app/api/reservations/[reservationId]/route');
let availabilityRoute: typeof import('@/app/api/stores/[storeId]/stay/availability/route');

const STORE = 'st0001';
const FORM = 'stayform0001';

function dataFile(name: string) {
  return path.join(tmpDir, 'data', name);
}

function writeStayForm(overrides: Record<string, unknown> = {}) {
  const stay = createDefaultStaySettings();
  fs.writeFileSync(dataFile(`forms_${STORE}.json`), JSON.stringify([{
    id: FORM,
    store_id: STORE,
    status: 'published',
    config: {
      form_type: 'line',
      basic_info: { form_name: '宿泊予約', store_name: '宿', liff_id: '' },
      calendar_settings: {
        booking_mode: 'stay',
        min_advance_days: 0,
        advance_booking_days: 365,
        stay_settings: stay,
        show_customer_name: true,
        show_customer_phone: true,
      },
      cancel_rules: {
        fee_tiers: [{ days_before: 7, percent: 0 }, { days_before: 2, percent: 50 }, { days_before: 0, percent: 100 }],
        fee_base: 'stay',
      },
      ...overrides,
    },
  }]));
}

function readReservations(): any[] {
  const f = dataFile('reservations.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : [];
}

function post(body: Record<string, unknown>) {
  return postRoute.POST(new Request('http://localhost/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form_id: FORM,
      store_id: STORE,
      customer_name: '山田 太郎',
      customer_phone: '090-0000-0000',
      selected_menus: [],
      selected_options: [],
      customer_info: {},
      ...body,
    }),
  }));
}

function patch(id: string, body: Record<string, unknown>) {
  return patchRoute.PATCH(
    new Request(`http://localhost/api/reservations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ reservationId: id }) }
  );
}

/** 受付期間の中（今日から 30〜40 日後）の日付を使う */
function futureDate(offsetDays: number): string {
  const d = new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stay-api-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: '宿', owner_email: '', phone: '000' }]));
  postRoute = await import('@/app/api/reservations/route');
  patchRoute = await import('@/app/api/reservations/[reservationId]/route');
  availabilityRoute = await import('@/app/api/stores/[storeId]/stay/availability/route');
}, 120000); // ルートの依存が多く初回 import に時間がかかる

beforeEach(() => {
  writeStayForm();
  for (const f of ['reservations.json', 'customers.json', 'customer_visits.json', 'follow_messages.json']) {
    fs.rmSync(dataFile(f), { force: true });
  }
  fs.writeFileSync(dataFile('reservations.json'), '[]');
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/reservations（宿泊モード）', () => {
  it('チェックイン〜チェックアウトで保存し、料金はサーバーで再計算する', async () => {
    const d1 = futureDate(30);
    const d3 = futureDate(32);
    const res = await post({ reservation_date: d1, checkout_date: d3, guest_counts: { adult: 2, child: 1 }, stay_price_total: 1 });
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row).toMatchObject({
      reservation_date: d1,
      reservation_time: '15:00',
      checkout_date: d3,
      stay_nights: 2,
      guest_counts: { adult: 2, child: 1 },
      guest_count: 2,
      stay_price_total: 40000,
    });
    expect(row.customer_info).toMatchObject({ booking_mode: 'stay', guest_text: '6歳以上 2名 / 0〜5歳 1名', stay_subtotal: 40000 });
    expect(readReservations()).toHaveLength(1);
  });

  it('A: 1〜2 日目、B: 2〜3 日目は両方入る。C: 1〜3 日目は 409（slot_taken）', async () => {
    const d1 = futureDate(40), d2 = futureDate(41), d3 = futureDate(42);
    expect((await post({ reservation_date: d1, checkout_date: d2, guest_counts: { adult: 1 } })).status).toBe(201);
    expect((await post({ reservation_date: d2, checkout_date: d3, guest_counts: { adult: 1 } })).status).toBe(201);
    const c = await post({ reservation_date: d1, checkout_date: d3, guest_counts: { adult: 1 } });
    expect(c.status).toBe(409);
    expect((await c.json()).code).toBe('slot_taken');
    expect(readReservations()).toHaveLength(2);
  });

  it('不正な入力は 400（泊数超過 / 人数）', async () => {
    const r1 = await post({ reservation_date: futureDate(50), checkout_date: futureDate(60), guest_counts: { adult: 1 } });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toContain('最大7泊');
    const r2 = await post({ reservation_date: futureDate(50), checkout_date: futureDate(51), guest_counts: { adult: 0 } });
    expect(r2.status).toBe(400);
  });
});

describe('GET /api/stores/{storeId}/stay/availability', () => {
  it('予約で埋まった夜は full、他は料金付きで空き', async () => {
    const d1 = futureDate(70), d2 = futureDate(71);
    expect((await post({ reservation_date: d1, checkout_date: d2, guest_counts: { adult: 1 } })).status).toBe(201);
    const res = await availabilityRoute.GET(
      new Request(`http://localhost/api/stores/${STORE}/stay/availability?form_id=${FORM}&from=${d1}&to=${futureDate(72)}&guests=adult:2`) as any,
      { params: Promise.resolve({ storeId: STORE }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nights[d1]).toMatchObject({ available: false, remaining: 0, reason: 'full' });
    expect(json.nights[d2]).toMatchObject({ available: true, remaining: 1, price: 20000 });
    expect(json.settings).toMatchObject({ check_in_time: '15:00', check_out_time: '10:00', max_nights: 7 });
    expect(json.calendar_degraded).toBe(false);
  });

  it('宿泊モード以外のフォームは 400、期間が長すぎれば 400', async () => {
    writeStayForm({ calendar_settings: { booking_mode: 'calendar' } });
    const res = await availabilityRoute.GET(
      new Request(`http://localhost/api/stores/${STORE}/stay/availability?form_id=${FORM}&from=2026-11-01&to=2026-11-10`) as any,
      { params: Promise.resolve({ storeId: STORE }) }
    );
    expect(res.status).toBe(400);
    writeStayForm();
    const long = await availabilityRoute.GET(
      new Request(`http://localhost/api/stores/${STORE}/stay/availability?form_id=${FORM}&from=2026-11-01&to=2027-11-01`) as any,
      { params: Promise.resolve({ storeId: STORE }) }
    );
    expect(long.status).toBe(400);
  });
});

describe('PATCH /api/reservations/{id}（宿泊モード）', () => {
  it('チェックアウト日と人数の変更で料金を再計算。他の予約と重なれば 409', async () => {
    const d1 = futureDate(80), d2 = futureDate(81), d3 = futureDate(82), d4 = futureDate(83);
    const a = await (await post({ reservation_date: d1, checkout_date: d2, guest_counts: { adult: 1 } })).json();
    expect((await post({ reservation_date: d3, checkout_date: d4, guest_counts: { adult: 1 } })).status).toBe(201);

    const ok = await patch(a.id, { checkout_date: d3, guest_counts: { adult: 2 } });
    expect(ok.status).toBe(200);
    const updated = await ok.json();
    expect(updated).toMatchObject({ checkout_date: d3, stay_nights: 2, guest_count: 2, stay_price_total: 40000 });

    const conflict = await patch(a.id, { checkout_date: d4 });
    expect(conflict.status).toBe(409);
  });

  it('キャンセルでキャンセル料を記録し、復元でクリアする', async () => {
    // 3 日後チェックイン → 2〜6 日前の段階 = 50%
    const d1 = futureDate(3), d2 = futureDate(4);
    const a = await (await post({ reservation_date: d1, checkout_date: d2, guest_counts: { adult: 2 } })).json();
    const cancelled = await (await patch(a.id, { status: 'cancelled' })).json();
    expect(cancelled).toMatchObject({ status: 'cancelled', cancel_fee_percent: 50, cancel_fee_amount: 10000 });
    expect(typeof cancelled.cancelled_at).toBe('string');

    const restored = await (await patch(a.id, { status: 'confirmed' })).json();
    expect(restored.cancel_fee_percent).toBeNull();
    expect(restored.cancelled_at).toBeNull();

    // 手動で上書き
    const manual = await (await patch(a.id, { status: 'cancelled', cancel_fee_percent: 0 })).json();
    expect(manual).toMatchObject({ cancel_fee_percent: 0, cancel_fee_amount: 0 });
  });
});
