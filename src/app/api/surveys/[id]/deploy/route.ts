import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { SurveyForm } from '@/types/survey';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { SupabaseStorageDeployer } from '@/lib/supabase-storage-deployer';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { storeId } = await request.json();
    const env = getAppEnvironment();

    let form: SurveyForm | null = null;

    // フォームデータの取得
    if (env === 'local') {
      const formsPath = path.join(DATA_DIR, `surveys_${storeId}.json`);
      if (fs.existsSync(formsPath)) {
        const data = fs.readFileSync(formsPath, 'utf-8');
        const forms = JSON.parse(data);
        form = forms.find((f: SurveyForm) => f.id === id) || null;
      }
    } else {
      const adminClient = createAdminClient();
      if (adminClient) {
        const { data } = await adminClient
          .from('survey_forms')
          .select('*')
          .eq('id', id)
          .single();
        form = data;
      }
    }

    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    // HTML生成
    const generator = new StaticSurveyGenerator();
    const html = generator.generateHTML(form.config, form.id, form.store_id);

    // デプロイ処理
    let deployUrl = '';
    let storageUrl = '';

    if (env === 'local') {
      // ローカル保存
      const staticDir = path.join(process.cwd(), 'public', 'static-forms');
      if (!fs.existsSync(staticDir)) {
        fs.mkdirSync(staticDir, { recursive: true });
      }
      const fileName = `${id}.html`;
      fs.writeFileSync(path.join(staticDir, fileName), html);
      deployUrl = `http://localhost:3000/static-forms/${fileName}`;
    } else {
      // Supabase Storageへアップロード
      const deployer = new SupabaseStorageDeployer();
      const result = await deployer.deployForm(storeId, id, html);
      deployUrl = result.url;
      storageUrl = result.storage_url || '';
    }

    // デプロイ情報の更新
    const deployInfo = {
      deployed_at: new Date().toISOString(),
      deploy_url: deployUrl,
      storage_url: storageUrl,
      status: 'deployed' as const,
      environment: env
    };

    if (env === 'local') {
      const formsPath = path.join(DATA_DIR, `surveys_${storeId}.json`);
      const data = fs.readFileSync(formsPath, 'utf-8');
      const forms = JSON.parse(data);
      const index = forms.findIndex((f: SurveyForm) => f.id === id);
      if (index !== -1) {
        forms[index].static_deploy = deployInfo;
        fs.writeFileSync(formsPath, JSON.stringify(forms, null, 2));
      }
    } else {
      const adminClient = createAdminClient();
      if (adminClient) {
        await adminClient
          .from('survey_forms')
          // @ts-expect-error Supabase型定義不足のため
          .update({ static_deploy: deployInfo })
          .eq('id', id);
      }
    }

    return NextResponse.json(deployInfo);

  } catch (error) {
    console.error('Survey deploy error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
