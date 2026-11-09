import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { listLineFlexMessages } from '@/lib/line-flex-repository';
import { createLineFlexMessage } from '@/lib/line-flex-service';
import type { LineFlexMessageInput } from '@/types/line-flex';

const noStore = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/line-messages - 公式 LINE Flex Message の一覧
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const messages = await listLineFlexMessages(storeId);
    return NextResponse.json({ messages }, noStore);
  } catch (error) {
    console.error('[API] line-messages list error:', error);
    return NextResponse.json({ error: 'LINE メッセージの取得に失敗しました' }, { status: 500 });
  }
}

// POST /api/stores/{storeId}/line-messages - 作成（body: LineFlexMessageInput）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = (await request.json().catch(() => null)) as LineFlexMessageInput | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    const result = await createLineFlexMessage(storeId, body, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ message: result.value }, { status: 201, ...noStore });
  } catch (error) {
    console.error('[API] line-messages create error:', error);
    return NextResponse.json({ error: 'LINE メッセージの保存に失敗しました' }, { status: 500 });
  }
}
