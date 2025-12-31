import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { Customer } from '@/types/form';
import { determineCustomerSegment } from '@/lib/customer-utils';

// ローカル環境用のデータファイル
const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

/**
 * GET /api/stores/[storeId]/customers/analytics
 * 顧客統計・分析データを取得
 */
export async function GET(
  request: Request,
  { params }: { params: { storeId: string } }
) {
  try {
    const { storeId } = params;
    const env = getAppEnvironment();

    let customers: Customer[] = [];

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      if (fs.existsSync(CUSTOMERS_FILE)) {
        const data = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
        const allCustomers: Customer[] = JSON.parse(data);
        customers = allCustomers.filter((c) => c.store_id === storeId);
      }
    } else {
      // Staging/Production: Supabase から取得
      const adminClient = createAdminClient();
      if (!adminClient) {
        return NextResponse.json(
          { error: 'Supabase 接続エラー' },
          { status: 500 }
        );
      }

      const { data, error } = await (adminClient as any)
        .from('customers')
        .select('*')
        .eq('store_id', storeId);

      if (error) {
        console.error('[API] Customers analytics fetch error:', error);
        return NextResponse.json(
          { error: '顧客分析データの取得に失敗しました' },
          { status: 500 }
        );
      }

      customers = data || [];
    }

    // セグメント別集計
    const segmentCounts = {
      new: 0,
      repeat: 0,
      vip: 0,
      dormant: 0,
    };

    customers.forEach((customer) => {
      const segment = determineCustomerSegment(customer);
      segmentCounts[segment]++;
    });

    // 顧客タイプ別集計
    const typeCounts = {
      new: 0,
      regular: 0,
      vip: 0,
      inactive: 0,
    };

    customers.forEach((customer) => {
      typeCounts[customer.customer_type]++;
    });

    // 月別新規顧客数（過去12ヶ月）
    const monthlyNewCustomers = getMonthlyNewCustomers(customers);

    // 性別分布
    const genderDistribution = {
      male: 0,
      female: 0,
      other: 0,
      unknown: 0,
    };

    customers.forEach((customer) => {
      const gender = customer.gender || 'unknown';
      genderDistribution[gender]++;
    });

    // LINE友だち追加率
    const lineConnectedCount = customers.filter((c) => c.line_friend_flag).length;
    const lineFriendRate =
      customers.length > 0 ? (lineConnectedCount / customers.length) * 100 : 0;

    // 平均来店間隔
    const totalInterval = customers.reduce(
      (sum, c) => sum + (c.average_visit_interval_days || 0),
      0
    );
    const avgVisitInterval =
      customers.length > 0 ? totalInterval / customers.length : 0;

    // リピート率（2回以上来店した顧客の割合）
    const repeatCustomers = customers.filter((c) => c.total_visits >= 2).length;
    const repeatRate =
      customers.length > 0 ? (repeatCustomers / customers.length) * 100 : 0;

    // 顧客別売上ランキング（トップ10）
    const topCustomersByRevenue = customers
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, 10)
      .map((c) => ({
        customer_id: c.id,
        name: c.name,
        total_spent: c.total_spent,
        total_visits: c.total_visits,
      }));

    // セグメント別平均単価
    const segmentAvgSpending = calculateSegmentAvgSpending(customers);

    // 年齢層分布（誕生日から算出）
    const ageDistribution = calculateAgeDistribution(customers);

    return NextResponse.json({
      // 概要統計
      total_customers: customers.length,
      segment_distribution: segmentCounts,
      type_distribution: typeCounts,

      // 時系列データ
      monthly_new_customers: monthlyNewCustomers,

      // 顧客属性
      gender_distribution: genderDistribution,
      age_distribution: ageDistribution,
      line_friend_rate: Math.round(lineFriendRate * 10) / 10, // 小数点1桁

      // 来店パターン
      avg_visit_interval_days: Math.round(avgVisitInterval),
      repeat_rate: Math.round(repeatRate * 10) / 10, // 小数点1桁

      // 売上分析
      top_customers_by_revenue: topCustomersByRevenue,
      segment_avg_spending: segmentAvgSpending,
    });
  } catch (error) {
    console.error('Customer analytics error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * 月別新規顧客数を計算（過去12ヶ月）
 */
function getMonthlyNewCustomers(customers: Customer[]) {
  const monthlyData: { [key: string]: number } = {};
  const now = new Date();

  // 過去12ヶ月の月をキーとして初期化
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthlyData[key] = 0;
  }

  // 顧客の作成月をカウント
  customers.forEach((customer) => {
    if (customer.created_at) {
      const createdDate = new Date(customer.created_at);
      const key = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyData[key] !== undefined) {
        monthlyData[key]++;
      }
    }
  });

  return Object.entries(monthlyData).map(([month, count]) => ({
    month,
    count,
  }));
}

/**
 * セグメント別平均単価を計算
 */
function calculateSegmentAvgSpending(customers: Customer[]) {
  const segmentTotals: { [key: string]: { total: number; count: number } } = {
    new: { total: 0, count: 0 },
    repeat: { total: 0, count: 0 },
    vip: { total: 0, count: 0 },
    dormant: { total: 0, count: 0 },
  };

  customers.forEach((customer) => {
    const segment = determineCustomerSegment(customer);
    segmentTotals[segment].total += customer.total_spent;
    segmentTotals[segment].count++;
  });

  return Object.entries(segmentTotals).map(([segment, data]) => ({
    segment,
    avg_spending: data.count > 0 ? Math.round(data.total / data.count) : 0,
    customer_count: data.count,
  }));
}

/**
 * 年齢層分布を計算
 */
function calculateAgeDistribution(customers: Customer[]) {
  const ageGroups = {
    '10代': 0,
    '20代': 0,
    '30代': 0,
    '40代': 0,
    '50代': 0,
    '60代以上': 0,
    '不明': 0,
  };

  const now = new Date();

  customers.forEach((customer) => {
    if (!customer.birthday) {
      ageGroups['不明']++;
      return;
    }

    const birthDate = new Date(customer.birthday);
    const age = now.getFullYear() - birthDate.getFullYear();

    if (age < 20) {
      ageGroups['10代']++;
    } else if (age < 30) {
      ageGroups['20代']++;
    } else if (age < 40) {
      ageGroups['30代']++;
    } else if (age < 50) {
      ageGroups['40代']++;
    } else if (age < 60) {
      ageGroups['50代']++;
    } else {
      ageGroups['60代以上']++;
    }
  });

  return Object.entries(ageGroups).map(([age_group, count]) => ({
    age_group,
    count,
  }));
}
