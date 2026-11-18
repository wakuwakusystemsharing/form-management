import { NextRequest, NextResponse } from 'next/server';
import { getWaitlistSourceForForm } from '@/lib/waitlist-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/waitlist/source?entry_id=&store_id=&line_user_id=
 * 空きのお知らせから予約フォームを開いたとき（URL の ?waitlist=空き待ちID）に、
 * 入力済みにするメニュー・スタッフ・日時と、いまその日時を予約できるか（open）を返す。公開 API（本人の空き待ちだけ）
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const entryId = url.searchParams.get('entry_id') || '';
  const storeId = url.searchParams.get('store_id') || '';
  const lineUserId = url.searchParams.get('line_user_id') || '';
  try {
    const result = await getWaitlistSourceForForm({ entryId, storeId, lineUserId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ entry: result.entry }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[API] waitlist source error:', e);
    return NextResponse.json({ error: '空き待ちを確認できませんでした。' }, { status: 500 });
  }
}
