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
 * - search: 顧客名 / メール / 電話番号の部分一致検索
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
    const search = searchParams.get('search')?.trim() || null;
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

      if (search) {
        const q = search.toLowerCase();
        reservations = reservations.filter((r) =>
          r.customer_name?.toLowerCase().includes(q) ||
          r.customer_email?.toLowerCase().includes(q) ||
          r.customer_phone?.toLowerCase().includes(q)
        );
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

    if (search) {
      // ILIKE のメタ文字 % _ \ をエスケープ
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      query = query.or(
        `customer_name.ilike.%${escaped}%,customer_email.ilike.%${escaped}%,customer_phone.ilike.%${escaped}%`
      );
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

    let result: unknown[] = reservations || [];

    // 外部予約メール連携の予約をマージ（include_external=1 のときのみ。店舗管理画面の予約管理で使用）
    if (searchParams.get('include_external') === '1') {
      const { data: externals } = await (adminClient as any)
        .from('external_reservations')
        .select('id,source,status,reservation_number,reservation_date,reservation_time,duration_minutes,customer_name,customer_phone,menu_text,staff_text,created_at')
        .eq('store_id', storeId)
        .in('status', ['created', 'cancelled'])
        .not('reservation_date', 'is', null);

      let mapped = (externals || []).map((e: any) => ({
        id: `ext_${e.id}`,
        external_id: e.id,
        is_external: true,
        external_source: e.source,
        reservation_number: e.reservation_number,
        form_id: '',
        store_id: storeId,
        customer_name: e.customer_name || 'お客様',
        customer_phone: e.customer_phone || '',
        selected_menus: e.menu_text
          ? [{ menu_name: e.menu_text, duration: e.duration_minutes || undefined }]
          : [],
        selected_options: [],
        reservation_date: e.reservation_date,
        reservation_time: (e.reservation_time || '').slice(0, 5),
        customer_info: {},
        staff_name: e.staff_text && !['設定なし', '指名なし'].includes(e.staff_text) ? e.staff_text : null,
        // 外部予約は媒体側で成立済みのため cancelled 以外は confirmed 扱い
        status: e.status === 'cancelled' ? 'cancelled' : 'confirmed',
        created_at: e.created_at,
        updated_at: e.created_at,
      }));

      // フォーム予約と同じフィルタを適用
      if (status) {
        mapped = mapped.filter((e: any) => e.status === status);
      }
      if (dateFrom) {
        mapped = mapped.filter((e: any) => e.reservation_date >= dateFrom);
      }
      if (dateTo) {
        mapped = mapped.filter((e: any) => e.reservation_date <= dateTo);
      }
      if (search) {
        const q = search.toLowerCase();
        mapped = mapped.filter((e: any) =>
          e.customer_name?.toLowerCase().includes(q) ||
          e.customer_phone?.toLowerCase().includes(q)
        );
      }

      result = [...result, ...mapped].sort((a: any, b: any) => {
        const dateA = `${a.reservation_date}T${a.reservation_time || '00:00'}`;
        const dateB = `${b.reservation_date}T${b.reservation_time || '00:00'}`;
        return dateB.localeCompare(dateA);
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Store reservations fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
