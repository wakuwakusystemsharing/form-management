import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { createRichMenu, getRichMenuOverview } from '@/lib/line-rich-menu-service';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// GET /api/stores/{storeId}/rich-menus - リッチメニューの一覧（+ 選べる予約フォーム・LINE のいまの設定との食い違い）
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const overview = await getRichMenuOverview(storeId, new URL(request.url).origin);
    return NextResponse.json(overview, { headers: NO_STORE });
  } catch (error) {
    console.error('[API] rich-menus list error:', error);
    return NextResponse.json({ error: 'リッチメニューの取得に失敗しました' }, { status: 500 });
  }
}

// POST /api/stores/{storeId}/rich-menus - 下書きを作る
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await createRichMenu(storeId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error('[API] rich-menus create error:', error);
    return NextResponse.json({ error: 'リッチメニューの作成に失敗しました' }, { status: 500 });
  }
}
