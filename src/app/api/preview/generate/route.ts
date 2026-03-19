import { NextResponse } from 'next/server';
import { Form } from '@/types/form';
import { SurveyForm, SurveyConfig } from '@/types/survey';
import { shouldSkipAuth } from '@/lib/env';
import { getCurrentUser } from '@/lib/auth-helper';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';

export async function POST(request: Request) {
  try {
    // 認証チェック
    if (!shouldSkipAuth()) {
      const user = await getCurrentUser(request);
      if (!user) {
        return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { form, storeId, formType } = body;

    // 入力バリデーション
    if (!form || !storeId || !formType) {
      return NextResponse.json(
        { error: 'form、storeId、formType は必須です' },
        { status: 400 }
      );
    }

    if (formType !== 'reservation' && formType !== 'survey') {
      return NextResponse.json(
        { error: 'formType は "reservation" または "survey" を指定してください' },
        { status: 400 }
      );
    }

    let html: string;

    if (formType === 'reservation') {
      const normalizedForm = normalizeForm(form as Form);
      const generator = new StaticReservationGenerator();
      html = generator.generateHTML(normalizedForm.config, form.id, storeId);
    } else {
      const generator = new StaticSurveyGenerator();
      html = generator.generateHTML(
        (form as SurveyForm).config as SurveyConfig,
        form.id,
        storeId
      );
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Preview generate error:', error);
    return NextResponse.json(
      { error: 'プレビューの生成に失敗しました' },
      { status: 500 }
    );
  }
}
