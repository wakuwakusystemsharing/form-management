import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { SurveyForm } from '@/types/survey';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

const DATA_DIR = path.join(process.cwd(), 'data');

function generateRandomFormId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const env = getAppEnvironment();
    const now = new Date().toISOString();

    if (env === 'local') {
      // ローカル: JSONファイルから元フォームを検索
      let sourceForm: SurveyForm | undefined;
      let targetFilePath = '';

      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('surveys_') && f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const forms: SurveyForm[] = JSON.parse(data);
        const found = forms.find(f => f.id === id);
        if (found) {
          sourceForm = found;
          targetFilePath = filePath;
          break;
        }
      }

      if (!sourceForm) {
        return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
      }

      // 新しいIDを生成（重複チェック付き）
      const allForms: SurveyForm[] = [];
      for (const file of files) {
        const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
        allForms.push(...JSON.parse(data));
      }
      let newId = generateRandomFormId();
      while (allForms.some(f => f.id === newId)) {
        newId = generateRandomFormId();
      }

      // configをディープコピーしてリセット
      const newConfig = JSON.parse(JSON.stringify(sourceForm.config));
      if (newConfig.basic_info) {
        newConfig.basic_info.title = (newConfig.basic_info.title || '') + '（コピー）';
        newConfig.basic_info.liff_id = '';
      }

      const newForm: SurveyForm = {
        ...sourceForm,
        id: newId,
        config: newConfig,
        status: 'inactive',
        draft_status: 'none',
        static_deploy: undefined,
        created_at: now,
        updated_at: now,
      };

      // 同じファイルに保存
      const existingData = fs.readFileSync(targetFilePath, 'utf-8');
      const existingForms: SurveyForm[] = JSON.parse(existingData);
      existingForms.push(newForm);
      fs.writeFileSync(targetFilePath, JSON.stringify(existingForms, null, 2));

      return NextResponse.json(newForm, { status: 201 });
    }

    // staging/production: Supabase
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    // 元フォームを取得
    const { data: sourceForm, error: fetchError } = await (adminClient as any)
      .from('survey_forms')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !sourceForm) {
      return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
    }

    // 新しいIDを生成（重複チェック付き）
    let newId = generateRandomFormId();
    let idExists = true;
    while (idExists) {
      const { data } = await (adminClient as any)
        .from('survey_forms')
        .select('id')
        .eq('id', newId)
        .single();
      idExists = !!data;
      if (idExists) newId = generateRandomFormId();
    }

    // configをディープコピーしてリセット
    const config = typeof sourceForm.config === 'string'
      ? JSON.parse(sourceForm.config)
      : JSON.parse(JSON.stringify(sourceForm.config));

    if (config.basic_info) {
      config.basic_info.title = (config.basic_info.title || '') + '（コピー）';
      config.basic_info.liff_id = '';
    }

    const newName = (sourceForm.name || config?.basic_info?.title || 'アンケート') + '（コピー）';

    const { data: newForm, error: insertError } = await (adminClient as any)
      .from('survey_forms')
      .insert({
        id: newId,
        store_id: sourceForm.store_id,
        name: newName,
        config,
        status: 'inactive',
        draft_status: 'none',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError || !newForm) {
      console.error('[API] Survey duplicate error:', insertError);
      return NextResponse.json({ error: 'フォームの複製に失敗しました' }, { status: 500 });
    }

    return NextResponse.json(newForm, { status: 201 });
  } catch (error) {
    console.error('Survey duplicate error:', error);
    return NextResponse.json({ error: 'フォームの複製に失敗しました' }, { status: 500 });
  }
}
