import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getBroadcastSettings } from '@/lib/broadcast-repository';
import { fetchLineQuota, saveBroadcastSettings } from '@/lib/broadcast-automation-service';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
type Params = { params: Promise<{ storeId: string }> };

// GET /api/stores/{storeId}/broadcast-settings - 配信設定 + LINE の今月の通数（取得できなければ line_quota: null）
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const [settings, lineQuota] = await Promise.all([getBroadcastSettings(storeId), fetchLineQuota(storeId)]);
    return NextResponse.json({ settings, line_quota: lineQuota }, noStore);
  } catch (error) {
    console.error('[API] broadcast settings get error:', error);
    return NextResponse.json({ error: '配信設定の取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/stores/{storeId}/broadcast-settings - 配信設定を保存
//   body: { monthly_limit: number | null, over_limit: 'confirm' | 'block', opt_out_keyword, opt_in_keyword, automation_time: 'HH:00' }
export async function PUT(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    const result = await saveBroadcastSettings(storeId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ settings: result.value }, noStore);
  } catch (error) {
    console.error('[API] broadcast settings update error:', error);
    return NextResponse.json({ error: '配信設定の保存に失敗しました' }, { status: 500 });
  }
}
