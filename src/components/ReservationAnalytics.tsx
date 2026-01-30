'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

interface AnalyticsData {
  daily_stats: Array<{ date: string; count: number }>;
  monthly_stats: Array<{ month: string; count: number }>;
  menu_popularity: Array<{
    menu_id: string;
    menu_name: string;
    category_name: string;
    count: number;
    revenue: number;
  }>;
  time_slot_distribution: Array<{ time: string; count: number }>;
  customer_demographics: {
    gender: Record<string, number>;
    visit_count: Record<string, number>;
    coupon_usage: Record<string, number>;
  };
  status_distribution: Record<string, number>;
  revenue_analysis: {
    total_revenue: number;
    by_menu: Array<{ menu_name: string; revenue: number }>;
    by_month: Array<{ month: string; revenue: number }>;
  };
}

interface ReservationAnalyticsProps {
  storeId: string;
  dateFrom?: string;
  dateTo?: string;
}

export default function ReservationAnalytics({ 
  storeId, 
  dateFrom, 
  dateTo 
}: ReservationAnalyticsProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'menus' | 'time' | 'customers' | 'revenue'>('overview');

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);

      const response = await fetch(`/api/stores/${storeId}/reservations/analytics?${params.toString()}`);
      if (response.ok) {
        const analyticsData = await response.json();
        setData(analyticsData);
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  }, [storeId, dateFrom, dateTo]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    return `${year}年${parseInt(month)}月`;
  };

  const BarChart = ({ 
    data, 
    getLabel, 
    getValue, 
    maxValue 
  }: { 
    data: any[]; 
    getLabel: (item: any) => string; 
    getValue: (item: any) => number;
    maxValue?: number;
  }) => {
    const max = maxValue || Math.max(...data.map(getValue), 1);
    
    return (
      <div className="space-y-2">
        {data.map((item, index) => {
          const value = getValue(item);
          const percentage = max > 0 ? (value / max) * 100 : 0;
          
          return (
            <div key={index} className="flex items-center gap-3">
              <div className="w-32 text-sm text-muted-foreground truncate">
                {getLabel(item)}
              </div>
              <div className="flex-1">
                <div className="h-6 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
              <div className="w-16 text-right text-sm font-medium">
                {value}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted-foreground">分析データを読み込み中...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            分析データの取得に失敗しました
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">概要</TabsTrigger>
          <TabsTrigger value="menus">メニュー分析</TabsTrigger>
          <TabsTrigger value="time">時間帯分析</TabsTrigger>
          <TabsTrigger value="customers">顧客属性</TabsTrigger>
          <TabsTrigger value="revenue">売上分析</TabsTrigger>
        </TabsList>

        {/* 概要タブ */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 日別集計 */}
            <Card>
              <CardHeader>
                <CardTitle>日別予約数</CardTitle>
              </CardHeader>
              <CardContent>
                {data.daily_stats.length > 0 ? (
                  <BarChart
                    data={data.daily_stats.slice(-14)} // 直近14日
                    getLabel={(item) => formatDate(item.date)}
                    getValue={(item) => item.count}
                  />
                ) : (
                  <p className="text-muted-foreground text-center py-4">データがありません</p>
                )}
              </CardContent>
            </Card>

            {/* 月別集計 */}
            <Card>
              <CardHeader>
                <CardTitle>月別予約数</CardTitle>
              </CardHeader>
              <CardContent>
                {data.monthly_stats.length > 0 ? (
                  <BarChart
                    data={data.monthly_stats}
                    getLabel={(item) => formatMonth(item.month)}
                    getValue={(item) => item.count}
                  />
                ) : (
                  <p className="text-muted-foreground text-center py-4">データがありません</p>
                )}
              </CardContent>
            </Card>

            {/* ステータス別集計 */}
            <Card>
              <CardHeader>
                <CardTitle>ステータス別集計</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(data.status_distribution).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(data.status_distribution).map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between">
                        <span className="text-sm">
                          {status === 'pending' ? '保留中' : 
                           status === 'confirmed' ? '確認済み' :
                           status === 'cancelled' ? 'キャンセル' :
                           status === 'completed' ? '完了' : status}
                        </span>
                        <Badge variant="secondary">{count as number}件</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">データがありません</p>
                )}
              </CardContent>
            </Card>

            {/* 総売上 */}
            <Card>
              <CardHeader>
                <CardTitle>総売上</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-primary">
                  {formatCurrency(data.revenue_analysis.total_revenue)}
                </div>
                <p className="text-muted-foreground text-sm mt-2">
                  {data.revenue_analysis.by_menu.length}種類のメニュー
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* メニュー分析タブ */}
        <TabsContent value="menus" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>メニュー別人気度（予約数）</CardTitle>
            </CardHeader>
            <CardContent>
              {data.menu_popularity.length > 0 ? (
                <BarChart
                  data={data.menu_popularity.slice(0, 10)} // トップ10
                  getLabel={(item) => `${item.category_name ? item.category_name + ' > ' : ''}${item.menu_name}`}
                  getValue={(item) => item.count}
                />
              ) : (
                <p className="text-muted-foreground text-center py-4">データがありません</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>メニュー別売上</CardTitle>
            </CardHeader>
            <CardContent>
              {data.revenue_analysis.by_menu.length > 0 ? (
                <div className="space-y-3">
                  {data.revenue_analysis.by_menu.slice(0, 10).map((item, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-sm">{item.menu_name}</span>
                      <span className="font-semibold text-primary">
                        {formatCurrency(item.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4">データがありません</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 時間帯分析タブ */}
        <TabsContent value="time" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>時間帯別予約分布</CardTitle>
            </CardHeader>
            <CardContent>
              {data.time_slot_distribution.length > 0 ? (
                <BarChart
                  data={data.time_slot_distribution}
                  getLabel={(item) => item.time}
                  getValue={(item) => item.count}
                />
              ) : (
                <p className="text-muted-foreground text-center py-4">データがありません</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 顧客属性タブ */}
        <TabsContent value="customers" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>性別分布</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(data.customer_demographics.gender).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(data.customer_demographics.gender).map(([gender, count]) => (
                      <div key={gender} className="flex items-center justify-between">
                        <span className="text-sm">
                          {gender === 'male' ? '男性' : gender === 'female' ? '女性' : gender}
                        </span>
                        <Badge variant="secondary">{count as number}人</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">データがありません</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>来店回数</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(data.customer_demographics.visit_count).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(data.customer_demographics.visit_count).map(([visitCount, count]) => (
                      <div key={visitCount} className="flex items-center justify-between">
                        <span className="text-sm">
                          {visitCount === 'first' ? '初回' : visitCount === 'repeat' ? '2回目以降' : visitCount}
                        </span>
                        <Badge variant="secondary">{count as number}人</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">データがありません</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>クーポン利用</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(data.customer_demographics.coupon_usage).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(data.customer_demographics.coupon_usage).map(([coupon, count]) => (
                      <div key={coupon} className="flex items-center justify-between">
                        <span className="text-sm">
                          {coupon === 'use' ? '利用する' : coupon === 'not_use' ? '利用しない' : coupon}
                        </span>
                        <Badge variant="secondary">{count as number}人</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">データがありません</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 売上分析タブ */}
        <TabsContent value="revenue" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>総売上</CardTitle>
                <div className="text-3xl font-bold text-primary">
                  {formatCurrency(data.revenue_analysis.total_revenue)}
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>月別売上</CardTitle>
            </CardHeader>
            <CardContent>
              {data.revenue_analysis.by_month.length > 0 ? (
                <BarChart
                  data={data.revenue_analysis.by_month}
                  getLabel={(item) => formatMonth(item.month)}
                  getValue={(item) => item.revenue}
                />
              ) : (
                <p className="text-muted-foreground text-center py-4">データがありません</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>メニュー別売上（トップ10）</CardTitle>
            </CardHeader>
            <CardContent>
              {data.revenue_analysis.by_menu.length > 0 ? (
                <div className="space-y-3">
                  {data.revenue_analysis.by_menu.slice(0, 10).map((item, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-sm">{item.menu_name}</span>
                      <span className="font-semibold text-primary">
                        {formatCurrency(item.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4">データがありません</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
