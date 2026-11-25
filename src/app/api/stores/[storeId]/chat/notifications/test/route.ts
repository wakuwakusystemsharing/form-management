import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { sendChatNotifyTest } from '@/lib/chat-service';

export const dynamic = 'force-dynamic';

// POST /api/stores/{storeId}/chat/notifications/test - テストの通知を送る
// 保存済みの設定の送り先（スタッフの LINE・メール）へ送る。夜間・10 分に 1 回の制限は見ない。
// LINE で送ると、公式 LINE の通数を使う（1 通 × スタッフの人数）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await sendChatNotifyTest(storeId, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ line_sent: result.line_sent, email_sent: result.email_sent, failed: result.failed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] chat notifications test error:', error);
    return NextResponse.json({ error: 'テストの通知を送れませんでした' }, { status: 500 });
  }
}
