/**
 * リッチメニュー: タブ付きメニューをまとめて作る（local = JSON）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TAB_SET_STRIP_RATIO, areasOverlap, buildTabSetAreas, collectSwitchGroup, normalizeRichMenuTabSetInput, validateRichMenu, validateRichMenuTabSetInput, type LineRichMenu } from '@/lib/line-rich-menu';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/line-rich-menu-service');
let route: typeof import('@/app/api/stores/[storeId]/rich-menus/tab-set/route');

const STORE = 'st0001';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-menu-tabs-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: 'テスト店' }]));
  service = await import('@/lib/line-rich-menu-service');
  route = await import('@/app/api/stores/[storeId]/rich-menus/tab-set/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  if (fs.existsSync(dataFile('line_rich_menus.json'))) fs.rmSync(dataFile('line_rich_menus.json'));
});

describe('入力の確認', () => {
  it('タブは 2〜5 個。名前が要る。同じ名前は使えない', () => {
    const v = (tabs: string[]) => validateRichMenuTabSetInput(normalizeRichMenuTabSetInput({ size: 'large', tabs }));
    expect(v(['A', 'B'])).toEqual([]);
    expect(v(['A'])[0]).toContain('2 個以上');
    expect(v(['A', 'B', 'C', 'D', 'E', 'F'])[0]).toContain('5 個まで');
    expect(v(['A', ' '])[0]).toBe('タブ 2 の名前を入力してください');
    expect(v(['A', 'A'])[0]).toContain('同じ名前');
    expect(v(['A', 'あ'.repeat(41)])[0]).toContain('40 文字まで');
  });

  it('既定値: 大きさ = 大、バーの文言 = メニュー', () => {
    expect(normalizeRichMenuTabSetInput({ tabs: [' A ', 1] })).toEqual({ size: 'large', tabs: ['A', ''], chat_bar_text: 'メニュー' });
  });
});

describe('タブのボタンの並び', () => {
  it('上の帯を等分し、ほかのタブは切り替え、自分のタブは何もしない。帯の下に大きなボタンを 1 つ', () => {
    const areas = buildTabSetAreas('large', 1, ['m1', 'm2', 'm3']);
    expect(areas.map((a) => a.action)).toEqual([{ type: 'switch', menu_id: 'm1' }, { type: 'none' }, { type: 'switch', menu_id: 'm3' }, { type: 'none' }]);
    expect(areas.slice(0, 3).every((a) => a.y === 0 && a.h === TAB_SET_STRIP_RATIO.large)).toBe(true);
    expect(areas[3]).toMatchObject({ x: 0, y: 0.15, w: 1, h: 0.85 });
  });

  it('割り切れない数でも、すき間・重なり・はみ出しが無い（2〜5 個・大小）', () => {
    for (const size of ['large', 'small'] as const) {
      for (let n = 2; n <= 5; n++) {
        const ids = Array.from({ length: n }, (_, i) => `m${i}`);
        const areas = buildTabSetAreas(size, 0, ids);
        const tabs = areas.slice(0, n);
        expect(tabs[0].x).toBe(0);
        expect(Math.round((tabs[n - 1].x + tabs[n - 1].w) * 10000)).toBe(10000);
        for (let i = 1; i < n; i++) expect(Math.round((tabs[i - 1].x + tabs[i - 1].w) * 10000)).toBe(Math.round(tabs[i].x * 10000));
        for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) expect(areasOverlap(areas[i], areas[j])).toBe(false);
        // そのまま保存できる形
        expect(validateRichMenu({ name: 'x', size, image_url: '', areas, chat_bar_text: 'メニュー', open_by_default: true, rule: null })).toEqual([]);
      }
    }
  });
});

describe('まとめて作る', () => {
  it('タブの数だけ下書きができ、たがいに切り替わる。反映のときは 1 つのまとまりになる', async () => {
    const result = await service.createRichMenuTabSet(STORE, { size: 'small', tabs: ['ご予約', 'メニュー・料金', 'アクセス'], chat_bar_text: 'タップして開く' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const menus = result.data;
    expect(menus.map((m) => [m.name, m.size, m.status, m.chat_bar_text])).toEqual([
      ['ご予約', 'small', 'draft', 'タップして開く'],
      ['メニュー・料金', 'small', 'draft', 'タップして開く'],
      ['アクセス', 'small', 'draft', 'タップして開く'],
    ]);
    const ids = menus.map((m) => m.id);
    menus.forEach((m, i) => {
      const targets = m.areas.filter((a) => a.action.type === 'switch').map((a) => (a.action as { menu_id: string }).menu_id);
      expect(targets).toEqual(ids.filter((_, j) => j !== i));
    });
    const saved = JSON.parse(fs.readFileSync(dataFile('line_rich_menus.json'), 'utf-8')) as LineRichMenu[];
    expect(saved).toHaveLength(3);
    const group = collectSwitchGroup(saved[0].id, saved);
    expect(group.ok && group.group.map((m) => m.id)).toEqual(ids);
  });

  it('上限（20 個）を超えるときは、1 つも作らない', async () => {
    for (let i = 0; i < 19; i++) await service.createRichMenu(STORE, { name: `メニュー${i}`, size: 'small' });
    const result = await service.createRichMenuTabSet(STORE, { tabs: ['A', 'B'] });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((JSON.parse(fs.readFileSync(dataFile('line_rich_menus.json'), 'utf-8')) as unknown[]).length).toBe(19);
  });

  it('API: 作った下書きを返す。入力がおかしいときは 400', async () => {
    const post = (body: unknown) => route.POST(new Request(`http://localhost/api/stores/${STORE}/rich-menus/tab-set`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ storeId: STORE }) });
    const ok = await post({ size: 'large', tabs: ['A', 'B'] });
    expect(ok.status).toBe(201);
    expect((await ok.json()).menus).toHaveLength(2);
    const ng = await post({ tabs: ['A'] });
    expect(ng.status).toBe(400);
    expect((await ng.json()).error).toContain('2 個以上');
  });
});
