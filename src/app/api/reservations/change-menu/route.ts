import { NextRequest, NextResponse } from 'next/server';
import { changeReservationMenu } from '@/lib/reservation-change-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/reservations/change-menu
 * メニュー変更フォーム（LINE の「予約を変更」→「メニューを変更」）の送信。新しい予約は作らず、
 * いまの予約のメニュー（と、いまの時間に入らず選び直したときだけ日時）を書き換える。
 * check_only: true のときは「選んだメニューがいまの時間に入るか」だけを返す（{ fits }）。
 * 公開 API。予約 ID（本人のトークにだけ届く）と LINE ユーザー ID の両方が一致し、変更できる期限内のときだけ受け付ける
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || typeof body.reservation_id !== 'string' || typeof body.store_id !== 'string') {
    return NextResponse.json({ error: '変更するご予約を確認できませんでした。' }, { status: 400 });
  }
  try {
    const result = await changeReservationMenu({
      reservationId: body.reservation_id,
      storeId: body.store_id,
      lineUserId: typeof body.line_user_id === 'string' ? body.line_user_id : null,
      checkOnly: body.check_only === true,
      selectedMenus: body.selected_menus,
      selectedOptions: body.selected_options,
      totalDuration: body.total_duration,
      totalPrice: body.total_price,
      date: body.reservation_date,
      time: body.reservation_time,
      message: body.message,
      customFields: body.custom_fields,
      customFieldsLabeled: body.custom_fields_labeled,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    if (body.check_only === true) return NextResponse.json({ fits: result.fits });
    return NextResponse.json({ success: true, reservation_date: result.reservation?.reservation_date, reservation_time: result.reservation?.reservation_time });
  } catch (e) {
    console.error('[API] change-menu error:', e);
    return NextResponse.json({ error: 'メニューを変更できませんでした。時間をおいてもう一度お試しください。' }, { status: 500 });
  }
}
