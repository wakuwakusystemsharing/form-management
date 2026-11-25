/**
 * 1 対 1 トーク（④-4）: 画像の受信と返信・定型文・対応済みの切り替え・画像を持つ会話の自動削除（local = JSON）
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
const T0 = Date.parse('2026-11-25T03:00:00Z');
const KEY1 = '11111111-1111-4111-8111-111111111111';
const KEY2 = '22222222-2222-4222-8222-222222222222';

/** 1×1 の PNG / 小さな JPEG の先頭（形式の判定に使える最小の中身） */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);

let seq = 0;
const textEvent = (text: string, opts: { user?: string; at?: number } = {}) => ({ type: 'message', timestamp: opts.at ?? T0, source: { type: 'user', userId: opts.user ?? 'U1' }, message: { id: `m${++seq}`, type: 'text', text } });
const imageEvent = (id: string, at: number = T0) => ({ type: 'message', timestamp: at, source: { type: 'user', userId: 'U1' }, message: { id, type: 'image' } });

const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const noWait = async () => undefined;
const okContent = (data: Buffer = PNG, contentType = 'image/png') => async () => ({ content: { data, contentType } });
const record = (events: unknown[], fetchContent?: Parameters<typeof service.storeChatInboundImage>[2] extends infer D ? (D extends { fetchContent?: infer F } ? F : never) : never) =>
  service.recordChatInboundEvents(STORE, events, { verified: false }, { fetchContent, wait: noWait });
const threadId = () => repo.readLocalChatData().threads[0].id;

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-media-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: 'テスト店', line_channel_access_token: 'store-token' }]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子' }]));
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

describe('お客様から届いた画像', () => {
  it('LINE から中身を取得して、公開しない置き場に保存する。画面には、ログインが要る API の URL を返す', async () => {
    await record([imageEvent('img1')], okContent());
    const m = repo.readLocalChatData().messages[0];
    expect(m).toMatchObject({ kind: 'image', direction: 'in', media_path: `${STORE}/${m.thread_id}/${m.id}.png`, meta: null });
    // 保存先は public の下ではない（外から直接は見えない）
    expect(fs.existsSync(path.join(tmpDir, 'data', 'chat_media', m.media_path!))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'public'))).toBe(false);
    const detail = await service.getChatThreadDetail(STORE, m.thread_id);
    expect(detail?.messages[0]).toMatchObject({ kind: 'image', image_url: `/api/stores/${STORE}/chat/media/${m.id}`, image_failed: false });
    const image = await service.getChatInboundImage(STORE, m.id);
    expect(image?.contentType).toBe('image/png');
    expect(image?.data.equals(PNG)).toBe(true);
  });

  it('LINE 側の準備中・一時的なエラーは 3 回まで試す。3 回目で取れれば保存する', async () => {
    let calls = 0;
    await record([imageEvent('img1')], async () => (++calls < 3 ? { content: null, reason: 'LINE の応答 202', retry: true } : { content: { data: JPEG, contentType: 'image/jpeg' } }));
    expect(calls).toBe(3);
    expect(repo.readLocalChatData().messages[0].media_path).toMatch(/\.jpg$/);
  });

  it('取得できなかった画像は「読み込めませんでした」の印を付けて、メッセージは残す。やり直しても無駄なエラーは 1 回でやめる', async () => {
    let calls = 0;
    const summary = await record([imageEvent('img1')], async () => {
      calls += 1;
      return { content: null, reason: 'LINE の応答 404' };
    });
    expect(summary).toMatchObject({ saved: 1, failed: 0 });
    expect(calls).toBe(1);
    const m = repo.readLocalChatData().messages[0];
    expect(m).toMatchObject({ kind: 'image', media_path: null, meta: { media_error: '1' } });
    const detail = await service.getChatThreadDetail(STORE, m.thread_id);
    expect(detail?.messages[0]).toMatchObject({ image_url: null, image_failed: true });
    expect(await service.getChatInboundImage(STORE, m.id)).toBeNull();
  });

  it('画像でない中身は保存しない', async () => {
    await record([imageEvent('img1')], async () => ({ content: { data: Buffer.from('<html>'), contentType: 'text/html' } }));
    expect(repo.readLocalChatData().messages[0]).toMatchObject({ media_path: null, meta: { media_error: '1' } });
  });

  it('同じ通知が送り直されても、画像を取りにいくのは 1 回', async () => {
    let calls = 0;
    const fetchContent = async () => {
      calls += 1;
      return { content: { data: PNG, contentType: 'image/png' } };
    };
    const ev = imageEvent('img1');
    await record([ev], fetchContent);
    await record([ev], fetchContent);
    expect(calls).toBe(1);
  });

  it('他の店舗からは読めない。文字のメッセージ・形のおかしい ID でも返さない', async () => {
    await record([imageEvent('img1'), textEvent('こんにちは', { at: T0 + 1000 })], okContent());
    const [image, text] = repo.readLocalChatData().messages;
    expect(await service.getChatInboundImage('st9999', image.id)).toBeNull();
    expect(await service.getChatInboundImage(STORE, text.id)).toBeNull();
    expect(await service.getChatInboundImage(STORE, '../x')).toBeNull();
    expect(await service.getChatInboundImage(STORE, '999')).toBeNull();
  });

  it('記録の保存先が、その店舗の置き場の外を指していても読まない', async () => {
    await record([imageEvent('img1')], okContent());
    const file = dataFile('chat.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    data.messages[0].media_path = 'st9999/x/1.png';
    fs.writeFileSync(file, JSON.stringify(data));
    expect(await service.getChatInboundImage(STORE, data.messages[0].id)).toBeNull();
  });
});

