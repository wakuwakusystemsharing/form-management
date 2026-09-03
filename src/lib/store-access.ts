/**
 * 店舗単位の管理 API 共通の認可チェック
 *
 * - local 環境: 認証スキップ（null を返す）
 * - それ以外: getCurrentUser → checkStoreAccess（マスター / システム管理者 / 店舗管理者）
 *
 * 失敗時はそのまま返せる NextResponse を返し、成功時は null と認証ユーザーを返す。
 * 顧客 API（customers/route.ts）の authorizeStoreAccess と同じ挙動を共通化したもの。
 */
import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { checkStoreAccess, createAuthenticatedClient } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';

export interface StoreAccessResult {
  response: NextResponse | null;
  user: { id: string; email: string | undefined } | null;
}

function extractAccessToken(request: Request): string | null {
  const cookieToken = request.headers
    .get('cookie')
    ?.split(';')
    .find((c) => c.trim().startsWith('sb-access-token='))
    ?.trim()
    .substring('sb-access-token='.length);
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  return cookieToken || bearer || null;
}

export async function authorizeStoreAccess(request: Request, storeId: string): Promise<StoreAccessResult> {
  if (getAppEnvironment() === 'local') {
    return { response: null, user: null };
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: '認証が必要です' }, { status: 401 }), user: null };
  }

  const token = extractAccessToken(request);
  if (!token) {
    return { response: NextResponse.json({ error: '認証が必要です' }, { status: 401 }), user: null };
  }

  const authClient = createAuthenticatedClient(token);
  if (!authClient) {
    return { response: NextResponse.json({ error: '認証に失敗しました' }, { status: 401 }), user: null };
  }

  const hasAccess = await checkStoreAccess(user.id, storeId, user.email, authClient);
  if (!hasAccess) {
    return { response: NextResponse.json({ error: 'この店舗へのアクセス権限がありません' }, { status: 403 }), user };
  }

  return { response: null, user };
}
