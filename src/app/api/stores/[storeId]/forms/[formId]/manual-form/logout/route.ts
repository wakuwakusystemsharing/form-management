import { NextResponse } from 'next/server';
import { clearSessionCookies, createAuthClient, readCookie, REFRESH_COOKIE } from '@/lib/manual-form-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/stores/[storeId]/forms/[formId]/manual-form/logout
// 手動フォームからのログアウト（Cookie 削除 + 可能ならリフレッシュトークンを失効）
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string; formId: string }> }
) {
  const { storeId, formId } = await params;

  // サーバー側でもリフレッシュトークンを失効させる（失敗しても Cookie 削除は行う）
  try {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    const client = createAuthClient();
    if (refreshToken && client) {
      const { data } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (data.session) {
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
      }
    }
  } catch {
    /* ignore */
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookies(response, storeId, formId);
  return response;
}
