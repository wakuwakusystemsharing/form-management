/**
 * 管理用の API の認証（staging / production の動き）
 * 以前はログインなしで呼べた API が、ログインと店舗へのアクセス権を確認すること。
 *   未ログイン = 401 / 別の店舗の人 = 403 / 運営だけの操作を店舗管理者が呼ぶ = 403
 * 認証を通ったあとの処理の中身は、それぞれの機能のテストで確かめる（ここでは入口だけ）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ who: 'none' as 'none' | 'store_a' | 'store_b' | 'system_a' | 'master' }));

const USERS = {
  store_a: { id: 'u-store-a', email: 'a@example.com' },
  store_b: { id: 'u-store-b', email: 'b@example.com' },
  system_a: { id: 'u-sys-a', email: 'sys-a@example.com' },
  master: { id: 'u-master', email: 'master@example.com' },
};
const currentUser = () => (state.who === 'none' ? null : USERS[state.who]);

/** ID → 店舗（フォーム・アンケート・予約はすべて A 店のもの） */
const RECORD_STORE: Record<string, string> = { form1: 'storea', survey1: 'storea', resv1: 'storea' };

function lookupClient() {
  return {
    from: () => {
      let id = '';
      const b = {
        select: () => b,
        eq: (_k: string, v: string) => {
          id = v;
          return b;
        },
        maybeSingle: async () => ({ data: RECORD_STORE[id] ? { store_id: RECORD_STORE[id] } : null, error: null }),
      };
      return b;
    },
  };
}

vi.mock('@/lib/auth-helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-helper')>()),
  getCurrentUser: vi.fn(async () => currentUser()),
  getCurrentUserRole: vi.fn(async () => {
    const u = currentUser();
    if (!u) return null;
    const role = state.who === 'master' ? 'master' : state.who === 'system_a' ? 'system' : 'store';
    return { role, userId: u.id, email: u.email };
  }),
}));

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase')>()),
  getSupabaseAdminClient: () => lookupClient(),
  createAuthenticatedClient: () => ({}),
  checkStoreAccess: async (userId: string, storeId: string) => {
    if (userId === 'u-master') return true;
    if (userId === 'u-sys-a' || userId === 'u-store-a') return storeId === 'storea';
    return userId === 'u-store-b' && storeId === 'storeb';
  },
}));

