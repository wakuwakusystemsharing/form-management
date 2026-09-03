import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { listLotteryEntries } from '@/lib/lottery-repository';
import type { LotteryEntryEffectiveStatus } from '@/types/lottery';

const STATUS_VALUES: Array<LotteryEntryEffectiveStatus | 'all'> = [
  'all', 'entered', 'provisional', 'drawn', 'lost', 'redeemed', 'cancelled', 'expired',
];

/**
 * GET /api/stores/[storeId]/lotteries/entries - 抽選履歴一覧
 *   ?form_id= &prize_id= &status=all|entered|provisional|drawn|lost|redeemed|cancelled|expired
 *   &search=（LINE 名・引換コード・賞品名の部分一致）&from= &to=（ISO）&limit= &offset=
 * 返却: { entries: LotteryEntryView[], total, limit, offset }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');
    const status = statusParam && (STATUS_VALUES as string[]).includes(statusParam)
      ? (statusParam as LotteryEntryEffectiveStatus | 'all')
      : 'all';
    const limit = Number(url.searchParams.get('limit')) || 50;
    const offset = Number(url.searchParams.get('offset')) || 0;

    const result = await listLotteryEntries({
      storeId,
      formId: url.searchParams.get('form_id'),
      prizeId: url.searchParams.get('prize_id'),
      status,
      search: url.searchParams.get('search'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      customerId: url.searchParams.get('customer_id'),
      limit,
      offset,
    });
    return NextResponse.json({ ...result, limit: Math.min(Math.max(limit, 1), 500), offset: Math.max(offset, 0) });
  } catch (error) {
    console.error('[API] Lottery entries fetch error:', error);
    return NextResponse.json({ error: '抽選履歴の取得に失敗しました' }, { status: 500 });
  }
}
