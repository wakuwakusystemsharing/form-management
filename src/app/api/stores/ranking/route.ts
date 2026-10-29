// GET /api/stores/ranking?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
// 全店舗ランキング（全予約一覧 → ランキングタブ）。マスター管理者は全店舗、システム管理者は同テナントの店舗のみ。
// 集計は純粋ロジック `src/lib/store-ranking.ts` の computeStoreRankings。件数・金額だけを返し、個人情報は含まない。
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { getCurrentUserRole } from '@/lib/auth-helper';
import { fetchAllRows } from '@/lib/supabase-fetch-all';
import {
  computeStoreRankings,
  type RankingCustomerInput,
  type RankingPeriod,
  type RankingReservationInput,
  type RankingStoreInput,
  type RankingSurveyInput,
} from '@/lib/store-ranking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATA_DIR = path.join(process.cwd(), 'data');

function readJsonArray<T>(file: string): T[] {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(arr) ? (arr as T[]) : [];
  } catch {
    return [];
  }
}

function parsePeriod(searchParams: URLSearchParams): RankingPeriod | null | 'invalid' {
  const from = searchParams.get('date_from');
  const to = searchParams.get('date_to');
  if (!from && !to) return null;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !re.test(from) || !re.test(to) || from > to) return 'invalid';
  return { date_from: from, date_to: to };
}

/** 回答日時の期間フィルタ用: JST の日付 → UTC の ISO（開始は 00:00 JST、終了は翌日 00:00 JST 未満） */
function jstDayStartIso(ymd: string, addDays = 0): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + addDays, 0, 0, 0) - 9 * 60 * 60 * 1000).toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = parsePeriod(searchParams);
    if (period === 'invalid') {
      return NextResponse.json({ error: '期間の指定が正しくありません（date_from / date_to は YYYY-MM-DD）' }, { status: 400 });
    }
    const env = getAppEnvironment();

    if (env === 'local') {
      const stores = readJsonArray<RankingStoreInput>('stores.json');
      const reservations = readJsonArray<RankingReservationInput>('reservations.json');
      const surveys = readJsonArray<RankingSurveyInput>('survey_responses.json');
      const customers = readJsonArray<RankingCustomerInput>('customers.json');
      return NextResponse.json({ rows: computeStoreRankings(stores, reservations, surveys, customers, period), period });
    }

    const roleInfo = await getCurrentUserRole(request);
    if (!roleInfo) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    if (roleInfo.role !== 'master' && roleInfo.role !== 'system') {
      return NextResponse.json({ error: 'この操作を行う権限がありません' }, { status: 403 });
    }
    if (roleInfo.role === 'system' && !roleInfo.orgId) {
      return NextResponse.json({ error: '所属テナントが見つかりません' }, { status: 403 });
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }
    const db = adminClient as any;

    let storeQuery = db.from('stores').select('id, name');
    if (roleInfo.role === 'system') storeQuery = storeQuery.eq('org_id', roleInfo.orgId);
    const { data: storeData, error: storeError } = await storeQuery;
    if (storeError) {
      console.error('[stores/ranking] stores fetch error:', storeError);
      return NextResponse.json({ error: '店舗の取得に失敗しました' }, { status: 500 });
    }
    const stores = (storeData || []) as RankingStoreInput[];
    const storeIds = stores.map((s) => s.id);
    if (storeIds.length === 0) {
      return NextResponse.json({ rows: [], period });
    }

    const [reservations, surveys, customers] = await Promise.all([
      fetchAllRows<RankingReservationInput>((from, to) => {
        let q = db
          .from('reservations')
          .select('store_id, status, reservation_date, selected_menus, selected_options, stay_price_total')
          .in('store_id', storeIds)
          .order('id', { ascending: true })
          .range(from, to);
        if (period) q = q.gte('reservation_date', period.date_from).lte('reservation_date', period.date_to);
        return q;
      }),
      fetchAllRows<RankingSurveyInput>((from, to) => {
        let q = db
          .from('surveys')
          .select('store_id, submitted_at')
          .in('store_id', storeIds)
          .order('id', { ascending: true })
          .range(from, to);
        if (period) q = q.gte('submitted_at', jstDayStartIso(period.date_from)).lt('submitted_at', jstDayStartIso(period.date_to, 1));
        return q;
      }),
      fetchAllRows<RankingCustomerInput>((from, to) =>
        db
          .from('customers')
          .select('store_id, line_user_id, line_friend_flag')
          .in('store_id', storeIds)
          .not('line_user_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to)
      ),
    ]);

    return NextResponse.json({ rows: computeStoreRankings(stores, reservations, surveys, customers, period), period });
  } catch (error) {
    console.error('[stores/ranking] error:', error);
    return NextResponse.json({ error: 'ランキングの集計に失敗しました' }, { status: 500 });
  }
}
