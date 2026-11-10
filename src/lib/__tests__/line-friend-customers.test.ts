import { describe, expect, it } from 'vitest';
import { buildFriendCustomerRow, checkLineFriendship, ensureFriendCustomer, fetchLineProfile, importLineFriends, promoteFriendOnlyPatch, verifyLineFriends } from '@/lib/line-friend-customers';
import { computeStoreRankings } from '@/lib/store-ranking';

/** customers テーブルだけを持つ、最小限の偽 Supabase クライアント */
function fakeClient(initial: Array<Record<string, unknown>> = [], opts: { failInsertBatch?: boolean } = {}) {
  const rows = [...initial];
  const client = {
    rows,
    from() {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        not: (k: string) => (filters.push((r) => r[k] !== null && r[k] !== undefined), q),
        order: () => q,
        limit: () => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).slice(0, 1), error: null }),
        range: (from: number, to: number) => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).slice(from, to + 1), error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: (k: string, v: unknown) => {
            for (const r of rows) if (r[k] === v) Object.assign(r, patch);
            return Promise.resolve({ error: null });
          },
        }),
        insert: (input: Record<string, unknown> | Array<Record<string, unknown>>) => {
          const list = Array.isArray(input) ? input : [input];
          const dup = (r: Record<string, unknown>) => rows.some((x) => x.store_id === r.store_id && x.line_user_id === r.line_user_id);
          if (Array.isArray(input) && (opts.failInsertBatch || list.some(dup))) return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } });
          if (!Array.isArray(input) && dup(input)) return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } });
          rows.push(...list.map((r) => ({ id: `id${rows.length}`, ...r })));
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return client;
}

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('fetchLineProfile / buildFriendCustomerRow', () => {
  it('プロフィールを取得する。取得できなければ null', async () => {
    const ok = (async () => res(200, { displayName: ' はなこ ', pictureUrl: 'https://p/x.jpg', language: 'ja' })) as unknown as typeof fetch;
    expect(await fetchLineProfile('t', 'U1', ok)).toEqual({ displayName: 'はなこ', pictureUrl: 'https://p/x.jpg', statusMessage: null, language: 'ja' });
    const blocked = (async () => res(404, { message: 'Not found' })) as unknown as typeof fetch;
    expect(await fetchLineProfile('t', 'U1', blocked)).toBeNull();
    const down = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await fetchLineProfile('t', 'U1', down)).toBeNull();
  });
  it('友だちだけの顧客の行: 名前は LINE 表示名（無ければ既定名）、印付き', () => {
    const row = buildFriendCustomerRow('st1', 'U1', { displayName: 'はなこ', pictureUrl: null, statusMessage: null, language: null }, { addedAt: '2026-11-10T00:00:00.000Z' });
    expect(row).toMatchObject({ store_id: 'st1', line_user_id: 'U1', name: 'はなこ', line_display_name: 'はなこ', line_friend_flag: true, line_friend_added_at: '2026-11-10T00:00:00.000Z', line_friend_only: true, tags: [] });
    expect(buildFriendCustomerRow('st1', 'U2', null)).toMatchObject({ name: 'LINE 友だち', line_display_name: null, line_friend_only: true });
  });
});

describe('promoteFriendOnlyPatch（友だちだけの顧客が予約したとき）', () => {
  it('印を外し、名前を予約時のものに、空の電話・メールを埋める', () => {
    expect(promoteFriendOnlyPatch({ line_friend_only: true, name: 'はなこ', phone: null, email: null }, { name: '山田 花子', phone: '090-0000-0000', email: 'a@example.com' })).toEqual({
      line_friend_only: false, name: '山田 花子', phone: '090-0000-0000', email: 'a@example.com',
    });
  });
  it('「未記入」や空は入れない。既にある電話・メールは変えない', () => {
    expect(promoteFriendOnlyPatch({ line_friend_only: true, name: 'はなこ', phone: '03-1', email: 'x@example.com' }, { name: '未記入', phone: '090', email: 'b@example.com' })).toEqual({ line_friend_only: false });
    expect(promoteFriendOnlyPatch({ line_friend_only: true }, { name: ' ', phone: '未記入' })).toEqual({ line_friend_only: false });
  });
  it('通常の顧客は何も変えない', () => {
    expect(promoteFriendOnlyPatch({ line_friend_only: false, name: '山田' }, { name: '別名' })).toEqual({});
    expect(promoteFriendOnlyPatch({ name: '山田' }, { name: '別名' })).toEqual({});
  });
});