describe('画像の返信', () => {
  const seed = async () => {
    await record([textEvent('こんにちは')]);
    return threadId();
  };

  it('アップロードした画像を送れる。会話には画像として残り、一覧の 1 行は「画像を送りました」', async () => {
    const id = await seed();
    const up = await service.uploadChatReplyImage(STORE, JPEG);
    expect(up.ok).toBe(true);
    const url = up.ok ? up.url : '';
    expect(url).toMatch(new RegExp(`^/chat_images/${STORE}/[0-9a-f]{32}\\.jpg$`));
    const r = await service.sendChatReply(STORE, id, { image_url: url, client_key: KEY1 }, { id: 'u1', email: 'staff@example.com' }, { now: new Date(T0 + 60000) });
    expect(r).toMatchObject({ ok: true, message: { direction: 'out', kind: 'image', text: null, image_url: url, send_status: 'sent', sent_by_name: 'staff@example.com' } });
    const saved = repo.readLocalChatData().messages.find((m) => m.direction === 'out')!;
    expect(saved).toMatchObject({ kind: 'image', media_path: url.slice(1), meta: { sent_by_name: 'staff@example.com', image_url: url } });
    expect((await service.getChatOverview(STORE)).threads[0].preview).toBe('画像を送りました');
    // 同じ送信の ID をもう一度送っても 1 通
    await service.sendChatReply(STORE, id, { image_url: url, client_key: KEY1 }, null);
    expect(repo.readLocalChatData().messages.filter((m) => m.direction === 'out')).toHaveLength(1);
  });

  it('PNG は png として保存する。JPEG / PNG 以外・1MB 超・空のファイルは断る', async () => {
    await seed();
    const png = await service.uploadChatReplyImage(STORE, PNG);
    expect(png.ok && png.url).toMatch(/\.png$/);
    expect(await service.uploadChatReplyImage(STORE, Buffer.from('GIF89a................'))).toMatchObject({ ok: false, status: 400 });
    expect(await service.uploadChatReplyImage(STORE, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toMatchObject({ ok: false, status: 400 });
    expect(await service.uploadChatReplyImage(STORE, Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]))).toMatchObject({ ok: false, status: 400 });
    expect(await service.uploadChatReplyImage(STORE, Buffer.alloc(0))).toMatchObject({ ok: false, status: 400 });
  });

  it('この店舗の置き場にない URL は送らない（ほかの店舗の画像・外のサイト・http）', async () => {
    const id = await seed();
    for (const image_url of [
      'https://evil.example/x.jpg',
      `https://evil.example/chat_images/st9999/${'a'.repeat(32)}.jpg`,
      `http://x.supabase.co/storage/v1/object/public/forms/chat_images/${STORE}/${'a'.repeat(32)}.jpg`,
      `/chat_images/${STORE}/../../secret.jpg`,
      `/menu_images/${STORE}/${'a'.repeat(32)}.jpg`,
    ]) {
      expect(await service.sendChatReply(STORE, id, { image_url, client_key: KEY2 }, null), image_url).toMatchObject({ ok: false, status: 400 });
    }
    expect(repo.readLocalChatData().messages.filter((m) => m.direction === 'out')).toHaveLength(0);
  });

  it('トーク機能が OFF の店舗では、画像をアップロードできない', async () => {
    await service.updateChatSettings(STORE, { enabled: false });
    expect(await service.uploadChatReplyImage(STORE, JPEG)).toMatchObject({ ok: false, status: 409 });
    expect(fs.existsSync(path.join(tmpDir, 'public'))).toBe(false);
  });
});

describe('対応済みの切り替え', () => {
  it('対応済みにでき、「対応中」の絞り込みから外れる。お客様から新しいメッセージが届くと、対応中に戻る', async () => {
    await record([textEvent('こんにちは'), textEvent('別の人です', { user: 'U2', at: T0 + 1000 })]);
    const id = repo.readLocalChatData().threads.find((t) => t.line_user_id === 'U1')!.id;
    expect(await service.updateChatThreadStatus(STORE, id, { status: 'done' })).toEqual({ ok: true, status: 'done' });
    expect((await service.getChatOverview(STORE)).threads.find((t) => t.id === id)?.status).toBe('done');
    expect((await service.getChatOverview(STORE, { filter: 'open' })).threads.map((t) => t.name)).toEqual(['（お名前不明）']);
    // 自動の文（予約確認など）では戻らない
    await record([textEvent('予約確認', { at: T0 + 60000 })]);
    expect((await service.getChatOverview(STORE)).threads.find((t) => t.id === id)?.status).toBe('done');
    await record([textEvent('やっぱり質問があります', { at: T0 + 120000 })]);
    expect((await service.getChatOverview(STORE)).threads.find((t) => t.id === id)?.status).toBe('open');
    expect(await service.updateChatThreadStatus(STORE, id, { status: 'open' })).toEqual({ ok: true, status: 'open' });
  });

  it('決まっていない状態・他の店舗の会話・無い会話は断る', async () => {
    await record([textEvent('こんにちは')]);
    const id = threadId();
    expect(await service.updateChatThreadStatus(STORE, id, { status: 'closed' })).toMatchObject({ ok: false, status: 400 });
    expect(await service.updateChatThreadStatus('st9999', id, { status: 'done' })).toMatchObject({ ok: false, status: 404 });
    expect(await service.updateChatThreadStatus(STORE, '00000000-0000-4000-8000-000000000000', { status: 'done' })).toMatchObject({ ok: false, status: 404 });
    expect(repo.readLocalChatData().threads[0].status).toBe('open');
  });
});

