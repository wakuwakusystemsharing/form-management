import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { listLineFlexMessages } from '@/lib/line-flex-repository';
import { listLineFlexAnswersByUser } from '@/lib/line-flex-answers';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
type Params = { params: Promise<{ storeId: string }> };

// GET /api/stores/{storeId}/line-messages/answers?line_user_id= - お客様が分岐ボタンで選んだ内容（新しい順。顧客詳細用）
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const lineUserId = new URL(request.url).searchParams.get('line_user_id') ?? '';
    if (!lineUserId) return NextResponse.json({ answers: [] }, noStore);
    const [rows, messages] = await Promise.all([listLineFlexAnswersByUser(storeId, lineUserId, 100), listLineFlexMessages(storeId)]);
    const names = new Map(messages.map((m) => [m.id, m.name]));
    const answers = rows.map((r) => ({
      id: r.id,
      message_id: r.message_id,
      message_name: names.get(r.message_id) ?? '削除されたメッセージ',
      question: r.question,
      label: r.label,
      created_at: r.created_at,
    }));
    return NextResponse.json({ answers }, noStore);
  } catch (error) {
    console.error('[API] line-messages user answers error:', error);
    return NextResponse.json({ error: '回答の取得に失敗しました' }, { status: 500 });
  }
}
