import { NextResponse } from 'next/server';
import { logFormAudit } from '@/lib/form-audit';
import { getCurrentUserId } from '@/lib/auth-helper';
import { authorizeStoreAccess } from '@/lib/store-access';
import { generateLotteryId } from '@/lib/lottery-engine';
import { createLotteryForm, getLotteryForm, lotteryFormIdExists } from '@/lib/lottery-repository';
import type { LotteryConfig } from '@/types/lottery';

// POST /api/lotteries/[id]/duplicate - 抽選フォームを複製（履歴はコピーしない）
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const source = await getLotteryForm(id);
    if (!source) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }
    const auth = await authorizeStoreAccess(request, source.store_id);
    if (auth.response) return auth.response;

    const config: LotteryConfig = JSON.parse(JSON.stringify(source.config));
    config.basic_info.title = `${config.basic_info.title || ''}（コピー）`;
    config.basic_info.liff_id = '';
    // 賞品 ID は引換・在庫の集計キーなので新しい ID に振り直す
    config.prizes = config.prizes.map((p) => ({ ...p, id: generateLotteryId() }));
    if (config.consolation_prize) config.consolation_prize = { ...config.consolation_prize, id: generateLotteryId() };

    let newId = generateLotteryId();
    while (await lotteryFormIdExists(newId)) newId = generateLotteryId();

    const currentUserId = await getCurrentUserId(request);
    const created = await createLotteryForm({
      id: newId,
      store_id: source.store_id,
      config,
      status: 'inactive',
      created_by: currentUserId,
    });

    const sourceTitle = source.config.basic_info.title || null;
    await logFormAudit(request, {
      storeId: source.store_id, formId: id, formType: 'lottery', action: 'duplicate',
      formName: sourceTitle, note: `この抽選フォームを複製 → 新フォーム ${newId}`,
    });
    await logFormAudit(request, {
      storeId: source.store_id, formId: newId, formType: 'lottery', action: 'duplicate',
      formName: config.basic_info.title, note: `抽選フォーム ${id}（${sourceTitle || '名称なし'}）から複製して作成`,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('[API] Lottery form duplicate error:', error);
    return NextResponse.json({ error: '抽選フォームの複製に失敗しました' }, { status: 500 });
  }
}
