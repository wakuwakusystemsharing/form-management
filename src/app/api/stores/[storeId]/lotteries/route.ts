import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { logFormAudit } from '@/lib/form-audit';
import { getCurrentUserId } from '@/lib/auth-helper';
import { authorizeStoreAccess } from '@/lib/store-access';
import { generateLotteryId } from '@/lib/lottery-engine';
import { createDefaultLotteryConfig, normalizeLotteryConfig } from '@/lib/lottery-normalizer';
import {
  createLotteryForm,
  getLotteryFormStatsByStore,
  listLotteryForms,
  lotteryFormIdExists,
} from '@/lib/lottery-repository';
import { getStoreForLottery, validateLotteryConfigForSave } from '@/lib/lottery-service';
import type { LotteryFormWithStats, LotteryType } from '@/types/lottery';

// GET /api/stores/[storeId]/lotteries - 店舗の抽選フォーム一覧（参加数・当選数・引換数付き）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const [forms, stats] = await Promise.all([listLotteryForms(storeId), getLotteryFormStatsByStore(storeId)]);
    const result: LotteryFormWithStats[] = forms.map((form) => ({
      ...form,
      stats: stats[form.id] ?? { entries: 0, wins: 0, redeemed: 0, prize_counts: {} },
    }));
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Lottery forms fetch error:', error);
    return NextResponse.json({ error: '抽選フォームの取得に失敗しました' }, { status: 500 });
  }
}

// POST /api/stores/[storeId]/lotteries - 抽選フォーム作成
//   body: { form_name, liff_id?, lottery_type?: 'instant' | 'deferred', template_config?: LotteryConfig }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => ({}));
    const formName = typeof body.form_name === 'string' && body.form_name.trim() ? body.form_name.trim() : '抽選フォーム';
    const liffId = typeof body.liff_id === 'string' ? body.liff_id.trim() : '';
    const lotteryType: LotteryType = body.lottery_type === 'deferred' ? 'deferred' : 'instant';

    const store = await getStoreForLottery(storeId);
    if (!store) {
      return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
    }
    // 後日抽選は Bot push で結果を通知するため、チャネルアクセストークンが無い店舗では作成不可
    if (lotteryType === 'deferred' && getAppEnvironment() !== 'local' && !store.line_channel_access_token) {
      return NextResponse.json(
        { error: '後日抽選を作成するには、店舗の LINE チャネルアクセストークンの設定が必要です' },
        { status: 400 }
      );
    }

    const config = body.template_config
      ? normalizeLotteryConfig({ ...body.template_config, lottery_type: lotteryType })
      : createDefaultLotteryConfig({
          title: formName,
          liff_id: liffId,
          store_name: store.name,
          lottery_type: lotteryType,
          generateId: generateLotteryId,
        });
    if (body.template_config) {
      config.basic_info.title = formName;
      if (liffId) config.basic_info.liff_id = liffId;
      if (!config.basic_info.store_name) config.basic_info.store_name = store.name;
    }

    let id = generateLotteryId();
    while (await lotteryFormIdExists(id)) id = generateLotteryId();

    const currentUserId = await getCurrentUserId(request);
    const form = await createLotteryForm({
      id,
      store_id: storeId,
      config,
      status: 'inactive',
      created_by: currentUserId,
    });

    await logFormAudit(request, {
      storeId,
      formId: form.id,
      formType: 'lottery',
      action: 'create',
      formName,
    });

    // 参考情報として検証結果も返す（テンプレートは常に valid だが、template_config 指定時の確認用）
    const warnings = validateLotteryConfigForSave(form.config);
    return NextResponse.json({ ...form, warnings }, { status: 201 });
  } catch (error) {
    console.error('[API] Lottery form create error:', error);
    return NextResponse.json({ error: '抽選フォームの作成に失敗しました' }, { status: 500 });
  }
}
