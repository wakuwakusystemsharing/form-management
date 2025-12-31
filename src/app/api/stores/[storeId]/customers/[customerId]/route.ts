import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { Customer, CustomerUpdate } from '@/types/form';
import { updateCustomer } from '@/lib/customer-utils';

// ローカル環境用のデータファイル
const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');
const VISITS_FILE = path.join(DATA_DIR, 'customer_visits.json');

/**
 * GET /api/stores/[storeId]/customers/[customerId]
 * 顧客詳細を取得（予約履歴、来店履歴を含む）
 */
export async function GET(
  request: Request,
  { params }: { params: { storeId: string; customerId: string } }
) {
  try {
    const { storeId, customerId } = params;
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

    // 顧客情報を取得
    const { data: customer, error: customerError } = await (adminClient as any)
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .eq('store_id', storeId)
      .single();

    if (customerError || !customer) {
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
    }

    // 予約履歴を取得
    const { data: reservations, error: reservationsError } = await (adminClient as any)
      .from('reservations')
      .select('*')
      .eq('customer_id', customerId)
      .order('reservation_date', { ascending: false })
      .limit(50);

    // 来店履歴を取得
    const { data: visits, error: visitsError } = await (adminClient as any)
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
  { params }: { params: { storeId: string; customerId: string } }
) {
  try {
    const { storeId, customerId } = params;
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

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        (updateData as any)[field] = body[field];
      }
    }

    const updatedCustomer = await updateCustomer(customerId, updateData);

    return NextResponse.json(updatedCustomer);
  } catch (error) {
    console.error('Customer update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
