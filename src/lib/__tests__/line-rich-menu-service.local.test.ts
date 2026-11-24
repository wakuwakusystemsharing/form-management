/**
 * リッチメニュー: LINE への反映の順番（偽の LINE で確かめる）と、ローカル JSON モードの API
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RichMenuLineApi } from '@/lib/line-rich-menu-api';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/line-rich-menu-service');
let listRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/route');
let itemRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/[id]/route');
let publishRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/[id]/publish/route');
let unpublishRoute: typeof import('@/app/api/stores/[storeId]/rich-menus/[id]/unpublish/route');

const STORE = 'st0001';
const OTHER = 'st0002';
const ORIGIN = 'http://localhost';

/** 呼ばれた順番を記録する偽の LINE */
function fakeApi(opts: { failAt?: 'create' | 'image' | 'default'; list?: Array<{ richMenuId: string; name: string }>; removeFails?: string[] } = {}) {
  const calls: string[] = [];
  const ok = { ok: true, status: 200, body: '{}' };
  const ng = { ok: false, status: 400, body: '{"message":"だめでした"}' };
  const api: RichMenuLineApi = {
    create: async () => {
      calls.push('create');
      return opts.failAt === 'create' ? { ...ng, richMenuId: null } : { ...ok, richMenuId: 'rm-new' };
    },
    uploadImage: async (id) => {
      calls.push(`image:${id}`);
      return opts.failAt === 'image' ? ng : ok;
    },
    setDefault: async (id) => {
      calls.push(`default:${id}`);
      return opts.failAt === 'default' ? ng : ok;
    },
    clearDefault: async () => {
      calls.push('clear');
      return ok;
    },
    remove: async (id) => {
      calls.push(`remove:${id}`);
      return opts.removeFails?.includes(id) ? { ok: false, status: 500, body: '' } : ok;
    },
    getDefault: async () => 'rm-new',
    list: async () => opts.list ?? [],
  };
  return { api, calls };
}

const image = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' as const };
const body = (over: Record<string, unknown> = {}) => ({
  name: 'いつものメニュー',
  size: 'small',
  image_url: '/menu_images/st0001/richmenu.jpg',
  chat_bar_text: 'メニュー',
  areas: [
    { id: 'a1', x: 0, y: 0, w: 0.5, h: 1, action: { type: 'message', text: '予約確認' } },
    { id: 'a2', x: 0.5, y: 0, w: 0.5, h: 1, action: { type: 'form', form_id: 'formaaaa0001' } },
  ],
  ...over,
});

