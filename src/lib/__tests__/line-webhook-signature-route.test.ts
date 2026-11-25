/**
 * LINE Webhook の入口（POST /api/webhooks/line）の署名チェックの動作確認
 * - シークレット未登録の店舗: 署名が無くても今までどおり受け付ける
 * - 登録済みの店舗: 正しい署名だけ受け付け、それ以外は 401
 */
import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const SECRET = '0123456789abcdef0123456789abcdef';
const secretState = vi.hoisted(() => ({ current: { status: 'none' } as { status: 'none' } | { status: 'set'; secret: string; updated_at: string } | { status: 'error'; message: string } }));

vi.mock('@/lib/line-secret-repository', () => ({
  getStoreLineSecret: vi.fn(async () => secretState.current),
}));

const chatCalls = vi.hoisted(() => ({ list: [] as Array<{ storeId: string; count: number; verified: boolean }> }));
vi.mock('@/lib/chat-service', () => ({
  scheduleChatInbound: vi.fn((storeId: string, events: unknown[], opts: { verified: boolean }) => {
    chatCalls.list.push({ storeId, count: events.length, verified: opts.verified });
  }),
}));

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: 'abc123', name: 'テスト店', line_channel_access_token: 'token', google_calendar_id: null, owner_email: null, phone: null }, error: null }),
        }),
      }),
    }),
  }),
}));

const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('base64');

async function post(body: string, signature?: string): Promise<Response> {
  const { POST } = await import('@/app/api/webhooks/line/route');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature !== undefined) headers['x-line-signature'] = signature;
  const req = new Request('https://app.example/api/webhooks/line?storeId=abc123', { method: 'POST', headers, body });
  return POST(req as unknown as NextRequest);
}

// LINE の「検証」ボタンと同じ内容（events が空）
const EMPTY = '{"destination":"U1","events":[]}';

describe('LINE Webhook の署名チェック', () => {
  beforeEach(() => {
    secretState.current = { status: 'none' };
    chatCalls.list = [];
  });

  it('1 対 1 トークの保存には、署名を確認できたかどうかを渡す（断った通知は渡さない）', async () => {
    await post(EMPTY);
    expect(chatCalls.list).toEqual([{ storeId: 'abc123', count: 0, verified: false }]);
    secretState.current = { status: 'set', secret: SECRET, updated_at: '2026-11-20T00:00:00.000Z' };
    await post(EMPTY, sign(EMPTY));
    expect(chatCalls.list[1]).toEqual({ storeId: 'abc123', count: 0, verified: true });
    await post(EMPTY, 'detarame');
    expect(chatCalls.list).toHaveLength(2);
  }, 120000);

  it('シークレット未登録の店舗は、署名が無くても今までどおり受け付ける', async () => {
    const res = await post(EMPTY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // でたらめな署名が付いていても同じ（確認しない）
    expect((await post(EMPTY, 'detarame')).status).toBe(200);
  }, 120000);

  it('登録済みの店舗は、正しい署名なら受け付ける', async () => {
    secretState.current = { status: 'set', secret: SECRET, updated_at: '2026-11-20T00:00:00.000Z' };
    const res = await post(EMPTY, sign(EMPTY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('登録済みの店舗は、署名が無い・合わない通知を 401 で断る', async () => {
    secretState.current = { status: 'set', secret: SECRET, updated_at: '2026-11-20T00:00:00.000Z' };
    expect((await post(EMPTY)).status).toBe(401);
    expect((await post(EMPTY, sign(EMPTY, 'f'.repeat(32)))).status).toBe(401);
    // 署名は本物でも、内容を書き換えたら通らない
    const forged = EMPTY.replace('"events":[]', '"events":[{"type":"message"}]');
    expect((await post(forged, sign(EMPTY))).status).toBe(401);
  });

  it('シークレットの読み取りに失敗したときは、既存の応答を止めないよう受け付ける', async () => {
    secretState.current = { status: 'error', message: 'timeout' };
    expect((await post(EMPTY)).status).toBe(200);
  });

  it('壊れた内容（JSON でない）でも落ちない', async () => {
    expect((await post('こわれた内容')).status).toBe(200);
  });
});
