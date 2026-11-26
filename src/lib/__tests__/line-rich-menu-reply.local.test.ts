/**
 * リッチメニュー: 「応答メッセージを返す」のボタンが押されたときに返す内容（local = JSON）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/line-rich-menu-service');

const STORE = 'st0001';
const OTHER = 'st0002';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const area = (id: string, x: number, action: unknown) => ({ id, x, y: 0, w: 0.25, h: 1, action });
const flex = (id: string, storeId: string, enabled: boolean) => ({
  id,
  store_id: storeId,
  name: `メッセージ ${id}`,
  template: 'custom',
  data: {},
  flex_override: null,
  alt_text: 'お知らせ',
  keywords: [],
  attach_confirm: false,
  attach_reminder: false,
  attach_follow: false,
  enabled,
  track_taps: false,
  payload: { type: 'flex', altText: `カード ${id}`, contents: { type: 'bubble' } },
  payloads: [{ type: 'flex', altText: `カード ${id}`, contents: { type: 'bubble' } }, { type: 'text', text: '2 通目' }],
  reply_count: 0,
  tap_counts: {},
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
});

let menuId = '';

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-menu-reply-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: 'テスト店' }, { id: OTHER, name: 'となりの店' }]));
  fs.writeFileSync(dataFile('line_flex_messages.json'), JSON.stringify([flex('msgon0000001', STORE, true), flex('msgoff000001', STORE, false), flex('msgother0001', OTHER, true)]));
  service = await import('@/lib/line-rich-menu-service');
  const created = await service.createRichMenu(STORE, {
    name: 'いつものメニュー',
    size: 'small',
    image_url: 'https://example.com/a.jpg',
    chat_bar_text: 'メニュー',
    open_by_default: true,
    areas: [
      area('a1', 0, { type: 'reply', mode: 'text', text: '営業時間は 10:00〜19:00 です。' }),
      area('a2', 0.25, { type: 'reply', mode: 'message', message_id: 'msgon0000001' }),
      area('a3', 0.5, { type: 'reply', mode: 'message', message_id: 'msgoff000001' }),
      area('a4', 0.75, { type: 'message', text: '予約確認', silent: true }),
    ],
  });
  if (!created.ok) throw new Error(created.error);
  menuId = created.data.id;
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('応答メッセージのボタンが押されたとき', () => {
  it('この画面で書いた文章を返す', async () => {
    expect(await service.resolveRichMenuReply(STORE, menuId, 'a1')).toEqual([{ type: 'text', text: '営業時間は 10:00〜19:00 です。' }]);
  });

  it('保存済みの LINE メッセージを、追加のメッセージごと返す', async () => {
    const messages = await service.resolveRichMenuReply(STORE, menuId, 'a2');
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toMatchObject({ type: 'flex', altText: 'カード msgon0000001' });
    expect(messages?.[1]).toEqual({ type: 'text', text: '2 通目' });
  });

  it('無効にした LINE メッセージ・ほかの店舗の LINE メッセージは返さない', async () => {
    expect(await service.resolveRichMenuReply(STORE, menuId, 'a3')).toBeNull();
    const saved = await service.saveRichMenu(STORE, menuId, {
      name: 'いつものメニュー',
      size: 'small',
      image_url: 'https://example.com/a.jpg',
      chat_bar_text: 'メニュー',
      open_by_default: true,
      areas: [area('a1', 0, { type: 'reply', mode: 'text', text: '書き直した文章' }), area('a2', 0.25, { type: 'reply', mode: 'message', message_id: 'msgother0001' })],
    });
    expect(saved.ok).toBe(true);
    expect(await service.resolveRichMenuReply(STORE, menuId, 'a2')).toBeNull();
  });

  it('文章を直したら、保存するだけで返す内容が変わる（反映し直さなくてよい）', async () => {
    expect(await service.resolveRichMenuReply(STORE, menuId, 'a1')).toEqual([{ type: 'text', text: '書き直した文章' }]);
  });

  it('消えたボタン・応答メッセージでないボタン・無いメニュー・ほかの店舗のメニューは何も返さない', async () => {
    expect(await service.resolveRichMenuReply(STORE, menuId, 'a4')).toBeNull();
    expect(await service.resolveRichMenuReply(STORE, menuId, 'zz')).toBeNull();
    expect(await service.resolveRichMenuReply(STORE, 'no-such-menu', 'a1')).toBeNull();
    expect(await service.resolveRichMenuReply(OTHER, menuId, 'a1')).toBeNull();
  });

  it('一覧に、選べる LINE メッセージが入る', async () => {
    const overview = await service.getRichMenuOverview(STORE, 'http://localhost');
    expect(overview.messages).toEqual([
      { id: 'msgon0000001', name: 'メッセージ msgon0000001', enabled: true },
      { id: 'msgoff000001', name: 'メッセージ msgoff000001', enabled: false },
    ]);
  });
});
