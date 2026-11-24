/**
 * 店舗情報の API の認証（staging / production の動き）
 *   GET /api/stores               … 運営だけ（未ログイン 401 / 店舗管理者 403）
 *   GET /api/stores/{storeId}     … 見ている人で内容を変える。?full=1 は未ログイン 401
 *   PUT / DELETE /api/stores/{id} … 運営だけ
 * 以前はどれもログインなしで呼べて、LINE のトークンなども返っていた。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Who = 'none' | 'master' | 'system_a' | 'system_b' | 'store_admin' | 'outsider' | 'legacy';

const state = vi.hoisted(() => ({
  who: 'none' as string,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  deletes: [] as string[],
  stores: [] as Array<Record<string, unknown>>,
}));

const USERS: Record<Exclude<Who, 'none'>, { id: string; email: string }> = {
  master: { id: 'u-master', email: 'master@example.com' },
  system_a: { id: 'u-sys-a', email: 'sys-a@example.com' },
  system_b: { id: 'u-sys-b', email: 'sys-b@example.com' },
  store_admin: { id: 'u-store', email: 'store@example.com' },
  outsider: { id: 'u-out', email: 'out@example.com' },
  legacy: { id: 'u-legacy', email: 'wakuwakusystemsharing@gmail.com' },
};
const currentUser = () => (state.who === 'none' ? null : USERS[state.who as Exclude<Who, 'none'>]);
const orgOf = (userId: string) => (userId === 'u-sys-a' ? 'org-a' : userId === 'u-sys-b' ? 'org-b' : null);

/** Supabase の代わり（このテストで使う呼び出しだけ） */
function fakeAdminClient() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op: 'select' | 'update' | 'delete' = 'select';
      let patch: Record<string, unknown> = {};
      const run = () => {
        if (table === 'system_admins') {
          const org = orgOf(String(filters.user_id));
          return { data: org ? { org_id: org } : null, error: null };
        }
        if (table === 'stores') {
          let rows = state.stores.filter((s) => Object.entries(filters).every(([k, v]) => s[k] === v));
          if (op === 'update') {
            rows = rows.map((s) => Object.assign(s, patch));
            for (const s of rows) state.updates.push({ id: String(s.id), patch });
          }
          if (op === 'delete') {
            for (const s of rows) state.deletes.push(String(s.id));
            return { data: null, error: null };
          }
          return { data: rows, error: null };
        }
        // reservation_forms / survey_forms の件数
        return { data: [], error: null, count: 0 };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return builder;
        },
        update: (p: Record<string, unknown>) => {
          op = 'update';
          patch = p;
          return builder;
        },
        delete: () => {
          op = 'delete';
          return builder;
        },
        single: async () => {
          const r = run();
          const row = Array.isArray(r.data) ? r.data[0] ?? null : r.data;
          return { data: row, error: row ? null : { message: 'not found' } };
        },
        maybeSingle: async () => {
          const r = run();
          return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth-helper', () => ({
  getCurrentUser: vi.fn(async () => currentUser()),
  getCurrentUserRole: vi.fn(async () => {
    const u = currentUser();
    if (!u) return null;
    const role = state.who === 'master' ? 'master' : state.who.startsWith('system') ? 'system' : state.who === 'store_admin' ? 'store' : null;
    return { role, userId: u.id, email: u.email };
  }),
}));

vi.mock('@/lib/supabase', () => {
  const isMasterAdmin = async (userId: string) => userId === 'u-master';
  const isSystemAdminById = async (userId: string) => userId === 'u-sys-a' || userId === 'u-sys-b';
  const isServiceAdmin = (email: string) => email === 'wakuwakusystemsharing@gmail.com';
  return {
    isMasterAdmin,
    isSystemAdminById,
    isServiceAdmin,
    createAdminClient: () => fakeAdminClient(),
    getSupabaseAdminClient: () => fakeAdminClient(),
    getSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: currentUser() }, error: null }) } }),
    createAuthenticatedClient: () => ({}),
    checkStoreAccess: async (userId: string, storeId: string, email?: string) => {
      if (userId === 'u-master' || (email && isServiceAdmin(email))) return true;
      const store = state.stores.find((s) => s.id === storeId);
      const org = orgOf(userId);
      if (org) return !!store && store.org_id === org;
      return userId === 'u-store' && storeId === 'storea';
    },
  };
});

