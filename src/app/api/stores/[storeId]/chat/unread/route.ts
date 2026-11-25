import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getChatUnread } from '@/lib/chat-service';
import { fetchLineQuota } from '@/lib/broadcast-automation-service';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/chat/unread?quota=1 - トーク機能が ON か・未読の合計（タブのバッジ用）
// quota=1 を付けると、公式 LINE の今月の通数（使った数・上限）も返す（取得できなければ null）
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const withQuota = new URL(request.url).searchParams.get('quota') === '1';
    const [state, quota] = await Promise.all([getChatUnread(storeId), withQuota ? fetchLineQuota(storeId).catch(() => null) : Promise.resolve(undefined)]);
    return NextResponse.json(withQuota ? { ...state, line_quota: quota ?? null } : state, NO_STORE);
  } catch (error) {
    console.error('[API] chat unread error:', error);
    return NextResponse.json({ error: '未読の数の取得に失敗しました' }, { status: 500 });
  }
}
