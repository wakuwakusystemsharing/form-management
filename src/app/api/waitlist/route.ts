import { NextRequest, NextResponse } from 'next/server';
import { listMyWaitlist, registerWaitlist } from '@/lib/waitlist-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/waitlist?store_id=&line_user_id=
 * 予約フォームに出す「あなたの空き待ち」。公開 API（LINE ユーザー ID が一致する登録中の空き待ちだけを返す）
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const storeId = url.searchParams.get('store_id') || '';
  const lineUserId = url.searchParams.get('line_user_id') || '';
  if (!storeId || !lineUserId) return NextResponse.json({ entries: [] }, { headers: NO_STORE });
  try {
    return NextResponse.json({ entries: await listMyWaitlist(storeId, lineUserId) }, { headers: NO_STORE });
  } catch (e) {
    console.error('[API] waitlist list error:', e);
    return NextResponse.json({ entries: [] }, { headers: NO_STORE });
  }
}

/**
 * POST /api/waitlist - 空き待ち（キャンセル待ち）を登録する。公開 API。
 * フォームの設定が ON で、その日時が満席のときだけ受け付ける（409 + code: slot_open / duplicate / limit / deadline など）
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'リクエストの形式が正しくありません' }, { status: 400 });
  try {
    const result = await registerWaitlist({
      storeId: body.store_id,
      formId: body.form_id,
      lineUserId: body.line_user_id,
      customerName: body.customer_name,
      date: body.date,
      time: body.time,
      selectedMenus: body.selected_menus,
      selectedOptions: body.selected_options,
      totalDuration: body.total_duration,
      menuText: body.menu_text,
      staffId: body.staff_id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    const entries = await listMyWaitlist(result.entry.store_id, result.entry.line_user_id);
    return NextResponse.json({ entry_id: result.entry.id, entries }, { status: 201 });
  } catch (e) {
    console.error('[API] waitlist register error:', e);
    return NextResponse.json({ error: '空き待ちを登録できませんでした。時間をおいてもう一度お試しください。' }, { status: 500 });
  }
}
