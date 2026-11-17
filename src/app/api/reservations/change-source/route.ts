import { NextRequest, NextResponse } from 'next/server';
import { getChangeSourceForForm } from '@/lib/reservation-change-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/reservations/change-source?reservation_id=&store_id=&line_user_id=
 * 予約フォームを変更用に開いたとき（LINE の「予約を変更」→「メニューを変更」）に、変更元の予約の内容を返す。
 * 公開 API。予約 ID（本人のトークにだけ届く）と LINE ユーザー ID の両方が一致し、変更できる期限内のときだけ返す
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const reservationId = url.searchParams.get('reservation_id') || '';
  const storeId = url.searchParams.get('store_id') || '';
  const lineUserId = url.searchParams.get('line_user_id') || '';
  if (!reservationId || !storeId || !lineUserId) {
    return NextResponse.json({ error: '変更するご予約を確認できませんでした。' }, { status: 400 });
  }
  try {
    const result = await getChangeSourceForForm({ reservationId, storeId, lineUserId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ reservation: result.reservation });
  } catch (e) {
    console.error('[API] change-source error:', e);
    return NextResponse.json({ error: '変更するご予約を確認できませんでした。時間をおいてもう一度お試しください。' }, { status: 500 });
  }
}
