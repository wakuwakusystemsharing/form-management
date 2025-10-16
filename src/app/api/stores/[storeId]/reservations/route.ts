import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

// 予約データの型定義（簡易版）
interface Reservation {
  id: string;
  form_id: string;
  store_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  selected_menus: unknown[];
  selected_options?: unknown[];
  reservation_date: string;
  reservation_time: string;
  customer_info?: unknown;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  created_at: string;
  updated_at: string;
}

// 一時的なJSONファイルでのデータ保存（開発用）
const DATA_DIR = path.join(process.cwd(), 'data');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');

// データディレクトリとファイルの初期化
function initializeDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(RESERVATIONS_FILE)) {
    fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify([], null, 2));
  }
}

// 予約データの読み込み
function readReservations(): Reservation[] {
  initializeDataFile();
  const data = fs.readFileSync(RESERVATIONS_FILE, 'utf-8');
  return JSON.parse(data);
}

/**
 * GET /api/stores/[storeId]/reservations
 * 店舗管理者用: 自店舗の予約のみ取得
 * 
 * クエリパラメータ:
 * - status: ステータスでフィルタ
 * - date_from: 開始日（YYYY-MM-DD）
 * - date_to: 終了日（YYYY-MM-DD）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const env = getAppEnvironment();

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      let reservations = readReservations();

      // 店舗IDでフィルタ（必須）
      reservations = reservations.filter(r => r.store_id === storeId);

      // 追加フィルタ
      if (status) {
        reservations = reservations.filter(r => r.status === status);
      }

      if (dateFrom) {
        reservations = reservations.filter(r => r.reservation_date >= dateFrom);
      }

      if (dateTo) {
        reservations = reservations.filter(r => r.reservation_date <= dateTo);
      }

      // 予約日時でソート（新しい順）
      reservations.sort((a, b) => {
        const dateA = new Date(`${a.reservation_date}T${a.reservation_time}`);
        const dateB = new Date(`${b.reservation_date}T${b.reservation_time}`);
        return dateB.getTime() - dateA.getTime();
      });

      return NextResponse.json(reservations);
    }

    // staging/production: Supabase から取得
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // クエリビルド
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as any)
      .from('reservations')
      .select('*')
      .eq('store_id', storeId);

    if (status) {
      query = query.eq('status', status);
    }

    if (dateFrom) {
      query = query.gte('reservation_date', dateFrom);
    }

    if (dateTo) {
      query = query.lte('reservation_date', dateTo);
    }

    query = query.order('reservation_date', { ascending: false })
                 .order('reservation_time', { ascending: false });

    const { data: reservations, error } = await query;

    if (error) {
      console.error('[API] Store reservations fetch error:', error);
      return NextResponse.json(
        { error: '予約データの取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(reservations || []);
  } catch (error) {
    console.error('Store reservations fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
