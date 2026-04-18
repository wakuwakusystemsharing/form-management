import { NextRequest, NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';
import { getCalendarClientForStore } from '@/lib/google-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/[storeId]/calendar/list
 * 店舗 OAuth 連携中の Google アカウントから、書き込み可能なカレンダー一覧を返す。
 * Caller must be store admin or service admin.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    if (env === 'local') {
      return NextResponse.json(
        { error: 'カレンダー一覧取得は staging/production 環境で利用できます' },
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

    const { data: store, error: storeError } = await (adminClient as any)
      .from('stores')
      .select('google_calendar_source, google_calendar_id, google_calendar_refresh_token')
      .eq('id', storeId)
      .single();

    if (storeError || !store) {
      return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
    }

    if (store.google_calendar_source !== 'store_oauth' || !store.google_calendar_refresh_token) {
      return NextResponse.json(
        { error: '店舗 OAuth 連携がされていません' },
        { status: 400 }
      );
    }

    const calendarClient = await getCalendarClientForStore(storeId);
    if (!calendarClient) {
      return NextResponse.json(
        { error: 'Googleカレンダークライアントの初期化に失敗しました' },
        { status: 500 }
      );
    }

    try {
      const list = await calendarClient.calendarList.list();
      const items = list.data.items || [];
      const calendars = items
        .filter((c) => c.accessRole === 'writer' || c.accessRole === 'owner')
        .map((c) => ({
          id: c.id || '',
          summary: c.summary || '',
          primary: !!c.primary,
          accessRole: c.accessRole || '',
          backgroundColor: c.backgroundColor || null,
        }))
        .filter((c) => c.id);

      return NextResponse.json({
        current_calendar_id: store.google_calendar_id || null,
        calendars,
      });
    } catch (err: any) {
      const isAuthError =
        err?.code === 400 ||
        err?.message?.includes('invalid_grant') ||
        err?.message?.includes('Token has been expired') ||
        err?.message?.includes('Token has been revoked');
      if (isAuthError) {
        return NextResponse.json(
          { error: 'Googleの認証が失効しています。再連携してください' },
          { status: 401 }
        );
      }
      console.error(`[API] Calendar list error for store ${storeId}:`, err);
      return NextResponse.json(
        { error: 'カレンダー一覧の取得に失敗しました' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[API] GET /api/stores/[storeId]/calendar/list error:', error);
    return NextResponse.json(
      { error: 'カレンダー一覧取得中にエラーが発生しました' },
      { status: 500 }
    );
  }
}
