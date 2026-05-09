import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';
import { Customer, CustomerUpdate } from '@/types/form';
import { updateCustomer, deleteCustomer } from '@/lib/customer-utils';

// ローカル環境用のデータファイル
const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');
const VISITS_FILE = path.join(DATA_DIR, 'customer_visits.json');

/**
 * 顧客 API 共通の認可チェック。
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

/**
 * 顧客が指定店舗に属していることを確認する。
 * 属していない / 存在しない場合は適切な NextResponse を返す。
 */
async function verifyCustomerBelongsToStore(
  storeId: string,
  customerId: string
): Promise<NextResponse | null> {
  const env = getAppEnvironment();

  if (env === 'local') {
    if (!fs.existsSync(CUSTOMERS_FILE)) {
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
    }
    const data = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
    const customers: Customer[] = JSON.parse(data);
    const found = customers.find((c) => c.id === customerId);
    if (!found) {
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
    }
    if (found.store_id !== storeId) {
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
    }
    return null;
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
  }
  const { data, error } = await (adminClient as any)
    .from('customers')
    .select('id, store_id')
    .eq('id', customerId)
    .maybeSingle();

  if (error) {
    console.error('[API] Customer ownership check error:', error);
    return NextResponse.json({ error: '顧客情報の取得に失敗しました' }, { status: 500 });
  }
  if (!data || data.store_id !== storeId) {
    // 別店舗の顧客 ID が指定された場合も「見つからない」として扱う（情報漏洩防止）
    return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
  }
  return null;
}

/**
 * GET /api/stores/[storeId]/customers/[customerId]
 * 顧客詳細を取得（予約履歴、来店履歴を含む）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string; customerId: string }> }
) {
  try {
    const { storeId, customerId } = await params;

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const env = getAppEnvironment();

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      if (!fs.existsSync(CUSTOMERS_FILE)) {
        return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
      }

      const customersData = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
      const customers: Customer[] = JSON.parse(customersData);

      const customer = customers.find(
        (c) => c.id === customerId && c.store_id === storeId
      );

      if (!customer) {
        return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
      }

      // 予約履歴を取得
      let reservations = [];
      if (fs.existsSync(RESERVATIONS_FILE)) {
        const reservationsData = fs.readFileSync(RESERVATIONS_FILE, 'utf-8');
        const allReservations = JSON.parse(reservationsData);
        reservations = allReservations.filter(
          (r: any) => r.customer_id === customerId
        );
      }

      // 来店履歴を取得
      let visits = [];
      if (fs.existsSync(VISITS_FILE)) {
        const visitsData = fs.readFileSync(VISITS_FILE, 'utf-8');
        const allVisits = JSON.parse(visitsData);
        visits = allVisits.filter((v: any) => v.customer_id === customerId);
      }

      return NextResponse.json({
        customer,
        reservations,
        visits,
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

    // 顧客情報を取得（store_id でも絞り込み）
    const { data: customer, error: customerError } = await (adminClient as any)
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .eq('store_id', storeId)
      .maybeSingle();

    if (customerError || !customer) {
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
    }

    // 予約履歴を取得
    const { data: reservations } = await (adminClient as any)
      .from('reservations')
      .select('*')
      .eq('customer_id', customerId)
      .order('reservation_date', { ascending: false })
      .limit(50);

    // 来店履歴を取得
    const { data: visits } = await (adminClient as any)
      .from('customer_visits')
      .select('*')
      .eq('customer_id', customerId)
      .order('visit_date', { ascending: false })
      .limit(50);

    return NextResponse.json({
      customer,
      reservations: reservations || [],
      visits: visits || [],
    });
  } catch (error) {
    console.error('Customer detail fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/stores/[storeId]/customers/[customerId]
 * 顧客情報を更新
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ storeId: string; customerId: string }> }
) {
  try {
    const { storeId, customerId } = await params;

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const ownershipError = await verifyCustomerBelongsToStore(storeId, customerId);
    if (ownershipError) return ownershipError;

    const body = await request.json();

    const updateData: CustomerUpdate = {};

    // 更新可能なフィールドのみを抽出
    const allowedFields = [
      'name',
      'name_kana',
      'phone',
      'email',
      'birthday',
      'gender',
      'customer_type',
      'preferred_contact_method',
      'allergies',
      'medical_history',
      'notes',
      'tags',
    ];

    // 空文字を null に正規化すべきフィールド
    // - birthday: DATE 型は '' を受け付けない
    // - gender: CHECK (gender IN ('male','female','other','unknown')) で '' は違反
    // - その他の nullable な TEXT 列も空文字より null の方が一貫性が高い
    const nullableFields = new Set([
      'name_kana',
      'phone',
      'email',
      'birthday',
      'gender',
      'preferred_contact_method',
      'allergies',
      'medical_history',
      'notes',
    ]);

    for (const field of allowedFields) {
      if (body[field] === undefined) continue;
      let value = body[field];
      if (nullableFields.has(field) && value === '') {
        value = null;
      }
      (updateData as any)[field] = value;
    }

    const updatedCustomer = await updateCustomer(customerId, updateData);

    return NextResponse.json(updatedCustomer);
  } catch (error) {
    console.error('Customer update error:', error);
    const message = error instanceof Error ? error.message : '顧客の更新に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/stores/[storeId]/customers/[customerId]
 * 顧客を削除（関連する customer_visits は CASCADE 削除、reservations.customer_id は SET NULL）
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ storeId: string; customerId: string }> }
) {
  try {
    const { storeId, customerId } = await params;

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const ownershipError = await verifyCustomerBelongsToStore(storeId, customerId);
    if (ownershipError) return ownershipError;

    await deleteCustomer(customerId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Customer delete error:', error);
    const message = error instanceof Error ? error.message : '顧客の削除に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
