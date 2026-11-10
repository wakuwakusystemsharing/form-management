import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { scheduleBroadcast, isBroadcastId } from '@/lib/broadcast-service';

type Params = { params: Promise<{ storeId: string; id: string }> };

// POST /api/stores/{storeId}/broadcasts/{id}/schedule - 対象者を確定して予約 / 今すぐ送る
//   body: { scheduled_at?: ISO（無ければ今すぐ）, confirmed?: 上限超過の確認済み, double_confirmed?: 100 人超の確認済み }
//   409 + code: over_limit / needs_confirm / needs_double_confirm
export async function POST(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return NextResponse.json({ error: '配信が見つかりません' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const result = await scheduleBroadcast(
      storeId,
      id,
      { scheduled_at: typeof body?.scheduled_at === 'string' && body.scheduled_at ? body.scheduled_at : null, confirmed: body?.confirmed === true, double_confirmed: body?.double_confirmed === true },
      new URL(request.url).origin
    );
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ broadcast: result.value.broadcast, immediate: result.value.immediate });
  } catch (error) {
    console.error('[API] broadcast schedule error:', error);
    return NextResponse.json({ error: '配信の予約に失敗しました' }, { status: 500 });
  }
}
