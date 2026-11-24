import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { publishRichMenu } from '@/lib/line-rich-menu-service';

export const dynamic = 'force-dynamic';
// LINE との通信（メニューの作成・画像の送信・古いメニューの削除）に時間がかかることがある
export const maxDuration = 60;

// POST /api/stores/{storeId}/rich-menus/{id}/publish - 全員向けのメニューとして公式 LINE に反映する
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string; id: string }> }) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await publishRichMenu(storeId, id, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ menu: result.data, notice: result.notice ?? null, summary: result.summary ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[API] rich-menus publish error:', error);
    return NextResponse.json({ error: 'リッチメニューの反映に失敗しました' }, { status: 500 });
  }
}
