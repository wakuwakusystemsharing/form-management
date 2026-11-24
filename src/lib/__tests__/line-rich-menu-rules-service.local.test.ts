/**
 * リッチメニューの「お客様ごとの切り替え」（ローカル JSON モードの API）
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 * local は LINE と通信しないので、「だれにどのメニューを設定したか」の記録（data/line_rich_menu_links.json）で確かめる
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let listRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/route');
let itemRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/[id]/route');
let publishRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/[id]/publish/route');
let unpublishRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/[id]/unpublish/route');
let syncRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/sync/route');
let orderRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/rule-order/route');
let cronRoute: typeof import('@/app/api/cron/rich-menu-sync/route');

const STORE = 'st0001';
const OTHER = 'st0002';
const ORIGIN = 'http://localhost';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);

const json = (method: string, url: string, payload?: unknown) => new Request(`${ORIGIN}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
const p = (storeId: string, id?: string) => ({ params: Promise.resolve({ storeId, id: id as string }) });

const body = (over: Record<string, unknown> = {}) => ({
  name: 'メニュー',
  size: 'small',
  image_url: '/menu_images/st0001/richmenu.jpg',
  chat_bar_text: 'メニュー',
  areas: [{ id: 'a1', x: 0, y: 0, w: 1, h: 1, action: { type: 'message', text: '予約確認' } }],
  ...over,
});
const vipRule = { audience: { tags: { mode: 'any', values: ['VIP'] } } };
const repeatRule = { audience: { visits: { min: 2 } } };

function customer(id: string, storeId: string, over: Record<string, unknown> = {}) {
  return { id, store_id: storeId, name: id, line_user_id: `U-${id}`, line_friend_flag: true, tags: [], total_visits: 0, total_spent: 0, ...over };
}
function writeCustomers(rows: unknown[]) {
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify(rows));
}
/** だれにどのメニューを設定したか（LINE ユーザー ID → メニュー ID） */
function links(storeId = STORE): Record<string, string> {
  const f = dataFile('line_rich_menu_links.json');
  const rows = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf-8')) as Array<{ store_id: string; line_user_id: string; menu_id: string }>) : [];
  return Object.fromEntries(rows.filter((r) => r.store_id === storeId).map((r) => [r.line_user_id, r.menu_id]));
}

const create = async (payload: unknown, storeId = STORE) => (await listRoute.POST(json('POST', `/api/stores/${storeId}/rich-menus`, payload), p(storeId))).json();
const publish = (id: string, storeId = STORE) => publishRoute.POST(json('POST', `/api/stores/${storeId}/rich-menus/${id}/publish`), p(storeId, id));
const unpublish = (id: string, storeId = STORE) => unpublishRoute.POST(json('POST', `/api/stores/${storeId}/rich-menus/${id}/unpublish`), p(storeId, id));
const overview = async (storeId = STORE) => (await listRoute.GET(json('GET', `/api/stores/${storeId}/rich-menus`), p(storeId))).json();
const sync = async (storeId = STORE) => (await syncRoute.POST(json('POST', `/api/stores/${storeId}/rich-menus/sync`), p(storeId))).json();

