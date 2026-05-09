import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';
import { Customer } from '@/types/form';
import { determineCustomerSegment } from '@/lib/customer-utils';

// ローカル環境用のデータファイル
const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

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
 * GET /api/stores/[storeId]/customers/analytics
 * 顧客統計・分析データを取得
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

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
      const t = customer.customer_type as keyof typeof typeCounts;
      if (t in typeCounts) {
        typeCounts[t]++;
      }
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
      const gender = (customer.gender || 'unknown') as keyof typeof genderDistribution;
      if (gender in genderDistribution) {
        genderDistribution[gender]++;
      } else {
        genderDistribution.unknown++;
      }
    });

    // LINE友だち追加率
    // 分母は LINE 連携済み顧客（line_user_id があるもの）に限定する。
    // line_user_id が無い手動登録顧客を分母に入れると率が不当に低く出るため。
    const lineLinkedCustomers = customers.filter((c) => !!c.line_user_id);
    const lineConnectedCount = lineLinkedCustomers.filter((c) => c.line_friend_flag).length;
    const lineFriendRate =
      lineLinkedCustomers.length > 0
        ? (lineConnectedCount / lineLinkedCustomers.length) * 100
        : 0;

    // 平均来店間隔: average_visit_interval_days が null（来店 0〜1 回）の顧客は除外
    const intervalsWithData = customers
      .map((c) => c.average_visit_interval_days)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const avgVisitInterval =
      intervalsWithData.length > 0
        ? intervalsWithData.reduce((sum, v) => sum + v, 0) / intervalsWithData.length
        : 0;

    // リピート率（2回以上来店した顧客の割合）
    const repeatCustomers = customers.filter((c) => c.total_visits >= 2).length;
    const repeatRate =
      customers.length > 0 ? (repeatCustomers / customers.length) * 100 : 0;

    // 顧客別売上ランキング（トップ10）— 元配列を破壊しないよう [...customers]
    const topCustomersByRevenue = [...customers]
      .sort((a, b) => Number(b.total_spent) - Number(a.total_spent))
      .slice(0, 10)
      .map((c) => ({
        customer_id: c.id,
        name: c.name,
        total_spent: Number(c.total_spent),
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
      line_friend_connected: lineConnectedCount,
      line_linked_customers: lineLinkedCustomers.length,

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
    segmentTotals[segment].total += Number(customer.total_spent);
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
    if (Number.isNaN(birthDate.getTime())) {
      ageGroups['不明']++;
      return;
    }
    // 誕生日が今年まだ来ていなければ -1（実年齢）
    let age = now.getFullYear() - birthDate.getFullYear();
    const m = now.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) {
      age -= 1;
    }
    if (age < 0) {
      ageGroups['不明']++;
      return;
    }

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
