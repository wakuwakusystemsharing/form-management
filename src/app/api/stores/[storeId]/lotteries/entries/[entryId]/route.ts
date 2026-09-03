import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getCurrentUserId } from '@/lib/auth-helper';
import { getEffectiveStatus } from '@/lib/lottery-engine';
import {
  getLotteryEntry,
  getLotteryForm,
  toLotteryEntryView,
  updateLotteryEntry,
  type LotteryEntryPatch,
} from '@/lib/lottery-repository';

/**
 * PATCH /api/stores/[storeId]/lotteries/entries/[entryId] - 引換 / 取り消し
 *   body: { action: 'redeem' | 'unredeem' | 'cancel' | 'restore', note?: string }
 *   - redeem:   drawn → redeemed（期限切れは不可）
 *   - unredeem: redeemed → drawn（誤操作の戻し）
 *   - cancel:   任意 → cancelled（在庫・回数のカウントから外す）
 *   - restore:  cancelled → 元のステータス（当選なら drawn、はずれなら lost、応募なら entered）
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ storeId: string; entryId: string }> }
) {
  try {
    const { storeId, entryId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => null)) as { action?: unknown; note?: unknown } | null;
    const action = body?.action;
    if (action !== 'redeem' && action !== 'unredeem' && action !== 'cancel' && action !== 'restore') {
      return NextResponse.json({ error: 'action は redeem / unredeem / cancel / restore のいずれかです' }, { status: 400 });
    }
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null;

    const entry = await getLotteryEntry(storeId, entryId);
    if (!entry) {
      return NextResponse.json({ error: '抽選履歴が見つかりません' }, { status: 404 });
    }

    const now = new Date();
    const userId = await getCurrentUserId(request);
    let patch: LotteryEntryPatch;

    switch (action) {
      case 'redeem': {
        if (entry.status === 'redeemed') {
          return NextResponse.json({ error: 'この当選はすでに引換済みです' }, { status: 409 });
        }
        if (entry.status !== 'drawn') {
          return NextResponse.json({ error: '当選していない履歴は引換できません' }, { status: 400 });
        }
        if (getEffectiveStatus(entry, now) === 'expired') {
          return NextResponse.json({ error: '有効期限が切れているため引換できません' }, { status: 400 });
        }
        patch = { status: 'redeemed', redeemed_at: now.toISOString(), redeemed_by: userId, redeemed_note: note };
        break;
      }
      case 'unredeem': {
        if (entry.status !== 'redeemed') {
          return NextResponse.json({ error: '引換済みの履歴ではありません' }, { status: 400 });
        }
        patch = { status: 'drawn', redeemed_at: null, redeemed_by: null, redeemed_note: note };
        break;
      }
      case 'cancel': {
        if (entry.status === 'cancelled') {
          return NextResponse.json({ error: 'すでに取り消し済みです' }, { status: 409 });
        }
        patch = { status: 'cancelled', redeemed_note: note ?? entry.redeemed_note };
        break;
      }
      case 'restore':
      default: {
        if (entry.status !== 'cancelled') {
          return NextResponse.json({ error: '取り消し済みの履歴ではありません' }, { status: 400 });
        }
        // 賞品あり → 当選（drawn）。賞品なし → 後日抽選の応募受付中なら応募（entered）、それ以外ははずれ（lost）
        let status: LotteryEntryPatch['status'] = 'lost';
        if (entry.prize_id) {
          status = 'drawn';
        } else {
          const form = await getLotteryForm(entry.lottery_form_id);
          if (form?.config.lottery_type === 'deferred' && form.deferred_draw_status === 'accepting') status = 'entered';
        }
        patch = { status, redeemed_note: note ?? entry.redeemed_note };
        break;
      }
    }

    const updated = await updateLotteryEntry(entry.id, patch);
    if (!updated) {
      return NextResponse.json({ error: '抽選履歴が見つかりません' }, { status: 404 });
    }
    return NextResponse.json(toLotteryEntryView(updated, now));
  } catch (error) {
    console.error('[API] Lottery entry update error:', error);
    return NextResponse.json({ error: '抽選履歴の更新に失敗しました' }, { status: 500 });
  }
}
