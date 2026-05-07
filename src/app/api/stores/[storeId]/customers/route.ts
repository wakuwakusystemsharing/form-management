import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';
import { Customer, CustomerInsert } from '@/types/form';
import { createCustomer, determineCustomerSegment } from '@/lib/customer-utils';

// ローカル環境用のデータファイル
const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

/**
 * 顧客 API 共通の認可チェック。
 * - local 環境: 認証スキップ
 * - それ以外: getCurrentUser → checkStoreAccess
 *
 * 失敗時はそのまま返せる NextResponse を返し、成功時は null。
 */
async function authorizeStoreAccess(
  request: Request,
  storeId: string
): Promise<NextResponse | null> {
  const env = getAppEnvironment();
  if (env === 'local') return null;

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const token =
    request.headers.get('cookie')
      ?.split(';')
      .find((c) => c.trim().startsWith('sb-access-token='))
      ?.trim()
      .substring('sb-access-token='.length) ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const authClient = createAuthenticatedClient(token);
  if (!authClient) {
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
  }

  const hasAccess = await checkStoreAccess(user.id, storeId, user.email, authClient);
  if (!hasAccess) {
    return NextResponse.json({ error: 'この店舗へのアクセス権限がありません' }, { status: 403 });
  }

  return null;
}

// PostgREST の or() フィルタ構文で意味を持つ文字をエスケープ。
// 検索クエリにユーザーが「,」「(」「)」「.」を含む場合、フィルタ文字列が壊れて 500 になるため。
function escapeForOrFilter(value: string): string {
  return value.replace(/[(),\\]/g, ' ').trim();
}

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

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

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

    // 検索クエリ（フィルタ構文文字を除去してから埋め込む）
    if (search) {
      const safe = escapeForOrFilter(search);
      if (safe) {
        query = query.or(
          `name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`
        );
      }
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

// 電話番号の正規化（重複検出用）。ハイフン・スペースを除去。
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const stripped = phone.replace(/[\s\-－ー]/g, '');
  return stripped || null;
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

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const body = await request.json();

    // バリデーション
    if (!body.name) {
      return NextResponse.json(
        { error: '顧客名は必須です' },
        { status: 400 }
      );
    }

    // 電話番号の重複チェック（ハイフン無視で正規化）
    const normalizedPhone = normalizePhone(body.phone);
    if (normalizedPhone) {
      const env = getAppEnvironment();
      if (env === 'local') {
        if (fs.existsSync(CUSTOMERS_FILE)) {
          const data = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
          const all: Customer[] = JSON.parse(data);
          const dup = all.find(
            (c) =>
              c.store_id === storeId &&
              normalizePhone(c.phone) === normalizedPhone
          );
          if (dup) {
            return NextResponse.json(
              { error: 'この電話番号の顧客は既に登録されています', existing_customer_id: dup.id },
              { status: 409 }
            );
          }
        }
      } else {
        const adminClient = createAdminClient();
        if (adminClient) {
          // ハイフン入りでも一致するよう、両方の表記を OR で問い合わせる
          const { data } = await (adminClient as any)
            .from('customers')
            .select('id, phone')
            .eq('store_id', storeId);
          const dup = (data || []).find(
            (c: any) => normalizePhone(c.phone) === normalizedPhone
          );
          if (dup) {
            return NextResponse.json(
              { error: 'この電話番号の顧客は既に登録されています', existing_customer_id: dup.id },
              { status: 409 }
            );
          }
        }
      }
    }

    const customerData: CustomerInsert = {
      store_id: storeId,
      name: body.name,
      name_kana: body.name_kana || null,
      phone: body.phone || null,
      email: body.email || null,
      birthday: body.birthday || null,
      gender: body.gender || null,
      line_user_id: body.line_user_id || null,
      line_display_name: body.line_display_name || null,
      line_picture_url: body.line_picture_url || null,
      line_status_message: body.line_status_message || null,
      line_email: body.line_email || null,
      customer_type: body.customer_type || 'regular',
      preferred_contact_method: body.preferred_contact_method || null,
      allergies: body.allergies || null,
      medical_history: body.medical_history || null,
      notes: body.notes || null,
      tags: body.tags || null,
    };

    const newCustomer = await createCustomer(customerData);

    return NextResponse.json(newCustomer, { status: 201 });
  } catch (error) {
    console.error('Customer creation error:', error);
    const message = error instanceof Error ? error.message : '顧客の作成に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
