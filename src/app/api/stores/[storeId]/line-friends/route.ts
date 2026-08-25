import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 店舗側手動予約フォーム用: 店舗の LINE 友だち一覧
// - 認証済み公式アカウント: Messaging API の followers 一覧 + プロフィール取得
// - 未認証アカウント（followers API 不可）: LINE 連携済みの顧客一覧にフォールバック

interface FriendEntry {
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  customer_name: string | null;
  customer_phone: string | null;
}

const MAX_FOLLOWERS = 1000;        // プロフィール取得の負荷を抑える上限
const PROFILE_CONCURRENCY = 10;    // プロフィール取得の並列数

// ストア単位のメモリキャッシュ（サーバーレスのためベストエフォート）
const friendsCache = new Map<string, { at: number; payload: unknown }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 顧客 API と同じ認可チェック（local はスキップ、それ以外は店舗管理者のみ）
 */
async function authorizeStoreAccess(
  request: Request,
  storeId: string
): Promise<NextResponse | null> {
  const env = getAppEnvironment();
  if (env === 'local') return null;

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const token =
    request.headers.get('cookie')
      ?.split(';')
      .find((c) => c.trim().startsWith('sb-access-token='))
      ?.trim()
      .substring('sb-access-token='.length) ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const authClient = createAuthenticatedClient(token);
  if (!authClient) {
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
  }

  const hasAccess = await checkStoreAccess(user.id, storeId, user.email, authClient);
  if (!hasAccess) {
    return NextResponse.json({ error: 'この店舗へのアクセス権限がありません' }, { status: 403 });
  }

  return null;
}

/** followers/ids をページング取得（上限 MAX_FOLLOWERS）。403 等で使えない場合は null */
async function fetchFollowerIds(accessToken: string): Promise<{ ids: string[]; truncated: boolean } | null> {
  const ids: string[] = [];
  let next: string | undefined;
  let truncated = false;
  for (let page = 0; page < 10; page++) {
    const url = 'https://api.line.me/v2/bot/followers/ids?limit=1000' + (next ? `&start=${encodeURIComponent(next)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      // 403: 未認証アカウント（followers API は認証済み/プレミアムのみ）。400 等もフォールバックへ
      console.warn(`[API] line-friends followers fetch failed: status=${res.status}`);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.userIds)) return null;
    ids.push(...data.userIds.filter((x: unknown): x is string => typeof x === 'string'));
    if (ids.length >= MAX_FOLLOWERS) {
      truncated = true;
      ids.length = MAX_FOLLOWERS;
      break;
    }
    if (data.next) {
      next = data.next;
    } else {
      break;
    }
  }
  return { ids, truncated };
}

/** 各 userId のプロフィールを並列取得（失敗 = ブロック中等はスキップ） */
async function fetchProfiles(
  accessToken: string,
  userIds: string[]
): Promise<Map<string, { displayName: string | null; pictureUrl: string | null }>> {
  const result = new Map<string, { displayName: string | null; pictureUrl: string | null }>();
  let index = 0;
  const workers = Array.from({ length: PROFILE_CONCURRENCY }, async () => {
    while (index < userIds.length) {
      const i = index++;
      const userId = userIds[i];
      try {
        const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) continue; // ブロック中などは一覧から除外
        const p = await res.json().catch(() => null);
        if (p) {
          result.set(userId, {
            displayName: typeof p.displayName === 'string' ? p.displayName : null,
            pictureUrl: typeof p.pictureUrl === 'string' && /^https:/.test(p.pictureUrl) ? p.pictureUrl : null,
          });
        }
      } catch {
        // 通信エラーはスキップ
      }
    }
  });
  await Promise.all(workers);
  return result;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const env = getAppEnvironment();
    if (env === 'local') {
      // ローカル環境: ダミーデータ（UI 開発用）
      return NextResponse.json({
        source: 'followers',
        truncated: false,
        friends: [
          { line_user_id: 'Ulocal001', display_name: 'ローカル太郎', picture_url: null, customer_name: '山田 太郎', customer_phone: '090-0000-0001' },
          { line_user_id: 'Ulocal002', display_name: 'ローカル花子', picture_url: null, customer_name: null, customer_phone: null },
        ],
      });
    }

    // キャッシュ確認
    const cached = friendsCache.get(storeId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload);
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    const { data: store, error: storeError } = await (adminClient as any)
      .from('stores')
      .select('id, line_channel_access_token')
      .eq('id', storeId)
      .single();

    if (storeError || !store) {
      return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
    }

    const accessToken = store.line_channel_access_token;
    if (!accessToken) {
      return NextResponse.json(
        { error: 'LINEチャネルアクセストークンが未設定です。店舗設定でLINE連携を行ってください。' },
        { status: 400 }
      );
    }

    // LINE 連携済みの顧客（突合・フォールバック用）
    const { data: customers } = await (adminClient as any)
      .from('customers')
      .select('line_user_id, name, phone')
      .eq('store_id', storeId)
      .not('line_user_id', 'is', null);
    const customerByLineId = new Map<string, { name: string | null; phone: string | null }>();
    (customers || []).forEach((c: { line_user_id: string; name: string | null; phone: string | null }) => {
      if (c.line_user_id && !customerByLineId.has(c.line_user_id)) {
        customerByLineId.set(c.line_user_id, { name: c.name || null, phone: c.phone || null });
      }
    });

    // 友だち一覧の取得（認証済みアカウントのみ）
    const followers = await fetchFollowerIds(accessToken);

    let payload: { source: 'followers' | 'customers'; truncated: boolean; notice?: string; friends: FriendEntry[] };

    if (followers && followers.ids.length > 0) {
      const profiles = await fetchProfiles(accessToken, followers.ids);
      const friends: FriendEntry[] = [];
      for (const userId of followers.ids) {
        const profile = profiles.get(userId);
        if (!profile) continue; // プロフィール取得不可（ブロック中等）は除外
        const customer = customerByLineId.get(userId);
        friends.push({
          line_user_id: userId,
          display_name: profile.displayName,
          picture_url: profile.pictureUrl,
          customer_name: customer?.name || null,
          customer_phone: customer?.phone || null,
        });
      }
      // 表示名でソート（見つけやすさ優先）
      friends.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'ja'));
      payload = { source: 'followers', truncated: followers.truncated, friends };
    } else {
      // フォールバック: LINE 連携済み顧客一覧（未認証アカウント or 友だち0）
      const friends: FriendEntry[] = [];
      for (const [userId, customer] of customerByLineId) {
        friends.push({
          line_user_id: userId,
          display_name: customer.name,
          picture_url: null,
          customer_name: customer.name,
          customer_phone: customer.phone,
        });
      }
      friends.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'ja'));
      payload = {
        source: 'customers',
        truncated: false,
        notice: '友だち一覧を取得できないため（未認証アカウント等）、LINE連携済みのお客様のみ表示しています。',
        friends,
      };
    }

    friendsCache.set(storeId, { at: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[API] line-friends error:', error);
    return NextResponse.json({ error: 'お客様一覧の取得に失敗しました' }, { status: 500 });
  }
}
