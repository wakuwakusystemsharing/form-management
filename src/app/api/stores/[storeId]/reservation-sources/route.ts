import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { createSource, getSourceOverview } from '@/lib/reservation-source-service';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/reservation-sources - 流入経路の一覧（+ 選べる予約フォーム）
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    return NextResponse.json(await getSourceOverview(storeId, new URL(request.url).origin), NO_STORE);
  } catch (error) {
    console.error('[API] reservation-sources list error:', error);
    return NextResponse.json({ error: '流入経路の取得に失敗しました' }, { status: 500 });
  }
}

// POST /api/stores/{storeId}/reservation-sources - 経路を作る（{ name, form_id }）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = (await request.json().catch(() => null)) as { name?: unknown; form_id?: unknown } | null;
    const result = await createSource(storeId, body || {}, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: 201, ...NO_STORE });
  } catch (error) {
    console.error('[API] reservation-sources create error:', error);
    return NextResponse.json({ error: '経路の作成に失敗しました' }, { status: 500 });
  }
}
