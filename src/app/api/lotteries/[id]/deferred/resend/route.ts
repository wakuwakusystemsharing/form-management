import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/env';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLotteryForm } from '@/lib/lottery-repository';
import { getStoreForLottery } from '@/lib/lottery-service';
import { resendDeferredNotifications } from '@/lib/lottery-deferred-service';

// POST /api/lotteries/[id]/deferred/resend - 未通知の当選者へ再送
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const form = await getLotteryForm(id);
    if (!form) return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, form.store_id);
    if (auth.response) return auth.response;
    const store = await getStoreForLottery(form.store_id);
    if (!store) return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });

    const result = await resendDeferredNotifications(form, store, { baseUrl: getBaseUrl() });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  } catch (error) {
    console.error('[API] Lottery deferred resend error:', error);
    return NextResponse.json({ error: '再送に失敗しました' }, { status: 500 });
  }
}