const json = (method: string, url: string, payload?: unknown) => new Request(`${ORIGIN}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
const p = (storeId: string, id?: string) => ({ params: Promise.resolve({ storeId, id: id as string }) });

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-menu-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'data', 'stores.json'), JSON.stringify([{ id: STORE, name: 'A店' }, { id: OTHER, name: 'B店' }]));
  fs.writeFileSync(
    path.join(tmpDir, 'data', `forms_${STORE}.json`),
    JSON.stringify([{ id: 'formaaaa0001', store_id: STORE, status: 'published', config: { form_type: 'line', basic_info: { form_name: '予約フォーム', store_name: 'A店', liff_id: '1234567890-abcdefgh' } } }])
  );
  service = await import('@/lib/line-rich-menu-service');
  listRoute = await import('@/app/api/stores/[storeId]/rich-menus/route');
  itemRoute = await import('@/app/api/stores/[storeId]/rich-menus/[id]/route');
  publishRoute = await import('@/app/api/stores/[storeId]/rich-menus/[id]/publish/route');
  unpublishRoute = await import('@/app/api/stores/[storeId]/rich-menus/[id]/unpublish/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('publishToLine（LINE への反映の順番）', () => {
  it('作る → 画像 → 全員向け の順。成功したら何も消さない', async () => {
    const { api, calls } = fakeApi();
    const r = await service.publishToLine({ api, object: {}, image });
    expect(r).toEqual({ ok: true, richMenuId: 'rm-new' });
    expect(calls).toEqual(['create', 'image:rm-new', 'default:rm-new']);
  });

  it('作るのに失敗したら、何も変えずに終わる', async () => {
    const { api, calls } = fakeApi({ failAt: 'create' });
    const r = await service.publishToLine({ api, object: {}, image });
    expect(r).toMatchObject({ ok: false, step: 'create' });
    expect(calls).toEqual(['create']);
  });

  it('画像に失敗したら、作ったメニューを消す（全員向けにはしない）', async () => {
    const { api, calls } = fakeApi({ failAt: 'image' });
    const r = await service.publishToLine({ api, object: {}, image });
    expect(r).toMatchObject({ ok: false, step: 'image' });
    expect(calls).toEqual(['create', 'image:rm-new', 'remove:rm-new']);
  });

  it('全員向けの設定に失敗したら、作ったメニューを消す', async () => {
    const { api, calls } = fakeApi({ failAt: 'default' });
    const r = await service.publishToLine({ api, object: {}, image });
    expect(r).toMatchObject({ ok: false, step: 'default' });
    expect(calls).toEqual(['create', 'image:rm-new', 'default:rm-new', 'remove:rm-new']);
    if (!r.ok) expect(r.error).toContain('だめでした');
  });
});

describe('cleanupLineRichMenus（古いメニューの掃除）', () => {
  it('古い ID と、このシステムの印が付いた消し残りを消す。いま出しているものと、ほかのツールのメニューは消さない', async () => {
    const { api, calls } = fakeApi({
      list: [
        { richMenuId: 'rm-new', name: `${service.LINE_MENU_NAME_PREFIX}いま出しているもの` },
        { richMenuId: 'rm-left', name: `${service.LINE_MENU_NAME_PREFIX}消し残り` },
        { richMenuId: 'rm-tool', name: 'ほかのツールで作ったメニュー' },
      ],
    });
    const r = await service.cleanupLineRichMenus(api, 'rm-new', ['rm-old', 'rm-new']);
    expect(calls.sort()).toEqual(['remove:rm-left', 'remove:rm-old']);
    expect(r.removed.sort()).toEqual(['rm-left', 'rm-old']);
    expect(r.failed).toEqual([]);
  });

  it('消せなかったものがあっても例外にしない', async () => {
    const { api } = fakeApi({ removeFails: ['rm-old'] });
    await expect(service.cleanupLineRichMenus(api, 'rm-new', ['rm-old'])).resolves.toEqual({ removed: [], failed: ['rm-old'] });
  });
});

describe('API（ローカル JSON モード）', () => {
  let id = '';

  it('最初は空。選べる予約フォームが返る', async () => {
    const res = await listRoute.GET(json('GET', `/api/stores/${STORE}/rich-menus`), p(STORE));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ menus: [], local: true, max: 20, external_notice: null });
    expect(data.forms).toEqual([{ id: 'formaaaa0001', name: '予約フォーム', openable: true }]);
  });

  it('下書きを作る（画像やボタンの動きが未設定でも保存できる）', async () => {
    const res = await listRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus`, body({ image_url: '', areas: [] })), p(STORE));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data).toMatchObject({ name: 'いつものメニュー', size: 'small', status: 'draft', is_default: false, areas: [] });
    id = data.id;
  });

  it('名前が無い・ボタンが重なっていると保存できない', async () => {
    expect((await listRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus`, body({ name: '' })), p(STORE))).status).toBe(400);
    const overlap = body({ areas: [{ x: 0, y: 0, w: 0.6, h: 1, action: { type: 'none' } }, { x: 0.5, y: 0, w: 0.5, h: 1, action: { type: 'none' } }] });
    const res = await itemRoute.PUT(json('PUT', `/api/stores/${STORE}/rich-menus/${id}`, overlap), p(STORE, id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('重なっています');
  });

  it('画像の無い下書きは反映できない', async () => {
    const res = await publishRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus/${id}/publish`), p(STORE, id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('画像');
  });

  it('内容を保存して反映する（local は記録だけ）', async () => {
    expect((await itemRoute.PUT(json('PUT', `/api/stores/${STORE}/rich-menus/${id}`, body()), p(STORE, id))).status).toBe(200);
    const res = await publishRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus/${id}/publish`), p(STORE, id));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.menu).toMatchObject({ status: 'published', is_default: true, dirty: false });
    expect(data.notice).toContain('local');
  });

  it('反映中のメニューを変えると「未反映の変更あり」になる。削除はできない', async () => {
    const res = await itemRoute.PUT(json('PUT', `/api/stores/${STORE}/rich-menus/${id}`, body({ chat_bar_text: 'ご予約はこちら' })), p(STORE, id));
    expect(await res.json()).toMatchObject({ status: 'published', dirty: true, chat_bar_text: 'ご予約はこちら' });
    const del = await itemRoute.DELETE(json('DELETE', `/api/stores/${STORE}/rich-menus/${id}`), p(STORE, id));
    expect(del.status).toBe(409);
    expect((await del.json()).error).toContain('反映をやめる');
  });

  it('別のメニューを反映すると、全員向けは 1 つだけになる', async () => {
    const second = await (await listRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus`, body({ name: '2 つ目' })), p(STORE))).json();
    const res = await publishRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus/${second.id}/publish`), p(STORE, second.id));
    expect(res.status).toBe(200);
    const { menus } = await (await listRoute.GET(json('GET', `/api/stores/${STORE}/rich-menus`), p(STORE))).json();
    expect(menus.filter((m: { is_default: boolean }) => m.is_default).map((m: { name: string }) => m.name)).toEqual(['2 つ目']);
    expect(menus.find((m: { id: string }) => m.id === id)).toMatchObject({ status: 'draft', is_default: false });

    // 反映をやめる → 下書きに戻る → 削除できる
    const un = await unpublishRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus/${second.id}/unpublish`), p(STORE, second.id));
    expect((await un.json()).menu).toMatchObject({ status: 'draft', is_default: false });
    expect((await itemRoute.DELETE(json('DELETE', `/api/stores/${STORE}/rich-menus/${second.id}`), p(STORE, second.id))).status).toBe(200);
  });

  it('消えたフォームを指すボタンがあると反映できない', async () => {
    await itemRoute.PUT(json('PUT', `/api/stores/${STORE}/rich-menus/${id}`, body({ areas: [{ x: 0, y: 0, w: 1, h: 1, action: { type: 'form', form_id: 'gone' } }] })), p(STORE, id));
    const res = await publishRoute.POST(json('POST', `/api/stores/${STORE}/rich-menus/${id}/publish`), p(STORE, id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('見つかりません');
  });

  it('ほかの店舗のメニューは、読めない・書けない・反映できない', async () => {
    const other = await (await listRoute.GET(json('GET', `/api/stores/${OTHER}/rich-menus`), p(OTHER))).json();
    expect(other.menus).toEqual([]);
    expect((await itemRoute.PUT(json('PUT', `/api/stores/${OTHER}/rich-menus/${id}`, body()), p(OTHER, id))).status).toBe(404);
    expect((await publishRoute.POST(json('POST', `/api/stores/${OTHER}/rich-menus/${id}/publish`), p(OTHER, id))).status).toBe(404);
    expect((await itemRoute.DELETE(json('DELETE', `/api/stores/${OTHER}/rich-menus/${id}`), p(OTHER, id))).status).toBe(404);
  });
});
