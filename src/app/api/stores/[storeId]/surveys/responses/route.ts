import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, getSupabaseClient } from '@/lib/supabase';
import { getAppEnvironment as getEnv } from '@/lib/env';

// GET /api/stores/[storeId]/surveys/responses - 店舗のアンケート回答一覧取得
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getEnv();
    const url = new URL(request.url);
    const surveyFormId = url.searchParams.get('survey_form_id');

    // staging/production: Supabase から取得
    const supabase = getSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 認証チェック（RLSが適用される）
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    // アンケート回答を取得
    let query = supabase
      .from('surveys')
      .select(`
        *,
        survey_forms:survey_form_id (
          id,
          name,
          config
        )
      `)
      .eq('store_id', storeId)
      .order('submitted_at', { ascending: false });

    // survey_form_idが指定されている場合はフィルタ
    if (surveyFormId) {
      query = query.eq('survey_form_id', surveyFormId);
    }

    const { data: surveys, error } = await query;

    if (error) {
      console.error('[API] Surveys fetch error:', error);
      return NextResponse.json(
        { error: 'アンケート回答の取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(surveys || []);
  } catch (error) {
    console.error('Surveys fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

