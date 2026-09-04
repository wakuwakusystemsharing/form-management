'use client';

import { fetchWithAuth } from '@/lib/client-auth';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ChevronRight } from 'lucide-react';
import { ChipTabsList } from '@/components/customers/ChipTabs';
import { StatGrid, StatTile } from '@/components/customers/StatTile';

interface CustomerAnalyticsProps {
  storeId: string;
  /** 売上ランキングの行をタップしたときに顧客詳細を開く（未指定なら通常の行） */
  onCustomerClick?: (customerId: string) => void;
}

interface AnalyticsData {
  total_customers: number;
  segment_distribution: { new: number; repeat: number; vip: number; dormant: number };
  type_distribution: { new: number; regular: number; vip: number; inactive: number };
  monthly_new_customers: Array<{ month: string; count: number }>;
  gender_distribution: { male: number; female: number; other: number; unknown: number };
  age_distribution: Array<{ age_group: string; count: number }>;
  line_friend_rate: number;
  line_friend_connected?: number;
  line_linked_customers?: number;
  avg_visit_interval_days: number;
  repeat_rate: number;
  top_customers_by_revenue: Array<{ customer_id: string; name: string; total_spent: number; total_visits: number }>;
  segment_avg_spending: Array<{ segment: string; avg_spending: number; customer_count: number }>;
}

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