describe('ensureFriendCustomer（Webhook）', () => {
  const profileFetch = (async () => res(200, { displayName: 'さとう' })) as unknown as typeof fetch;
  it('顧客が無ければ作り、あれば何もしない', async () => {
    const client = fakeClient([{ id: 'c1', store_id: 'st1', line_user_id: 'Uexisting', name: '既存' }]);
    expect(await ensureFriendCustomer(client, 'st1', 'Uexisting', 't', { fetchImpl: profileFetch })).toBe('exists');
    expect(await ensureFriendCustomer(client, 'st1', 'Unew', 't', { fetchImpl: profileFetch, timestampMs: Date.parse('2026-11-10T01:00:00Z') })).toBe('created');
    expect(client.rows).toHaveLength(2);
    expect(client.rows[1]).toMatchObject({ store_id: 'st1', line_user_id: 'Unew', name: 'さとう', line_friend_only: true, line_friend_flag: true, line_friend_added_at: '2026-11-10T01:00:00.000Z' });
    // 同じ LINE ユーザーでも別の店舗なら別に作る
    expect(await ensureFriendCustomer(client, 'st2', 'Unew', 't', { fetchImpl: profileFetch })).toBe('created');
    // もう一度呼んでも増えない
    expect(await ensureFriendCustomer(client, 'st1', 'Unew', 't', { fetchImpl: profileFetch })).toBe('exists');
    expect(client.rows).toHaveLength(3);
  });
  it('すでにいる顧客が発言してきたら、友だちに直してブロックの記録を消す（友だち追加が予約より先だった人の救済）', async () => {
    const client = fakeClient([
      { id: 'c1', store_id: 'st1', line_user_id: 'U1', name: '未確認', line_friend_flag: false },
      { id: 'c2', store_id: 'st1', line_user_id: 'U2', name: '再追加', line_friend_flag: false, line_blocked_at: '2026-10-01T00:00:00Z' },
      { id: 'c3', store_id: 'st1', line_user_id: 'U3', name: '友だち', line_friend_flag: true },
    ]);
    for (const u of ['U1', 'U2', 'U3']) expect(await ensureFriendCustomer(client, 'st1', u, 't', { fetchImpl: profileFetch })).toBe('exists');
    expect(client.rows.map((r) => [r.id, r.line_friend_flag, r.line_blocked_at ?? null])).toEqual([['c1', true, null], ['c2', true, null], ['c3', true, null]]);
  });

  it('クライアントが失敗しても例外を投げない', async () => {
    const broken = { from: () => { throw new Error('boom'); } };
    expect(await ensureFriendCustomer(broken, 'st1', 'U1', 't', { fetchImpl: profileFetch })).toBe('failed');
  });
});

describe('checkLineFriendship / verifyLineFriends（送信前の友だち確認）', () => {
  const api = (async (url: string) => {
    const id = decodeURIComponent(String(url).split('/profile/')[1] ?? '');
    if (id.startsWith('Ufriend')) return res(200, { displayName: 'x' });
    if (id.startsWith('Ugone')) return res(404, { message: 'Not found' });
    return res(429, { message: 'rate limit' });
  }) as unknown as typeof fetch;

  it('プロフィールが取れれば友だち、404 は友だちでない、それ以外は不明', async () => {
    expect(await checkLineFriendship('t', 'Ufriend1', api)).toBe('friend');
    expect(await checkLineFriendship('t', 'Ugone1', api)).toBe('not_friend');
    expect(await checkLineFriendship('t', 'Uother', api)).toBe('unknown');
  });
  it('まとめて確認し、友だち / 友だちでない に分ける。不明・時間切れの人はどちらにも入れない', async () => {
    const targets = [{ id: 'a', line_user_id: 'Ufriend1' }, { id: 'b', line_user_id: 'Ugone1' }, { id: 'c', line_user_id: 'Uother' }];
    expect(await verifyLineFriends('t', targets, Date.now() + 60_000, api)).toEqual({ friends: ['a'], notFriends: ['b'], unchecked: 0 });
    expect(await verifyLineFriends('t', targets, Date.now() - 1, api)).toEqual({ friends: [], notFriends: [], unchecked: 3 });
  });
});

