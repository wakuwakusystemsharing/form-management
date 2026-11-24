/**
 * 流入経路（ローカル JSON モード）の結合テスト
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 *
 * - 経路の作成・一覧・変更（他店舗のフォームは選べない / 他店舗の経路は触れない）
 * - GET /s/{code}: 読まれた数を数えてフォームへ移動（停止中・ロボットは数えない）
 * - POST /api/reservations: その店舗の有効な経路の合言葉だけ予約に記録する
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESERVATION_FORM_FEATURES } from '@/lib/form-deploy-features';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/reservation-source-service');
let repo: typeof import('@/lib/reservation-source-repository');
let entryRoute: typeof import('@/app/s/[code]/route');
let listRoute: typeof import('@/app/api/stores/[storeId]/reservation-sources/route');
let itemRoute: typeof import('@/app/api/stores/[storeId]/reservation-sources/[id]/route');
let reservationRoute: typeof import('@/app/api/reservations/route');

const ORIGIN = 'http://localhost';
const STORE = 'st0001';
const OTHER = 'st0002';
const LIFF = '1234567890-abcdefgh';
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/14.0.0';

const dataFile = (name: string) => path.join(tmpDir, 'data', name);

function formRow(id: string, storeId: string, opts: { liffId?: string; features?: string[] } = {}) {
  return {
    id,
    store_id: storeId,
    status: 'published',
    static_deploy: { deployed_at: '2026-11-20T00:00:00Z', deploy_url: `/api/public-form/reservations/${storeId}/${id}/index.html`, status: 'deployed', features: opts.features },
    config: {
      form_type: 'line',
      basic_info: { form_name: `フォーム ${id}`, store_name: 'テスト店', liff_id: opts.liffId ?? LIFF },
      calendar_settings: { booking_mode: 'multiple_dates', show_customer_name: true, show_customer_phone: true },
    },
  };
}

function readReservations(): Array<Record<string, unknown>> {
  const f = dataFile('reservations.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : [];
}

function reserve(body: Record<string, unknown>) {
  return reservationRoute.POST(
    new Request(`${ORIGIN}/api/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        form_id: 'formaaaa0001',
        store_id: STORE,
        customer_name: '山田 花子',
        customer_phone: '090-0000-0000',
        selected_menus: [],
        selected_options: [],
        reservation_date: '2026-12-10',
        reservation_time: '10:00',
        customer_info: {},
        ...body,
      }),
    })
  );
}

const open = (code: string, ua: string | null = BROWSER) =>
  entryRoute.GET(new Request(`${ORIGIN}/s/${code}`, { headers: ua ? { 'user-agent': ua } : {} }), { params: Promise.resolve({ code }) });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reservation-sources-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: 'A店', owner_email: '', phone: '000' }, { id: OTHER, name: 'B店', owner_email: '', phone: '000' }]));
  fs.writeFileSync(dataFile(`forms_${STORE}.json`), JSON.stringify([formRow('formaaaa0001', STORE, { features: [...RESERVATION_FORM_FEATURES] }), formRow('formaaaa0002', STORE, { features: ['menu_change'] })]));
  fs.writeFileSync(dataFile(`forms_${OTHER}.json`), JSON.stringify([formRow('formbbbb0001', OTHER, { features: [...RESERVATION_FORM_FEATURES] })]));
  service = await import('@/lib/reservation-source-service');
  repo = await import('@/lib/reservation-source-repository');
  entryRoute = await import('@/app/s/[code]/route');
  listRoute = await import('@/app/api/stores/[storeId]/reservation-sources/route');
  itemRoute = await import('@/app/api/stores/[storeId]/reservation-sources/[id]/route');
  reservationRoute = await import('@/app/api/reservations/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('経路の作成・一覧・変更', () => {
  it('作ると URL ができ、フォームの状態（古い HTML かどうか）が分かる', async () => {
    const res = await listRoute.POST(new Request(`${ORIGIN}/api/stores/${STORE}/reservation-sources`, { method: 'POST', body: JSON.stringify({ name: ' 店頭ポップ ', form_id: 'formaaaa0001' }) }), { params: Promise.resolve({ storeId: STORE }) });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ name: '店頭ポップ', form_id: 'formaaaa0001', active: true, click_count: 0, form_name: 'フォーム formaaaa0001', form_status: 'ok' });
    expect(created.code).toMatch(/^[a-z0-9]{8}$/);
    expect(created.entry_url).toBe(`${ORIGIN}/s/${created.code}`);

    // 古い HTML のフォームを選ぶと「保存＆デプロイが必要」
    const old = await service.createSource(STORE, { name: 'チラシ', form_id: 'formaaaa0002' }, ORIGIN);
    expect(old.ok && old.data.form_status).toBe('needs_deploy');

    const list = await (await listRoute.GET(new Request(`${ORIGIN}/api/stores/${STORE}/reservation-sources`), { params: Promise.resolve({ storeId: STORE }) })).json();
    expect(list.sources.map((s: { name: string }) => s.name)).toEqual(['店頭ポップ', 'チラシ']);
    expect(list.forms).toEqual([
      { id: 'formaaaa0001', name: 'フォーム formaaaa0001', status: 'ok' },
      { id: 'formaaaa0002', name: 'フォーム formaaaa0002', status: 'needs_deploy' },
    ]);
    // 他の店舗には見えない
    expect((await service.getSourceOverview(OTHER, ORIGIN)).sources).toEqual([]);
  });

  it('名前が空・他の店舗のフォームは作れない', async () => {
    expect(await service.createSource(STORE, { name: '  ', form_id: 'formaaaa0001' }, ORIGIN)).toMatchObject({ ok: false, status: 400 });
    expect(await service.createSource(STORE, { name: 'Instagram', form_id: 'formbbbb0001' }, ORIGIN)).toMatchObject({ ok: false, status: 400, error: '選んだ予約フォームが見つかりません' });
    expect(await service.createSource(STORE, { name: 'Instagram' }, ORIGIN)).toMatchObject({ ok: false, status: 400 });
  });

  it('名前の変更・停止ができ、他の店舗の経路は変更できない', async () => {
    const [first] = await repo.listSources(STORE);
    const put = (storeId: string, body: unknown) =>
      itemRoute.PUT(new Request(`${ORIGIN}/api/stores/${storeId}/reservation-sources/${first.id}`, { method: 'PUT', body: JSON.stringify(body) }), { params: Promise.resolve({ storeId, id: first.id }) });
    const renamed = await put(STORE, { name: '店頭ポップ（レジ横）' });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ name: '店頭ポップ（レジ横）', code: first.code, active: true });
    expect((await put(OTHER, { name: 'のっとり' })).status).toBe(404);
    expect((await put(STORE, { active: 'no' })).status).toBe(400);
    expect((await put(STORE, { form_id: 'formbbbb0001' })).status).toBe(400);
    expect((await repo.getSourceById(STORE, first.id))?.name).toBe('店頭ポップ（レジ横）');
  });
});

describe('GET /s/{code}', () => {
  it('読まれた数を 1 増やし、?src= 付きでフォームへ移動する', async () => {
    const [first] = await repo.listSources(STORE);
    const res = await open(first.code);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://liff.line.me/${LIFF}?src=${first.code}`);
    await wait(30);
    expect((await repo.getSourceByCode(first.code))?.click_count).toBe(1);
  });

  it('検索ロボット・User-Agent なしのアクセスは移動するが数えない', async () => {
    const [first] = await repo.listSources(STORE);
    expect((await open(first.code, 'Googlebot/2.1')).status).toBe(302);
    expect((await open(first.code, null)).status).toBe(302);
    await wait(30);
    expect((await repo.getSourceByCode(first.code))?.click_count).toBe(1);
  });

  it('停止中の経路は、?src= を付けずに通常のフォームを開き、数えない', async () => {
    const created = await service.createSource(STORE, { name: '停止する経路', form_id: 'formaaaa0001' }, ORIGIN);
    if (!created.ok) throw new Error('create failed');
    await service.editSource(STORE, created.data.id, { active: false }, ORIGIN);
    const res = await open(created.data.code);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://liff.line.me/${LIFF}`);
    await wait(30);
    expect((await repo.getSourceByCode(created.data.code))?.click_count).toBe(0);
  });

  it('存在しない合言葉・形のおかしい合言葉は 404', async () => {
    expect((await open('zzzzzzzz')).status).toBe(404);
    expect((await open('ABC')).status).toBe(404);
    expect((await open('../admin')).status).toBe(404);
  });
});

describe('予約への記録（POST /api/reservations）', () => {
  it('その店舗の有効な経路の合言葉なら、予約に記録する', async () => {
    const [first] = await repo.listSources(STORE);
    const res = await reserve({ source_code: first.code });
    expect(res.status).toBe(201);
    const saved = readReservations().at(-1);
    expect(saved?.source_code).toBe(first.code);
  });

  it('合言葉が無い予約は今までどおり（source_code を持たない）', async () => {
    const res = await reserve({});
    expect(res.status).toBe(201);
    expect(readReservations().at(-1)).not.toHaveProperty('source_code');
  });

  it('でたらめ・別の店舗の経路・停止中の経路・手動予約では記録しない（予約は成功する）', async () => {
    const other = await service.createSource(OTHER, { name: '他店の経路', form_id: 'formbbbb0001' }, ORIGIN);
    if (!other.ok) throw new Error('create failed');
    const stopped = (await repo.listSources(STORE)).find((s) => !s.active);
    const [first] = await repo.listSources(STORE);
    for (const body of [{ source_code: 'zzzzzzzz' }, { source_code: "x' OR 1=1" }, { source_code: 12345678 }, { source_code: other.data.code }, { source_code: stopped?.code }, { source_code: first.code, manual_entry: true }]) {
      const res = await reserve(body);
      expect(res.status, JSON.stringify(body)).toBe(201);
      expect(readReservations().at(-1), JSON.stringify(body)).not.toHaveProperty('source_code');
    }
  });
});
