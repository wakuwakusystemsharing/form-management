import { NextRequest, NextResponse } from 'next/server';
import { cancelMyWaitlist, listMyWaitlist } from '@/lib/waitlist-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/waitlist/cancel - お客様が自分の空き待ちを取り消す。公開 API
 * （空き待ち ID・店舗・LINE ユーザー ID がすべて一致するときだけ）
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const entryId = typeof body?.entry_id === 'string' ? body.entry_id : '';
  const storeId = typeof body?.store_id === 'string' ? body.store_id : '';
  const lineUserId = typeof body?.line_user_id === 'string' ? body.line_user_id : '';
  if (!entryId || !storeId || !lineUserId) return NextResponse.json({ error: '空き待ちを確認できませんでした。' }, { status: 400 });
  try {
    const result = await cancelMyWaitlist({ entryId, storeId, lineUserId });
    if (!result.entry) return NextResponse.json({ error: '空き待ちが見つかりませんでした。' }, { status: 404 });
    return NextResponse.json({ cancelled: result.ok, entries: await listMyWaitlist(storeId, lineUserId) });
  } catch (e) {
    console.error('[API] waitlist cancel error:', e);
    return NextResponse.json({ error: '空き待ちを取り消せませんでした。時間をおいてもう一度お試しください。' }, { status: 500 });
  }
}
