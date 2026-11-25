import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getChatThreadDetail, updateChatThreadStatus } from '@/lib/chat-service';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/chat/threads/{threadId}?before=&after=&read=0 - 会話 1 本とメッセージ
// - 指定なし: 新しいほうから 50 通。開くと既読になる（read=0 のときは既読にしない）
// - before: その ID より前の 50 通（さかのぼって読む） / after: その ID より後（新着の確認）
// - 他の店舗の会話 ID・存在しない ID は 404
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string; threadId: string }> }) {
  try {
    const { storeId, threadId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const url = new URL(request.url);
    const detail = await getChatThreadDetail(storeId, threadId, { beforeId: url.searchParams.get('before'), afterId: url.searchParams.get('after'), read: url.searchParams.get('read') !== '0' });
    if (!detail) return NextResponse.json({ error: '会話が見つかりません' }, { status: 404 });
    return NextResponse.json(detail, NO_STORE);
  } catch (error) {
    console.error('[API] chat thread error:', error);
    return NextResponse.json({ error: '会話の取得に失敗しました' }, { status: 500 });
  }
}

// PATCH /api/stores/{storeId}/chat/threads/{threadId} - 対応中 / 対応済み を切り替える（{ status: 'open' | 'done' }）
// 対応済みにした会話に、お客様から新しいメッセージが届くと、自動で対応中に戻る
export async function PATCH(request: Request, { params }: { params: Promise<{ storeId: string; threadId: string }> }) {
  try {
    const { storeId, threadId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await updateChatThreadStatus(storeId, threadId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ status: result.status }, NO_STORE);
  } catch (error) {
    console.error('[API] chat thread status error:', error);
    return NextResponse.json({ error: '対応の状態の保存に失敗しました' }, { status: 500 });
  }
}
