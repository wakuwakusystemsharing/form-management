import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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
  } catch (error) {
    console.error('Reservation creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
