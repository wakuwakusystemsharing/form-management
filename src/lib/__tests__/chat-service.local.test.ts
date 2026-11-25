/**
 * 1 対 1 トーク: 設定と、Webhook で届いたメッセージの保存（local = JSON）
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

let seq = 0;
const textEvent = (text: string, opts: { user?: string; at?: number; id?: string; sourceType?: string } = {}) => ({
  type: 'message',
  replyToken: 'r',
  timestamp: opts.at ?? T0,
  source: { type: opts.sourceType ?? 'user', userId: opts.user ?? 'U1' },
  message: { id: opts.id ?? `m${++seq}`, type: 'text', text },
});

const chatFile = () => path.join(tmpDir, 'data', 'chat.json');
const reset = () => {
  if (fs.existsSync(chatFile())) fs.rmSync(chatFile());
};
const turnOn = async () => {
  const r = await service.updateChatSettings(STORE, { enabled: true });
  expect(r.ok).toBe(true);
};
const record = (events: unknown[]) => service.recordChatInboundEvents(STORE, events, { verified: false });

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-service-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'data', 'stores.json'), JSON.stringify([{ id: STORE, name: 'テスト店', broadcast_opt_out_keyword: '配信停止', broadcast_opt_in_keyword: '配信再開' }]));
  fs.writeFileSync(path.join(tmpDir, 'data', 'customers.json'), JSON.stringify([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田' }]));
  service = await import('@/lib/chat-service');
  repo = await import('@/lib/chat-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  reset();
});

describe('トークの設定', () => {
  it('既定は OFF。ON にすると日時が入り、保存期間だけ変えても ON のまま', async () => {
    const before = await service.getChatSettingsView(STORE);
    expect(before).toMatchObject({ enabled: false, retention_years: 1, enabled_at: null, stats: { threads: 0, messages: 0, last_message_at: null } });

    const on = await service.updateChatSettings(STORE, { enabled: true });
    expect(on.ok && on.view.enabled).toBe(true);
    const enabledAt = on.ok ? on.view.enabled_at : null;
    expect(enabledAt).toBeTruthy();

    const years = await service.updateChatSettings(STORE, { retention_years: 3 });
    expect(years.ok && years.view).toMatchObject({ enabled: true, retention_years: 3, enabled_at: enabledAt });

    const off = await service.updateChatSettings(STORE, { enabled: false });
    expect(off.ok && off.view.enabled).toBe(false);
  });

  it('選べない値は 400 で断り、設定は変わらない', async () => {
    const r = await service.updateChatSettings(STORE, { enabled: true, retention_years: 10 });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect((await service.getChatSettingsView(STORE)).enabled).toBe(false);
  });
});

describe('届いたメッセージの保存', () => {
  it('OFF の店舗では何も保存しない', async () => {
    expect(await record([textEvent('こんにちは')])).toMatchObject({ saved: 0, skipped: 'disabled' });
    expect(repo.readLocalChatData()).toEqual({ threads: [], messages: [] });
    expect(fs.existsSync(chatFile())).toBe(false);
  });

  it('ON の店舗では保存し、会話は LINE ユーザーごとに 1 本。顧客が見つかればひも付ける', async () => {
    await turnOn();
    expect(await record([textEvent('こんにちは', { at: T0 }), textEvent('駐車場はありますか？', { at: T0 + 60000 }), textEvent('はじめまして', { user: 'U2', at: T0 + 1000 })])).toMatchObject({ saved: 3, duplicated: 0, failed: 0 });
    const { threads, messages } = repo.readLocalChatData();
    expect(threads).toHaveLength(2);
    const t1 = threads.find((t) => t.line_user_id === 'U1')!;
    expect(t1).toMatchObject({ store_id: STORE, customer_id: 'c1', unread_count: 2, status: 'open', last_message_preview: '駐車場はありますか？', last_message_at: new Date(T0 + 60000).toISOString() });
    expect(threads.find((t) => t.line_user_id === 'U2')).toMatchObject({ customer_id: null, unread_count: 1 });
    expect(messages.filter((m) => m.thread_id === t1.id).map((m) => [m.direction, m.kind, m.text, m.auto])).toEqual([
      ['in', 'text', 'こんにちは', false],
      ['in', 'text', '駐車場はありますか？', false],
    ]);
    expect((await service.getChatSettingsView(STORE)).stats).toEqual({ threads: 2, messages: 3, last_message_at: new Date(T0 + 60000).toISOString() });
  });

  it('同じ通知が 2 回届いても 1 件（未読も増えない）', async () => {
    await turnOn();
    const ev = textEvent('こんにちは', { id: 'same-1' });
    expect(await record([ev])).toMatchObject({ saved: 1 });
    expect(await record([ev])).toMatchObject({ saved: 0, duplicated: 1 });
    const { threads, messages } = repo.readLocalChatData();
    expect(messages).toHaveLength(1);
    expect(threads[0].unread_count).toBe(1);
  });

  it('フォームの送信文・コマンド・続けて送られた文は「自動」で、未読に数えない', async () => {
    await turnOn();
    await record([
      textEvent('【カット予約フォーム】\n《お名前》\n山田', { at: T0 }),
      textEvent('ご予約ありがとうございます', { at: T0 + 200 }),
      textEvent('予約確認', { at: T0 + 60000 }),
      textEvent('配信停止', { at: T0 + 120000 }),
      textEvent('ありがとうございます！', { at: T0 + 180000 }),
    ]);
    const { threads, messages } = repo.readLocalChatData();
    expect(messages.map((m) => [m.auto, m.auto_kind])).toEqual([
      [true, 'form'],
      [true, 'follow_up'],
      [true, 'command'],
      [true, 'command'],
      [false, null],
    ]);
    expect(threads[0].unread_count).toBe(1);
    expect(threads[0].last_message_preview).toBe('ありがとうございます！');
  });

  it('通知がばらばらに届いても、フォームの送信文に続く文に印が付く', async () => {
    await turnOn();
    await record([textEvent('【アンケート】\n《ご感想》\nよかった', { at: T0 })]);
    await record([textEvent('クーポンはこちら', { at: T0 + 500 })]);
    await record([textEvent('また行きます', { at: T0 + 30000 })]);
    expect(repo.readLocalChatData().messages.map((m) => m.auto_kind)).toEqual(['form', 'follow_up', null]);
  });

  it('画像・スタンプ・動画は種類だけを保存し、未読に数える', async () => {
    await turnOn();
    const ev = (type: string, extra: Record<string, string> = {}) => ({ type: 'message', timestamp: T0 + ++seq, source: { type: 'user', userId: 'U1' }, message: { id: `x${seq}`, type, ...extra } });
    await record([ev('image'), ev('sticker', { packageId: '446', stickerId: '1988' }), ev('video')]);
    const { threads, messages } = repo.readLocalChatData();
    expect(messages.map((m) => [m.kind, m.text, m.meta, m.media_path])).toEqual([
      ['image', null, null, null],
      ['sticker', null, { sticker_id: '1988', package_id: '446' }, null],
      ['video', null, null, null],
    ]);
    expect(threads[0]).toMatchObject({ unread_count: 3, last_message_preview: '動画が送られました' });
  });

  it('グループの発言・友だち追加・ボタン操作は保存しない', async () => {
    await turnOn();
    const r = await record([textEvent('グループの発言', { sourceType: 'group' }), { type: 'follow', timestamp: T0, source: { type: 'user', userId: 'U1' } }, { type: 'postback', timestamp: T0, source: { type: 'user', userId: 'U1' }, postback: { data: 'rc:d:1' } }]);
    expect(r).toMatchObject({ saved: 0, skipped: 'none' });
    expect(repo.readLocalChatData().messages).toHaveLength(0);
  });

  it('OFF に戻すと保存しなくなるが、保存済みの会話は残る', async () => {
    await turnOn();
    await record([textEvent('こんにちは')]);
    await service.updateChatSettings(STORE, { enabled: false });
    expect(await record([textEvent('もう 1 通')])).toMatchObject({ saved: 0, skipped: 'disabled' });
    expect(repo.readLocalChatData().messages).toHaveLength(1);
  });

  it('保存先が壊れていても例外を投げない（Webhook の応答を止めない）', async () => {
    await turnOn();
    await expect(service.recordChatInboundEvents(STORE, [null, 'x', { type: 'message' }], { verified: false })).resolves.toMatchObject({ saved: 0 });
  });
});
