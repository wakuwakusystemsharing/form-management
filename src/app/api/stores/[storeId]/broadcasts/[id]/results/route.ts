import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { isBroadcastId } from '@/lib/broadcast-service';
import { getBroadcastResultDetail } from '@/lib/broadcast-results-service';

type Params = { params: Promise<{ storeId: string; id: string }> };

// GET /api/stores/{storeId}/broadcasts/{id}/results?days=3|7|14 - 配信 1 件の成果（予約した人の一覧つき）
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = isBroadcastId(id) ? await getBroadcastResultDetail(storeId, id, new URL(request.url).searchParams.get('days')) : null;
    if (!result) return NextResponse.json({ error: '配信が見つかりません' }, { status: 404 });
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] broadcast result detail error:', error);
    return NextResponse.json({ error: '配信の成果の取得に失敗しました' }, { status: 500 });
  }
}
