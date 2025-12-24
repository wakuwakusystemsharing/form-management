'use client';

import { useState, useEffect } from 'react';

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

  useEffect(() => {
    fetchAnalytics();
  }, [storeId, dateFrom, dateTo]);

  const fetchAnalytics = async () => {
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
  };

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
              <div className="w-32 text-sm text-gray-300 truncate">
                {getLabel(item)}
              </div>
              <div className="flex-1">
                <div className="h-6 bg-gray-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
              <div className="w-16 text-right text-sm font-medium text-gray-200">
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
      <div className="text-center py-12 text-gray-400">
        分析データを読み込み中...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-400">
        分析データの取得に失敗しました
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* タブ */}
      <div className="border-b border-gray-700">
        <nav className="flex space-x-8">
          {[
            { id: 'overview', label: '概要' },
            { id: 'menus', label: 'メニュー分析' },
            { id: 'time', label: '時間帯分析' },
            { id: 'customers', label: '顧客属性' },
            { id: 'revenue', label: '売上分析' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 概要タブ */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 日別集計 */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">日別予約数</h3>
            {data.daily_stats.length > 0 ? (
              <BarChart
                data={data.daily_stats.slice(-14)} // 直近14日
                getLabel={(item) => formatDate(item.date)}
                getValue={(item) => item.count}
              />
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>

          {/* 月別集計 */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">月別予約数</h3>
            {data.monthly_stats.length > 0 ? (
              <BarChart
                data={data.monthly_stats}
                getLabel={(item) => formatMonth(item.month)}
                getValue={(item) => item.count}
              />
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>

          {/* ステータス別集計 */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">ステータス別集計</h3>
            {Object.keys(data.status_distribution).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(data.status_distribution).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <span className="text-gray-300 capitalize">
                      {status === 'pending' ? '保留中' : 
                       status === 'confirmed' ? '確認済み' :
                       status === 'cancelled' ? 'キャンセル' :
                       status === 'completed' ? '完了' : status}
                    </span>
                    <span className="text-cyan-400 font-semibold">{count as number}件</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>

          {/* 総売上 */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">総売上</h3>
            <div className="text-3xl font-bold text-cyan-400">
              {formatCurrency(data.revenue_analysis.total_revenue)}
            </div>
            <p className="text-gray-400 text-sm mt-2">
              {data.revenue_analysis.by_menu.length}種類のメニュー
            </p>
          </div>
        </div>
      )}

      {/* メニュー分析タブ */}
      {activeTab === 'menus' && (
        <div className="space-y-6">
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">メニュー別人気度（予約数）</h3>
            {data.menu_popularity.length > 0 ? (
              <BarChart
                data={data.menu_popularity.slice(0, 10)} // トップ10
                getLabel={(item) => `${item.category_name ? item.category_name + ' > ' : ''}${item.menu_name}`}
                getValue={(item) => item.count}
              />
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">メニュー別売上</h3>
            {data.revenue_analysis.by_menu.length > 0 ? (
              <div className="space-y-3">
                {data.revenue_analysis.by_menu.slice(0, 10).map((item, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-gray-300">{item.menu_name}</span>
                    <span className="text-cyan-400 font-semibold">
                      {formatCurrency(item.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>
        </div>
      )}

      {/* 時間帯分析タブ */}
      {activeTab === 'time' && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">時間帯別予約分布</h3>
          {data.time_slot_distribution.length > 0 ? (
            <BarChart
              data={data.time_slot_distribution}
              getLabel={(item) => item.time}
              getValue={(item) => item.count}
            />
          ) : (
            <p className="text-gray-400 text-center py-4">データがありません</p>
          )}
        </div>
      )}

      {/* 顧客属性タブ */}
      {activeTab === 'customers' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">性別分布</h3>
            {Object.keys(data.customer_demographics.gender).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(data.customer_demographics.gender).map(([gender, count]) => (
                  <div key={gender} className="flex items-center justify-between">
                    <span className="text-gray-300">
                      {gender === 'male' ? '男性' : gender === 'female' ? '女性' : gender}
                    </span>
                    <span className="text-cyan-400 font-semibold">{count as number}人</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">来店回数</h3>
            {Object.keys(data.customer_demographics.visit_count).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(data.customer_demographics.visit_count).map(([visitCount, count]) => (
                  <div key={visitCount} className="flex items-center justify-between">
                    <span className="text-gray-300">
                      {visitCount === 'first' ? '初回' : visitCount === 'repeat' ? '2回目以降' : visitCount}
                    </span>
                    <span className="text-cyan-400 font-semibold">{count as number}人</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">クーポン利用</h3>
            {Object.keys(data.customer_demographics.coupon_usage).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(data.customer_demographics.coupon_usage).map(([coupon, count]) => (
                  <div key={coupon} className="flex items-center justify-between">
                    <span className="text-gray-300">
                      {coupon === 'use' ? '利用する' : coupon === 'not_use' ? '利用しない' : coupon}
                    </span>
                    <span className="text-cyan-400 font-semibold">{count as number}人</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>
        </div>
      )}

      {/* 売上分析タブ */}
      {activeTab === 'revenue' && (
        <div className="space-y-6">
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">総売上</h3>
              <div className="text-3xl font-bold text-cyan-400">
                {formatCurrency(data.revenue_analysis.total_revenue)}
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">月別売上</h3>
            {data.revenue_analysis.by_month.length > 0 ? (
              <BarChart
                data={data.revenue_analysis.by_month}
                getLabel={(item) => formatMonth(item.month)}
                getValue={(item) => item.revenue}
              />
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">メニュー別売上（トップ10）</h3>
            {data.revenue_analysis.by_menu.length > 0 ? (
              <div className="space-y-3">
                {data.revenue_analysis.by_menu.slice(0, 10).map((item, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-gray-300">{item.menu_name}</span>
                    <span className="text-cyan-400 font-semibold">
                      {formatCurrency(item.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">データがありません</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

