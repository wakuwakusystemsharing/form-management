// アンケート回答数の集計（店舗×月別）
// 全予約一覧の集計ダウンロード用。件数のみ返す（回答内容は含まない）
// マスター管理者は全店舗、システム管理者は同じテナントの店舗、店舗管理者は自分の店舗だけ。
// 月は日本時間で分け、1000 件を超える回答もすべて数える。

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/supabase-fetch-all';
import { getAccessibleStoreIds, resolveStoreScope } from '@/lib/admin-store-scope';
import { countSurveysByStoreMonth, type SurveyMonthRow } from '@/lib/survey-month-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('store_id');
    const env = getAppEnvironment();

    if (env === 'local') {
      let rows: SurveyMonthRow[] = [];
      const file = path.join(process.cwd(), 'data', 'survey_responses.json');
      if (fs.existsSync(file)) {
        try {
          const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
          if (Array.isArray(arr)) {
            rows = (arr as SurveyMonthRow[]).filter((r) => !storeId || r.store_id === storeId);
          }
        } catch {
          /* ignore parse errors */
        }
      }
      return NextResponse.json({ stats: countSurveysByStoreMonth(rows) });
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = adminClient as any;

    const access = await getAccessibleStoreIds(request, db);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const scope = resolveStoreScope(access.storeIds, storeId);
    if (!scope.ok) {
      return NextResponse.json({ error: 'この店舗を表示する権限がありません' }, { status: 403 });
    }
    if (scope.storeIds && scope.storeIds.length === 0) {
      return NextResponse.json({ stats: [] });
    }

    let rows: SurveyMonthRow[];
    try {
      rows = await fetchAllRows<SurveyMonthRow>((from, to) => {
        let q = db.from('surveys').select('store_id,submitted_at');
        if (scope.storeIds) q = q.in('store_id', scope.storeIds);
        return q.order('id', { ascending: true }).range(from, to);
      });
    } catch (error) {
      console.error('[surveys/stats] fetch error:', error);
      return NextResponse.json({ error: 'アンケート回答の取得に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ stats: countSurveysByStoreMonth(rows) });
  } catch (error) {
    console.error('[surveys/stats] error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
