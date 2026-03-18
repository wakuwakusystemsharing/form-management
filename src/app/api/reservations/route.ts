import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { createReservationEvent } from '@/lib/google-calendar';
import {
  findCustomerByLineOrPhone,
  createCustomer,
  updateCustomer,
  createCustomerVisit,
  calculateTotalAmount,
} from '@/lib/customer-utils';

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
  line_user_id?: string | null; // LINEユーザーID
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
      // === CRM顧客自動統合ロジック ===
      // 1. LINEユーザーIDまたは電話番号で既存顧客を検索
      let customerId: string | null = null;
      try {
        const existingCustomer = await findCustomerByLineOrPhone(
          body.store_id,
          body.line_user_id,
          body.customer_phone
        );

        if (existingCustomer) {
          // 2-a. 既存顧客の情報を更新
          const totalAmount = calculateTotalAmount(body.selected_menus, body.selected_options);
          await updateCustomer(existingCustomer.id, {
            last_visit_date: body.reservation_date,
            total_visits: existingCustomer.total_visits + 1,
            total_spent: existingCustomer.total_spent + totalAmount,
            // LINE情報があれば更新
            line_display_name: body.line_display_name || existingCustomer.line_display_name,
            line_picture_url: body.line_picture_url || existingCustomer.line_picture_url,
            line_status_message: body.line_status_message || existingCustomer.line_status_message,
            line_os: body.line_os || existingCustomer.line_os,
          });
          customerId = existingCustomer.id;
        } else {
          // 2-b. 新規顧客を作成
          const newCustomer = await createCustomer({
            store_id: body.store_id,
            line_user_id: body.line_user_id,
            name: body.customer_name,
            phone: body.customer_phone,
            email: body.customer_email,
            gender: body.customer_info?.gender,
            line_display_name: body.line_display_name,
            line_picture_url: body.line_picture_url,
            line_status_message: body.line_status_message,
            line_email: body.line_email,
            line_language: body.line_language,
            line_os: body.line_os,
            customer_type: 'new',
            first_visit_date: body.reservation_date,
            last_visit_date: body.reservation_date,
            total_visits: 1,
            total_spent: calculateTotalAmount(body.selected_menus, body.selected_options),
          });
          customerId = newCustomer.id;
        }
      } catch (error) {
        console.error('[CRM] Customer integration error:', error);
        // エラーが発生しても予約作成は継続
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
        line_user_id: body.line_user_id || null, // LINEユーザーID
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const reservations = readReservations();
      reservations.push(newReservation);
      writeReservations(reservations);

      // 3. 来店履歴を作成
      if (customerId) {
        try {
          await createCustomerVisit({
            customer_id: customerId,
            store_id: body.store_id,
            reservation_id: reservationId,
            visit_date: body.reservation_date,
            visit_time: body.reservation_time,
            visit_type: 'reservation',
            treatment_menus: body.selected_menus,
            amount: calculateTotalAmount(body.selected_menus, body.selected_options),
          });
        } catch (error) {
          console.error('[CRM] Customer visit creation error:', error);
        }
      }

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

    // === CRM顧客自動統合ロジック ===
    // 1. LINEユーザーIDまたは電話番号で既存顧客を検索
    let customerId: string | null = null;
    try {
      const existingCustomer = await findCustomerByLineOrPhone(
        body.store_id,
        body.line_user_id,
        body.customer_phone
      );

      if (existingCustomer) {
        // 2-a. 既存顧客の情報を更新
        const totalAmount = calculateTotalAmount(body.selected_menus, body.selected_options);
        await updateCustomer(existingCustomer.id, {
          last_visit_date: body.reservation_date,
          total_visits: existingCustomer.total_visits + 1,
          total_spent: existingCustomer.total_spent + totalAmount,
          // LINE情報があれば更新
          line_display_name: body.line_display_name || existingCustomer.line_display_name,
          line_picture_url: body.line_picture_url || existingCustomer.line_picture_url,
          line_status_message: body.line_status_message || existingCustomer.line_status_message,
          line_os: body.line_os || existingCustomer.line_os,
        });
        customerId = existingCustomer.id;
      } else {
        // 2-b. 新規顧客を作成
        const newCustomer = await createCustomer({
          store_id: body.store_id,
          line_user_id: body.line_user_id,
          name: body.customer_name,
          phone: body.customer_phone,
          email: body.customer_email,
          gender: body.customer_info?.gender,
          line_display_name: body.line_display_name,
          line_picture_url: body.line_picture_url,
          line_status_message: body.line_status_message,
          line_email: body.line_email,
          line_language: body.line_language,
          line_os: body.line_os,
          customer_type: 'new',
          first_visit_date: body.reservation_date,
          last_visit_date: body.reservation_date,
          total_visits: 1,
          total_spent: calculateTotalAmount(body.selected_menus, body.selected_options),
        });
        customerId = newCustomer.id;
      }
    } catch (error) {
      console.error('[CRM] Customer integration error:', error);
      // エラーが発生しても予約作成は継続
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
      line_user_id: body.line_user_id || null, // LINEユーザーID
      customer_id: customerId, // 顧客ID (CRM連携)
      status: 'pending'
    };

     
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

    // 3. 来店履歴を作成
    if (customerId) {
      try {
        await createCustomerVisit({
          customer_id: customerId,
          store_id: body.store_id,
          reservation_id: reservation.id,
          visit_date: body.reservation_date,
          visit_time: body.reservation_time,
          visit_type: 'reservation',
          treatment_menus: body.selected_menus,
          amount: calculateTotalAmount(body.selected_menus, body.selected_options),
        });
      } catch (error) {
        console.error('[CRM] Customer visit creation error:', error);
        // エラーが発生しても予約のレスポンスは返す
      }
    }

    // 4. Googleカレンダーに予約イベントを作成し、イベントIDを予約に保存（キャンセル時に削除するため）
    try {
      const { data: storeData, error: storeError } = await (adminClient as any)
        .from('stores')
        .select('google_calendar_id')
        .eq('id', body.store_id)
        .single();

      if (storeError) {
        console.error('[API] Store calendar lookup error:', storeError);
      } else if (storeData?.google_calendar_id) {
        const eventId = await createReservationEvent(
          {
            calendarId: storeData.google_calendar_id,
            reservationDate: body.reservation_date,
            reservationTime: body.reservation_time,
            customerName: body.customer_name,
            customerPhone: body.customer_phone,
            lineUserId: body.line_user_id || null,
            lineDisplayName: body.line_display_name || null,
            message: body.message || null,
            selectedMenus,
            selectedOptions: body.selected_options || []
          },
          body.store_id
        );
        if (eventId) {
          await (adminClient as any)
            .from('reservations')
            .update({ google_calendar_event_id: eventId })
            .eq('id', reservation.id);
        }
      }
    } catch (calendarError) {
      console.error('[API] Calendar event creation error:', calendarError);
      // 予約自体は成功しているため、ここではエラーにしない
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
