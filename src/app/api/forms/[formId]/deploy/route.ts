 
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { SupabaseStorageDeployer } from '@/lib/supabase-storage-deployer';
import { normalizeForm } from '@/lib/form-normalizer';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { Form, StaticDeploy } from '@/types/form';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params;
    const body = await request.json();
    const { storeId, formData } = body;
    const env = getAppEnvironment();

    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      );
    }

    // フォームデータを読み込み（環境に応じて）
    // リクエストボディにformDataが含まれている場合はそれを使用（最新の保存済みデータ）
    let form = formData;

    if (!form) {
      // formDataが提供されていない場合は、データベースから取得
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

        const { data, error } = await (adminClient as any)
          .from('reservation_forms')
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
    const generator = new StaticReservationGenerator();
    const staticHtml = generator.generateHTML(formConfig, formId, storeId);
    
    // Supabase Storageにデプロイ（環境に応じて自動判定）
    const deployer = new SupabaseStorageDeployer();
    const deployResult = await deployer.deployForm(storeId, formId, staticHtml);
    
    console.log(`✅ フォーム再デプロイ完了: ${deployResult.storage_url || deployResult.url}`);

    // デプロイ情報をフォームに記録（環境に応じて）
    // ローカル環境の場合、相対パスを完全なURLに変換
    let deployUrl = deployResult.url;
    if (env === 'local' && deployUrl.startsWith('/')) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      deployUrl = `${baseUrl}${deployResult.url}`;
    }
    
    const deployInfo: StaticDeploy = {
      deployed_at: new Date().toISOString(),
      deploy_url: deployUrl,
      storage_url: deployResult.storage_url,
      status: 'deployed'
    };

    if (env === 'local') {
      // ローカル環境: JSON を更新（正規化されたフォーム形式で保存）
      const updatedForm: Form = {
        ...normalizedForm,
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
        await (adminClient as any)
          .from('reservation_forms')
          .update({
            static_deploy: deployInfo,
            updated_at: new Date().toISOString()
          })
          .eq('id', formId);
      }
    }

    return NextResponse.json({
      success: true,
      deployUrl: deployResult.storage_url || 
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
