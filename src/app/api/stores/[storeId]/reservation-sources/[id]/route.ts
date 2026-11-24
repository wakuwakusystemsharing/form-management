import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { editSource } from '@/lib/reservation-source-service';

export const dynamic = 'force-dynamic';

// PUT /api/stores/{storeId}/reservation-sources/{id} - 経路の名前 / 開くフォーム / 有効・停止を変える
// 経路は削除しない（過去の集計を残すため。使わなくなったら { active: false } で停止する）
export async function PUT(request: Request, { params }: { params: Promise<{ storeId: string; id: string }> }) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = (await request.json().catch(() => null)) as { name?: unknown; form_id?: unknown; active?: unknown } | null;
    const result = await editSource(storeId, id, body || {}, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] reservation-sources update error:', error);
    return NextResponse.json({ error: '経路の更新に失敗しました' }, { status: 500 });
  }
}
