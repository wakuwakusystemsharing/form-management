import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { logFormAudit } from '@/lib/form-audit';
import { getCurrentUserId } from '@/lib/auth-helper';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLotteryForm, updateLotteryForm } from '@/lib/lottery-repository';
import { validateLotteryConfigForSave } from '@/lib/lottery-service';
import { StaticLotteryGenerator } from '@/lib/static-generator-lottery';
import { SupabaseStorageDeployer } from '@/lib/supabase-storage-deployer';
import type { StaticDeploy } from '@/types/form';

/**
 * POST /api/lotteries/[id]/deploy - 静的 HTML を生成して Supabase Storage（local: public/static-forms）へデプロイ
 * 配信パス: lotteries/{storeId}/{formId}/index.html
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const form = await getLotteryForm(id);
    if (!form) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }
    const auth = await authorizeStoreAccess(request, form.store_id);
    if (auth.response) return auth.response;

    const errors = validateLotteryConfigForSave(form.config);
    if (errors.length > 0) {
      return NextResponse.json({ error: '設定に不備があるためデプロイできません', details: errors }, { status: 400 });
    }
    if (!form.config.basic_info.liff_id || form.config.basic_info.liff_id.length < 10) {
      return NextResponse.json({ error: 'LIFF ID を設定してからデプロイしてください' }, { status: 400 });
    }

    const html = new StaticLotteryGenerator().generateHTML(form, 'production');
    const deployer = new SupabaseStorageDeployer();
    const result = await deployer.deployForm(form.store_id, form.id, html, 'lottery');

    const env = getAppEnvironment();
    const deployInfo: StaticDeploy = {
      deployed_at: new Date().toISOString(),
      deploy_url: result.url,
      storage_url: result.storage_url || '',
      status: 'deployed',
      environment: env,
    } as StaticDeploy;

    const currentUserId = await getCurrentUserId(request);
    const updated = await updateLotteryForm(id, {
      static_deploy: deployInfo,
      last_published_at: deployInfo.deployed_at,
      draft_status: 'none',
      draft_config: null,
      updated_by: currentUserId,
    });

    await logFormAudit(request, {
      storeId: form.store_id,
      formId: id,
      formType: 'lottery',
      action: 'deploy',
      formName: form.config.basic_info.title || null,
      before: { config: form.config, status: form.status } as unknown as Record<string, unknown>,
      after: { config: updated?.config ?? form.config, status: updated?.status ?? form.status } as unknown as Record<string, unknown>,
    });

    return NextResponse.json(deployInfo);
  } catch (error) {
    console.error('[API] Lottery deploy error:', error);
    return NextResponse.json({ error: '抽選フォームのデプロイに失敗しました' }, { status: 500 });
  }
}
