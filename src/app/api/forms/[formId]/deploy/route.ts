import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { StaticFormGenerator } from '@/lib/static-generator';
import { VercelBlobDeployer } from '@/lib/vercel-blob-deployer';
import { normalizeForm } from '@/lib/form-normalizer';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params;
    const body = await request.json();
    const { storeId } = body;

    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      );
    }

    // フォームデータを読み込み
    const formsPath = join(process.cwd(), 'data', `forms_${storeId}.json`);
    if (!existsSync(formsPath)) {
      return NextResponse.json(
        { error: 'Forms file not found' },
        { status: 404 }
      );
    }

    const formsData = JSON.parse(readFileSync(formsPath, 'utf8'));
    const form = formsData.find((f: { id: string; store_id: string }) => f.id === formId && f.store_id === storeId);

    if (!form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      );
    }

    // フォームを正規化してFormConfig形式に変換
    const normalizedForm = normalizeForm(form);
    const formConfig = normalizedForm.config;

    // 静的HTMLを生成
    const generator = new StaticFormGenerator();
    const staticHtml = generator.generateHTML(formConfig);
    
    // Vercel Blobにデプロイ（環境に応じて自動判定）
    const deployer = new VercelBlobDeployer();
    const deployResult = await deployer.deployForm(storeId, formId, staticHtml);
    
    console.log(`✅ フォーム再デプロイ完了: ${deployResult.blob_url || deployResult.url}`);

    // デプロイ情報をフォームに記録
    const updatedForm = {
      ...form,
      static_deploy: {
        deployed_at: new Date().toISOString(),
        deploy_url: deployResult.url,
        blob_url: deployResult.blob_url,
        status: 'deployed',
        environment: deployResult.environment
      },
      updated_at: new Date().toISOString()
    };

    const updatedForms = formsData.map((f: { id: string }) => 
      f.id === formId ? updatedForm : f
    );

    writeFileSync(formsPath, JSON.stringify(updatedForms, null, 2));

    return NextResponse.json({
      success: true,
      deployUrl: deployResult.blob_url || 
                 `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}${deployResult.url}`,
      deployedAt: updatedForm.static_deploy.deployed_at,
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
