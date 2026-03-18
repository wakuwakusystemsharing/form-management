import { NextRequest, NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/[storeId]/calendar/disconnect
 * Removes store's Google Calendar OAuth link: clears refresh token, sets source to 'system', clears calendar id.
 * Caller must be store admin or service admin.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    if (env === 'local') {
      return NextResponse.json(
        { error: 'カレンダー連携解除は staging/production 環境で利用できます' },
        { status: 501 }
      );
    }

    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const token =
      request.cookies.get('sb-access-token')?.value ||
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

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    const { error } = await (adminClient as any)
      .from('stores')
      .update({
        google_calendar_source: 'system',
        google_calendar_id: '',
        google_calendar_refresh_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', storeId);

    if (error) {
      console.error('[API] Calendar disconnect update error:', error);
      return NextResponse.json({ error: '連携解除に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] POST /api/stores/[storeId]/calendar/disconnect error:', error);
    return NextResponse.json({ error: '連携解除中にエラーが発生しました' }, { status: 500 });
  }
}
