import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { createRichMenuTabSet } from '@/lib/line-rich-menu-service';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// POST /api/stores/{storeId}/rich-menus/tab-set - タブ付きメニューをまとめて作る（タブの数だけ、たがいに切り替わる下書きを作る）
//   body: { size: 'large' | 'small', tabs: string[]（タブの名前。2〜5 個）, chat_bar_text?: string }
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await createRichMenuTabSet(storeId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ menus: result.data }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error('[API] rich-menus tab-set error:', error);
    return NextResponse.json({ error: 'タブ付きメニューの作成に失敗しました' }, { status: 500 });
  }
}
