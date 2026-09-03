import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLotteryEntryByQrToken, getLotteryEntryByRedeemCode, getLotteryForm, toLotteryEntryView } from '@/lib/lottery-repository';
import { findPrizeById } from '@/lib/lottery-service';

/**
 * GET /api/stores/[storeId]/lotteries/redeem/[qrToken] - QR スキャン / 引換コード手入力時の当選内容照会
 *
 * qrToken には QR の 32 文字トークン、または 6 桁の引換コードを渡せる。
 * 店舗境界（他店舗の QR）は 404。引換可否は `can_redeem` と `reason` で返す。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string; qrToken: string }> }
) {
  try {
    const { storeId, qrToken } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const token = decodeURIComponent(qrToken || '').trim();
    if (!token) {
      return NextResponse.json({ error: 'トークンが不正です' }, { status: 400 });
    }

    const entry = token.length <= 8
      ? await getLotteryEntryByRedeemCode(storeId, token)
      : await getLotteryEntryByQrToken(storeId, token);
    if (!entry) {
      return NextResponse.json({ error: 'この店舗の当選情報が見つかりません' }, { status: 404 });
    }

    const view = toLotteryEntryView(entry);
    const form = await getLotteryForm(entry.lottery_form_id);
    const prize = form ? findPrizeById(form.config, entry.prize_id) : null;

    let canRedeem = false;
    let reason: string | null = null;
    switch (view.effective_status) {
      case 'drawn':
        canRedeem = true;
        break;
      case 'redeemed':
        reason = 'すでに引換済みです';
        break;
      case 'expired':
        reason = '有効期限が切れています';
        break;
      case 'cancelled':
        reason = '取り消された当選です';
        break;
      case 'provisional':
        reason = 'まだ当選が確定していません';
        break;
      default:
        reason = '当選していません';
    }

    return NextResponse.json({
      entry: view,
      prize,
      form_title: form?.config.basic_info.title ?? null,
      can_redeem: canRedeem,
      reason,
    });
  } catch (error) {
    console.error('[API] Lottery redeem lookup error:', error);
    return NextResponse.json({ error: '当選情報の照会に失敗しました' }, { status: 500 });
  }
}
