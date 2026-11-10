import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { estimateAudience, listAudience } from '@/lib/broadcast-service';

const noStore = { headers: { 'Cache-Control': 'no-store' } };

// POST /api/stores/{storeId}/broadcasts/estimate - 配信先の人数見積り
//   body: { audience, list?: { offset, limit } }  list を付けると対象者の一覧（ページング）も返す
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => ({}));
    const audience = body?.audience ?? {};
    if (body?.list && typeof body.list === 'object') {
      const offset = Number(body.list.offset) || 0;
      const limit = Number(body.list.limit) || 50;
      return NextResponse.json(await listAudience(storeId, audience, offset, limit), noStore);
    }
    return NextResponse.json(await estimateAudience(storeId, audience), noStore);
  } catch (error) {
    console.error('[API] broadcast estimate error:', error);
    return NextResponse.json({ error: '配信先の計算に失敗しました' }, { status: 500 });
  }
}
