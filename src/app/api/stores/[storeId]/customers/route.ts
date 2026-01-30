import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { Customer, CustomerInsert } from '@/types/form';
import { createCustomer, determineCustomerSegment } from '@/lib/customer-utils';

// ローカル環境用のデータファイル
const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

/**
 * GET /api/stores/[storeId]/customers
 * 自店舗の顧客一覧を取得
 *
 * クエリパラメータ:
 * - search: 検索クエリ（名前、電話番号、メール）
 * - customer_type: 顧客タイプでフィルタ (new, regular, vip, inactive)
 * - segment: セグメントでフィルタ (new, repeat, vip, dormant)
 * - limit: 取得件数（デフォルト: 50）
 * - offset: オフセット（デフォルト: 0）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const customerType = searchParams.get('customer_type');
    const segment = searchParams.get('segment');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const env = getAppEnvironment();

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      if (!fs.existsSync(CUSTOMERS_FILE)) {
        return NextResponse.json({ customers: [], total: 0 });
      }

      const data = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
      let customers: Customer[] = JSON.parse(data);

      // 店舗IDでフィルタ
      customers = customers.filter((c) => c.store_id === storeId);

      // 検索クエリでフィルタ
      if (search) {
        const query = search.toLowerCase();
        customers = customers.filter(
          (c) =>
            c.name.toLowerCase().includes(query) ||
            c.phone?.toLowerCase().includes(query) ||
            c.email?.toLowerCase().includes(query)
        );
      }

      // 顧客タイプでフィルタ
      if (customerType) {
        customers = customers.filter((c) => c.customer_type === customerType);
      }

      // セグメントでフィルタ
      if (segment) {
        customers = customers.filter((c) => determineCustomerSegment(c) === segment);
      }

      // ソート（最終来店日の降順）
      customers.sort((a, b) => {
        const dateA = a.last_visit_date ? new Date(a.last_visit_date).getTime() : 0;
        const dateB = b.last_visit_date ? new Date(b.last_visit_date).getTime() : 0;
        return dateB - dateA;
      });

      const total = customers.length;
      const paginatedCustomers = customers.slice(offset, offset + limit);

      return NextResponse.json({
        customers: paginatedCustomers,
        total,
      });
    }

    // Staging/Production: Supabase から取得
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // クエリビルド
    let query = (adminClient as any)
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('store_id', storeId);

    // 検索クエリ
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
      );
    }

    // 顧客タイプフィルタ
    if (customerType) {
      query = query.eq('customer_type', customerType);
    }

    // ページネーション
    query = query
      .order('last_visit_date', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    const { data: customers, error, count } = await query;

    if (error) {
      console.error('[API] Customers fetch error:', error);
      return NextResponse.json(
        { error: '顧客データの取得に失敗しました' },
        { status: 500 }
      );
    }

    // セグメントフィルタ（Supabaseでは計算が必要なのでフロントエンド側で実施）
    let filteredCustomers = customers || [];
    if (segment) {
      filteredCustomers = filteredCustomers.filter(
        (c: Customer) => determineCustomerSegment(c) === segment
      );
    }

    return NextResponse.json({
      customers: filteredCustomers,
      total: count || 0,
    });
  } catch (error) {
    console.error('Customers fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stores/[storeId]/customers
 * 新規顧客を手動作成
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();

    // バリデーション
    if (!body.name) {
      return NextResponse.json(
        { error: '顧客名は必須です' },
        { status: 400 }
      );
    }

    const customerData: CustomerInsert = {
      store_id: storeId,
      name: body.name,
      name_kana: body.name_kana,
      phone: body.phone,
      email: body.email,
      birthday: body.birthday,
      gender: body.gender,
      line_user_id: body.line_user_id,
      line_display_name: body.line_display_name,
      line_picture_url: body.line_picture_url,
      line_status_message: body.line_status_message,
      line_email: body.line_email,
      customer_type: body.customer_type || 'regular',
      preferred_contact_method: body.preferred_contact_method,
      allergies: body.allergies,
      medical_history: body.medical_history,
      notes: body.notes,
      tags: body.tags,
    };

    const newCustomer = await createCustomer(customerData);

    return NextResponse.json(newCustomer, { status: 201 });
  } catch (error) {
    console.error('Customer creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
