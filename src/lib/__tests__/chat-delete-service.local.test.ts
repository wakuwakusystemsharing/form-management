/**
 * 1 対 1 トーク: 会話を消す（お客様から削除を求められたとき。local = JSON）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/chat-service');
let repo: typeof import('@/lib/chat-repository');

const STORE = 'st0001';
const OTHER = 'st0002';
const T0 = Date.parse('2026-11-25T03:00:00Z');
const KEY1 = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);

let seq = 0;
const textEvent = (text: string, opts: { user?: string; at?: number } = {}) => ({ type: 'message', timestamp: opts.at ?? T0, source: { type: 'user', userId: opts.user ?? 'U1' }, message: { id: `m${++seq}`, type: 'text', text } });
const imageEvent = (id: string, at: number) => ({ type: 'message', timestamp: at, source: { type: 'user', userId: 'U1' }, message: { id, type: 'image' } });
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const record = (events: unknown[], storeId = STORE) =>
  service.recordChatInboundEvents(storeId, events, { verified: false }, { fetchContent: async () => ({ content: { data: PNG, contentType: 'image/png' } }), wait: async () => undefined });
const threadOf = (user: string, storeId = STORE) => repo.readLocalChatData().threads.find((t) => t.line_user_id === user && t.store_id === storeId);
const USER = { id: 'u-master', email: 'master@example.com' };

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-delete-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: 'テスト店', line_channel_access_token: 'store-token' }, { id: OTHER, name: 'となりの店', line_channel_access_token: 'other-token' }]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子', total_visits: 3 }]));
  service = await import('@/lib/chat-service');
  repo = await import('@/lib/chat-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (fs.existsSync(dataFile('chat.json'))) fs.rmSync(dataFile('chat.json'));
  for (const dir of [dataFile('chat_media'), path.join(tmpDir, 'public')]) fs.rmSync(dir, { recursive: true, force: true });
  expect((await service.updateChatSettings(STORE, { enabled: true })).ok).toBe(true);
});

describe('会話を消す', () => {
  it('その会話のメッセージ・自動の記録・画像（届いた画像・送った画像）をすべて消す。ほかのお客様の会話は残る', async () => {
    await record([textEvent('こんにちは'), imageEvent('img1', T0 + 1000), textEvent('別の人です', { user: 'U2', at: T0 + 2000 })]);
    const id = threadOf('U1')!.id;
    const up = await service.uploadChatReplyImage(STORE, JPEG);
    const url = up.ok ? up.url : '';
    await service.sendChatReply(STORE, id, { image_url: url, client_key: KEY1 }, null, { now: new Date(T0 + 3000) });
    await service.recordChatSystemEventsSafe(STORE, [{ line_user_id: 'U1', kind: 'reminder', text: 'リマインダーを送信しました', source_key: 'reminder:1', at: new Date(T0 + 4000) }]);
    const inbound = repo.readLocalChatData().messages.find((m) => m.line_message_id === 'img1')!;
    const inFile = path.join(tmpDir, 'data', 'chat_media', inbound.media_path!);
    const outFile = path.join(tmpDir, 'public', url.slice(1));
    expect(fs.existsSync(inFile) && fs.existsSync(outFile)).toBe(true);

    expect(await service.deleteChatThread(STORE, id, USER)).toEqual({ ok: true, messages: 4, images: 2 });

    expect(fs.existsSync(inFile)).toBe(false);
    expect(fs.existsSync(outFile)).toBe(false);
    const { threads, messages } = repo.readLocalChatData();
    expect(threads.map((t) => t.line_user_id)).toEqual(['U2']);
    expect(messages.map((m) => m.text)).toEqual(['別の人です']);
    expect((await service.getChatOverview(STORE)).threads.map((t) => t.name)).toEqual(['（お名前不明）']);
    expect(await service.getChatThreadDetail(STORE, id)).toBeNull();
  });

  it('顧客の情報は消さない。未読の合計は、消した会話のぶんだけ減る', async () => {
    await record([textEvent('こんにちは'), textEvent('もう 1 通', { at: T0 + 1000 }), textEvent('別の人です', { user: 'U2', at: T0 + 2000 })]);
    expect((await service.getChatUnread(STORE)).unread).toBe(3);
    await service.deleteChatThread(STORE, threadOf('U1')!.id, USER);
    expect((await service.getChatUnread(STORE)).unread).toBe(1);
    expect(JSON.parse(fs.readFileSync(dataFile('customers.json'), 'utf-8'))).toEqual([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子', total_visits: 3 }]);
  });

  it('消したあとに同じお客様から届いたメッセージは、新しい会話として保存される（前の内容は戻らない）', async () => {
    await record([textEvent('消してほしい内容')]);
    const oldId = threadOf('U1')!.id;
    await service.deleteChatThread(STORE, oldId, USER);
    await record([textEvent('また連絡しました', { at: T0 + 60000 })]);
    const thread = threadOf('U1')!;
    expect(thread.id).not.toBe(oldId);
    expect((await service.getChatThreadDetail(STORE, thread.id))?.messages.map((m) => m.text)).toEqual(['また連絡しました']);
  });

  it('他の店舗の会話・無い会話・形のおかしい ID は消さない', async () => {
    await service.updateChatSettings(OTHER, { enabled: true });
    await record([textEvent('こんにちは')]);
    await record([textEvent('となりの店のお客様です')], OTHER);
    const otherId = threadOf('U1', OTHER)!.id;
    expect(await service.deleteChatThread(STORE, otherId, USER)).toMatchObject({ ok: false, status: 404 });
    expect(await service.deleteChatThread(STORE, '00000000-0000-4000-8000-000000000000', USER)).toMatchObject({ ok: false, status: 404 });
    expect(await service.deleteChatThread(STORE, "x' or '1'='1", USER)).toMatchObject({ ok: false, status: 404 });
    expect(repo.readLocalChatData().threads).toHaveLength(2);
    expect(repo.readLocalChatData().messages).toHaveLength(2);
  });

  it('記録の画像の場所が、その店舗の置き場の外を指していても、そのファイルは消さない', async () => {
    await record([textEvent('こんにちは'), imageEvent('img1', T0 + 1000)]);
    const id = threadOf('U1')!.id;
    // ほかの店舗の置き場にあるファイル（消されてはいけない）
    const foreign = path.join(tmpDir, 'data', 'chat_media', OTHER, 'x', '1.png');
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, PNG);
    const file = dataFile('chat.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    data.messages.find((m: { line_message_id: string }) => m.line_message_id === 'img1').media_path = `${OTHER}/x/1.png`;
    fs.writeFileSync(file, JSON.stringify(data));
    expect(await service.deleteChatThread(STORE, id, USER)).toMatchObject({ ok: true, images: 0 });
    expect(fs.existsSync(foreign)).toBe(true);
    expect(repo.readLocalChatData().threads).toHaveLength(0);
  });

  it('トーク機能を OFF にした店舗の会話も消せる（保存済みの会話は残っているため）', async () => {
    await record([textEvent('こんにちは')]);
    await service.updateChatSettings(STORE, { enabled: false });
    expect(await service.deleteChatThread(STORE, threadOf('U1')!.id, USER)).toEqual({ ok: true, messages: 1, images: 0 });
  });
});
