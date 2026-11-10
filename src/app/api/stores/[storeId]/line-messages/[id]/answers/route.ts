import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLineFlexMessage } from '@/lib/line-flex-repository';
import { listLineFlexAnswers } from '@/lib/line-flex-answers';
import { summarizeBranchAnswers } from '@/lib/line-flex-branch';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
type Params = { params: Promise<{ storeId: string; id: string }> };

// GET /api/stores/{storeId}/line-messages/{id}/answers - 分岐ボタンの回答の集計（件数・人数のみ）
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const message = await getLineFlexMessage(storeId, id);
    if (!message) return NextResponse.json({ error: 'メッセージが見つかりません' }, { status: 404 });
    const rows = await listLineFlexAnswers(storeId, id);
    return NextResponse.json({ summary: summarizeBranchAnswers(message.branches ?? {}, rows) }, noStore);
  } catch (error) {
    console.error('[API] line-messages answers error:', error);
    return NextResponse.json({ error: '回答の集計の取得に失敗しました' }, { status: 500 });
  }
}
