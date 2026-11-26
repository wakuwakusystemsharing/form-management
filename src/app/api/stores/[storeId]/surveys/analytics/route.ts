import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { computeSurveyAnalytics } from '@/lib/survey-analytics';
import { loadSurveyAnalyticsSource, loadSurveyStatCustomers } from '@/lib/survey-analytics-service';

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/stores/[storeId]/surveys/analytics
 * アンケートの分析（店舗管理者 / テナント管理者 / マスター管理者）
 *
 * クエリ:
 * - date_from / date_to: 回答した日（日本時間。YYYY-MM-DD）の範囲。省略時は全期間
 * - form_id: 指定すると、フォーム別の一覧以外をそのフォームの回答だけで集計し、質問ごとの集計も返す
 *
 * 集計ルールは `src/lib/survey-analytics.ts`。LINE のユーザー ID は返さない
 */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const { response: authError } = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const dateFromRaw = searchParams.get('date_from');
    const dateToRaw = searchParams.get('date_to');
    const dateFrom = dateFromRaw && DATE_PARAM_RE.test(dateFromRaw) ? dateFromRaw : null;
    const dateTo = dateToRaw && DATE_PARAM_RE.test(dateToRaw) ? dateToRaw : null;
    if ((dateFromRaw && !dateFrom) || (dateToRaw && !dateTo)) {
      return NextResponse.json({ error: '日付は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
    }
    const formId = searchParams.get('form_id')?.trim() || null;

    let source;
    try {
      source = await loadSurveyAnalyticsSource(storeId);
    } catch (e) {
      console.error('[API] Survey analytics fetch error:', e);
      return NextResponse.json({ error: 'アンケートの回答の取得に失敗しました' }, { status: 500 });
    }
    // 顧客を読めなくても、分析そのものは返す（「顧客として登録済み」の人数だけ出さない）
    const customerLineIds = await loadSurveyStatCustomers(storeId)
      .then((list) => list.map((c) => c.line_user_id).filter((id): id is string => !!id))
      .catch(() => null);

    const analytics = computeSurveyAnalytics(source.responses, source.forms, { dateFrom, dateTo, formId, customerLineIds });
    return NextResponse.json({
      ...analytics,
      forms: source.forms.map((f) => ({ id: f.id, name: f.name })),
      period: { date_from: dateFrom, date_to: dateTo },
      form_id: formId,
    });
  } catch (error) {
    console.error('Survey analytics error:', error);
    return NextResponse.json({ error: '分析データの取得に失敗しました' }, { status: 500 });
  }
}