describe('importLineFriends（友だちを取り込む）', () => {
  const FAR = Date.now() + 60_000;
  function lineApi(pages: Array<{ userIds: string[]; next?: string }>, status = 200) {
    let page = 0;
    return (async (url: string) => {
      if (String(url).includes('/followers/ids')) return status === 200 ? res(200, pages[page++] ?? { userIds: [] }) : res(status, { message: 'error' });
      const id = decodeURIComponent(String(url).split('/profile/')[1] ?? '');
      return res(200, { displayName: `名前${id}` });
    }) as unknown as typeof fetch;
  }

  it('顧客台帳にいない友だちだけを登録する。ページをまたいで続ける。何度押しても増えない', async () => {
    const client = fakeClient([{ id: 'c1', store_id: 'st1', line_user_id: 'U1', name: '既存' }, { id: 'c9', store_id: 'st2', line_user_id: 'U2', name: '他店' }]);
    const r = await importLineFriends(client, 'st1', 't', FAR, lineApi([{ userIds: ['U1', 'U2'], next: 'p2' }, { userIds: ['U3'] }]));
    expect(r).toEqual({ imported: 2, existing: 1, remaining: false });
    expect(client.rows.filter((x) => x.store_id === 'st1').map((x) => [x.line_user_id, x.name, x.line_friend_only])).toEqual([['U1', '既存', undefined], ['U2', '名前U2', true], ['U3', '名前U3', true]]);
    const again = await importLineFriends(client, 'st1', 't', FAR, lineApi([{ userIds: ['U1', 'U2', 'U3'] }]));
    expect(again).toEqual({ imported: 0, existing: 3, remaining: false });
  });

  it('未認証アカウント（403）・トークン無効（401）は案内文つきのエラー', async () => {
    const client = fakeClient();
    expect(await importLineFriends(client, 'st1', 't', FAR, lineApi([], 403))).toMatchObject({ imported: 0, status: 400, error: expect.stringContaining('認証済みアカウント') });
    expect(await importLineFriends(client, 'st1', 't', FAR, lineApi([], 401))).toMatchObject({ status: 400, error: expect.stringContaining('トークン') });
    expect(await importLineFriends(client, 'st1', 't', FAR, lineApi([], 500))).toMatchObject({ status: 502 });
  });

  it('時間切れなら remaining = true で止まり、続きはもう一度呼ぶ', async () => {
    const client = fakeClient();
    const r = await importLineFriends(client, 'st1', 't', Date.now() - 1, lineApi([{ userIds: ['U1', 'U2'] }]));
    expect(r).toEqual({ imported: 0, existing: 0, remaining: true });
  });

  it('まとめての登録が競合で失敗したら 1 件ずつ入れる', async () => {
    const client = fakeClient([], { failInsertBatch: true });
    const r = await importLineFriends(client, 'st1', 't', FAR, lineApi([{ userIds: ['U1', 'U2'] }]));
    expect(r).toEqual({ imported: 2, existing: 0, remaining: false });
  });
});

describe('全店舗ランキング: 予約なしの LINE 友だちは友だち追加率に数えない', () => {
  it('line_friend_only の顧客を分母・分子から除く', () => {
    const rows = computeStoreRankings(
      [{ id: 'st1', name: 'A店' }],
      [],
      [],
      [
        { store_id: 'st1', line_user_id: 'U1', line_friend_flag: true },
        { store_id: 'st1', line_user_id: 'U2', line_friend_flag: false },
        { store_id: 'st1', line_user_id: 'U3', line_friend_flag: true, line_friend_only: true },
        { store_id: 'st1', line_user_id: 'U4', line_friend_flag: true, line_friend_only: true },
      ],
      null
    );
    expect(rows[0]).toMatchObject({ line_linked_customers: 2, line_friend_connected: 1, line_friend_rate: 50 });
  });
});
