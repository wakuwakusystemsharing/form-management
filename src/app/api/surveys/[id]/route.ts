import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { SurveyForm } from '@/types/survey';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

const DATA_DIR = path.join(process.cwd(), 'data');

// GET /api/surveys/[id] - アンケートフォーム取得
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const env = getAppEnvironment();

    // ローカル環境
    if (env === 'local') {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('surveys_') && f.endsWith('.json'));
      
      for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const forms = JSON.parse(data);
        const form = forms.find((f: SurveyForm) => f.id === id);
        
        if (form) {
          // ui_settingsが存在しない場合はデフォルト値を設定
          if (form.config && !form.config.ui_settings) {
            form.config.ui_settings = {
              submit_button_text: '送信',
              theme_color: form.config.basic_info?.theme_color || '#13ca5e'
            };
          }
          return NextResponse.json(form);
        }
      }
      
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    // staging/production
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase connection error' }, { status: 500 });
    }

    const { data: form, error } = await adminClient
      .from('survey_forms')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ui_settingsが存在しない場合はデフォルト値を設定
    if (form && form.config && !form.config.ui_settings) {
      form.config.ui_settings = {
        submit_button_text: '送信',
        theme_color: form.config.basic_info?.theme_color || '#13ca5e'
      };
    }

    return NextResponse.json(form);

  } catch (error) {
    console.error('Survey fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/surveys/[id] - アンケートフォーム更新
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const env = getAppEnvironment();

    // ローカル環境
    if (env === 'local') {
      // 全てのsurvey_*.jsonを探索
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('surveys_') && f.endsWith('.json'));
      
      for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const forms = JSON.parse(data);
        const index = forms.findIndex((f: SurveyForm) => f.id === id);
        
        if (index !== -1) {
          forms[index] = { ...forms[index], ...body, updated_at: new Date().toISOString() };
          fs.writeFileSync(filePath, JSON.stringify(forms, null, 2));
          return NextResponse.json(forms[index]);
        }
      }
      
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    // staging/production
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase connection error' }, { status: 500 });
    }

    const { data: updatedForm, error } = await adminClient
      .from('survey_forms')
      // @ts-expect-error Supabase型定義不足のため
      .update({
        config: body.config,
        status: body.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(updatedForm);

  } catch (error) {
    console.error('Survey update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/surveys/[id] - アンケートフォーム削除
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const env = getAppEnvironment();

    if (env === 'local') {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('surveys_') && f.endsWith('.json'));
      
      for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        let forms = JSON.parse(data);
        const initialLength = forms.length;
        
        forms = forms.filter((f: SurveyForm) => f.id !== id);
        
        if (forms.length !== initialLength) {
          fs.writeFileSync(filePath, JSON.stringify(forms, null, 2));
          return NextResponse.json({ success: true });
        }
      }
      
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase connection error' }, { status: 500 });
    }

    const { error } = await adminClient
      .from('survey_forms')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Survey delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