// 横棒チャート: ラベル行とバー + 数値を分け、ラベルが長くても数値が押し出されない
const BarChart = ({
  data,
  getLabel,
  getValue,
  formatValue = (v: number) => String(v),
  maxValue,
}: {
  data: any[];
  getLabel: (item: any) => string;
  getValue: (item: any) => number;
  formatValue?: (v: number) => string;
  maxValue?: number;
}) => {
  const max = maxValue || Math.max(...data.map(getValue), 1);
  if (data.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>;
  return (
    <div className="space-y-2.5">
      {data.map((item, index) => {
        const value = getValue(item);
        const percentage = Math.max(0, Math.min(100, (value / max) * 100));
        return (
          <div key={index} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <span className="text-sm text-muted-foreground truncate">{getLabel(item)}</span>
            <span className="text-sm font-medium tabular-nums">{formatValue(value)}</span>
            <div className="col-span-2 h-2.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Card の余白をスマホ 16px / PC 24px に揃える薄いラッパー */
function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
        <CardTitle className="text-base md:text-lg">{title}</CardTitle>
        {description && <CardDescription className="text-xs md:text-sm">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-4 pt-1 md:p-6 md:pt-0">{children}</CardContent>
    </Card>
  );
}

export default function CustomerAnalytics({ storeId, onCustomerClick }: CustomerAnalyticsProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth(`/api/stores/${storeId}/customers/analytics`);
      if (response.ok) setAnalytics(await response.json());
    } catch (error) {
      console.error('Failed to fetch customer analytics:', error);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-10 rounded-full bg-muted animate-pulse" />
        <StatGrid cols={4}>
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[4.25rem] rounded-lg bg-muted animate-pulse" />)}
        </StatGrid>
        <div className="h-48 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (!analytics) {
    return <div className="text-center py-8"><p className="text-muted-foreground">データが見つかりませんでした</p></div>;
  }

  const segmentLabels: Record<string, string> = { new: '新規', repeat: 'リピーター', vip: 'VIP', dormant: '休眠' };

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <ChipTabsList
        desktopGrid
        className="-mx-4 w-[calc(100%+2rem)] px-4 md:mx-0 md:w-full md:px-1"
        items={[
          { value: 'overview', label: '概要' },
          { value: 'attributes', label: '顧客属性' },
          { value: 'behavior', label: '来店パターン' },
          { value: 'revenue', label: '売上' },
        ]}
      />

      {/* 概要 */}
      <TabsContent value="overview" className="space-y-3 md:space-y-4 mt-3">
        <StatGrid cols={4}>
          <StatTile label="総顧客数" value={analytics.total_customers} />
          <StatTile label="VIP 顧客" value={analytics.segment_distribution.vip} />
          <StatTile label="新規顧客" value={analytics.segment_distribution.new} />
          <StatTile label="休眠顧客" value={analytics.segment_distribution.dormant} />
        </StatGrid>
        <div className="grid gap-3 md:gap-4 md:grid-cols-2">
          <Section title="セグメント分布" description="来店履歴から自動判定">
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
          </Section>
          <Section title="月別新規顧客数" description="直近 6 か月">
            <BarChart data={analytics.monthly_new_customers.slice(-6)} getLabel={(item) => item.month} getValue={(item) => item.count} />
          </Section>
        </div>
      </TabsContent>

      {/* 顧客属性 */}
      <TabsContent value="attributes" className="space-y-3 md:space-y-4 mt-3">
        <div className="grid gap-3 md:gap-4 md:grid-cols-2">
          <Section title="性別分布">
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
          </Section>
          <Section title="年齢層分布" description="誕生日から算出">
            <BarChart data={analytics.age_distribution} getLabel={(item) => item.age_group} getValue={(item) => item.count} />
          </Section>
          <Section title="LINE 友だち追加率" description="LINE 連携済み顧客のうち友だち追加済みの割合">
            <div className="flex items-baseline gap-3">
              <div className="text-4xl font-bold tabular-nums">{analytics.line_friend_rate}<span className="text-xl">%</span></div>
              {typeof analytics.line_friend_connected === 'number' && typeof analytics.line_linked_customers === 'number' && (
                <p className="text-sm text-muted-foreground tabular-nums">{analytics.line_friend_connected} / {analytics.line_linked_customers} 人</p>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">電話番号のみで登録された顧客は分母に含まれません</p>
          </Section>
        </div>
      </TabsContent>

      {/* 来店パターン: スマホでも 3 列 */}
      <TabsContent value="behavior" className="space-y-3 md:space-y-4 mt-3">
        <StatGrid cols={3}>
          <StatTile label="平均来店間隔" value={<>{analytics.avg_visit_interval_days}<span className="text-sm font-medium ml-0.5">日</span></>} />
          <StatTile label="リピート率" value={<>{analytics.repeat_rate}<span className="text-sm font-medium ml-0.5">%</span></>} />
          <StatTile label="リピーター数" value={<>{analytics.segment_distribution.repeat}<span className="text-sm font-medium ml-0.5">人</span></>} />
        </StatGrid>
        <p className="text-xs text-muted-foreground px-1">リピート率は 2 回以上来店した顧客の割合。平均来店間隔は来店履歴が 2 回以上ある顧客の平均です</p>
      </TabsContent>

      {/* 売上 */}
      <TabsContent value="revenue" className="space-y-3 md:space-y-4 mt-3">
        <div className="grid gap-3 md:gap-4 md:grid-cols-2">
          <Section title="顧客別売上ランキング" description="総利用金額の上位 10 名">
            {analytics.top_customers_by_revenue.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>
            ) : (
              <ol className="divide-y">
                {analytics.top_customers_by_revenue.map((customer, index) => {
                  const inner = (
                    <>
                      <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{customer.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{customer.total_visits}回来店</p>
                      </div>
                      <p className="font-bold tabular-nums shrink-0">{yen.format(customer.total_spent)}</p>
                      {onCustomerClick && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
                    </>
                  );
                  return (
                    <li key={customer.customer_id}>
                      {onCustomerClick ? (
                        <button type="button" onClick={() => onCustomerClick(customer.customer_id)} className="w-full min-h-12 flex items-center gap-3 py-2 text-left active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                          {inner}
                        </button>
                      ) : (
                        <div className="min-h-12 flex items-center gap-3 py-2">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
          <Section title="セグメント別平均単価" description="セグメントごとの平均利用金額">
            <BarChart
              data={analytics.segment_avg_spending}
              getLabel={(item) => `${segmentLabels[item.segment] || item.segment}（${item.customer_count}人）`}
              getValue={(item) => item.avg_spending}
              formatValue={(v) => yen.format(v)}
            />
          </Section>
        </div>
      </TabsContent>
    </Tabs>
  );
}
