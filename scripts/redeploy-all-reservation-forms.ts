/**
 * 全予約フォームを再デプロイするスクリプト
 *
 * 目的: フォーム生成コード（static-generator-reservation.ts）を修正したあと、
 *       既にデプロイ済みの静的HTMLは古いままになるため、全フォームを再生成して
 *       Supabase Storage にアップロードし直す。
 *
 * 安全策:
 *   - デプロイ済み（static_deploy.status === 'deployed'）のフォームのみが対象（既定）
 *   - 公開中の config（ライブ）でのみ再生成。draft_config / draft_status は触らない（下書き保護）
 *   - 1件失敗しても続行し、最後にサマリーを出す
 *
 * 実行方法（本番に対して実行する例）:
 *   1) 本番の認証情報を .env.local（または別ファイル）に設定
 *      NEXT_PUBLIC_APP_ENV=production
 *      NEXT_PUBLIC_SUPABASE_URL=...        # 本番プロジェクト
 *      SUPABASE_SERVICE_ROLE_KEY=...       # 本番 service role
 *   2) まずドライラン（何もアップロードせず対象一覧だけ表示）:
 *      pnpm tsx scripts/redeploy-all-reservation-forms.ts --dry-run
 *   3) 問題なければ本実行:
 *      pnpm tsx scripts/redeploy-all-reservation-forms.ts
 *
 *   オプション:
 *     --all        未デプロイのフォームも含めて全件再生成（通常は不要）
 *     --store=ID   特定店舗だけに限定
 */

import dotenv from 'dotenv';
import { createAdminClient } from '../src/lib/supabase';
import { StaticReservationGenerator } from '../src/lib/static-generator-reservation';
import { SupabaseStorageDeployer } from '../src/lib/supabase-storage-deployer';
import { normalizeForm } from '../src/lib/form-normalizer';
import { getAppEnvironment } from '../src/lib/env';

dotenv.config({ path: '.env.local' });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const INCLUDE_ALL = args.includes('--all');
const storeArg = args.find((a) => a.startsWith('--store='));
const ONLY_STORE = storeArg ? storeArg.split('=')[1] : null;

async function main() {
  const env = getAppEnvironment();
  console.log(`\n=== 全予約フォーム再デプロイ ===`);
  console.log(`環境: ${env}`);
  console.log(`モード: ${DRY_RUN ? 'DRY-RUN（アップロードしない）' : '本実行'}`);
  console.log(`対象: ${INCLUDE_ALL ? '全フォーム' : 'デプロイ済みのみ'}${ONLY_STORE ? ` / 店舗=${ONLY_STORE}` : ''}\n`);

  if (env === 'local') {
    console.error('このスクリプトは Supabase 環境（staging/production）用です。NEXT_PUBLIC_APP_ENV を確認してください。');
    process.exit(1);
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    console.error('Supabase 管理クライアントを作成できませんでした。環境変数を確認してください。');
    process.exit(1);
  }

  // 全予約フォームを取得
  let query = (adminClient as any).from('reservation_forms').select('*');
  if (ONLY_STORE) query = query.eq('store_id', ONLY_STORE);
  const { data: forms, error } = await query;

  if (error) {
    console.error('フォーム取得エラー:', error);
    process.exit(1);
  }
  if (!forms || forms.length === 0) {
    console.log('対象フォームがありません。');
    return;
  }

  // デプロイ済みのみに絞る（既定）
  const targets = forms.filter((f: any) => {
    if (INCLUDE_ALL) return true;
    const status = f.static_deploy?.status;
    return status === 'deployed';
  });

  console.log(`取得: ${forms.length} 件 / 対象: ${targets.length} 件\n`);

  const generator = new StaticReservationGenerator();
  const deployer = new SupabaseStorageDeployer();

  let ok = 0;
  let ng = 0;
  const failures: { id: string; store_id: string; error: string }[] = [];

  for (const form of targets) {
    const formId = form.id as string;
    const storeId = form.store_id as string;
    const label = `${storeId}/${formId}`;

    try {
      const normalized = normalizeForm(form);
      const config = normalized.config;
      const html = generator.generateHTML(config, formId, storeId);

      if (DRY_RUN) {
        console.log(`[dry-run] 再生成OK: ${label}（${html.length} bytes）`);
        ok++;
        continue;
      }

      const result = await deployer.deployForm(storeId, formId, html, 'reservation');

      // static_deploy のみ更新（draft 系は触らない）
      await (adminClient as any)
        .from('reservation_forms')
        .update({
          static_deploy: {
            ...(form.static_deploy || {}),
            deployed_at: new Date().toISOString(),
            storage_url: result.storage_url,
            status: 'deployed',
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', formId);

      console.log(`✅ ${label} → ${result.storage_url || result.url}`);
      ok++;
    } catch (e) {
      console.error(`❌ ${label}: ${String(e)}`);
      failures.push({ id: formId, store_id: storeId, error: String(e) });
      ng++;
    }
  }

  console.log(`\n=== 完了 ===`);
  console.log(`成功: ${ok} / 失敗: ${ng}`);
  if (failures.length) {
    console.log('失敗したフォーム:');
    failures.forEach((f) => console.log(`  - ${f.store_id}/${f.id}: ${f.error}`));
  }
  if (!DRY_RUN) {
    console.log('\n確認: 公開URL（/api/public-form/reservations/{storeId}/{formId}/index.html）のソースに formatLocalYmd が入っていればOKです。');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
