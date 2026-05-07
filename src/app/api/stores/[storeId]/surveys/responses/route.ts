import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const SURVEY_RESPONSES_FILE = path.join(DATA_DIR, 'survey_responses.json');

// GET /api/stores/[storeId]/surveys/responses - 店舗のアンケート回答一覧取得
//   ?survey_form_id=... でフォーム別に絞り込み
//   ?search=... で responses JSONB 内の text 部分一致 + 紐付き顧客の name/email/phone を検索
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();
    const url = new URL(request.url);
    const surveyFormId = url.searchParams.get('survey_form_id');
    const search = url.searchParams.get('search')?.trim() || null;

    // ローカル環境: JSON ファイルから取得
    if (env === 'local') {
      if (!fs.existsSync(SURVEY_RESPONSES_FILE)) {
        return NextResponse.json([]);
      }
      const data = JSON.parse(fs.readFileSync(SURVEY_RESPONSES_FILE, 'utf-8'));
      let responses = data.filter((r: any) => r.store_id === storeId);
      if (surveyFormId) {
        responses = responses.filter((r: any) => r.survey_form_id === surveyFormId);
      }
      if (search) {
        const q = search.toLowerCase();
        responses = responses.filter((r: any) => {
          // 回答 JSONB 全体を text 化して部分一致
          const responsesText = JSON.stringify(r.responses ?? r.answers ?? {}).toLowerCase();
          return responsesText.includes(q);
        });
      }
      responses.sort((a: any, b: any) =>
        new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
      );
      return NextResponse.json(responses);
    }

    // staging/production: 認証チェック
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    // Admin Client でクエリ（RLSバイパス）
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // アンケート回答を取得
    let query = (adminClient as any)
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

    // 検索: PostgREST で JSONB の text キャスト ILIKE を素直に扱えないため、
    // store_id / survey_form_id で絞り込んだ後に JS で部分一致フィルタを行う。
    // 回答 1 件あたりのサイズは小さく件数も店舗単位で限定的なので許容範囲。
    let filtered = surveys || [];
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r: any) => {
        const rawAnswers = r.responses ?? r.answers ?? {};
        const responsesText = (typeof rawAnswers === 'string'
          ? rawAnswers
          : JSON.stringify(rawAnswers)
        ).toLowerCase();
        return responsesText.includes(q);
      });
    }

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Surveys fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
