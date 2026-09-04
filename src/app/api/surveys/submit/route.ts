import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';
import { applySurveyTagsToCustomer } from '@/lib/survey-tags-apply';

const DATA_DIR = path.join(process.cwd(), 'data');
const SURVEY_RESPONSES_FILE = path.join(DATA_DIR, 'survey_responses.json');

/**
 * 選択肢に設定されたタグを回答者の顧客レコードへ付与する。
 * 回答の保存は済んでいるため、失敗してもログだけ残して送信自体は成功として返す。
 */
async function applyTagsSafely(storeId: string, surveyFormId: string, responses: Record<string, unknown>, lineUserId: unknown) {
  try {
    const result = await applySurveyTagsToCustomer({
      storeId,
      surveyFormId,
      responses,
      lineUserId: typeof lineUserId === 'string' && lineUserId ? lineUserId : null,
    });
    if (result.applied.length > 0 && !result.customerId) {
      console.warn('[Survey] タグ付与スキップ:', result.reason, { storeId, surveyFormId });
    }
  } catch (e) {
    console.error('[Survey] タグ付与エラー:', e);
  }
}

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
    const parsedResponses = typeof responses === 'string' ? JSON.parse(responses) : responses;

    // ローカル環境: JSON ファイルに保存
    if (env === 'local') {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      let existing: any[] = [];
      if (fs.existsSync(SURVEY_RESPONSES_FILE)) {
        existing = JSON.parse(fs.readFileSync(SURVEY_RESPONSES_FILE, 'utf-8'));
      }

      const newResponse = {
        id: `sr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        survey_form_id,
        store_id,
        responses: parsedResponses,
        line_user_id: body.line_user_id || null,
        // null = LIFF で取得失敗（不明）→ false 扱いで記録（webhook 側で後から true に更新される想定）
        line_friend_flag: body.line_friend_flag === true,
        submitted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      existing.push(newResponse);
      fs.writeFileSync(SURVEY_RESPONSES_FILE, JSON.stringify(existing, null, 2));

      await applyTagsSafely(store_id, survey_form_id, parsedResponses, body.line_user_id);
      return NextResponse.json(newResponse, { status: 201 });
    }

    // staging/production: Supabase に保存
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // アンケート回答を挿入
    const { data: survey, error } = await (adminClient as any)
      .from('surveys')
      .insert({
        survey_form_id,
        store_id,
        answers: parsedResponses,
        line_user_id: body.line_user_id || null,
        submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Survey submit error:', error);
      return NextResponse.json(
        { error: 'アンケート回答の送信に失敗しました', details: error.message, code: error.code },
        { status: 500 }
      );
    }

    await applyTagsSafely(store_id, survey_form_id, parsedResponses, body.line_user_id);
    return NextResponse.json(survey, { status: 201 });
  } catch (error) {
    console.error('Survey submit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
