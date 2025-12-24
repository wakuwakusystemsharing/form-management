import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

// 予約データの型定義
interface SelectedMenu {
  menu_id: string;
  menu_name: string;
  submenu_id?: string;
  submenu_name?: string;
}

interface SelectedOption {
  option_id: string;
  option_name: string;
  value: string;
}

interface Reservation {
  id: string;
  form_id: string;
  store_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  selected_menus: SelectedMenu[];
  selected_options?: SelectedOption[];
  reservation_date: string;
  reservation_time: string;
  customer_info?: Record<string, string>;
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

// 予約データの保存
function writeReservations(reservations: Reservation[]) {
  initializeDataFile();
  fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2));
}

/**
 * GET /api/reservations
 * サービス管理者用: 全店舗の予約一覧を取得
 * 
 * クエリパラメータ:
 * - store_id: 店舗IDでフィルタ
 * - status: ステータスでフィルタ
 * - date_from: 開始日（YYYY-MM-DD）
 * - date_to: 終了日（YYYY-MM-DD）
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('store_id');
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const env = getAppEnvironment();

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      let reservations = readReservations();

      // フィルタリング
      if (storeId) {
        reservations = reservations.filter(r => r.store_id === storeId);
      }

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
      .select('*');

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

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
      console.error('[API] Reservations fetch error:', error);
      return NextResponse.json(
        { error: '予約データの取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(reservations || []);
  } catch (error) {
    console.error('Reservations fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reservations
 * 新規予約作成（顧客向けフォームから）
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // バリデーション
    if (!body.form_id || !body.store_id) {
      return NextResponse.json(
        { error: 'form_idとstore_idは必須です' },
        { status: 400 }
      );
    }

    if (!body.customer_name || !body.customer_phone) {
      return NextResponse.json(
        { error: '顧客名と電話番号は必須です' },
        { status: 400 }
      );
    }

    if (!body.reservation_date || !body.reservation_time) {
      return NextResponse.json(
        { error: '予約日時は必須です' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();

    // ローカル環境: JSON に保存
    if (env === 'local') {
      // 予約ID生成
      const reservationId = `rsv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const newReservation: Reservation = {
        id: reservationId,
        form_id: body.form_id,
        store_id: body.store_id,
        customer_name: body.customer_name,
        customer_phone: body.customer_phone,
        customer_email: body.customer_email,
        selected_menus: body.selected_menus || [],
        selected_options: body.selected_options,
        reservation_date: body.reservation_date,
        reservation_time: body.reservation_time,
        customer_info: body.customer_info,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const reservations = readReservations();
      reservations.push(newReservation);
      writeReservations(reservations);

      return NextResponse.json(newReservation, { status: 201 });
    }

    // staging/production: Supabase に保存
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 既存カラム用のデータを抽出（後方互換性のため）
    const selectedMenus = body.selected_menus || [];
    const customerInfo = body.customer_info || {};
    
    // menu_nameとsubmenu_nameを抽出（最初のメニューから）
    let menuName = '';
    let submenuName: string | null = null;
    if (selectedMenus.length > 0) {
      const firstMenu = selectedMenus[0];
      menuName = firstMenu.menu_name || '';
      submenuName = firstMenu.submenu_name || null;
    }
    
    // customer_infoから既存カラム用の値を抽出
    const gender = customerInfo.gender || null;
    const visitCount = customerInfo.visit_count || null;
    const coupon = customerInfo.coupon || null;
    
    const newReservation = {
      form_id: body.form_id,
      store_id: body.store_id,
      customer_name: body.customer_name,
      customer_phone: body.customer_phone,
      customer_email: body.customer_email || null,
      // 既存カラム（後方互換性のため）
      menu_name: menuName || '未選択',
      submenu_name: submenuName,
      gender: gender,
      visit_count: visitCount,
      coupon: coupon,
      message: body.message || null,
      // 新しいJSONBカラム（分析用）
      selected_menus: selectedMenus,
      selected_options: body.selected_options || [],
      reservation_date: body.reservation_date,
      reservation_time: body.reservation_time,
      customer_info: customerInfo,
      status: 'pending'
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: reservation, error } = await (adminClient as any)
      .from('reservations')
      .insert([newReservation])
      .select()
      .single();

    if (error || !reservation) {
      console.error('[API] Reservation creation error:', error);
      return NextResponse.json(
        { error: '予約の作成に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    console.error('Reservation creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
