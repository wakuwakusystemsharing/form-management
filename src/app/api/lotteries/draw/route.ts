import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/env';
import { getLotteryForm } from '@/lib/lottery-repository';
import { buildQrImageUrl } from '@/lib/lottery-qr';
import { executeLotteryDraw, getStoreForLottery, resolveLineUser } from '@/lib/lottery-service';

/**
 * POST /api/lotteries/draw - 抽選を実行（公開 API。LINE ID トークンで本人確認）
 *
 * body:
 *   lottery_form_id: string
 *   store_id: string
 *   id_token: string             // LIFF liff.getIDToken()（local 環境では line_user_id で代用）
 *   line_user_id?: string        // local 環境のみ
 *   line_display_name?: string
 *   line_friend_flag?: boolean | null
 *   answers?: Record<string, unknown>
 *
 * 即時抽選: 結果（賞品・引換コード・LINE 送信テキスト）を返す
 * 後日抽選: 応募として記録し、応募完了テキストを返す
 * 回数上限のときは 409 + existing_result（前回の結果）を返す
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    }
    const formId = typeof body.lottery_form_id === 'string' ? body.lottery_form_id : '';
    const storeId = typeof body.store_id === 'string' ? body.store_id : '';
    if (!formId || !storeId) {
      return NextResponse.json({ error: 'lottery_form_id と store_id は必須です' }, { status: 400 });
    }

    const form = await getLotteryForm(formId);
    if (!form || form.store_id !== storeId) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }
    const store = await getStoreForLottery(storeId);
    if (!store) {
      return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
    }

    const resolved = await resolveLineUser(body, store);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error, details: resolved.detail ?? null }, { status: resolved.status });
    }

    const lineFriendFlag = typeof body.line_friend_flag === 'boolean' ? body.line_friend_flag : null;
    const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
      ? (body.answers as Record<string, unknown>)
      : null;
    const userAgent = request.headers.get('user-agent')?.slice(0, 500) || null;
    const baseUrl = getBaseUrl();

    const outcome = await executeLotteryDraw({
      form,
      store,
      user: resolved.user,
      lineFriendFlag,
      answers,
      userAgent,
      qrImageUrlBuilder: (qrToken) => buildQrImageUrl(qrToken, baseUrl),
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error, existing_result: outcome.existing ?? null },
        { status: outcome.status }
      );
    }
    return NextResponse.json(outcome.response, { status: outcome.status });
  } catch (error) {
    console.error('[API] Lottery draw error:', error);
    return NextResponse.json({ error: '抽選の実行に失敗しました。時間をおいて再度お試しください' }, { status: 500 });
  }
}
