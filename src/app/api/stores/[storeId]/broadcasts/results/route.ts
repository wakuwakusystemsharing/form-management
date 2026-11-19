import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getBroadcastResultSummaries } from '@/lib/broadcast-results-service';

// GET /api/stores/{storeId}/broadcasts/results?days=3|7|14 - 配信ごとの成果の要約（配信後の予約数・売上）
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await getBroadcastResultSummaries(storeId, new URL(request.url).searchParams.get('days'));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] broadcast results error:', error);
    return NextResponse.json({ error: '配信の成果の取得に失敗しました' }, { status: 500 });
  }
}
