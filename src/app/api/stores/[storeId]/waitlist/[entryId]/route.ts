import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { cancelWaitlistByStore } from '@/lib/waitlist-service';

// PATCH /api/stores/{storeId}/waitlist/{entryId} - { action: 'cancel' } 店舗が空き待ちを取り消す
export async function PATCH(request: Request, { params }: { params: Promise<{ storeId: string; entryId: string }> }) {
  try {
    const { storeId, entryId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    if (body?.action !== 'cancel') return NextResponse.json({ error: '操作を指定してください' }, { status: 400 });
    const done = await cancelWaitlistByStore(storeId, entryId);
    if (!done) return NextResponse.json({ error: '空き待ちが見つからないか、すでに終了しています' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] waitlist cancel error:', error);
    return NextResponse.json({ error: '空き待ちの取り消しに失敗しました' }, { status: 500 });
  }
}