vi.mock('@/lib/follow-message-repository', () => ({ applyFollowSettingsToScheduledRows: vi.fn(), backfillFollowMessagesForStore: vi.fn() }));

function req(url: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers);
  // ログインしている人は Cookie を持っている
  if (state.who !== 'none') headers.set('cookie', 'sb-access-token=token');
  return new Request(`https://app.example${url}`, { ...init, headers }) as unknown as NextRequest;
}

const detail = () => import('@/app/api/stores/[storeId]/route');
const list = () => import('@/app/api/stores/route');
const params = (storeId: string) => ({ params: Promise.resolve({ storeId }) });

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_ENV = 'staging';
  state.who = 'none';
  state.updates = [];
  state.deletes = [];
  state.stores = [
    { id: 'storea', org_id: 'org-a', name: 'A店', logo_url: null, theme_color: null, owner_email: 'a@example.com', line_channel_access_token: 'LINE-A', google_calendar_refresh_token: 'GOOGLE-A', admin_visible_tabs: ['dashboard'] },
    { id: 'storeb', org_id: 'org-b', name: 'B店', logo_url: null, theme_color: null, owner_email: 'b@example.com', line_channel_access_token: 'LINE-B', google_calendar_refresh_token: 'GOOGLE-B', admin_visible_tabs: null },
  ];
});

describe('GET /api/stores（店舗の一覧）', () => {
  it('ログインしていないと 401（以前は全店舗が返っていた）', async () => {
    const res = await (await list()).GET(req('/api/stores'));
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain('LINE-A');
  }, 120000);

  it('店舗管理者・関係のない人は 403', async () => {
    for (const who of ['store_admin', 'outsider']) {
      state.who = who;
      expect((await (await list()).GET(req('/api/stores'))).status, who).toBe(403);
    }
  });

  it('システム管理者は自分のテナントの店舗だけ、マスター管理者は全店舗', async () => {
    state.who = 'system_a';
    const a = await (await (await list()).GET(req('/api/stores'))).json();
    expect(a.stores.map((s: { id: string }) => s.id)).toEqual(['storea']);
    state.who = 'master';
    const all = await (await (await list()).GET(req('/api/stores'))).json();
    expect(all.stores.map((s: { id: string }) => s.id).sort()).toEqual(['storea', 'storeb']);
    // Google カレンダー連携の鍵は運営にも返さない
    expect(JSON.stringify(all)).not.toContain('GOOGLE-');
    // 移行期間中の旧サービス管理者（メールアドレスで判定）も全店舗
    state.who = 'legacy';
    expect((await (await (await list()).GET(req('/api/stores'))).json()).stores).toHaveLength(2);
  });
});

