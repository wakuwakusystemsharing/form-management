import { NextRequest, NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { listCalendarEvents } from '@/lib/google-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params;
  const env = getAppEnvironment();
  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  if (!start || !end) {
    return NextResponse.json({ error: 'start と end は必須です' }, { status: 400 });
  }

  if (env === 'local') {
    return NextResponse.json([]);
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
  }

  const { data: store, error } = await (adminClient as any)
    .from('stores')
    .select('google_calendar_id')
    .eq('id', storeId)
    .single();

  if (error || !store) {
    return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
  }

  if (!store.google_calendar_id) {
    return NextResponse.json([]);
  }

  try {
    const events = await listCalendarEvents(store.google_calendar_id, start, end, storeId);
    const availability = events.map(event => {
      const startTime = event.start?.dateTime || event.start?.date || '';
      const endTime = event.end?.dateTime || event.end?.date || '';
      return {
        title: event.summary || '',
        summary: event.summary || '',
        startTime,
        endTime,
        location: event.location || '',
        description: event.description || '',
        isBusinessDay: (event.summary || '').includes('営業日')
      };
    });

    return NextResponse.json(availability);
  } catch (error) {
    console.error('[API] Calendar availability error:', error);
    return NextResponse.json({ error: 'カレンダーの取得に失敗しました' }, { status: 500 });
  }
}
