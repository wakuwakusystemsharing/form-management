import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { authorizeStoreAccess } from '@/lib/store-access';
import { fetchAllRows } from '@/lib/supabase-fetch-all';
import { listCalendarEventsAll } from '@/lib/google-calendar';
import {
  STAY_LOOKBACK_DAYS,
  addDays,
  busyBlocksFromGoogle,
  reservationOverlapsRange,
  validateCalendarRange,
  type BusyBlock,
  type CalendarReservationInput,
  type GoogleEventInput,
} from '@/lib/reservation-calendar';

export const dynamic = 'force-dynamic';

const RESERVATIONS_FILE = path.join(process.cwd(), 'data', 'reservations.json');

type Row = CalendarReservationInput & { store_id?: string; google_calendar_event_id?: string | null };

function readLocalReservations(): Row[] {
  if (!fs.existsSync(RESERVATIONS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sortRows(rows: Row[]): Row[] {
  return rows.sort((a, b) => {
    const da = String(a.reservation_date || '');
    const db = String(b.reservation_date || '');
    if (da !== db) return da < db ? -1 : 1;
    return String(a.reservation_time || '').localeCompare(String(b.reservation_time || ''));
  });
}

/**
 * GET /api/stores/{storeId}/reservations/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 予約カレンダー用: その期間に掛かる予約（キャンセルを含む。宿泊はチェックアウト日まで）と、
 * 予約以外の予定（Google カレンダー）の灰色の帯を返す。期間は最大 62 日。
 *
 * - google: 'ok' = 予定を読めた / 'none' = カレンダー未設定（local を含む）/ 'error' = 読み込みに失敗（予約だけ返す）
 * - 予約以外の予定は時間だけを返す（タイトルなどの中身は返さない）
 */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const rangeError = validateCalendarRange(from, to);
    if (rangeError || !from || !to) {
      return NextResponse.json({ error: rangeError || '期間は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
    }
    const headers = { 'Cache-Control': 'private, no-store' };
    // 宿泊は期間より前にチェックインした予約も掛かるので、少し前から読んでから絞り込む
    const readFrom = addDays(from, -STAY_LOOKBACK_DAYS);

    if (getAppEnvironment() === 'local') {
      const reservations = sortRows(readLocalReservations().filter((r) => r.store_id === storeId && reservationOverlapsRange(r, from, to)));
      return NextResponse.json({ from, to, reservations, busy: [], google: 'none' }, { headers });
    }

    const adminClient = createAdminClient();
    if (!adminClient) return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });

    const rows = await fetchAllRows<Row>((rangeFrom, rangeTo) =>
       
      (adminClient as any)
        .from('reservations')
        .select('*')
        .eq('store_id', storeId)
        .gte('reservation_date', readFrom)
        .lte('reservation_date', to)
        .order('reservation_date', { ascending: true })
        .order('id', { ascending: true })
        .range(rangeFrom, rangeTo)
    );
    const reservations = sortRows(rows.filter((r) => reservationOverlapsRange(r, from, to)));

    // 予約以外の予定（Google カレンダー）。読めなくても予約は返す
    let busy: BusyBlock[] = [];
    let google: 'ok' | 'none' | 'error' = 'none';
     
    const { data: store } = await (adminClient as any).from('stores').select('google_calendar_id').eq('id', storeId).maybeSingle();
    const calendarId = typeof store?.google_calendar_id === 'string' ? store.google_calendar_id : '';
    if (calendarId) {
      try {
        const events = await listCalendarEventsAll(calendarId, `${from}T00:00:00+09:00`, `${addDays(to, 1)}T00:00:00+09:00`, storeId);
        // このシステムの予約から作った予定は、予約として別に描くので除く（期間に掛からない予約のぶんも除くため、読んだ行すべてを見る）
        const reservationEventIds = rows.map((r) => r.google_calendar_event_id).filter((id): id is string => typeof id === 'string' && id.length > 0);
        busy = busyBlocksFromGoogle(events as GoogleEventInput[], { from, to, reservationEventIds });
        google = 'ok';
      } catch (e) {
        console.error('[API] reservations calendar: Google カレンダーの取得に失敗:', e instanceof Error ? e.message : e);
        google = 'error';
      }
    }

    return NextResponse.json({ from, to, reservations, busy, google }, { headers });
  } catch (error) {
    console.error('[API] reservations calendar error:', error);
    return NextResponse.json({ error: '予約カレンダーの取得に失敗しました' }, { status: 500 });
  }
}
