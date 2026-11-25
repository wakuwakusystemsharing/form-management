import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getChatNotifyView, updateChatNotifySettings } from '@/lib/chat-service';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/chat/notifications - 1 対 1 トークの新着の通知の設定
// （スタッフの LINE / メール / 送らない時間帯 + LINE で受け取るスタッフの人数）。店舗管理者も見られる
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    return NextResponse.json(await getChatNotifyView(storeId), NO_STORE);
  } catch (error) {
    console.error('[API] chat notifications get error:', error);
    return NextResponse.json({ error: '通知の設定の取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/stores/{storeId}/chat/notifications - 通知の設定を変える
// { line, email, emails: string[]（5 件まで）, quiet: { enabled, start, end }（日本時間の「時」） }
export async function PUT(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await updateChatNotifySettings(storeId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.view, NO_STORE);
  } catch (error) {
    console.error('[API] chat notifications save error:', error);
    return NextResponse.json({ error: '通知の設定の保存に失敗しました' }, { status: 500 });
  }
}
