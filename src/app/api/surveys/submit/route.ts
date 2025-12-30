import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

// POST /api/surveys/submit - アンケート回答を送信
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { survey_form_id, store_id, responses } = body;

    // バリデーション
    if (!survey_form_id || !store_id || !responses) {
      return NextResponse.json(
        { error: 'survey_form_id, store_id, responsesは必須です' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();

    // staging/production: Supabase に保存
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // アンケート回答を挿入
    // @ts-expect-error Supabase型定義不足のため
    const { data: survey, error } = await (adminClient as any)
      .from('surveys')
      .insert({
        survey_form_id,
        store_id,
        responses: typeof responses === 'string' ? JSON.parse(responses) : responses,
        submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Survey submit error:', error);
      return NextResponse.json(
        { error: 'アンケート回答の送信に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(survey, { status: 201 });
  } catch (error) {
    console.error('Survey submit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

