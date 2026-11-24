import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getSourceStats } from '@/lib/reservation-source-service';

export const dynamic = 'force-dynamic';

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/stores/{storeId}/reservation-sources/stats?date_from&date_to&form_id
// 経路ごとの 予約数 / キャンセル数 / 売上 / 予約率（期間 = 予約日。予約分析と同じ基準）
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const { searchParams } = new URL(request.url);
    const fromRaw = searchParams.get('date_from');
    const toRaw = searchParams.get('date_to');
    if ((fromRaw && !DATE_PARAM_RE.test(fromRaw)) || (toRaw && !DATE_PARAM_RE.test(toRaw))) {
      return NextResponse.json({ error: '日付は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
    }
    const dateFrom = fromRaw || null;
    const dateTo = toRaw || null;
    const formId = searchParams.get('form_id')?.trim() || null;

    const stats = await getSourceStats(storeId, { dateFrom, dateTo, formId });
    return NextResponse.json({ ...stats, period: { date_from: dateFrom, date_to: dateTo }, form_id: formId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] reservation-sources stats error:', error);
    return NextResponse.json({ error: '流入経路の集計に失敗しました' }, { status: 500 });
  }
}
