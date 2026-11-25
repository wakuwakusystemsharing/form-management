import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { sendChatReply } from '@/lib/chat-service';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// POST /api/stores/{storeId}/chat/threads/{threadId}/messages - 返信を送る（{ text, client_key }）
// - client_key = 送信ボタンを押したときに画面が作る UUID。同じ ID は 1 回だけ送る（連打・通信の再試行で二重にならない）
// - 公式 LINE の通数を 1 通使う（push）
// - 失敗したときは 502 + 理由。同じ client_key でもう一度呼ぶと送り直す
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string; threadId: string }> }) {
  try {
    const { storeId, threadId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await sendChatReply(storeId, threadId, body, auth.user);
    if (!result.ok) return NextResponse.json({ error: result.error, message: result.message ?? null }, { status: result.status, ...NO_STORE });
    return NextResponse.json({ message: result.message, notice: result.notice ?? null }, NO_STORE);
  } catch (error) {
    console.error('[API] chat reply error:', error);
    return NextResponse.json({ error: '返信の送信に失敗しました' }, { status: 500 });
  }
}
