/**
 * 1 対 1 トーク: staging / production の動き（保存先は差し替え）
 * - 署名を確認できていない通知は保存しない
 * - チャネルシークレットを登録していない店舗は ON にできない
 * - マイグレーション未適用の環境では OFF として動き、ON にもできない
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_DEFAULT_SETTINGS, type ChatSettings } from '@/lib/chat';

const state = vi.hoisted(() => ({
  settings: null as unknown as ChatSettings,
  missing: false,
  secretSet: false,
  recorded: [] as Array<{ storeId: string; text: string | null; autoKind: string | null }>,
  failRecord: false,
  failKeywords: false,
  // ④-2: 返信
  token: 'token' as string | null,
  thread: null as null | { id: string; store_id: string; line_user_id: string; customer_id: string | null; unread_count: number; status: string; last_message_at: string; last_message_preview: string | null },
  out: [] as Array<Record<string, unknown>>,
  touched: 0,
}));

vi.mock('@/lib/chat-repository', () => ({
  getChatSettings: vi.fn(async () => ({ settings: state.settings, missing: state.missing })),
  getChatStats: vi.fn(async () => ({ threads: 0, messages: 0, last_message_at: null })),
  saveChatSettings: vi.fn(async (_storeId: string, value: { enabled: boolean; retention_years: 1 | 2 | 3 }) => {
    state.settings = { ...state.settings, ...value, enabled_at: value.enabled ? '2026-11-25T00:00:00.000Z' : state.settings.enabled_at };
    return state.settings;
  }),
  recordChatInbound: vi.fn(async (storeId: string, msg: { text: string | null }, autoKind: string | null) => {
    if (state.failRecord) throw new Error('db down');
    state.recorded.push({ storeId, text: msg.text, autoKind });
    return true;
  }),
  getChatThread: vi.fn(async (storeId: string, threadId: string) => (state.thread && state.thread.id === threadId && state.thread.store_id === storeId ? state.thread : null)),
  insertChatOutbound: vi.fn(async (storeId: string, threadId: string, input: { text: string; clientKey: string; sentByName: string | null; now?: Date }) => {
    const existing = state.out.find((m) => m.client_key === input.clientKey);
    if (existing) return { message: existing, created: false };
    const message = {
      id: String(state.out.length + 1),
      thread_id: threadId,
      store_id: storeId,
      direction: 'out',
      kind: 'text',
      text: input.text,
      meta: input.sentByName ? { sent_by_name: input.sentByName } : null,
      media_path: null,
      auto: false,
      auto_kind: null,
      line_message_id: null,
      client_key: input.clientKey,
      send_status: 'sending',
      send_error: null,
      sent_by: null,
      created_at: (input.now ?? new Date()).toISOString(),
    };
    state.out.push(message);
    return { message, created: true };
  }),
  updateChatOutboundStatus: vi.fn(async (_storeId: string, id: string, status: string, error: string | null) => {
    const m = state.out.find((x) => x.id === id);
    if (m) {
      m.send_status = status;
      m.send_error = error;
    }
  }),
  touchChatThreadAfterReply: vi.fn(async () => {
    state.touched += 1;
  }),
  listChatThreads: vi.fn(async () => []),
  listChatMessages: vi.fn(async () => ({ messages: [], hasMore: false })),
  markChatThreadRead: vi.fn(async () => undefined),
  countChatUnread: vi.fn(async () => 0),
  findChatCustomers: vi.fn(async () => []),
  setChatThreadCustomer: vi.fn(async () => undefined),
}));

vi.mock('@/lib/line-secret-repository', () => ({
  getStoreLineSecret: vi.fn(async () => (state.secretSet ? { status: 'set', secret: 'x'.repeat(32), updated_at: '2026-11-20T00:00:00.000Z' } : { status: 'none' })),
}));

vi.mock('@/lib/line-flex-repository', () => ({
  listEnabledLineFlexMessages: vi.fn(async () => {
    if (state.failKeywords) throw new Error('db down');
    return [{ keywords: ['メニュー'] }, { keywords: null }];
  }),
}));

vi.mock('@/lib/broadcast-repository', () => ({
  getBroadcastSettings: vi.fn(async () => {
    if (state.failKeywords) throw new Error('db down');
    return { opt_out_keyword: 'ストップ', opt_in_keyword: '再開' };
  }),
  getStoreLineToken: vi.fn(async () => state.token),
}));

const ev = (text: string, id: string) => ({ type: 'message', timestamp: Date.parse('2026-11-25T03:00:00Z'), source: { type: 'user', userId: 'U1' }, message: { id, type: 'text', text } });

const THREAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY = '3f2b8c1e-6a4d-4f7b-9c2a-1d5e8f0a7b3c';

let service: typeof import('@/lib/chat-service');

beforeEach(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'staging';
  state.settings = { ...CHAT_DEFAULT_SETTINGS };
  state.missing = false;
  state.secretSet = false;
  state.recorded = [];
  state.failRecord = false;
  state.failKeywords = false;
  state.token = 'token';
  state.thread = { id: THREAD, store_id: 'storea', line_user_id: 'U1', customer_id: null, unread_count: 1, status: 'open', last_message_at: '2026-11-25T03:00:00.000Z', last_message_preview: 'こんにちは' };
  state.out = [];
  state.touched = 0;
  service = await import('@/lib/chat-service');
}, 120000);

describe('ON にする条件', () => {
  it('チャネルシークレットが未登録の店舗は ON にできない', async () => {
    const view = await service.getChatSettingsView('storea');
    expect(view.secret_set).toBe(false);
    expect(view.enable_blocker).toContain('チャネルシークレット');
    const r = await service.updateChatSettings('storea', { enabled: true });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(state.settings.enabled).toBe(false);
  });

  it('登録済みなら ON にできる', async () => {
    state.secretSet = true;
    expect((await service.getChatSettingsView('storea')).enable_blocker).toBeNull();
    const r = await service.updateChatSettings('storea', { enabled: true });
    expect(r.ok && r.view.enabled).toBe(true);
  });

  it('ON のあとでシークレットを消しても、OFF にする・保存期間を変えるのはできる', async () => {
    state.settings = { ...CHAT_DEFAULT_SETTINGS, enabled: true, enabled_at: '2026-11-25T00:00:00.000Z' };
    expect((await service.updateChatSettings('storea', { retention_years: 2 })).ok).toBe(true);
    expect((await service.updateChatSettings('storea', { enabled: false })).ok).toBe(true);
  });

  it('マイグレーション未適用の環境では、理由を出して ON にできない', async () => {
    state.missing = true;
    state.secretSet = true;
    expect((await service.getChatSettingsView('storea')).enable_blocker).toContain('マイグレーション');
    expect(await service.updateChatSettings('storea', { enabled: true })).toMatchObject({ ok: false, status: 409 });
  });
});

describe('届いたメッセージの保存', () => {
  it('署名を確認できた通知だけ保存する', async () => {
    state.settings = { ...CHAT_DEFAULT_SETTINGS, enabled: true };
    expect(await service.recordChatInboundEvents('storea', [ev('こんにちは', 'm1')], { verified: false })).toMatchObject({ saved: 0, skipped: 'unverified' });
    expect(state.recorded).toHaveLength(0);
    expect(await service.recordChatInboundEvents('storea', [ev('こんにちは', 'm1')], { verified: true })).toMatchObject({ saved: 1 });
    expect(state.recorded).toEqual([{ storeId: 'storea', text: 'こんにちは', autoKind: null }]);
  });

  it('OFF の店舗では保存しない', async () => {
    expect(await service.recordChatInboundEvents('storea', [ev('こんにちは', 'm1')], { verified: true })).toMatchObject({ saved: 0, skipped: 'disabled' });
    expect(state.recorded).toHaveLength(0);
  });

  it('店舗のキーワード・配信停止の合言葉にも「自動」の印を付ける', async () => {
    state.settings = { ...CHAT_DEFAULT_SETTINGS, enabled: true };
    await service.recordChatInboundEvents('storea', [ev('メニュー', 'm1'), ev('ストップ', 'm2'), ev('メニューを見たいです', 'm3')], { verified: true });
    expect(state.recorded.map((r) => r.autoKind)).toEqual(['keyword', 'command', null]);
  });

  it('合言葉を読めなくても保存は続ける。保存に失敗しても例外を投げない', async () => {
    state.settings = { ...CHAT_DEFAULT_SETTINGS, enabled: true };
    state.failKeywords = true;
    expect(await service.recordChatInboundEvents('storea', [ev('メニュー', 'm1')], { verified: true })).toMatchObject({ saved: 1 });
    expect(state.recorded[0].autoKind).toBeNull();
    state.failRecord = true;
    await expect(service.recordChatInboundEvents('storea', [ev('こんにちは', 'm2')], { verified: true })).resolves.toMatchObject({ saved: 0, failed: 1 });
  });
});

describe('返信（LINE への送信）', () => {
  type Push = { token: string; to: string; text: string; key: string };
  const pusher = (results: Array<{ ok: boolean; status: number; body: string }>) => {
    const calls: Push[] = [];
    const push = async (token: string, to: string, text: string, key: string) => {
      calls.push({ token, to, text, key });
      return results[Math.min(calls.length - 1, results.length - 1)];
    };
    return { calls, push };
  };
  const on = () => {
    state.settings = { ...CHAT_DEFAULT_SETTINGS, enabled: true };
  };
  const OK = { ok: true, status: 200, body: '{}' };

  it('送れたら「送信済み」。LINE には、その会話のお客様あてに、送信の ID を鍵にして送る', async () => {
    on();
    const p = pusher([OK]);
    const r = await service.sendChatReply('storea', THREAD, { text: 'ありがとうございます', client_key: KEY }, { id: 'u1', email: 'staff@example.com' }, { push: p.push });
    expect(r).toMatchObject({ ok: true, message: { send_status: 'sent', text: 'ありがとうございます', sent_by_name: 'staff@example.com' } });
    expect(p.calls).toEqual([{ token: 'token', to: 'U1', text: 'ありがとうございます', key: KEY }]);
    expect(state.out[0].send_status).toBe('sent');
    expect(state.touched).toBe(1);
  });

  it('連打・通信の再試行で同じ送信の ID が届いても、LINE に送るのは 1 回', async () => {
    on();
    const p = pusher([OK]);
    await service.sendChatReply('storea', THREAD, { text: 'ありがとうございます', client_key: KEY }, null, { push: p.push });
    const again = await service.sendChatReply('storea', THREAD, { text: 'ありがとうございます', client_key: KEY }, null, { push: p.push });
    expect(again.ok).toBe(true);
    expect(p.calls).toHaveLength(1);
    expect(state.out).toHaveLength(1);
  });

  it('送信中のあいだに同じ ID がもう一度届いたら、送らずに待つ', async () => {
    on();
    const now = new Date('2026-11-25T03:10:00Z');
    state.out.push({ id: '1', thread_id: THREAD, store_id: 'storea', direction: 'out', kind: 'text', text: 'あ', meta: null, client_key: KEY, send_status: 'sending', send_error: null, created_at: '2026-11-25T03:09:55.000Z' });
    const p = pusher([OK]);
    const r = await service.sendChatReply('storea', THREAD, { text: 'あ', client_key: KEY }, null, { push: p.push, now });
    expect(r).toMatchObject({ ok: true, message: { send_status: 'sending' } });
    expect(p.calls).toHaveLength(0);
  });

  it('失敗したら理由を残す。同じ ID でもう一度送ると、送り直して「送信済み」になる', async () => {
    on();
    const p = pusher([{ ok: false, status: 429, body: '{"message":"You have reached your monthly limit."}' }, OK]);
    const failed = await service.sendChatReply('storea', THREAD, { text: 'ありがとうございます', client_key: KEY }, null, { push: p.push });
    expect(failed).toMatchObject({ ok: false, status: 502, error: '今月の通数の上限に達しています', message: { send_status: 'failed' } });
    expect(state.out[0]).toMatchObject({ send_status: 'failed', send_error: '今月の通数の上限に達しています' });
    expect(state.touched).toBe(0);
    const retried = await service.sendChatReply('storea', THREAD, { text: 'ありがとうございます', client_key: KEY }, null, { push: p.push });
    expect(retried).toMatchObject({ ok: true, message: { send_status: 'sent' } });
    expect(p.calls.map((c) => c.key)).toEqual([KEY, KEY]);
    expect(state.out).toHaveLength(1);
    expect(state.out[0]).toMatchObject({ send_status: 'sent', send_error: null });
  });

  it('トークンが未設定の店舗では、LINE に送らず失敗として残す', async () => {
    on();
    state.token = null;
    const p = pusher([OK]);
    const r = await service.sendChatReply('storea', THREAD, { text: 'こんにちは', client_key: KEY }, null, { push: p.push });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(p.calls).toHaveLength(0);
    expect(state.out[0].send_status).toBe('failed');
  });

  it('他の店舗の会話・OFF の店舗・空の文では、保存も送信もしない', async () => {
    const p = pusher([OK]);
    expect(await service.sendChatReply('storea', THREAD, { text: 'こんにちは', client_key: KEY }, null, { push: p.push })).toMatchObject({ ok: false, status: 409 });
    on();
    expect(await service.sendChatReply('storeb', THREAD, { text: 'こんにちは', client_key: KEY }, null, { push: p.push })).toMatchObject({ ok: false, status: 404 });
    expect(await service.sendChatReply('storea', THREAD, { text: '', client_key: KEY }, null, { push: p.push })).toMatchObject({ ok: false, status: 400 });
    expect(p.calls).toHaveLength(0);
    expect(state.out).toHaveLength(0);
  });

  it('同じ送信の ID が別の会話で使われていたら、送らない', async () => {
    on();
    state.out.push({ id: '1', thread_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', store_id: 'storea', direction: 'out', kind: 'text', text: 'あ', meta: null, client_key: KEY, send_status: 'failed', send_error: 'x', created_at: '2026-11-25T03:00:00.000Z' });
    const p = pusher([OK]);
    expect(await service.sendChatReply('storea', THREAD, { text: 'こんにちは', client_key: KEY }, null, { push: p.push })).toMatchObject({ ok: false, status: 409 });
    expect(p.calls).toHaveLength(0);
  });
});
