import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { reorderRuleMenuOrder } from '@/lib/line-rich-menu-service';

export const dynamic = 'force-dynamic';

// POST /api/stores/{storeId}/rich-menus/rule-order - お客様ごとのメニューの優先順位を変える（{ ids: [上から順のメニュー ID] }）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await reorderRuleMenuOrder(storeId, body?.ids);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[API] rich-menus rule-order error:', error);
    return NextResponse.json({ error: '優先順位の変更に失敗しました' }, { status: 500 });
  }
}
