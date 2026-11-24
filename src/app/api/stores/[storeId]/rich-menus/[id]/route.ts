import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { removeRichMenu, saveRichMenu } from '@/lib/line-rich-menu-service';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ storeId: string; id: string }> };

// PUT /api/stores/{storeId}/rich-menus/{id} - 内容を保存する（保存しただけでは公式 LINE には出ない）
export async function PUT(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await saveRichMenu(storeId, id, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[API] rich-menus update error:', error);
    return NextResponse.json({ error: 'リッチメニューの保存に失敗しました' }, { status: 500 });
  }
}

// DELETE /api/stores/{storeId}/rich-menus/{id} - 削除する（反映中のものは、先に反映をやめる）
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await removeRichMenu(storeId, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  } catch (error) {
    console.error('[API] rich-menus delete error:', error);
    return NextResponse.json({ error: 'リッチメニューの削除に失敗しました' }, { status: 500 });
  }
}
