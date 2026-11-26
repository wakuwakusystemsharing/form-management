import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { segmentOf } from '@/lib/broadcast-audience';
import { computeCustomerSurveyStats } from '@/lib/survey-analytics';
import { loadSurveyAnalyticsSource, loadSurveyStatCustomers } from '@/lib/survey-analytics-service';

/**
 * GET /api/stores/[storeId]/customers/survey-analytics
 * 顧客分析の「アンケート」: 顧客のうちアンケートに答えた人の数・セグメントごとの回答率・
 * 答えた人 / 答えていない人の来店の違い（件数と平均だけを返す。お客様の情報は返さない）
 */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const { response: authError } = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const [source, customers] = await Promise.all([loadSurveyAnalyticsSource(storeId), loadSurveyStatCustomers(storeId)]);
    const now = new Date();
    const stats = computeCustomerSurveyStats(customers, source.responses, source.forms, (c) =>
      segmentOf({ total_visits: c.total_visits ?? 0, total_spent: c.total_spent ?? 0, first_visit_date: c.first_visit_date ?? null, last_visit_date: c.last_visit_date ?? null }, now)
    );
    return NextResponse.json({ ...stats, total_responses: source.responses.length, form_count: source.forms.length });
  } catch (error) {
    console.error('Customer survey analytics error:', error);
    return NextResponse.json({ error: 'アンケートの分析データの取得に失敗しました' }, { status: 500 });
  }
}
