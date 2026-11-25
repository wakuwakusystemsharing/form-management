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
}));

const ev = (text: string, id: string) => ({ type: 'message', timestamp: Date.parse('2026-11-25T03:00:00Z'), source: { type: 'user', userId: 'U1' }, message: { id, type: 'text', text } });

let service: typeof import('@/lib/chat-service');

beforeEach(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'staging';
  state.settings = { ...CHAT_DEFAULT_SETTINGS };
  state.missing = false;
  state.secretSet = false;
  state.recorded = [];
  state.failRecord = false;
  state.failKeywords = false;
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
