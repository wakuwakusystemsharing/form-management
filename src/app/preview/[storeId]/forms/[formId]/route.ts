import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Form } from '@/types/form';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string; formId: string }> }
) {
  try {
    const { storeId, formId } = await params;
    const env = getAppEnvironment();
    let form: Form | null = null;

    // ローカル環境
    if (env === 'local') {
      const formsPath = path.join(DATA_DIR, `forms_${storeId}.json`);
      if (fs.existsSync(formsPath)) {
        const data = fs.readFileSync(formsPath, 'utf-8');
        const forms = JSON.parse(data);
        const found = forms.find((f: Form) => f.id === formId);
        if (found) {
          form = found;
        }
      }
    } else {
      // staging/production
      const adminClient = createAdminClient();
      if (adminClient) {
        const { data, error } = await (adminClient as any)
          .from('reservation_forms')
          .select('*')
          .eq('id', formId)
          .eq('store_id', storeId)
          .single();

        if (!error && data) {
          form = data as Form;
        }
      }
    }

    if (!form) {
      return new NextResponse('フォームが見つかりません', { status: 404 });
    }

    // フォームを正規化してFormConfig形式に変換（デプロイ時と同じ）
    const normalizedForm = normalizeForm(form);
    const formConfig = normalizedForm.config;

    // 静的HTMLを生成（デプロイ時と同じジェネレータを使用）
    const generator = new StaticReservationGenerator();
    const html = generator.generateHTML(formConfig, formId, storeId);

    // レスポンスヘッダーを公開配信（public-form）と整合させる
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline' 'unsafe-eval' https://static.line-scdn.net https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.line.me https://liff.line.me https://liffsdk.line-scdn.net https://script.google.com https://script.googleusercontent.com;",
      },
    });
  } catch (error) {
    console.error('Preview error:', error);
    return new NextResponse('サーバーエラーが発生しました', { status: 500 });
  }
}
