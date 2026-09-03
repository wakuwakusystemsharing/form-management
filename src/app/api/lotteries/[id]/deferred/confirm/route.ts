import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/env';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLotteryForm } from '@/lib/lottery-repository';
import { getStoreForLottery } from '@/lib/lottery-service';
import { confirmDeferredWinners } from '@/lib/lottery-deferred-service';
import { logFormAudit } from '@/lib/form-audit';

/**
 * POST /api/lotteries/[id]/deferred/confirm - 当選を確定して当選者へ Bot push
 *   provisional → drawn（引換コード・QR・有効期限を発行）、entered → lost
 */
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

    const result = await confirmDeferredWinners(form, store, { baseUrl: getBaseUrl() });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    await logFormAudit(request, {
      storeId: form.store_id, formId: id, formType: 'lottery', action: 'update',
      formName: form.config.basic_info.title || null,
      note: `後日抽選の当選を確定（当選 ${result.data.winners.length} 件・通知成功 ${result.data.notified} 件・失敗 ${result.data.failed} 件・落選 ${result.data.lost} 件）`,
    });
    return NextResponse.json(result.data);
  } catch (error) {
    console.error('[API] Lottery deferred confirm error:', error);
    return NextResponse.json({ error: '当選の確定に失敗しました' }, { status: 500 });
  }
}
