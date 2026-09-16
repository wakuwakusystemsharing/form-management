import { NextResponse } from 'next/server';
import { getLotteryForm } from '@/lib/lottery-repository';
import { getPrizeStockStatus } from '@/lib/lottery-service';

/**
 * GET /api/lotteries/[id]/stock - 賞品ごとの現在の在庫状況（公開・認証なし）
 *
 * 静的 HTML は在庫数を埋め込んだまま配信され、プロキシのキャッシュ（1 時間）もあるため、
 * フォームはこの API で「残り N」を最新に更新する。編集画面の「現在の残り」表示にも使う。
 * 返すのは件数だけ（誰が当選したか等は含めない）
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const form = await getLotteryForm(id);
    if (!form) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }
    const prizes = await getPrizeStockStatus(form);
    return NextResponse.json(
      { prizes, show_stock: form.config.presentation.show_stock, updated_at: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[API] Lottery stock error:', error);
    return NextResponse.json({ error: '在庫状況の取得に失敗しました' }, { status: 500 });
  }
}
