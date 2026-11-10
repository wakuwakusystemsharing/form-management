import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { testSendBroadcast, isBroadcastId } from '@/lib/broadcast-service';

type Params = { params: Promise<{ storeId: string; id: string }> };

// POST /api/stores/{storeId}/broadcasts/{id}/test - 指定した LINE ユーザーへテスト送信（push。無料通数を 1 通消費）
//   body: { line_user_id, name? }
export async function POST(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return NextResponse.json({ error: '配信が見つかりません' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const to = typeof body?.line_user_id === 'string' ? body.line_user_id.trim() : '';
    const result = await testSendBroadcast(storeId, id, to, typeof body?.name === 'string' ? body.name : null, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] broadcast test error:', error);
    return NextResponse.json({ error: 'テスト送信に失敗しました' }, { status: 500 });
  }
}
