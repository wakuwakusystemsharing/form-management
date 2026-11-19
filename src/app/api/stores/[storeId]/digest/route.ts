import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getDigestState, saveDigestSettings } from '@/lib/store-digest-service';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
type Params = { params: Promise<{ storeId: string }> };

// GET /api/stores/{storeId}/digest - 今日の予約まとめ・月次レポートの設定 + 合言葉 + LINE で受け取るスタッフ + 最近の送信
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    return NextResponse.json(await getDigestState(storeId), noStore);
  } catch (error) {
    console.error('[API] store digest get error:', error);
    return NextResponse.json({ error: 'まとめ・レポートの設定の取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/stores/{storeId}/digest - 設定を保存
//   body: { morning: { enabled, time: 'HH:00' }, monthly: { enabled }, channels: { email, line }, emails: string[] }
export async function PUT(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    const result = await saveDigestSettings(storeId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ settings: result.value }, noStore);
  } catch (error) {
    console.error('[API] store digest update error:', error);
    return NextResponse.json({ error: 'まとめ・レポートの設定の保存に失敗しました' }, { status: 500 });
  }
}
