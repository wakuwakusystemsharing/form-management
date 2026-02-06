import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { createStoreCalendar } from '@/lib/google-calendar';

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