let vip = '';
let repeat = '';
let main = '';

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-menu-rules-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: 'A店' }, { id: OTHER, name: 'B店' }]));
  writeCustomers([
    customer('vip', STORE, { tags: ['VIP'], total_visits: 12 }),
    customer('repeat', STORE, { total_visits: 3 }),
    customer('new', STORE),
    customer('no-line', STORE, { line_user_id: null, tags: ['VIP'] }),
    customer('other-vip', OTHER, { tags: ['VIP'] }),
  ]);
  listRoute = await import('@/app/api/stores/[storeId]/rich-menus/route');
  itemRoute = await import('@/app/api/stores/[storeId]/rich-menus/[id]/route');
  publishRoute = await import('@/app/api/stores/[storeId]/rich-menus/[id]/publish/route');
  unpublishRoute = await import('@/app/api/stores/[storeId]/rich-menus/[id]/unpublish/route');
  syncRoute = await import('@/app/api/stores/[storeId]/rich-menus/sync/route');
  orderRoute = await import('@/app/api/stores/[storeId]/rich-menus/rule-order/route');
  cronRoute = await import('@/app/api/cron/rich-menu-sync/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('お客様ごとのメニュー', () => {
  it('条件を付けて保存できる。優先順位は作った順（下に入る）', async () => {
    const a = await create(body({ name: 'VIP 用', rule: vipRule }));
    const b = await create(body({ name: 'リピーター用', rule: repeatRule }));
    vip = a.id;
    repeat = b.id;
    expect(a.rule).toEqual({ audience: { tags: { mode: 'any', values: ['VIP'] } }, order: 0 });
    expect(b.rule.order).toBe(1);
    const o = await overview();
    expect(o).toMatchObject({ rule_unavailable: null, rules_max: 5, link_counts: {} });
  });

  it('条件が 1 つも無い・切り替えのボタンがあるメニューは出せない', async () => {
    const empty = await create(body({ name: '条件なし', rule: { audience: {} } }));
    const r1 = await publish(empty.id);
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toContain('条件を 1 つ以上');
    await itemRoute.PUT(json('PUT', `/api/stores/${STORE}/rich-menus/${empty.id}`, body({ name: '切り替えつき', rule: vipRule, areas: [{ x: 0, y: 0, w: 1, h: 1, action: { type: 'switch', menu_id: vip } }] })), p(STORE, empty.id));
    const r2 = await publish(empty.id);
    expect(r2.status).toBe(400);
    expect((await r2.json()).error).toContain('切り替える」は使えません');
    await itemRoute.DELETE(json('DELETE', `/api/stores/${STORE}/rich-menus/${empty.id}`), p(STORE, empty.id));
  });

  it('出すと、条件に合うお客様だけに設定される（全員向けにはならない）', async () => {
    const res = await publish(vip);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.menu).toMatchObject({ status: 'published', is_default: false });
    expect(links()).toEqual({ 'U-vip': vip });
    expect((await overview()).link_counts).toEqual({ [vip]: 1 });
  });

  it('2 つ目を出す: 条件が重なる人は、上にあるメニューのまま。ほかの店舗のお客様には設定しない', async () => {
    expect((await publish(repeat)).status).toBe(200);
    // vip は来店 12 回なので両方に合うが、上にある VIP 用のまま
    expect(links()).toEqual({ 'U-vip': vip, 'U-repeat': repeat });
    expect(links(OTHER)).toEqual({});
  });

  it('優先順位を入れ替えると、重なる人のメニューが変わる', async () => {
    const res = await orderRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus/rule-order`, { ids: [repeat, vip] }), p(STORE));
    expect((await res.json()).order).toEqual([repeat, vip]);
    await sync();
    expect(links()).toEqual({ 'U-vip': repeat, 'U-repeat': repeat });
    // 元に戻す
    await orderRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus/rule-order`, { ids: [vip, repeat] }), p(STORE));
    await sync();
    expect(links()).toEqual({ 'U-vip': vip, 'U-repeat': repeat });
  });

  it('条件に合うようになった人には設定し、合わなくなった人は外す（見直し）', async () => {
    writeCustomers([
      customer('vip', STORE, { tags: [], total_visits: 1 }), // タグが外れ、来店も 1 回 → どの条件にも合わない
      customer('repeat', STORE, { total_visits: 3 }),
      customer('new', STORE, { tags: ['VIP'] }), // タグが付いた
      customer('other-vip', OTHER, { tags: ['VIP'] }),
    ]);
    const s = await sync();
    expect(s).toMatchObject({ linked: 1, unlinked: 1, unchanged: 1, failed: 0, menus: 2 });
    expect(s.summary).toContain('設定 1 人');
    expect(links()).toEqual({ 'U-repeat': repeat, 'U-new': vip });
    // もう一度見直しても、何も変わらない
    expect(await sync()).toMatchObject({ linked: 0, unlinked: 0, unchanged: 2 });
  });

  it('1 日 1 回の見直し（cron）でも同じ結果になる', async () => {
    writeCustomers([customer('repeat', STORE, { total_visits: 3 }), customer('new', STORE, { tags: [] })]);
    const res = await cronRoute.POST(json('POST', '/api/cron/rich-menu-sync'));
    expect(await res.json()).toMatchObject({ stores: 1, done: 1, unlinked: 1 });
    expect(links()).toEqual({ 'U-repeat': repeat });
  });

  it('全員向けのメニューを反映しても、お客様ごとのメニューは出したまま', async () => {
    main = (await create(body({ name: '全員向け' }))).id;
    expect((await publish(main)).status).toBe(200);
    const menus = (await overview()).menus as Array<{ id: string; status: string; is_default: boolean }>;
    expect(menus.find((m) => m.id === main)).toMatchObject({ status: 'published', is_default: true });
    expect(menus.find((m) => m.id === vip)).toMatchObject({ status: 'published', is_default: false });
    expect(menus.find((m) => m.id === repeat)).toMatchObject({ status: 'published', is_default: false });
    expect(links()).toEqual({ 'U-repeat': repeat });
    // 全員向けの反映をやめても、同じ
    expect((await unpublish(main)).status).toBe(200);
    expect(((await overview()).menus as Array<{ id: string; status: string }>).find((m) => m.id === repeat)).toMatchObject({ status: 'published' });
  });

  it('お客様ごとのメニューは、切り替え先にできない', async () => {
    await itemRoute.PUT(json('PUT', `/api/stores/${STORE}/rich-menus/${main}`, body({ name: '全員向け', areas: [{ x: 0, y: 0, w: 1, h: 1, action: { type: 'switch', menu_id: vip } }] })), p(STORE, main));
    const res = await publish(main);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('お客様ごとのメニューなので、切り替え先にできません');
  });

  it('公式 LINE に出しているあいだは、「全員向け」と「お客様ごと」を入れ替えられない', async () => {
    const res = await itemRoute.PUT(json('PUT', `/api/stores/${STORE}/rich-menus/${repeat}`, body({ name: 'リピーター用', rule: null })), p(STORE, repeat));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('種類を変えられません');
    // 条件の中身は変えられる（未反映の変更あり。優先順位はそのまま）
    const ok = await itemRoute.PUT(json('PUT', `/api/stores/${STORE}/rich-menus/${repeat}`, body({ name: 'リピーター用', rule: { audience: { visits: { min: 5 } }, order: 99 } })), p(STORE, repeat));
    expect(await ok.json()).toMatchObject({ status: 'published', dirty: true, rule: { audience: { visits: { min: 5 } }, order: 1 } });
  });

  it('条件を変えて出し直すと、合わなくなった人は外れる', async () => {
    expect((await publish(repeat)).status).toBe(200);
    // repeat は来店 3 回 → 5 回以上の条件に合わなくなった
    expect(links()).toEqual({});
  });

  it('出すのをやめると、設定していた人は外れ、メニューは下書きに戻る', async () => {
    writeCustomers([customer('vip', STORE, { tags: ['VIP'] })]);
    await sync();
    expect(links()).toEqual({ 'U-vip': vip });
    const res = await unpublish(vip);
    expect(res.status).toBe(200);
    expect((await res.json()).menu).toMatchObject({ status: 'draft', is_default: false });
    expect(links()).toEqual({});
  });
});
