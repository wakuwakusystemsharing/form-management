import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { StaticFormGenerator } from '@/lib/static-generator';
import { VercelBlobDeployer } from '@/lib/vercel-blob-deployer';
import { normalizeForm } from '@/lib/form-normalizer';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params;
    const body = await request.json();
    const { storeId } = body;
    const env = getAppEnvironment();

    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      );
    }

    // フォームデータを読み込み（環境に応じて）
    let form;

    if (env === 'local') {
      // ローカル環境: JSON から読み込み
      const formsPath = join(process.cwd(), 'data', `forms_${storeId}.json`);
      if (!existsSync(formsPath)) {
        return NextResponse.json(
          { error: 'Forms file not found' },
          { status: 404 }
        );
      }

      const formsData = JSON.parse(readFileSync(formsPath, 'utf8'));
      form = formsData.find((f: { id: string; store_id: string }) => f.id === formId && f.store_id === storeId);
    } else {
      // staging/production: Supabase から取得
      const adminClient = createAdminClient();
      if (!adminClient) {
        return NextResponse.json(
          { error: 'Supabase 接続エラー' },
          { status: 500 }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (adminClient as any)
        .from('forms')
        .select('*')
        .eq('id', formId)
        .eq('store_id', storeId)
        .single();

      if (error || !data) {
        console.error('[API] Form fetch error:', error);
        return NextResponse.json(
          { error: 'Form not found' },
          { status: 404 }
        );
      }

      form = data;
    }

    if (!form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      );
    }

    // フォームを正規化してFormConfig形式に変換
    const normalizedForm = normalizeForm(form);
    const formConfig = normalizedForm.config;

    // フォームConfig の必須フィールドを検証
    if (!formConfig.gender_selection || formConfig.gender_selection.enabled === undefined) {
      console.warn('[Deploy] Incomplete config detected, applying defaults');
    }

    // 静的HTMLを生成
    const generator = new StaticFormGenerator();
    const staticHtml = generator.generateHTML(formConfig);
    
    // Vercel Blobにデプロイ（環境に応じて自動判定）
    const deployer = new VercelBlobDeployer();
    const deployResult = await deployer.deployForm(storeId, formId, staticHtml);
    
    console.log(`✅ フォーム再デプロイ完了: ${deployResult.blob_url || deployResult.url}`);

    // デプロイ情報をフォームに記録（環境に応じて）
    const deployInfo = {
      deployed_at: new Date().toISOString(),
      deploy_url: deployResult.url,
      blob_url: deployResult.blob_url,
      status: 'deployed',
      environment: deployResult.environment
    };

    if (env === 'local') {
      // ローカル環境: JSON を更新
      const updatedForm = {
        ...form,
        static_deploy: deployInfo,
        updated_at: new Date().toISOString()
      };

      const formsPath = join(process.cwd(), 'data', `forms_${storeId}.json`);
      const formsData = JSON.parse(readFileSync(formsPath, 'utf8'));
      const updatedForms = formsData.map((f: { id: string }) => 
        f.id === formId ? updatedForm : f
      );

      writeFileSync(formsPath, JSON.stringify(updatedForms, null, 2));
    } else {
      // staging/production: Supabase を更新
      const adminClient = createAdminClient();
      if (adminClient) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (adminClient as any)
          .from('forms')
          .update({
            static_deploy: deployInfo,
            updated_at: new Date().toISOString()
          })
          .eq('id', formId);
      }
    }

    return NextResponse.json({
      success: true,
      deployUrl: deployResult.blob_url || 
                 `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}${deployResult.url}`,
      deployedAt: deployInfo.deployed_at,
      environment: deployResult.environment
    });

  } catch (error) {
    console.error('Deploy error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
