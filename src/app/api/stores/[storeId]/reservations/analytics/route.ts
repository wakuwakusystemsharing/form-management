import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { authorizeStoreAccess } from '@/lib/store-access';
import { fetchAllRows } from '@/lib/supabase-fetch-all';
import {
  computeReservationAnalytics,
  type AnalyticsFormInfo,
  type AnalyticsReservation,
} from '@/lib/reservation-analytics';

// ローカル環境用: 予約 / フォームデータの読み込み
const DATA_DIR = path.join(process.cwd(), 'data');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');

function readJsonArray(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

function formNameOf(form: any): string {
  const name = form?.form_name || form?.config?.basic_info?.form_name;
  return typeof name === 'string' && name.trim() ? name.trim() : 'フォーム';
}

/**
 * GET /api/stores/[storeId]/reservations/analytics
 * 予約データの分析結果を返す（店舗管理者 / テナント管理者 / マスター管理者）
 *
 * クエリ:
 * - date_from / date_to: 予約日（YYYY-MM-DD）の範囲。省略時は全期間
 * - form_id: 指定するとフォーム別一覧以外をそのフォームの予約だけで集計
 *
 * 集計ルールは `src/lib/reservation-analytics.ts`（キャンセル除外・メニュー+オプションの売上・フォーム別）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
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

    const env = getAppEnvironment();
    let reservations: AnalyticsReservation[] = [];
    let forms: AnalyticsFormInfo[] = [];

    if (env === 'local') {
      reservations = readJsonArray(RESERVATIONS_FILE).filter((r: any) => r && r.store_id === storeId);
      if (dateFrom) reservations = reservations.filter((r) => typeof r.reservation_date === 'string' && r.reservation_date >= dateFrom);
      if (dateTo) reservations = reservations.filter((r) => typeof r.reservation_date === 'string' && r.reservation_date <= dateTo);
      forms = readJsonArray(path.join(DATA_DIR, `forms_${storeId}.json`))
        .filter((f: any) => f && typeof f.id === 'string')
        .map((f: any) => ({ id: f.id, name: formNameOf(f) }));
    } else {
      const adminClient = createAdminClient();
      if (!adminClient) {
        return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
      }

      try {
        // 予約は 1000 件ずつページングして全件取得（PostgREST の既定上限で切れないように）
        reservations = await fetchAllRows<AnalyticsReservation>((from, to) => {
          let query = (adminClient as any)
            .from('reservations')
            .select('id, form_id, status, reservation_date, reservation_time, selected_menus, selected_options, customer_info, gender, visit_count, coupon')
            .eq('store_id', storeId);
          if (dateFrom) query = query.gte('reservation_date', dateFrom);
          if (dateTo) query = query.lte('reservation_date', dateTo);
          return query.order('reservation_date', { ascending: true }).order('id', { ascending: true }).range(from, to);
        });

        const formRows = await fetchAllRows<{ id: string; config: any; created_at: string }>((from, to) =>
          (adminClient as any)
            .from('reservation_forms')
            .select('id, config, created_at')
            .eq('store_id', storeId)
            .order('created_at', { ascending: false })
            .range(from, to)
        );
        forms = formRows.map((f) => ({ id: f.id, name: formNameOf(f) }));
      } catch (fetchError) {
        console.error('[API] Analytics fetch error:', fetchError);
        return NextResponse.json({ error: '予約データの取得に失敗しました' }, { status: 500 });
      }
    }

    const analytics = computeReservationAnalytics(reservations, forms, formId);

    return NextResponse.json({
      ...analytics,
      forms,
      period: { date_from: dateFrom, date_to: dateTo },
      form_id: formId,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json({ error: '分析データの取得に失敗しました' }, { status: 500 });
  }
}
