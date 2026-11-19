import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getMonthlyReportPage } from '@/lib/store-digest-service';

// GET /api/stores/{storeId}/reports/monthly?month=YYYY-MM - 月次レポート（month 省略 = 先月）+ 見られる月の一覧
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const month = new URL(request.url).searchParams.get('month');
    return NextResponse.json(await getMonthlyReportPage(storeId, month), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] monthly report error:', error);
    return NextResponse.json({ error: '月次レポートの取得に失敗しました' }, { status: 500 });
  }
}
