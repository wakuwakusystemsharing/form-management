import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLotteryForm } from '@/lib/lottery-repository';
import { getDeferredSummary } from '@/lib/lottery-deferred-service';

// GET /api/lotteries/[id]/deferred/summary - 後日抽選の進行状況（応募数・仮当選・確定当選・未通知）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const form = await getLotteryForm(id);
    if (!form) return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, form.store_id);
    if (auth.response) return auth.response;
    if (form.config.lottery_type !== 'deferred') {
      return NextResponse.json({ error: 'この抽選フォームは後日抽選ではありません' }, { status: 400 });
    }
    return NextResponse.json(await getDeferredSummary(form));
  } catch (error) {
    console.error('[API] Lottery deferred summary error:', error);
    return NextResponse.json({ error: '後日抽選の状況取得に失敗しました' }, { status: 500 });
  }
}
