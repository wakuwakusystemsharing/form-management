import { NextResponse } from 'next/server';
import { authorizeUpperAdminStoreAccess } from '@/lib/store-access';
import { getChatSettingsView, updateChatSettings } from '@/lib/chat-service';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/chat-settings - 1 対 1 トークの設定（ON / OFF・保存期間・ON にできるか・保存している件数）
// 運営だけ。会話の中身・LINE ユーザー ID は返さない
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeUpperAdminStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    return NextResponse.json(await getChatSettingsView(storeId), NO_STORE);
  } catch (error) {
    console.error('[API] chat-settings get error:', error);
    return NextResponse.json({ error: 'トークの設定の取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/stores/{storeId}/chat-settings - 設定を変える（{ enabled?, retention_years? }）
// 運営だけ（店舗管理者は自分の店舗でも 403）。ON にできるのは、チャネルシークレットを登録した店舗だけ
export async function PUT(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeUpperAdminStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await updateChatSettings(storeId, body, auth.user?.id ?? null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.view, NO_STORE);
  } catch (error) {
    console.error('[API] chat-settings save error:', error);
    return NextResponse.json({ error: 'トークの設定の保存に失敗しました' }, { status: 500 });
  }
}
