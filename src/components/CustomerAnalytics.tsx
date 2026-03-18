'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CustomerAnalyticsProps {
  storeId: string;
}

interface AnalyticsData {
  total_customers: number;
  segment_distribution: {
    new: number;
    repeat: number;
    vip: number;
    dormant: number;
  };
  type_distribution: {
    new: number;
    regular: number;
    vip: number;
    inactive: number;
  };
  monthly_new_customers: Array<{ month: string; count: number }>;
  gender_distribution: {
    male: number;
    female: number;
    other: number;
    unknown: number;
  };
  age_distribution: Array<{ age_group: string; count: number }>;
  line_friend_rate: number;
  avg_visit_interval_days: number;
  repeat_rate: number;
  top_customers_by_revenue: Array<{
    customer_id: string;
    name: string;
    total_spent: number;
    total_visits: number;
  }>;
  segment_avg_spending: Array<{
    segment: string;
    avg_spending: number;
    customer_count: number;
  }>;
}

// カスタム横棒チャートコンポーネント
const BarChart = ({
  data,
  getLabel,
  getValue,
  maxValue,
}: {
  data: any[];
  getLabel: (item: any) => string;
  getValue: (item: any) => number;
  maxValue?: number;
}) => {
  const max = maxValue || Math.max(...data.map(getValue), 1);

  return (
    <div className="space-y-3">
      {data.map((item, index) => {
        const value = getValue(item);
        const percentage = (value / max) * 100;

        return (
          <div key={index} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{getLabel(item)}</span>
              <span className="font-medium">{value}</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default function CustomerAnalytics({ storeId }: CustomerAnalyticsProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, [storeId]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/stores/${storeId}/customers/analytics`);
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data);
      }
    } catch (error) {
      console.error('Failed to fetch customer analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
        <p className="mt-2 text-sm text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">データが見つかりませんでした</p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="overview">概要</TabsTrigger>
        <TabsTrigger value="attributes">顧客属性</TabsTrigger>
        <TabsTrigger value="behavior">来店パターン</TabsTrigger>
        <TabsTrigger value="revenue">売上分析</TabsTrigger>
      </TabsList>

      {/* 概要タブ */}
      <TabsContent value="overview" className="space-y-4">
        {/* 統計カード */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>総顧客数</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.total_customers}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>VIP顧客</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.segment_distribution.vip}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>新規顧客</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.segment_distribution.new}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>休眠顧客</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.segment_distribution.dormant}</div>
            </CardContent>
          </Card>
        </div>

        {/* セグメント分布 */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>セグメント分布</CardTitle>
              <CardDescription>顧客をセグメント別に分類</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={[
                  { label: '新規', value: analytics.segment_distribution.new },
                  { label: 'リピーター', value: analytics.segment_distribution.repeat },
                  { label: 'VIP', value: analytics.segment_distribution.vip },
                  { label: '休眠', value: analytics.segment_distribution.dormant },
                ]}
                getLabel={(item) => item.label}
                getValue={(item) => item.value}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>月別新規顧客数</CardTitle>
              <CardDescription>過去12ヶ月の推移</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={analytics.monthly_new_customers.slice(-6)}
                getLabel={(item) => item.month}
                getValue={(item) => item.count}
              />
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* 顧客属性タブ */}
      <TabsContent value="attributes" className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* 性別分布 */}
          <Card>
            <CardHeader>
              <CardTitle>性別分布</CardTitle>
              <CardDescription>顧客の性別内訳</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={[
                  { label: '男性', value: analytics.gender_distribution.male },
                  { label: '女性', value: analytics.gender_distribution.female },
                  { label: 'その他', value: analytics.gender_distribution.other },
                  { label: '不明', value: analytics.gender_distribution.unknown },
                ]}
                getLabel={(item) => item.label}
                getValue={(item) => item.value}
              />
            </CardContent>
          </Card>

          {/* 年齢層分布 */}
          <Card>
            <CardHeader>
              <CardTitle>年齢層分布</CardTitle>
              <CardDescription>誕生日から算出</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={analytics.age_distribution}
                getLabel={(item) => item.age_group}
                getValue={(item) => item.count}
              />
            </CardContent>
          </Card>

          {/* LINE友だち追加率 */}
          <Card>
            <CardHeader>
              <CardTitle>LINE連携状況</CardTitle>
              <CardDescription>友だち追加率</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-4xl font-bold">{analytics.line_friend_rate}%</div>
                <p className="text-sm text-muted-foreground mt-2">
                  顧客の{analytics.line_friend_rate}%がLINE友だち追加済み
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* 来店パターンタブ */}
      <TabsContent value="behavior" className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>平均来店間隔</CardTitle>
              <CardDescription>日数</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-4xl font-bold">{analytics.avg_visit_interval_days}</div>
                <p className="text-sm text-muted-foreground mt-2">日</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>リピート率</CardTitle>
              <CardDescription>2回以上来店</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-4xl font-bold">{analytics.repeat_rate}%</div>
                <p className="text-sm text-muted-foreground mt-2">
                  顧客の{analytics.repeat_rate}%がリピーター
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>リピーター数</CardTitle>
              <CardDescription>2回以上来店した顧客</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-4xl font-bold">{analytics.segment_distribution.repeat}</div>
                <p className="text-sm text-muted-foreground mt-2">人</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* 売上分析タブ */}
      <TabsContent value="revenue" className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* 顧客別売上ランキング */}
          <Card>
            <CardHeader>
              <CardTitle>顧客別売上ランキング</CardTitle>
              <CardDescription>トップ10</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analytics.top_customers_by_revenue.map((customer, index) => (
                  <div key={customer.customer_id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-muted-foreground w-6">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-medium">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {customer.total_visits}回来店
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">¥{customer.total_spent.toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* セグメント別平均単価 */}
          <Card>
            <CardHeader>
              <CardTitle>セグメント別平均単価</CardTitle>
              <CardDescription>顧客セグメントごとの平均利用金額</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={analytics.segment_avg_spending}
                getLabel={(item) => {
                  const labels: { [key: string]: string } = {
                    new: '新規',
                    repeat: 'リピーター',
                    vip: 'VIP',
                    dormant: '休眠',
                  };
                  return `${labels[item.segment] || item.segment} (${item.customer_count}人)`;
                }}
                getValue={(item) => item.avg_spending}
              />
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  );
}
