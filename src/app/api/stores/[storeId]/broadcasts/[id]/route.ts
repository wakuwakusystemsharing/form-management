import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getBroadcast } from '@/lib/broadcast-repository';
import { isBroadcastId, removeBroadcast, saveBroadcast } from '@/lib/broadcast-service';
import type { BroadcastInput } from '@/types/broadcast';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
type Params = { params: Promise<{ storeId: string; id: string }> };
const notFound = () => NextResponse.json({ error: '配信が見つかりません' }, { status: 404 });

// GET /api/stores/{storeId}/broadcasts/{id}
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return notFound();
    const broadcast = await getBroadcast(storeId, id);
    return broadcast ? NextResponse.json({ broadcast }, noStore) : notFound();
  } catch (error) {
    console.error('[API] broadcast get error:', error);
    return NextResponse.json({ error: '配信の取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/stores/{storeId}/broadcasts/{id} - 下書きを更新（body: BroadcastInput 全体）
export async function PUT(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return notFound();
    const body = (await request.json().catch(() => null)) as BroadcastInput | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    const result = await saveBroadcast(storeId, id, body, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ broadcast: result.value }, noStore);
  } catch (error) {
    console.error('[API] broadcast update error:', error);
    return NextResponse.json({ error: '配信の更新に失敗しました' }, { status: 500 });
  }
}

// DELETE /api/stores/{storeId}/broadcasts/{id} - 下書き・送信済みを削除（予約済み・送信中は不可）
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return notFound();
    const result = await removeBroadcast(storeId, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true }, noStore);
  } catch (error) {
    console.error('[API] broadcast delete error:', error);
    return NextResponse.json({ error: '配信の削除に失敗しました' }, { status: 500 });
  }
}
