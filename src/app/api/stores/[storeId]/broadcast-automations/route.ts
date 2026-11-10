import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { countRecentAutomationSends, listBroadcastAutomations } from '@/lib/broadcast-repository';
import { previewAutomation, saveAutomation } from '@/lib/broadcast-automation-service';
import type { BroadcastAutomationInput } from '@/types/broadcast';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
type Params = { params: Promise<{ storeId: string }> };

// GET /api/stores/{storeId}/broadcast-automations - 自動配信ルールの一覧（直近 30 日の送信数付き）
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const automations = await listBroadcastAutomations(storeId);
    const recent = await countRecentAutomationSends(automations.map((a) => a.id));
    return NextResponse.json({ automations, recent_sends: recent }, noStore);
  } catch (error) {
    console.error('[API] broadcast automations list error:', error);
    return NextResponse.json({ error: '自動配信の取得に失敗しました' }, { status: 500 });
  }
}

// POST /api/stores/{storeId}/broadcast-automations - 作成（body: BroadcastAutomationInput）
//   body.preview = true のときは保存せず、次の実行で送られる人数だけを返す（body.id があればそのルールの送信記録を考慮）
export async function POST(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = (await request.json().catch(() => null)) as (BroadcastAutomationInput & { preview?: boolean; id?: string }) | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    if (body.preview === true) {
      const r = await previewAutomation(storeId, typeof body.id === 'string' && body.id ? body.id : null, body);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json(r.value, noStore);
    }
    const result = await saveAutomation(storeId, null, body, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ automation: result.value }, { status: 201, ...noStore });
  } catch (error) {
    console.error('[API] broadcast automations create error:', error);
    return NextResponse.json({ error: '自動配信の保存に失敗しました' }, { status: 500 });
  }
}
