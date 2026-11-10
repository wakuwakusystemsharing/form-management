import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { runDueAutomations } from '@/lib/broadcast-automation-service';

const TIME_BUDGET_MS = 22 * 1000;

// POST /api/stores/{storeId}/broadcast-automations/run - この店舗の今日の判定を今すぐ実行する
//   実行時刻を待たずに、ON のルールのうち今日まだ判定していないものを処理する（1 日 1 回の制限はそのまま。同じ人に二重には送らない）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const summary = await runDueAutomations(new Date(), new URL(request.url).origin, Date.now() + TIME_BUDGET_MS, { storeId, ignoreTime: true });
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] broadcast automations run error:', error);
    return NextResponse.json({ error: '自動配信の実行に失敗しました' }, { status: 500 });
  }
}
