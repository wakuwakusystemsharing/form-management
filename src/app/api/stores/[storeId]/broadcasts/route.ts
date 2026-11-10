import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { listBroadcasts } from '@/lib/broadcast-repository';
import { createBroadcast, getBroadcastOverview } from '@/lib/broadcast-service';
import type { BroadcastInput } from '@/types/broadcast';

const noStore = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/broadcasts - 配信の一覧 + 今月の通数・設定・配信停止数
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const [broadcasts, overview] = await Promise.all([listBroadcasts(storeId), getBroadcastOverview(storeId)]);
    return NextResponse.json({ broadcasts, overview }, noStore);
  } catch (error) {
    console.error('[API] broadcasts list error:', error);
    return NextResponse.json({ error: '配信の取得に失敗しました' }, { status: 500 });
  }
}

// POST /api/stores/{storeId}/broadcasts - 下書きを作成（body: BroadcastInput）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = (await request.json().catch(() => null)) as BroadcastInput | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    const result = await createBroadcast(storeId, body, new URL(request.url).origin, auth.user?.id ?? null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ broadcast: result.value }, { status: 201, ...noStore });
  } catch (error) {
    console.error('[API] broadcasts create error:', error);
    return NextResponse.json({ error: '配信の保存に失敗しました' }, { status: 500 });
  }
}
