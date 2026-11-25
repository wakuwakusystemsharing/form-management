import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getChatOverview } from '@/lib/chat-service';
import { isChatThreadFilter } from '@/lib/chat';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/chat/threads?filter=all|unread&search= - 1 対 1 トークの会話の一覧
// 未読のある会話が上・新しい順。LINE ユーザー ID は返さない
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const url = new URL(request.url);
    const filter = url.searchParams.get('filter');
    const overview = await getChatOverview(storeId, { filter: isChatThreadFilter(filter) ? filter : 'all', search: url.searchParams.get('search') });
    return NextResponse.json(overview, NO_STORE);
  } catch (error) {
    console.error('[API] chat threads error:', error);
    return NextResponse.json({ error: '会話の一覧の取得に失敗しました' }, { status: 500 });
  }
}
