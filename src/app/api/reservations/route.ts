import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { createReservationEvent } from '@/lib/google-calendar';
import { normalizeForm } from '@/lib/form-normalizer';
import { sendReservationEmails } from '@/lib/reservation-email';
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
  source_medium?: string | null; // 流入経路（web予約のみ）
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  created_at: string;
  updated_at: string;
}

const VALID_SOURCE_MEDIUMS = ['line', 'instagram', 'facebook', 'x_twitter', 'google_maps', 'google_search', 'yahoo_search', 'direct'] as const;

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
 * フォーム ID から正規化済み calendar_settings を取得。
 * フォームが見つからなければ null。
 */
async function getFormCalendarSettings(formId: string): Promise<any | null> {
  if (!formId) return null;
  const env = getAppEnvironment();

  if (env === 'local') {
    // ローカル: data/forms.json と data/forms_*.json から検索
    try {
      if (!fs.existsSync(DATA_DIR)) return null;
      const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('forms') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
          const arr = JSON.parse(data);
          if (Array.isArray(arr)) {
            const found = arr.find((f: any) => f?.id === formId);
            if (found) {
              const normalized = normalizeForm(found);
              return normalized?.config?.calendar_settings || null;
            }
          }
        } catch {
          /* ignore single-file parse errors */
        }
      }
    } catch (err) {
      console.error('[reservations] getFormCalendarSettings local error:', err);
    }
    return null;
  }

  // staging/production: Supabase
  const adminClient = createAdminClient();
  if (!adminClient) return null;
  const { data, error } = await (adminClient as any)
    .from('reservation_forms')
    .select('id, config, draft_config')
    .eq('id', formId)
    .single();
  if (error || !data) return null;
  const normalized = normalizeForm(data);
  return normalized?.config?.calendar_settings || null;
}

/**
 * フォーム ID から正規化済み form.config 全体を取得（form_type 等含む）。
 * フォームが見つからなければ null。
 */
async function getFormConfig(formId: string): Promise<any | null> {
  if (!formId) return null;
  const env = getAppEnvironment();

  if (env === 'local') {
    try {
      if (!fs.existsSync(DATA_DIR)) return null;
      const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('forms') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
          const arr = JSON.parse(data);
          if (Array.isArray(arr)) {
            const found = arr.find((f: any) => f?.id === formId);
            if (found) {
              const normalized = normalizeForm(found);
              return normalized?.config || null;
            }
          }
        } catch {
          /* ignore single-file parse errors */
        }
      }
    } catch (err) {
      console.error('[reservations] getFormConfig local error:', err);
    }
    return null;
  }

  const adminClient = createAdminClient();
  if (!adminClient) return null;
  const { data, error } = await (adminClient as any)
    .from('reservation_forms')
    .select('id, config, draft_config')
    .eq('id', formId)
    .single();
  if (error || !data) return null;
  const normalized = normalizeForm(data);
  return normalized?.config || null;
}

/**
 * 店舗 ID から、メールテンプレ差し込みに必要な店舗情報を取得（local / supabase 両対応）。
 */
async function getStoreForEmail(storeId: string): Promise<{
  name: string;
  address?: string | null;
  phone?: string | null;
  postal_code?: string | null;
  owner_email?: string | null;
} | null> {
  if (!storeId) return null;
  const env = getAppEnvironment();

  if (env === 'local') {
    try {
      const file = path.join(DATA_DIR, 'stores.json');
      if (!fs.existsSync(file)) return null;
      const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const found = Array.isArray(arr) ? arr.find((s: any) => s?.id === storeId) : null;
      if (!found) return null;
      return {
        name: found.name || '',
        address: found.address || null,
        phone: found.phone || null,
        postal_code: found.postal_code || null,
        owner_email: found.owner_email || null,
      };
    } catch (err) {
      console.error('[reservations] getStoreForEmail local error:', err);
      return null;
    }
  }

  const adminClient = createAdminClient();
  if (!adminClient) return null;
  const { data, error } = await (adminClient as any)
    .from('stores')
    .select('name, address, phone, postal_code, owner_email')
    .eq('id', storeId)
    .single();
  if (error || !data) return null;
  return data;
}

