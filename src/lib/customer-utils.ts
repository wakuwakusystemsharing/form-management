/**
 * CRM顧客管理用のユーティリティ関数
 */

import { createAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import {
  Customer,
  CustomerInsert,
  CustomerUpdate,
  CustomerVisit,
  CustomerVisitInsert,
  CustomerSegment,
} from '@/types/form';
import fs from 'fs';
import path from 'path';

// ローカル環境用のデータファイルパス
const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const VISITS_FILE = path.join(DATA_DIR, 'customer_visits.json');

/**
 * データファイルの初期化（ローカル環境のみ）
 */
function initializeDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(CUSTOMERS_FILE)) {
    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify([], null, 2));
  }

  if (!fs.existsSync(VISITS_FILE)) {
    fs.writeFileSync(VISITS_FILE, JSON.stringify([], null, 2));
  }
}

/**
 * LINEユーザーIDまたは電話番号で既存顧客を検索
 *
 * @param storeId - 店舗ID
 * @param lineUserId - LINEユーザーID（オプション）
 * @param phone - 電話番号（オプション）
 * @returns 顧客情報、存在しない場合はnull
 */
export async function findCustomerByLineOrPhone(
  storeId: string,
  lineUserId?: string | null,
  phone?: string | null
): Promise<Customer | null> {
  const env = getAppEnvironment();

  // ローカル環境: JSON ファイルから検索
  if (env === 'local') {
    initializeDataFiles();
    const data = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
    const customers: Customer[] = JSON.parse(data);

    // LINE ユーザーIDで検索（優先）
    if (lineUserId) {
      const customer = customers.find(
        (c) => c.store_id === storeId && c.line_user_id === lineUserId
      );
      if (customer) return customer;
    }

    // 電話番号で検索
    if (phone) {
      const customer = customers.find(
        (c) => c.store_id === storeId && c.phone === phone
      );
      if (customer) return customer;
    }

    return null;
  }

  // Staging/Production: Supabase から検索
  const adminClient = createAdminClient();
  if (!adminClient) {
    throw new Error('Supabase connection error');
  }

  // LINE ユーザーIDで検索（優先）
  if (lineUserId) {
    const { data, error } = await (adminClient as any)
      .from('customers')
      .select('*')
      .eq('store_id', storeId)
      .eq('line_user_id', lineUserId)
      .single();

    if (!error && data) {
      return data as Customer;
    }
  }

  // 電話番号で検索
  if (phone) {
    const { data, error } = await (adminClient as any)
      .from('customers')
      .select('*')
      .eq('store_id', storeId)
      .eq('phone', phone)
      .single();

    if (!error && data) {
      return data as Customer;
    }
  }

  return null;
}

/**
 * 新規顧客を作成
 *
 * @param data - 顧客データ
 * @returns 作成された顧客情報
 */
export async function createCustomer(data: CustomerInsert): Promise<Customer> {
  const env = getAppEnvironment();

  // ローカル環境: JSON ファイルに保存
  if (env === 'local') {
    initializeDataFiles();
    const customersData = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
    const customers: Customer[] = JSON.parse(customersData);

    const customerId = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newCustomer: Customer = {
      id: customerId,
      store_id: data.store_id,
      line_user_id: data.line_user_id || null,
      // 基本情報
      name: data.name,
      name_kana: data.name_kana || null,
      phone: data.phone || null,
      email: data.email || null,
      birthday: data.birthday || null,
      gender: data.gender || null,
      // LINE連携情報
      line_display_name: data.line_display_name || null,
      line_picture_url: data.line_picture_url || null,
      line_status_message: data.line_status_message || null,
      line_email: data.line_email || null,
      line_friend_flag: data.line_friend_flag || false,
      line_friend_added_at: data.line_friend_added_at || null,
      line_language: data.line_language || null,
      line_os: data.line_os || null,
      // 顧客属性
      customer_type: data.customer_type || 'regular',
      preferred_contact_method: data.preferred_contact_method || null,
      allergies: data.allergies || null,
      medical_history: data.medical_history || null,
      notes: data.notes || null,
      tags: data.tags || null,
      // 統計情報
      total_visits: data.total_visits || 0,
      total_spent: data.total_spent || 0,
      first_visit_date: data.first_visit_date || null,
      last_visit_date: data.last_visit_date || null,
      average_visit_interval_days: data.average_visit_interval_days || null,
      // タイムスタンプ
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    customers.push(newCustomer);
    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));

    return newCustomer;
  }

  // Staging/Production: Supabase に保存
  const adminClient = createAdminClient();
  if (!adminClient) {
    throw new Error('Supabase connection error');
  }

  const { data: customer, error } = await (adminClient as any)
    .from('customers')
    .insert([data])
    .select()
    .single();

  if (error || !customer) {
    throw new Error(`Failed to create customer: ${error?.message}`);
  }

  return customer as Customer;
}

