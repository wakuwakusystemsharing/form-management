/**
 * 1 対 1 トーク（④-5）:
 * - 利用状況の API は、マスター管理者だけが呼べる（システム管理者・店舗管理者は 403）
 * - Webhook の「自動で返信した内容」の書き留めが、同時に届いた別の通知と混ざらない
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ who: 'none' as 'none' | 'store' | 'system' | 'master', called: 0 }));

vi.mock('@/lib/auth-helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-helper')>()),
  getCurrentUser: vi.fn(async () => (state.who === 'none' ? null : { id: `u-${state.who}`, email: `${state.who}@example.com` })),
}));

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase')>()),
  isMasterAdmin: vi.fn(async (userId: string) => userId === 'u-master'),
}));

vi.mock('@/lib/chat-service', () => ({
  getChatUsageReport: vi.fn(async (month: string | null) => {
    state.called += 1;
    return {
      month: month || '2026-11',
      previous_month: '2026-10',
      rows: [{ store_id: 'abc123', store_name: 'テスト店', enabled: true, enabled_at: '2026-11-01T00:00:00.000Z', current: { inbound: 3, outbound: 2, image_bytes: 0 }, previous: { inbound: 0, outbound: 0, image_bytes: 0 } }],
      totals: { inbound: 3, outbound: 2, image_bytes: 0 },
      unavailable: false,
    };
  }),
}));

async function get(query = ''): Promise<Response> {
  const { GET } = await import('@/app/api/master-admin/chat-usage/route');
  return GET(new Request(`https://app.example/api/master-admin/chat-usage${query}`) as unknown as NextRequest);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_ENV = 'staging';
  state.who = 'none';
  state.called = 0;
});

describe('トークの利用状況の API', () => {
  it('未ログインは 401、システム管理者・店舗管理者は 403（集計も動かさない）', async () => {
    expect((await get()).status).toBe(401);
    state.who = 'store';
    expect((await get()).status).toBe(403);
    state.who = 'system';
    expect((await get()).status).toBe(403);
    expect(state.called).toBe(0);
  }, 120000);

  it('マスター管理者は見られる。format=csv で CSV をダウンロードできる', async () => {
    state.who = 'master';
    const res = await get('?month=2026-11');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ month: '2026-11', totals: { inbound: 3, outbound: 2 } });
    const csv = await get('?month=2026-11&format=csv');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('chat-usage-2026-11.csv');
    expect(await csv.text()).toContain('abc123,テスト店,ON');
  });
});

describe('自動で返信した内容の書き留め', () => {
  it('通知ごとに別々に書き留める（同時に処理しても混ざらない）。入れ物の外から呼んでも何も起きない', async () => {
    const { noteChatReply, runWithChatReplyLog, setChatReplyTarget } = await import('@/lib/chat-reply-log');
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const handle = (storeId: string, userId: string, token: string, delay: number) =>
      runWithChatReplyLog(async () => {
        setChatReplyTarget(storeId, userId);
        await wait(delay);
        noteChatReply(token, [{ type: 'text', text: `${userId} への返信` }]);
        await wait(delay);
        noteChatReply(token, []);
        return userId;
      });
    const [a, b] = await Promise.all([handle('storea', 'U1', 'tokenA', 20), handle('storeb', 'U2', 'tokenB', 5)]);
    expect(a).toMatchObject({ result: 'U1', log: { storeId: 'storea', lineUserId: 'U1' } });
    expect(a.log.replies.map((r) => r.replyToken)).toEqual(['tokenA']);
    expect(b.log).toMatchObject({ storeId: 'storeb', lineUserId: 'U2' });
    expect(b.log.replies.map((r) => r.replyToken)).toEqual(['tokenB']);
    // 入れ物の外
    expect(() => {
      setChatReplyTarget('storea', 'U1');
      noteChatReply('tokenC', [{ type: 'text', text: 'x' }]);
    }).not.toThrow();
  });
});
