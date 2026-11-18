import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { processWaitlist } from '@/lib/waitlist-service';

const TIME_BUDGET_MS = 22 * 1000;

// POST /api/stores/{storeId}/waitlist/run - この店舗の空き待ちを今すぐ見回る
//   （10 分おきの自動の見回りを待たずに、空いた枠のお知らせ・埋まった枠のおわび・過ぎた空き待ちの終了を行う）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const summary = await processWaitlist({ storeId, deadlineMs: Date.now() + TIME_BUDGET_MS });
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] waitlist run error:', error);
    return NextResponse.json({ error: '空き待ちの確認に失敗しました' }, { status: 500 });
  }
}