/**
 * フォーム ID から calendar_settings.max_concurrent_reservations_per_user を取得。
 * 互換性のため既存呼び出しを維持。
 */
async function getReservationLimitForForm(formId: string): Promise<number> {
  const settings = await getFormCalendarSettings(formId);
  const v = settings?.max_concurrent_reservations_per_user;
  return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

/**
 * 指定ユーザーの「未来かつ未キャンセル」の予約数を返す。
 * 判定: line_user_id がマッチする OR customer_phone がマッチする（OR 条件）。
 * 未来判定: reservation_date + reservation_time（JST）> NOW()。
 */
async function countActiveReservationsForUser(
  storeId: string,
  lineUserId: string | null | undefined,
  customerPhone: string | null | undefined
): Promise<number> {
  if (!lineUserId && !customerPhone) return 0;
  const env = getAppEnvironment();

  // JST の今（new Date は UTC ベースで保持されるが、+09:00 でフォーマットすれば良い）
  const now = new Date();
  // 日付絞り込み用の JST 日付文字列
  const jstParts = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const todayStr = `${jstParts.getFullYear()}-${String(jstParts.getMonth() + 1).padStart(2, '0')}-${String(jstParts.getDate()).padStart(2, '0')}`;
  const nowMs = now.getTime();

  const isFutureAndMatchUser = (r: {
    reservation_date?: string | null;
    reservation_time?: string | null;
    status?: string | null;
    line_user_id?: string | null;
    customer_phone?: string | null;
    store_id?: string | null;
  }): boolean => {
    if (!r) return false;
    if (r.store_id !== storeId) return false;
    if (r.status === 'cancelled') return false;
    const matchUser =
      (lineUserId && r.line_user_id && r.line_user_id === lineUserId) ||
      (customerPhone && r.customer_phone && r.customer_phone === customerPhone);
    if (!matchUser) return false;
    if (!r.reservation_date || !r.reservation_time) return false;
    const dt = new Date(`${r.reservation_date}T${r.reservation_time}+09:00`).getTime();
    return Number.isFinite(dt) && dt > nowMs;
  };

  if (env === 'local') {
    try {
      const all = readReservations();
      return all.filter(isFutureAndMatchUser).length;
    } catch (err) {
      console.error('[reservations] countActiveReservationsForUser local error:', err);
      return 0;
    }
  }

  const adminClient = createAdminClient();
  if (!adminClient) return 0;
  const orParts: string[] = [];
  if (lineUserId) orParts.push(`line_user_id.eq.${lineUserId}`);
  if (customerPhone) orParts.push(`customer_phone.eq.${customerPhone}`);
  const { data, error } = await (adminClient as any)
    .from('reservations')
    .select('reservation_date, reservation_time, status, line_user_id, customer_phone, store_id')
    .eq('store_id', storeId)
    .neq('status', 'cancelled')
    .gte('reservation_date', todayStr)
    .or(orParts.join(','));
  if (error || !data) return 0;
  return (data as any[]).filter(isFutureAndMatchUser).length;
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

    if (!body.reservation_date || !body.reservation_time) {
      return NextResponse.json(
        { error: '予約日時は必須です' },
        { status: 400 }
      );
    }

    // フォーム設定を取得（同時予約数チェック + 名前/電話の表示設定で共用）
    let formCalendarSettings: any = null;
    try {
      formCalendarSettings = await getFormCalendarSettings(body.form_id);
    } catch (err) {
      console.error('[reservations] getFormCalendarSettings error:', err);
    }

    // 名前/電話の表示設定が false ならフォールバック値を埋め、必須バリデーションをスキップ
    const showName = formCalendarSettings?.show_customer_name !== false;
    const showPhone = formCalendarSettings?.show_customer_phone !== false;
    if (!showName && !body.customer_name) {
      body.customer_name = body.line_display_name || '未記入';
    }
    if (!showPhone && !body.customer_phone) {
      body.customer_phone = '未記入';
    }
    if (!body.customer_name || !body.customer_phone) {
      return NextResponse.json(
        { error: '顧客名と電話番号は必須です' },
        { status: 400 }
      );
    }

    // 同一ユーザーの同時予約数制限チェック（form 設定で >0 の場合のみ）
    try {
      const v = formCalendarSettings?.max_concurrent_reservations_per_user;
      const limit = typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
      if (limit > 0) {
        const activeCount = await countActiveReservationsForUser(
          body.store_id,
          body.line_user_id || null,
          body.customer_phone || null
        );
        if (activeCount >= limit) {
          return NextResponse.json(
            {
              error: '既に予約があります。予約が過ぎるまで新しい予約はできません。',
              code: 'concurrent_reservation_limit',
            },
            { status: 409 }
          );
        }
      }
    } catch (err) {
      // 上限チェック自体の失敗で予約を止めるのは過剰なのでログのみ
      console.error('[reservations] concurrent reservation check error:', err);
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
            line_friend_flag: body.line_friend_flag || existingCustomer.line_friend_flag,
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
            line_friend_flag: body.line_friend_flag || false,
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
        source_medium: VALID_SOURCE_MEDIUMS.includes(body.source_medium) ? body.source_medium : null,
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

      // 4. Web 予約フォームの場合、お客様 / 店舗にメール送信（fire-and-forget）
      try {
        const formConfig = await getFormConfig(body.form_id);
        if (formConfig?.form_type === 'web') {
          const storeInfo = await getStoreForEmail(body.store_id);
          if (storeInfo) {
            void sendReservationEmails({
              reservation: {
                id: newReservation.id,
                customer_name: newReservation.customer_name,
                customer_phone: newReservation.customer_phone,
                customer_email: newReservation.customer_email,
                reservation_date: newReservation.reservation_date,
                reservation_time: newReservation.reservation_time,
                selected_menus: newReservation.selected_menus,
                selected_options: newReservation.selected_options || null,
                message: body.message || null,
              },
              store: storeInfo as any,
              form: { config: formConfig },
            }).catch((e) => console.error('[API] reservation email error:', e));
          }
        }
      } catch (emailError) {
        console.error('[API] reservation email orchestration error:', emailError);
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
          line_friend_flag: body.line_friend_flag || existingCustomer.line_friend_flag,
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
          line_friend_flag: body.line_friend_flag || false,
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
      source_medium: VALID_SOURCE_MEDIUMS.includes(body.source_medium) ? body.source_medium : null,
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

    // 4. Googleカレンダーに予約イベントを作成（希望日時式はスキップ — LINEチャットへの送信のみ）
    const bookingMode = body.booking_mode || customerInfo.booking_mode || 'calendar';
    if (bookingMode === 'multiple_dates') {
      console.log('[API] 希望日時式のためカレンダーイベント作成をスキップ');
    } else try {
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
            course: customerInfo.course || null,
            visitCount: customerInfo.visit_count_label || customerInfo.visit_count || null,
            preferredDate2: body.reservation_date2 || customerInfo.preferred_date2 || null,
            preferredTime2: body.reservation_time2 || customerInfo.preferred_time2 || null,
            preferredDate3: body.reservation_date3 || customerInfo.preferred_date3 || null,
            preferredTime3: body.reservation_time3 || customerInfo.preferred_time3 || null,
            selectedMenus,
            selectedOptions: body.selected_options || [],
            gender: customerInfo.gender_label || customerInfo.gender || null,
            coupon: customerInfo.coupon_label || customerInfo.coupon || null,
            customFields: customerInfo.custom_fields_labeled || null
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

    // 5. Web 予約フォームの場合、お客様 / 店舗にメール送信（fire-and-forget）
    try {
      const formConfig = await getFormConfig(body.form_id);
      if (formConfig?.form_type === 'web') {
        const storeInfo = await getStoreForEmail(body.store_id);
        if (storeInfo) {
          void sendReservationEmails({
            reservation: {
              id: reservation.id,
              customer_name: reservation.customer_name,
              customer_phone: reservation.customer_phone,
              customer_email: reservation.customer_email,
              reservation_date: reservation.reservation_date,
              reservation_time: reservation.reservation_time,
              selected_menus: reservation.selected_menus,
              selected_options: reservation.selected_options,
              message: body.message || null,
            },
            store: storeInfo as any,
            form: { config: formConfig },
          }).catch((e) => console.error('[API] reservation email error:', e));
        }
      }
    } catch (emailError) {
      console.error('[API] reservation email orchestration error:', emailError);
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
