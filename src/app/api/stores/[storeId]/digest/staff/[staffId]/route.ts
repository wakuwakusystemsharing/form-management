import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { removeDigestStaff } from '@/lib/store-digest-service';

// DELETE /api/stores/{storeId}/digest/staff/{staffId} - LINE で受け取るスタッフの登録を解除
export async function DELETE(request: Request, { params }: { params: Promise<{ storeId: string; staffId: string }> }) {
  try {
    const { storeId, staffId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const removed = await removeDigestStaff(storeId, staffId);
    if (!removed) return NextResponse.json({ error: 'スタッフが見つかりません' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] store digest staff delete error:', error);
    return NextResponse.json({ error: 'スタッフの解除に失敗しました' }, { status: 500 });
  }
}
