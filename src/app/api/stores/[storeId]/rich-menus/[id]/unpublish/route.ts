import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { unpublishRichMenu } from '@/lib/line-rich-menu-service';

export const dynamic = 'force-dynamic';
// LINE との通信（メニューの作成・画像の送信・古いメニューの削除）に時間がかかることがある
export const maxDuration = 60;

// POST /api/stores/{storeId}/rich-menus/{id}/unpublish - 反映をやめる（公式 LINE の管理画面で設定したメニューに戻る）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string; id: string }> }) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await unpublishRichMenu(storeId, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ menu: result.data, notice: result.notice ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[API] rich-menus unpublish error:', error);
    return NextResponse.json({ error: 'リッチメニューの反映の取りやめに失敗しました' }, { status: 500 });
  }
}
