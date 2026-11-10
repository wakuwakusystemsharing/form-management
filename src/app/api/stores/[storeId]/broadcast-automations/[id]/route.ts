import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { removeAutomation, saveAutomation } from '@/lib/broadcast-automation-service';
import { isBroadcastId } from '@/lib/broadcast-service';
import type { BroadcastAutomationInput } from '@/types/broadcast';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
type Params = { params: Promise<{ storeId: string; id: string }> };
const notFound = () => NextResponse.json({ error: '自動配信が見つかりません' }, { status: 404 });

// PUT /api/stores/{storeId}/broadcast-automations/{id} - 更新（body: BroadcastAutomationInput 全体）
export async function PUT(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return notFound();
    const body = (await request.json().catch(() => null)) as BroadcastAutomationInput | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    const result = await saveAutomation(storeId, id, body, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ automation: result.value }, noStore);
  } catch (error) {
    console.error('[API] broadcast automation update error:', error);
    return NextResponse.json({ error: '自動配信の更新に失敗しました' }, { status: 500 });
  }
}

// DELETE /api/stores/{storeId}/broadcast-automations/{id}
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id)) return notFound();
    const result = await removeAutomation(storeId, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true }, noStore);
  } catch (error) {
    console.error('[API] broadcast automation delete error:', error);
    return NextResponse.json({ error: '自動配信の削除に失敗しました' }, { status: 500 });
  }
}
