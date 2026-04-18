import { NextRequest, NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';
import { createStoreCalendar, getCalendarClientForStore } from '@/lib/google-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/[storeId]/calendar
 * 店舗に紐づく Google カレンダーを作成し、stores.google_calendar_id を更新する。
 * 既に google_calendar_id が設定されている場合は何もせず既存 ID を返す。
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    if (env === 'local') {
      return NextResponse.json(
        { error: 'カレンダー作成は staging/production 環境で利用できます' },
        { status: 501 }
      );
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const { data: store, error: storeError } = await (adminClient as any)
      .from('stores')
      .select('id, name, google_calendar_id, owner_email')
      .eq('id', storeId)
      .single();

    if (storeError || !store) {
      return NextResponse.json(
        { error: '店舗が見つかりません' },
        { status: 404 }
      );
    }

    if (store.google_calendar_id) {
      return NextResponse.json(
        { google_calendar_id: store.google_calendar_id },
        { status: 200 }
      );
    }

    const googleCalendarId = await createStoreCalendar(store.name, store.owner_email ?? null);
    if (!googleCalendarId) {
      return NextResponse.json(
        { error: 'Googleカレンダーの作成に失敗しました' },
        { status: 500 }
      );
    }

    const { error: updateError } = await (adminClient as any)
      .from('stores')
      .update({
        google_calendar_id: googleCalendarId,
        updated_at: new Date().toISOString()
      })
      .eq('id', storeId);

    if (updateError) {
      console.error('[API] Store calendar id update error:', updateError);
      return NextResponse.json(
        { error: '店舗の更新に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { google_calendar_id: googleCalendarId },
      { status: 200 }
    );
  } catch (error) {
    console.error('[API] POST /api/stores/[storeId]/calendar error:', error);
    return NextResponse.json(
      { error: 'カレンダーの作成中にエラーが発生しました' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/stores/[storeId]/calendar
 * 店舗 OAuth 連携中のアカウントから、指定したカレンダー ID に切り替える。
 * Caller must be store admin or service admin.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    if (env === 'local') {
      return NextResponse.json(
        { error: 'カレンダー変更は staging/production 環境で利用できます' },
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

    const body = await request.json().catch(() => null);
    const nextCalendarId =
      typeof body?.google_calendar_id === 'string' ? body.google_calendar_id.trim() : '';

    if (!nextCalendarId) {
      return NextResponse.json(
        { error: 'google_calendar_id が必要です' },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    const { data: store, error: storeError } = await (adminClient as any)
      .from('stores')
      .select('google_calendar_source, google_calendar_refresh_token')
      .eq('id', storeId)
      .single();

    if (storeError || !store) {
      return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
    }

    if (store.google_calendar_source !== 'store_oauth' || !store.google_calendar_refresh_token) {
      return NextResponse.json(
        { error: '店舗 OAuth 連携がされていないため、カレンダーを変更できません' },
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
      const matched = (list.data.items || []).find((c) => c.id === nextCalendarId);
      if (!matched) {
        return NextResponse.json(
          { error: '指定されたカレンダーが見つかりません' },
          { status: 400 }
        );
      }
      if (matched.accessRole !== 'writer' && matched.accessRole !== 'owner') {
        return NextResponse.json(
          { error: 'このカレンダーへの書き込み権限がありません' },
          { status: 400 }
        );
      }
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
      console.error(`[API] Calendar verify error for store ${storeId}:`, err);
      return NextResponse.json(
        { error: 'カレンダーの検証に失敗しました' },
        { status: 500 }
      );
    }

    const { error: updateError } = await (adminClient as any)
      .from('stores')
      .update({
        google_calendar_id: nextCalendarId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', storeId);

    if (updateError) {
      console.error('[API] Store calendar id update error:', updateError);
      return NextResponse.json(
        { error: '店舗の更新に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ google_calendar_id: nextCalendarId });
  } catch (error) {
    console.error('[API] PUT /api/stores/[storeId]/calendar error:', error);
    return NextResponse.json(
      { error: 'カレンダーの変更中にエラーが発生しました' },
      { status: 500 }
    );
  }
}
