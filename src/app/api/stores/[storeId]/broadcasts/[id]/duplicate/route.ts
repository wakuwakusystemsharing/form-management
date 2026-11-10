import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { duplicateBroadcast, isBroadcastId } from '@/lib/broadcast-service';

type Params = { params: Promise<{ storeId: string; id: string }> };

// POST /api/stores/{storeId}/broadcasts/{id}/duplicate - 下書きとして複製
export async function POST(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return NextResponse.json({ error: '配信が見つかりません' }, { status: 404 });
    const result = await duplicateBroadcast(storeId, id, new URL(request.url).origin, auth.user?.id ?? null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ broadcast: result.value }, { status: 201 });
  } catch (error) {
    console.error('[API] broadcast duplicate error:', error);
    return NextResponse.json({ error: '配信の複製に失敗しました' }, { status: 500 });
  }
}
