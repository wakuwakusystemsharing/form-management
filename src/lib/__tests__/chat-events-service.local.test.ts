/**
 * 1 対 1 トーク（④-5）: 自動で送ったメッセージを会話に出す・利用量の記録（local = JSON）
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
const KEY2 = '22222222-2222-4222-8222-222222222222';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);

let seq = 0;
const textEvent = (text: string, opts: { user?: string; at?: number } = {}) => ({ type: 'message', timestamp: opts.at ?? T0, source: { type: 'user', userId: opts.user ?? 'U1' }, message: { id: `m${++seq}`, type: 'text', text } });
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const record = (events: unknown[], storeId = STORE) => service.recordChatInboundEvents(storeId, events, { verified: false });
const reminder = (user: string, key: string, at = T0 + 3600000) => ({ line_user_id: user, kind: 'reminder' as const, text: 'リマインダーを送信しました（11月26日（木） 14:00 のご予約）', source_key: key, at: new Date(at) });
const messagesOf = () => repo.readLocalChatData().messages;

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-events-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(
    dataFile('stores.json'),
    JSON.stringify([
      { id: STORE, name: 'テスト店' },
      { id: OTHER, name: 'となりの店' },
      { id: 'st0003', name: 'トークを使っていない店' },
    ]),
  );
  service = await import('@/lib/chat-service');
  repo = await import('@/lib/chat-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (fs.existsSync(dataFile('chat.json'))) fs.rmSync(dataFile('chat.json'));
  fs.rmSync(path.join(tmpDir, 'public'), { recursive: true, force: true });
  expect((await service.updateChatSettings(STORE, { enabled: true })).ok).toBe(true);
});

describe('自動で送ったメッセージを会話に出す', () => {
  it('会話のあるお客様には 1 行で残る。未読・一覧の 1 行・並び順は変わらない', async () => {
    await record([textEvent('こんにちは')]);
    const before = (await service.getChatOverview(STORE)).threads[0];
    expect(await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'reminder:log-1')])).toBe(1);
    const after = (await service.getChatOverview(STORE)).threads[0];
    expect(after).toMatchObject({ unread_count: before.unread_count, preview: before.preview, last_message_at: before.last_message_at, status: 'open' });
    const detail = await service.getChatThreadDetail(STORE, after.id, { read: false });
    expect(detail?.messages.map((m) => [m.direction, m.auto, m.text])).toEqual([
      ['in', false, 'こんにちは'],
      ['system', true, 'リマインダーを送信しました（11月26日（木） 14:00 のご予約）'],
    ]);
  });

  it('会話の無いお客様の会話は作らない（配信のたびに、空の会話ができないように）', async () => {
    await record([textEvent('こんにちは')]);
    expect(await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'broadcast:r1'), reminder('U2', 'broadcast:r2'), reminder('U3', 'broadcast:r3')])).toBe(1);
    expect(repo.readLocalChatData().threads.map((t) => t.line_user_id)).toEqual(['U1']);
  });

  it('同じ送信（同じ鍵）は 1 回だけ。送信処理がやり直されても増えない', async () => {
    await record([textEvent('こんにちは')]);
    expect(await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'reminder:log-1')])).toBe(1);
    expect(await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'reminder:log-1'), reminder('U1', 'reminder:log-2')])).toBe(1);
    expect(messagesOf().filter((m) => m.direction === 'system')).toHaveLength(2);
  });

  it('トーク機能が OFF の店舗・設定の無い店舗では、何も記録しない', async () => {
    await record([textEvent('こんにちは')]);
    await service.updateChatSettings(STORE, { enabled: false });
    expect(await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'reminder:log-1')])).toBe(0);
    expect(await service.recordChatSystemEventsSafe('st0003', [reminder('U1', 'reminder:log-2')])).toBe(0);
    expect(messagesOf().filter((m) => m.direction === 'system')).toHaveLength(0);
  });

  it('ほかの店舗の会話には記録しない（同じ LINE ユーザーが両方の店舗にいても）', async () => {
    await service.updateChatSettings(OTHER, { enabled: true });
    await record([textEvent('こんにちは')]);
    await record([textEvent('こんにちは')], OTHER);
    await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'reminder:log-1')]);
    expect(messagesOf().filter((m) => m.direction === 'system').map((m) => m.store_id)).toEqual([STORE]);
  });

  it('自動の記録では、通知の対象にも、未読にも、利用量にもならない', async () => {
    await service.updateChatNotifySettings(STORE, { email: true, emails: ['a@example.com'], quiet: { enabled: false, start: 22, end: 8 } });
    await record([textEvent('こんにちは')]);
    const usageBefore = (await service.getChatUsageReport('2026-11')).rows.find((r) => r.store_id === STORE)?.current;
    await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'reminder:log-1')]);
    expect((await service.getChatUnread(STORE)).unread).toBe(1);
    expect((await service.getChatUsageReport('2026-11')).rows.find((r) => r.store_id === STORE)?.current).toEqual(usageBefore);
    // 対応済みにした会話は、自動の記録では対応中に戻らない
    const id = repo.readLocalChatData().threads[0].id;
    await service.updateChatThreadStatus(STORE, id, { status: 'done' });
    await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'reminder:log-2')]);
    expect(repo.readLocalChatData().threads[0].status).toBe('done');
  });

  it('形のおかしい記録・店舗が分からないときは、何もせずに 0 を返す（例外を投げない）', async () => {
    await record([textEvent('こんにちは')]);
    await expect(service.recordChatSystemEventsSafe(null, [reminder('U1', 'k')])).resolves.toBe(0);
    await expect(service.recordChatSystemEventsSafe(STORE, [{ line_user_id: 'U1', kind: 'follow', text: '', source_key: 'k' }])).resolves.toBe(0);
    await expect(service.recordChatSystemEventsSafe(STORE, [])).resolves.toBe(0);
  });

  it('Webhook の自動の返信: 1 回の返信 = 1 行。同じ返信の鍵は 1 回だけ', async () => {
    await record([textEvent('予約確認')]);
    const replies = [{ replyToken: 'tokenAAA', messages: [{ type: 'flex', altText: 'ご予約確認', contents: {} }], at: new Date(T0 + 1000).toISOString() }];
    service.scheduleChatAutoReplyEvents(STORE, 'U1', replies);
    service.scheduleChatAutoReplyEvents(STORE, 'U1', replies);
    await new Promise((r) => setTimeout(r, 50));
    const system = messagesOf().filter((m) => m.direction === 'system');
    expect(system.map((m) => [m.text, m.client_key, m.meta])).toEqual([['「ご予約確認」を自動で返信しました', 'reply:tokenAAA:0', { event: 'auto_reply' }]]);
  });

  it('保存期間を過ぎた自動の記録も、自動削除で消える', async () => {
    const now = new Date('2028-01-10T00:00:00Z');
    await record([textEvent('古い', { at: now.getTime() - 400 * 86400000 })]);
    await service.recordChatSystemEventsSafe(STORE, [reminder('U1', 'reminder:old', now.getTime() - 399 * 86400000)]);
    expect(await service.runChatRetention(now)).toEqual({ messages: 2, threads: 1, remaining: false });
  });
});

describe('利用量', () => {
  it('受信は、お客様が手で書いた文・画像だけを数える（フォームの送信文・コマンドは数えない）。月は日本時間', async () => {
    await record([
      textEvent('こんにちは', { at: Date.parse('2026-11-25T03:00:00Z') }),
      textEvent('【カット予約フォーム】\n《お名前》\n山田', { at: Date.parse('2026-11-25T04:00:00Z') }),
      textEvent('予約確認', { at: Date.parse('2026-11-25T05:00:00Z') }),
      textEvent('月末の夜です', { at: Date.parse('2026-11-30T14:59:00Z') }),
      textEvent('月初の朝です', { at: Date.parse('2026-11-30T15:00:00Z') }),
    ]);
    const nov = await service.getChatUsageReport('2026-11');
    expect(nov.rows.find((r) => r.store_id === STORE)).toMatchObject({ store_name: 'テスト店', enabled: true, current: { inbound: 2, outbound: 0, image_bytes: 0 } });
    const dec = await service.getChatUsageReport('2026-12');
    expect(dec.rows.find((r) => r.store_id === STORE)).toMatchObject({ current: { inbound: 1 }, previous: { inbound: 2 } });
    expect(dec).toMatchObject({ month: '2026-12', previous_month: '2026-11', unavailable: false });
  });

  it('同じ通知が送り直されても、受信は 1 回だけ数える', async () => {
    const ev = textEvent('こんにちは');
    await record([ev]);
    await record([ev]);
    expect((await service.getChatUsageReport('2026-11')).rows[0].current.inbound).toBe(1);
  });

  it('返信は、送れたものだけを数える。同じ送信の ID の送り直しでは増えない。画像は容量も足す', async () => {
    await record([textEvent('こんにちは')]);
    const id = repo.readLocalChatData().threads[0].id;
    const now = new Date('2026-11-25T06:00:00Z');
    await service.sendChatReply(STORE, id, { text: 'ありがとうございます', client_key: KEY1 }, null, { now });
    await service.sendChatReply(STORE, id, { text: 'ありがとうございます', client_key: KEY1 }, null, { now });
    expect(await service.sendChatReply(STORE, id, { text: ' ', client_key: KEY2 }, null, { now })).toMatchObject({ ok: false });
    const up = await service.uploadChatReplyImage(STORE, JPEG);
    await service.sendChatReply(STORE, id, { image_url: up.ok ? up.url : '', client_key: KEY2 }, null, { now });
    const row = (await service.getChatUsageReport(service ? '2026-11' : null)).rows[0];
    expect(row.current).toMatchObject({ inbound: 1, outbound: 2 });
    expect(row.current.image_bytes).toBeGreaterThanOrEqual(JPEG.length);
  });

  it('一覧: トークを使ったことのある店舗だけを出す。合計は出した店舗の合計', async () => {
    await service.updateChatSettings(OTHER, { enabled: true });
    await record([textEvent('こんにちは')]);
    await record([textEvent('こんにちは'), textEvent('もう 1 通', { at: T0 + 1000 })], OTHER);
    await service.updateChatSettings(OTHER, { enabled: false });
    // 通知の設定だけを保存した店舗（トークを一度も ON にしていない）は出さない
    await service.updateChatNotifySettings('st0003', { email: true, emails: ['a@example.com'] });
    const report = await service.getChatUsageReport('2026-11');
    expect(report.rows.map((r) => [r.store_id, r.enabled, r.current.inbound])).toEqual([
      [STORE, true, 1],
      [OTHER, false, 2],
    ]);
    expect(report.totals).toEqual({ inbound: 3, outbound: 0, image_bytes: 0 });
    expect(JSON.stringify(report)).not.toMatch(/U\d/);
  });

  it('形のおかしい月は今月として扱う', async () => {
    const report = await service.getChatUsageReport('2026-13', new Date('2026-11-25T03:00:00Z'));
    expect(report.month).toBe('2026-11');
  });
});