describe('定型文', () => {
  it('保存して読み直せる。ほかの設定（ON / OFF・通知）は変わらない', async () => {
    expect(await service.getChatTemplates(STORE)).toEqual([]);
    await service.updateChatNotifySettings(STORE, { email: true, emails: ['a@example.com'] });
    const r = await service.updateChatTemplates(STORE, { templates: [{ title: ' 営業時間 ', text: '平日は 10 時から 19 時までです。' }, { id: 'thanks', title: 'お礼', text: 'ご連絡ありがとうございます。' }] });
    expect(r.ok && r.templates.map((t) => [t.title, t.text])).toEqual([
      ['営業時間', '平日は 10 時から 19 時までです。'],
      ['お礼', 'ご連絡ありがとうございます。'],
    ]);
    expect((await service.getChatTemplates(STORE)).map((t) => t.id)).toEqual(['t1', 'thanks']);
    expect(await service.getChatSettingsView(STORE)).toMatchObject({ enabled: true });
    expect((await service.getChatNotifyView(STORE)).settings.emails).toEqual(['a@example.com']);
    // トークの設定を変えても、定型文は残る
    await service.updateChatSettings(STORE, { retention_years: 2 });
    expect(await service.getChatTemplates(STORE)).toHaveLength(2);
    // 空にもできる
    expect(await service.updateChatTemplates(STORE, { templates: [] })).toEqual({ ok: true, templates: [] });
  });

  it('名前・文が空、長すぎる、30 個を超える ときは断る', async () => {
    expect(await service.updateChatTemplates(STORE, { templates: [{ title: '', text: 'あ' }] })).toMatchObject({ ok: false, status: 400 });
    expect(await service.updateChatTemplates(STORE, { templates: [{ title: 'あ', text: ' ' }] })).toMatchObject({ ok: false, status: 400 });
    expect(await service.updateChatTemplates(STORE, { templates: [{ title: 'あ'.repeat(31), text: 'あ' }] })).toMatchObject({ ok: false, status: 400 });
    expect(await service.updateChatTemplates(STORE, { templates: [{ title: 'あ', text: 'あ'.repeat(1001) }] })).toMatchObject({ ok: false, status: 400 });
    expect(await service.updateChatTemplates(STORE, { templates: Array.from({ length: 31 }, (_, i) => ({ title: `t${i}`, text: 'あ' })) })).toMatchObject({ ok: false, status: 400 });
    expect(await service.updateChatTemplates(STORE, { templates: 'x' })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('画像を持つ会話の自動削除', () => {
  const DAY = 86400000;
  const now = new Date('2028-01-10T00:00:00Z');
  const ago = (days: number) => now.getTime() - days * DAY;

  it('保存期間を過ぎた画像は、ファイルを消してから行を消す（届いた画像・送った画像の両方）。新しい画像は残す', async () => {
    await record([imageEvent('old-in', ago(400)), imageEvent('new-in', ago(10))], okContent());
    const id = threadId();
    const up = await service.uploadChatReplyImage(STORE, JPEG);
    const url = up.ok ? up.url : '';
    await service.sendChatReply(STORE, id, { image_url: url, client_key: KEY1 }, null, { now: new Date(ago(390)) });
    const before = repo.readLocalChatData().messages;
    const oldIn = before.find((m) => m.line_message_id === 'old-in')!;
    const newIn = before.find((m) => m.line_message_id === 'new-in')!;
    const inFile = (p: string) => path.join(tmpDir, 'data', 'chat_media', p);
    const outFile = path.join(tmpDir, 'public', url.slice(1));
    expect(fs.existsSync(inFile(oldIn.media_path!))).toBe(true);
    expect(fs.existsSync(outFile)).toBe(true);

    expect(await service.runChatRetention(now)).toEqual({ messages: 2, threads: 0, remaining: false });
    expect(fs.existsSync(inFile(oldIn.media_path!))).toBe(false);
    expect(fs.existsSync(outFile)).toBe(false);
    expect(fs.existsSync(inFile(newIn.media_path!))).toBe(true);
    expect(repo.readLocalChatData().messages.map((m) => m.line_message_id)).toEqual(['new-in']);
  });
});
