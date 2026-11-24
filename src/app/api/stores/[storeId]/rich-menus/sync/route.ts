import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { syncRichMenuNow } from '@/lib/line-rich-menu-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/stores/{storeId}/rich-menus/sync - お客様ごとのメニューの設定を、いまの条件に合わせて見直す（画面の「いま見直す」）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await syncRichMenuNow(storeId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ...result.data, summary: result.summary ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[API] rich-menus sync error:', error);
    return NextResponse.json({ error: 'お客様ごとのメニューの見直しに失敗しました' }, { status: 500 });
  }
}
