import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLineFlexMessage } from '@/lib/line-flex-repository';
import { removeLineFlexMessage, saveLineFlexMessage } from '@/lib/line-flex-service';
import type { LineFlexMessageInput } from '@/types/line-flex';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
type Params = { params: Promise<{ storeId: string; id: string }> };

// GET /api/stores/{storeId}/line-messages/{id}
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const message = await getLineFlexMessage(storeId, id);
    if (!message) return NextResponse.json({ error: 'メッセージが見つかりません' }, { status: 404 });
    return NextResponse.json({ message }, noStore);
  } catch (error) {
    console.error('[API] line-messages get error:', error);
    return NextResponse.json({ error: 'LINE メッセージの取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/stores/{storeId}/line-messages/{id} - 更新（body: LineFlexMessageInput 全体）
export async function PUT(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = (await request.json().catch(() => null)) as LineFlexMessageInput | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    const result = await saveLineFlexMessage(storeId, id, body, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ message: result.value }, noStore);
  } catch (error) {
    console.error('[API] line-messages update error:', error);
    return NextResponse.json({ error: 'LINE メッセージの更新に失敗しました' }, { status: 500 });
  }
}

// DELETE /api/stores/{storeId}/line-messages/{id}
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await removeLineFlexMessage(storeId, id, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true }, noStore);
  } catch (error) {
    console.error('[API] line-messages delete error:', error);
    return NextResponse.json({ error: 'LINE メッセージの削除に失敗しました' }, { status: 500 });
  }
}
