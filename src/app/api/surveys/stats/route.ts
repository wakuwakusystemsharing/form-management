// アンケート回答数の集計（店舗×月別）
// 全予約一覧の集計ダウンロード用。件数のみ返す（回答内容は含まない）

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('store_id');
    const env = getAppEnvironment();

    // { store_id, month(YYYY-MM), count } の配列に集計する
    const counts = new Map<string, { store_id: string; month: string; count: number }>();
    const add = (sid: string, submittedAt: string | null | undefined) => {
      if (!sid || !submittedAt) return;
      const month = String(submittedAt).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      const key = `${sid}\t${month}`;
      const entry = counts.get(key) || { store_id: sid, month, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    };

    if (env === 'local') {
      const file = path.join(process.cwd(), 'data', 'survey_responses.json');
      if (fs.existsSync(file)) {
        try {
          const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
          if (Array.isArray(arr)) {
            arr.forEach((r: any) => {
              if (storeId && r.store_id !== storeId) return;
              add(r.store_id, r.submitted_at || r.created_at);
            });
          }
        } catch {
          /* ignore parse errors */
        }
      }
      return NextResponse.json({ stats: [...counts.values()] });
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    let query = (adminClient as any)
      .from('surveys')
      .select('store_id,submitted_at');
    if (storeId) {
      query = query.eq('store_id', storeId);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[surveys/stats] fetch error:', error);
      return NextResponse.json({ error: 'アンケート回答の取得に失敗しました' }, { status: 500 });
    }

    (data || []).forEach((r: any) => add(r.store_id, r.submitted_at));
    return NextResponse.json({ stats: [...counts.values()] });
  } catch (error) {
    console.error('[surveys/stats] error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
