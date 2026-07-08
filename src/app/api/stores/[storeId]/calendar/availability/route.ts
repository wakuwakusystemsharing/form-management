import { NextRequest, NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { listCalendarEvents } from '@/lib/google-calendar';
import { normalizeForm } from '@/lib/form-normalizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CalendarTarget = { calendarId: string; staffId: string | null };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params;
  const env = getAppEnvironment();
  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  // スタッフ選択用: staff_id（スタッフID or 'all'）と form_id（スタッフ設定の取得元フォーム）
  const staffIdParam = url.searchParams.get('staff_id');
  const formIdParam = url.searchParams.get('form_id');

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

  // 取得対象カレンダーを決定（デフォルト: 店舗カレンダー）
  // セキュリティ: カレンダーIDを直接受け取らず、フォーム設定に登録済みのスタッフIDから引く
  let targets: CalendarTarget[] = store.google_calendar_id
    ? [{ calendarId: store.google_calendar_id, staffId: null }]
    : [];

  if (staffIdParam && formIdParam) {
    const { data: formRow } = await (adminClient as any)
      .from('reservation_forms')
      .select('config')
      .eq('id', formIdParam)
      .eq('store_id', storeId)
      .single();

    if (formRow?.config) {
      try {
        const normalized = normalizeForm({ id: formIdParam, store_id: storeId, config: formRow.config });
        const ss = normalized.config.staff_selection;
        if (ss?.enabled === true) {
          const staffWithCalendar = (ss.staff || []).filter((m) => m.name && m.calendar_id);
          if (staffIdParam === 'all') {
            if (staffWithCalendar.length > 0) {
              targets = staffWithCalendar.map((m) => ({ calendarId: m.calendar_id, staffId: m.id }));
            }
          } else {
            const member = staffWithCalendar.find((m) => m.id === staffIdParam);
            if (member) {
              targets = [{ calendarId: member.calendar_id, staffId: member.id }];
            }
          }
        }
      } catch (e) {
        console.error('[API] availability: form config parse error:', e);
      }
    }
  }

  if (targets.length === 0) {
    return NextResponse.json([]);
  }

  try {
    // 複数カレンダーを並列取得し、各イベントにスタッフIDをタグ付けして返す
    const results = await Promise.all(
      targets.map(async (t) => {
        try {
          const events = await listCalendarEvents(t.calendarId, start, end, storeId);
          return events.map(event => {
            const startTime = event.start?.dateTime || event.start?.date || '';
            const endTime = event.end?.dateTime || event.end?.date || '';
            return {
              title: event.summary || '',
              summary: event.summary || '',
              startTime,
              endTime,
              location: event.location || '',
              description: event.description || '',
              isBusinessDay: (event.summary || '').includes('営業日'),
              staff_id: t.staffId
            };
          });
        } catch (calError: unknown) {
          // 一部のスタッフカレンダーが壊れていても他のカレンダーの結果は返す
          const msg = calError instanceof Error ? calError.message : String(calError);
          console.error(`[API] Calendar availability error (calendar=${t.calendarId}) for store ${storeId}:`, msg);
          return [];
        }
      })
    );

    return NextResponse.json(results.flat());
  } catch (error: any) {
    const isAuthError = error?.code === 400 ||
      error?.message?.includes('invalid_grant') ||
      error?.message?.includes('Token has been expired') ||
      error?.message?.includes('Token has been revoked');

    if (isAuthError) {
      console.error(`[API] Calendar auth error for store ${storeId} (token may be expired):`, error?.message || error);
    } else {
      console.error(`[API] Calendar availability error for store ${storeId}:`, error);
    }

    // カレンダーが壊れていてもフォーム自体は使えるように空配列を返す
    return NextResponse.json([]);
  }
}