/**
 * 顧客情報を更新
 *
 * @param customerId - 顧客ID
 * @param data - 更新データ
 * @returns 更新された顧客情報
 */
export async function updateCustomer(
  customerId: string,
  data: CustomerUpdate
): Promise<Customer> {
  const env = getAppEnvironment();

  // ローカル環境: JSON ファイルを更新
  if (env === 'local') {
    initializeDataFiles();
    const customersData = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
    const customers: Customer[] = JSON.parse(customersData);

    const index = customers.findIndex((c) => c.id === customerId);
    if (index === -1) {
      throw new Error(`Customer not found: ${customerId}`);
    }

    const updatedCustomer = {
      ...customers[index],
      ...data,
      updated_at: new Date().toISOString(),
    };

    customers[index] = updatedCustomer;
    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));

    return updatedCustomer;
  }

  // Staging/Production: Supabase を更新
  const adminClient = createAdminClient();
  if (!adminClient) {
    throw new Error('Supabase connection error');
  }

  const { data: customer, error } = await (adminClient as any)
    .from('customers')
    .update(data)
    .eq('id', customerId)
    .select()
    .single();

  if (error || !customer) {
    throw new Error(`Failed to update customer: ${error?.message}`);
  }

  return customer as Customer;
}

/**
 * 来店履歴を作成
 *
 * @param data - 来店履歴データ
 * @returns 作成された来店履歴
 */
export async function createCustomerVisit(
  data: CustomerVisitInsert
): Promise<CustomerVisit> {
  const env = getAppEnvironment();

  // ローカル環境: JSON ファイルに保存
  if (env === 'local') {
    initializeDataFiles();
    const visitsData = fs.readFileSync(VISITS_FILE, 'utf-8');
    const visits: CustomerVisit[] = JSON.parse(visitsData);

    const visitId = `visit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newVisit: CustomerVisit = {
      id: visitId,
      customer_id: data.customer_id,
      store_id: data.store_id,
      reservation_id: data.reservation_id || null,
      // 来店情報
      visit_date: data.visit_date,
      visit_time: data.visit_time || null,
      visit_type: data.visit_type || 'reservation',
      // 施術情報
      treatment_menus: data.treatment_menus || null,
      treatment_notes: data.treatment_notes || null,
      therapist_name: data.therapist_name || null,
      satisfaction_score: data.satisfaction_score || null,
      // 金額情報
      amount: data.amount || null,
      payment_method: data.payment_method || null,
      // タイムスタンプ
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    visits.push(newVisit);
    fs.writeFileSync(VISITS_FILE, JSON.stringify(visits, null, 2));

    return newVisit;
  }

  // Staging/Production: Supabase に保存
  const adminClient = createAdminClient();
  if (!adminClient) {
    throw new Error('Supabase connection error');
  }

  const { data: visit, error } = await (adminClient as any)
    .from('customer_visits')
    .insert([data])
    .select()
    .single();

  if (error || !visit) {
    throw new Error(`Failed to create customer visit: ${error?.message}`);
  }

  return visit as CustomerVisit;
}

/**
 * 顧客セグメントを判定
 *
 * @param customer - 顧客情報
 * @returns 顧客セグメント
 */
export function determineCustomerSegment(customer: Customer): CustomerSegment {
  const now = new Date();
  const lastVisit = customer.last_visit_date
    ? new Date(customer.last_visit_date)
    : null;

  // 休眠顧客: 最終来店から90日以上
  if (lastVisit) {
    const daysSinceLastVisit =
      (now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastVisit >= 90) {
      return 'dormant';
    }
  }

  // VIP顧客: 総利用金額が50,000円以上または来店回数が10回以上
  if (customer.total_spent >= 50000 || customer.total_visits >= 10) {
    return 'vip';
  }

  // 新規顧客: 初回来店から30日以内
  const firstVisit = customer.first_visit_date
    ? new Date(customer.first_visit_date)
    : null;
  if (firstVisit) {
    const daysSinceFirstVisit =
      (now.getTime() - firstVisit.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceFirstVisit <= 30) {
      return 'new';
    }
  }

  // リピーター: 2回以上来店
  if (customer.total_visits >= 2) {
    return 'repeat';
  }

  // デフォルト: 新規
  return 'new';
}

/**
 * メニュー配列から総額を計算
 *
 * @param selectedMenus - 選択されたメニュー配列
 * @param selectedOptions - 選択されたオプション配列
 * @returns 総額
 */
export function calculateTotalAmount(
  selectedMenus?: any[],
  selectedOptions?: any[]
): number {
  let total = 0;

  // メニューの合計
  if (selectedMenus && Array.isArray(selectedMenus)) {
    for (const menu of selectedMenus) {
      if (menu.price) {
        total += Number(menu.price);
      }
    }
  }

  // オプションの合計
  if (selectedOptions && Array.isArray(selectedOptions)) {
    for (const option of selectedOptions) {
      if (option.price) {
        total += Number(option.price);
      }
    }
  }

  return total;
}