describe('GET /api/stores/{storeId}', () => {
  it('ログインしていない人には店舗名など最小限だけ（ログイン画面用）', async () => {
    const res = await (await detail()).GET(req('/api/stores/storea'), params('storea'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'storea', name: 'A店', logo_url: null, theme_color: null });
  });

  it('?full=1（管理画面からの呼び出し）は、ログインしていないと 401、他の店舗は 403', async () => {
    expect((await (await detail()).GET(req('/api/stores/storea?full=1'), params('storea'))).status).toBe(401);
    state.who = 'store_admin';
    expect((await (await detail()).GET(req('/api/stores/storeb?full=1'), params('storeb'))).status).toBe(403);
    state.who = 'system_a';
    expect((await (await detail()).GET(req('/api/stores/storeb?full=1'), params('storeb'))).status).toBe(403);
  });

  it('店舗管理者には鍵を返さない。運営には LINE のトークンを返す（店舗編集で使う）', async () => {
    state.who = 'store_admin';
    const s = await (await (await detail()).GET(req('/api/stores/storea?full=1'), params('storea'))).json();
    expect(s).toMatchObject({ id: 'storea', owner_email: 'a@example.com', admin_visible_tabs: ['dashboard'], line_channel_access_token_set: true });
    expect(JSON.stringify(s)).not.toContain('LINE-A');
    expect(JSON.stringify(s)).not.toContain('GOOGLE-A');

    state.who = 'system_a';
    const u = await (await (await detail()).GET(req('/api/stores/storea?full=1'), params('storea'))).json();
    expect(u.line_channel_access_token).toBe('LINE-A');
    expect(JSON.stringify(u)).not.toContain('GOOGLE-A');
  });

  it('他の店舗の店舗管理者・別テナントのシステム管理者が見ても、最小限しか返らない', async () => {
    for (const who of ['store_admin', 'system_a', 'outsider']) {
      state.who = who;
      const body = await (await (await detail()).GET(req('/api/stores/storeb'), params('storeb'))).json();
      expect(body, who).toEqual({ id: 'storeb', name: 'B店', logo_url: null, theme_color: null });
    }
  });
});

describe('PUT /api/stores/{storeId}', () => {
  const put = async (storeId: string, body: unknown) => (await detail()).PUT(req(`/api/stores/${storeId}`, { method: 'PUT', body: JSON.stringify(body) }), params(storeId));

  it('ログインしていないと 401、店舗管理者・別テナントは 403（何も書き換わらない）', async () => {
    expect((await put('storea', { name: 'のっとり' })).status).toBe(401);
    state.who = 'store_admin';
    expect((await put('storea', { name: 'のっとり' })).status).toBe(403);
    state.who = 'system_b';
    expect((await put('storea', { name: 'のっとり' })).status).toBe(403);
    expect(state.updates).toEqual([]);
    expect(state.stores[0].name).toBe('A店');
  });

  it('システム管理者は自分のテナントの店舗を更新できる。テナントの付け替え・連携の鍵は反映しない', async () => {
    state.who = 'system_a';
    const res = await put('storea', { id: 'zzz', name: 'A店（改）', org_id: 'org-b', google_calendar_refresh_token: 'attack', line_channel_access_token: 'LINE-NEW' });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].id).toBe('storea');
    expect(state.updates[0].patch).toMatchObject({ name: 'A店（改）', line_channel_access_token: 'LINE-NEW' });
    expect(state.updates[0].patch).not.toHaveProperty('org_id');
    expect(state.updates[0].patch).not.toHaveProperty('id');
    expect(state.updates[0].patch).not.toHaveProperty('google_calendar_refresh_token');
    // 返す内容にも Google の鍵は入れない
    expect(JSON.stringify(await res.json())).not.toContain('GOOGLE-A');
  });

  it('マスター管理者はテナントの付け替えができる', async () => {
    state.who = 'master';
    expect((await put('storea', { org_id: 'org-b' })).status).toBe(200);
    expect(state.updates[0].patch).toMatchObject({ org_id: 'org-b' });
  });
});

describe('DELETE /api/stores/{storeId}', () => {
  const del = async (storeId: string) => (await detail()).DELETE(req(`/api/stores/${storeId}`, { method: 'DELETE' }), params(storeId));

  it('ログインしていないと 401、店舗管理者・別テナントは 403（削除されない）', async () => {
    expect((await del('storea')).status).toBe(401);
    state.who = 'store_admin';
    expect((await del('storea')).status).toBe(403);
    state.who = 'system_b';
    expect((await del('storea')).status).toBe(403);
    expect(state.deletes).toEqual([]);
  });

  it('運営は削除できる', async () => {
    state.who = 'system_a';
    expect((await del('storea')).status).toBe(200);
    expect(state.deletes).toEqual(['storea']);
  });
});
