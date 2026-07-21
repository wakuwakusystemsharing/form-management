// 外部予約メール連携: 外部予約のキャンセル
// PATCH { status: 'cancelled' } → 連携先Googleカレンダーのイベントを削除し、ステータスを cancelled に更新

import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';
import { deleteCalendarEvent } from '@/lib/google-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ storeId: string; externalId: string }> }
) {
  try {
    const { storeId, externalId } = await params;
    const env = getAppEnvironment();
    if (env === 'local') {
      return NextResponse.json({ error: 'local 環境では利用できません' }, { status: 400 });
    }

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const body = await request.json();
    if (body.status !== 'cancelled') {
      return NextResponse.json({ error: '外部予約はキャンセルのみ変更できます' }, { status: 400 });
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    // 店舗境界の確認込みで対象を取得
    const { data: external } = await (adminClient as any)
      .from('external_reservations')
      .select('id,store_id,status,google_calendar_event_id')
      .eq('id', externalId)
      .eq('store_id', storeId)
      .single();

    if (!external) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }
    if (external.status === 'cancelled') {
      return NextResponse.json({ ok: true, already: true });
    }

    // Googleカレンダーのイベントを削除（イベントIDがある場合）
    if (external.google_calendar_event_id) {
      // 登録先カレンダー: 連携設定 > 店舗カレンダー（イベント作成時と同じ解決順）
      const { data: integration } = await (adminClient as any)
        .from('external_mail_integrations')
        .select('target_calendar_id')
        .eq('store_id', storeId)
        .single();
      let calendarId: string | null = integration?.target_calendar_id || null;
      if (!calendarId) {
        const { data: storeData } = await (adminClient as any)
          .from('stores')
          .select('google_calendar_id')
          .eq('id', storeId)
          .single();
        calendarId = storeData?.google_calendar_id || null;
      }

      if (calendarId) {
        try {
          await deleteCalendarEvent(calendarId, external.google_calendar_event_id, storeId);
        } catch (calError: unknown) {
          // すでに削除済み（404/410）は成功扱い。それ以外はエラーを返してリトライ可能にする
          const status = (calError as { code?: number; response?: { status?: number } })?.code
            ?? (calError as { response?: { status?: number } })?.response?.status;
          if (status !== 404 && status !== 410) {
            console.error('[external-reservations] calendar delete error:', calError);
            return NextResponse.json(
              { error: 'Googleカレンダーのイベント削除に失敗しました。時間をおいて再度お試しください。' },
              { status: 500 }
            );
          }
        }
      }
    }

    const { error: updateError } = await (adminClient as any)
      .from('external_reservations')
      .update({ status: 'cancelled' })
      .eq('id', externalId)
      .eq('store_id', storeId);

    if (updateError) {
      console.error('[external-reservations] update error:', updateError);
      return NextResponse.json({ error: 'ステータスの更新に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[external-reservations] PATCH error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