function req(url: string, method: string, body?: unknown): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (state.who !== 'none') headers.set('cookie', 'sb-access-token=token');
  return new Request(`https://app.example${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

type Handler = (request: never, ctx: never) => Promise<Response>;
interface Case {
  name: string;
  load: () => Promise<Record<string, unknown>>;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  params: Record<string, string>;
  body?: unknown;
  /** 運営だけの操作（店舗管理者は自分の店舗でも 403） */
  upperOnly?: boolean;
}

const CASES: Case[] = [
  { name: 'フォームの更新', load: () => import('@/app/api/forms/[formId]/route'), method: 'PUT', url: '/api/forms/form1', params: { formId: 'form1' }, body: {} },
  { name: 'フォームの削除', load: () => import('@/app/api/forms/[formId]/route'), method: 'DELETE', url: '/api/forms/form1', params: { formId: 'form1' } },
  { name: 'フォームのデプロイ', load: () => import('@/app/api/forms/[formId]/deploy/route'), method: 'POST', url: '/api/forms/form1/deploy', params: { formId: 'form1' }, body: {} },
  { name: 'フォームの複製', load: () => import('@/app/api/forms/[formId]/duplicate/route'), method: 'POST', url: '/api/forms/form1/duplicate', params: { formId: 'form1' }, body: {} },
  { name: 'アンケートの更新', load: () => import('@/app/api/surveys/[id]/route'), method: 'PUT', url: '/api/surveys/survey1', params: { id: 'survey1' }, body: {} },
  { name: 'アンケートの削除', load: () => import('@/app/api/surveys/[id]/route'), method: 'DELETE', url: '/api/surveys/survey1', params: { id: 'survey1' } },
  { name: 'アンケートのデプロイ', load: () => import('@/app/api/surveys/[id]/deploy/route'), method: 'POST', url: '/api/surveys/survey1/deploy', params: { id: 'survey1' }, body: {} },
  { name: 'アンケートの複製', load: () => import('@/app/api/surveys/[id]/duplicate/route'), method: 'POST', url: '/api/surveys/survey1/duplicate', params: { id: 'survey1' }, body: {} },
  { name: '予約の変更・キャンセル', load: () => import('@/app/api/reservations/[reservationId]/route'), method: 'PATCH', url: '/api/reservations/resv1', params: { reservationId: 'resv1' }, body: { status: 'cancelled' } },
  { name: '予約の一覧', load: () => import('@/app/api/stores/[storeId]/reservations/route'), method: 'GET', url: '/api/stores/storea/reservations', params: { storeId: 'storea' } },
  { name: '予約カレンダー', load: () => import('@/app/api/stores/[storeId]/reservations/calendar/route'), method: 'GET', url: '/api/stores/storea/reservations/calendar?from=2026-11-01&to=2026-11-30', params: { storeId: 'storea' } },
  { name: 'リッチメニューの一覧', load: () => import('@/app/api/stores/[storeId]/rich-menus/route'), method: 'GET', url: '/api/stores/storea/rich-menus', params: { storeId: 'storea' } },
  { name: 'リッチメニューの作成', load: () => import('@/app/api/stores/[storeId]/rich-menus/route'), method: 'POST', url: '/api/stores/storea/rich-menus', params: { storeId: 'storea' }, body: { name: 'x' } },
  { name: 'リッチメニューの保存', load: () => import('@/app/api/stores/[storeId]/rich-menus/[id]/route'), method: 'PUT', url: '/api/stores/storea/rich-menus/m1', params: { storeId: 'storea', id: 'm1' }, body: { name: 'x' } },
  { name: 'リッチメニューの削除', load: () => import('@/app/api/stores/[storeId]/rich-menus/[id]/route'), method: 'DELETE', url: '/api/stores/storea/rich-menus/m1', params: { storeId: 'storea', id: 'm1' } },
  { name: 'リッチメニューの反映', load: () => import('@/app/api/stores/[storeId]/rich-menus/[id]/publish/route'), method: 'POST', url: '/api/stores/storea/rich-menus/m1/publish', params: { storeId: 'storea', id: 'm1' } },
  { name: 'リッチメニューの反映の取りやめ', load: () => import('@/app/api/stores/[storeId]/rich-menus/[id]/unpublish/route'), method: 'POST', url: '/api/stores/storea/rich-menus/m1/unpublish', params: { storeId: 'storea', id: 'm1' } },
  { name: 'リッチメニューの見直し', load: () => import('@/app/api/stores/[storeId]/rich-menus/sync/route'), method: 'POST', url: '/api/stores/storea/rich-menus/sync', params: { storeId: 'storea' } },
  { name: 'リッチメニューの優先順位', load: () => import('@/app/api/stores/[storeId]/rich-menus/rule-order/route'), method: 'POST', url: '/api/stores/storea/rich-menus/rule-order', params: { storeId: 'storea' }, body: { ids: [] } },
  { name: 'フォームの一覧', load: () => import('@/app/api/stores/[storeId]/forms/route'), method: 'GET', url: '/api/stores/storea/forms', params: { storeId: 'storea' } },
  { name: 'フォームの作成', load: () => import('@/app/api/stores/[storeId]/forms/route'), method: 'POST', url: '/api/stores/storea/forms', params: { storeId: 'storea' }, body: {} },
  { name: 'アンケートの一覧', load: () => import('@/app/api/stores/[storeId]/surveys/route'), method: 'GET', url: '/api/stores/storea/surveys', params: { storeId: 'storea' } },
  { name: 'アンケートの作成', load: () => import('@/app/api/stores/[storeId]/surveys/route'), method: 'POST', url: '/api/stores/storea/surveys', params: { storeId: 'storea' }, body: {} },
  { name: 'アンケートの回答', load: () => import('@/app/api/stores/[storeId]/surveys/responses/route'), method: 'GET', url: '/api/stores/storea/surveys/responses', params: { storeId: 'storea' } },
  { name: 'カレンダーの作成', load: () => import('@/app/api/stores/[storeId]/calendar/route'), method: 'POST', url: '/api/stores/storea/calendar', params: { storeId: 'storea' }, body: {} },
  { name: '店舗管理者の一覧', load: () => import('@/app/api/stores/[storeId]/admins/route'), method: 'GET', url: '/api/stores/storea/admins', params: { storeId: 'storea' }, upperOnly: true },
  { name: '店舗管理者の追加', load: () => import('@/app/api/stores/[storeId]/admins/route'), method: 'POST', url: '/api/stores/storea/admins', params: { storeId: 'storea' }, body: { email: 'x@example.com' }, upperOnly: true },
  { name: '店舗管理者の削除', load: () => import('@/app/api/stores/[storeId]/admins/[userId]/route'), method: 'DELETE', url: '/api/stores/storea/admins/u1', params: { storeId: 'storea', userId: 'u1' }, upperOnly: true },
  { name: 'トークの会話の一覧', load: () => import('@/app/api/stores/[storeId]/chat/threads/route'), method: 'GET', url: '/api/stores/storea/chat/threads', params: { storeId: 'storea' } },
  { name: 'トークの会話', load: () => import('@/app/api/stores/[storeId]/chat/threads/[threadId]/route'), method: 'GET', url: '/api/stores/storea/chat/threads/t1', params: { storeId: 'storea', threadId: 't1' } },
  { name: 'トークの返信', load: () => import('@/app/api/stores/[storeId]/chat/threads/[threadId]/messages/route'), method: 'POST', url: '/api/stores/storea/chat/threads/t1/messages', params: { storeId: 'storea', threadId: 't1' }, body: { text: 'x' } },
  { name: 'トークの未読の数', load: () => import('@/app/api/stores/[storeId]/chat/unread/route'), method: 'GET', url: '/api/stores/storea/chat/unread', params: { storeId: 'storea' } },
  { name: 'トークの通知の設定の取得', load: () => import('@/app/api/stores/[storeId]/chat/notifications/route'), method: 'GET', url: '/api/stores/storea/chat/notifications', params: { storeId: 'storea' } },
  { name: 'トークの通知の設定の変更', load: () => import('@/app/api/stores/[storeId]/chat/notifications/route'), method: 'PUT', url: '/api/stores/storea/chat/notifications', params: { storeId: 'storea' }, body: { line: true } },
  { name: 'トークのテストの通知', load: () => import('@/app/api/stores/[storeId]/chat/notifications/test/route'), method: 'POST', url: '/api/stores/storea/chat/notifications/test', params: { storeId: 'storea' } },
  { name: 'トークの画像', load: () => import('@/app/api/stores/[storeId]/chat/media/[messageId]/route'), method: 'GET', url: '/api/stores/storea/chat/media/1', params: { storeId: 'storea', messageId: '1' } },
  { name: 'トークの対応の状態', load: () => import('@/app/api/stores/[storeId]/chat/threads/[threadId]/route'), method: 'PATCH', url: '/api/stores/storea/chat/threads/t1', params: { storeId: 'storea', threadId: 't1' }, body: { status: 'done' } },
  { name: 'トークの定型文の一覧', load: () => import('@/app/api/stores/[storeId]/chat/templates/route'), method: 'GET', url: '/api/stores/storea/chat/templates', params: { storeId: 'storea' } },
  { name: 'トークの定型文の保存', load: () => import('@/app/api/stores/[storeId]/chat/templates/route'), method: 'PUT', url: '/api/stores/storea/chat/templates', params: { storeId: 'storea' }, body: { templates: [] } },
  { name: 'トークの画像のアップロード', load: () => import('@/app/api/stores/[storeId]/chat/images/route'), method: 'POST', url: '/api/stores/storea/chat/images', params: { storeId: 'storea' }, body: {} },
  { name: 'トークの会話の削除', load: () => import('@/app/api/stores/[storeId]/chat/threads/[threadId]/route'), method: 'DELETE', url: '/api/stores/storea/chat/threads/t1', params: { storeId: 'storea', threadId: 't1' }, upperOnly: true },
  { name: 'トークの設定の取得', load: () => import('@/app/api/stores/[storeId]/chat-settings/route'), method: 'GET', url: '/api/stores/storea/chat-settings', params: { storeId: 'storea' }, upperOnly: true },
  { name: 'トークの設定の変更', load: () => import('@/app/api/stores/[storeId]/chat-settings/route'), method: 'PUT', url: '/api/stores/storea/chat-settings', params: { storeId: 'storea' }, body: { enabled: true }, upperOnly: true },
];

async function call(c: Case): Promise<Response> {
  const mod = await c.load();
  const handler = mod[c.method] as Handler;
  return handler(req(c.url, c.method, c.body) as never, { params: Promise.resolve(c.params) } as never);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_ENV = 'staging';
  state.who = 'none';
});

describe('管理用の API は、ログインしていないと呼べない', () => {
  for (const c of CASES) {
    it(`${c.name}（${c.method} ${c.url}）: 未ログインは 401、別の店舗の人は 403`, async () => {
      const anon = await call(c);
      expect(anon.status).toBe(401);
      state.who = 'store_b';
      const other = await call(c);
      expect(other.status).toBe(403);
    }, 120000);
  }
});

describe('運営だけの操作は、店舗管理者が自分の店舗に対して呼んでも 403', () => {
  for (const c of CASES.filter((x) => x.upperOnly)) {
    it(`${c.name}（${c.method} ${c.url}）`, async () => {
      state.who = 'store_a';
      const res = await call(c);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('運営');
    });
  }
});

describe('ID から店舗をたどる API は、存在しない ID なら 404', () => {
  it('フォーム・アンケート・予約', async () => {
    state.who = 'master';
    const form = await (await import('@/app/api/forms/[formId]/route')).DELETE(req('/api/forms/nope', 'DELETE') as never, { params: Promise.resolve({ formId: 'nope' }) } as never);
    expect(form.status).toBe(404);
    const survey = await (await import('@/app/api/surveys/[id]/route')).DELETE(req('/api/surveys/nope', 'DELETE') as never, { params: Promise.resolve({ id: 'nope' }) } as never);
    expect(survey.status).toBe(404);
    const resv = await (await import('@/app/api/reservations/[reservationId]/route')).PATCH(req('/api/reservations/nope', 'PATCH', { status: 'cancelled' }) as never, { params: Promise.resolve({ reservationId: 'nope' }) } as never);
    expect(resv.status).toBe(404);
  });
});

describe('画像のアップロード・削除', () => {
  const upload = async (fields: Record<string, string>) => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const headers = new Headers();
    if (state.who !== 'none') headers.set('cookie', 'sb-access-token=token');
    const { POST } = await import('@/app/api/upload/menu-image/route');
    return POST(new Request('https://app.example/api/upload/menu-image', { method: 'POST', body: fd, headers }) as never);
  };
  const remove = async (url: string) => {
    const headers = new Headers();
    if (state.who !== 'none') headers.set('cookie', 'sb-access-token=token');
    const { DELETE } = await import('@/app/api/upload/menu-image/route');
    return DELETE(new Request(`https://app.example/api/upload/menu-image?url=${encodeURIComponent(url)}`, { method: 'DELETE', headers }) as never);
  };

  it('アップロード: 未ログインは 401、別の店舗の人は 403', async () => {
    expect((await upload({ storeId: 'storea', menuId: 'menu_1' })).status).toBe(401);
    state.who = 'store_b';
    expect((await upload({ storeId: 'storea', menuId: 'menu_1' })).status).toBe(403);
  });

  it('アップロード: 店舗 ID や画像の名前にフォルダの区切りを入れられない', async () => {
    state.who = 'store_a';
    expect((await upload({ storeId: '../storea', menuId: 'menu_1' })).status).toBe(400);
    expect((await upload({ storeId: 'storea', menuId: '../../reservations/x' })).status).toBe(400);
    expect((await upload({ storeId: 'storea', menuId: 'a..b' })).status).toBe(400);
  });

  it('削除: 未ログインは 401、別の店舗の画像は 403、画像置き場以外（フォームの HTML など）は 400', async () => {
    const mine = 'https://x.supabase.co/storage/v1/object/public/forms/menu_images/storea/menu_1_abc.png';
    expect((await remove(mine)).status).toBe(401);
    state.who = 'store_b';
    expect((await remove(mine)).status).toBe(403);
    state.who = 'store_a';
    expect((await remove('reservations/storea/form1/index.html')).status).toBe(400);
    expect((await remove('menu_images/storea/../../reservations/storea/form1/index.html')).status).toBe(400);
  });
});
