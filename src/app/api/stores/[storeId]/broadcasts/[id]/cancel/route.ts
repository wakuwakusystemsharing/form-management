import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { cancelBroadcast, isBroadcastId } from '@/lib/broadcast-service';

type Params = { params: Promise<{ storeId: string; id: string }> };

// POST /api/stores/{storeId}/broadcasts/{id}/cancel - 予約を取り消して下書きに戻す（送信開始前のみ）
export async function POST(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return NextResponse.json({ error: '配信が見つかりません' }, { status: 404 });
    const result = await cancelBroadcast(storeId, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ broadcast: result.value });
  } catch (error) {
    console.error('[API] broadcast cancel error:', error);
    return NextResponse.json({ error: '予約の取り消しに失敗しました' }, { status: 500 });
  }
}
