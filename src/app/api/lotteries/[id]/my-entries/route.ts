import { NextResponse } from 'next/server';
import { getLotteryForm } from '@/lib/lottery-repository';
import { getStoreForLottery, getUserWinResults, resolveLineUser } from '@/lib/lottery-service';

/**
 * GET /api/lotteries/[id]/my-entries?id_token=...（local: &line_user_id=...）
 *
 * 同一 LINE ユーザーがこの抽選で当選した一覧（新しい順）と残り参加回数。
 * 複数回抽選できる設定で 2 回目に当選したとき、1 回目の当選内容（引換コード・有効期限・使用状況）を
 * フォームの「あなたが当選した一覧」から確認できるようにする。公開 API・ID トークン検証あり
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const form = await getLotteryForm(id);
    if (!form) return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    const store = await getStoreForLottery(form.store_id);
    if (!store) return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });

    const url = new URL(request.url);
    const resolved = await resolveLineUser(
      {
        id_token: url.searchParams.get('id_token') ?? undefined,
        line_user_id: url.searchParams.get('line_user_id') ?? undefined,
      },
      store
    );
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error, details: resolved.detail ?? null }, { status: resolved.status });
    }
    const result = await getUserWinResults(form, store, resolved.user.userId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] Lottery my-entries error:', error);
    return NextResponse.json({ error: '当選一覧の取得に失敗しました' }, { status: 500 });
  }
}
