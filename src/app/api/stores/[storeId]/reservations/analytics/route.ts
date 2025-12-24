import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

/**
 * GET /api/stores/[storeId]/reservations/analytics
 * 予約データの分析結果を返す
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    const env = getAppEnvironment();
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 予約データを取得
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as any)
      .from('reservations')
      .select('*')
      .eq('store_id', storeId);

    if (dateFrom) {
      query = query.gte('reservation_date', dateFrom);
    }
    if (dateTo) {
      query = query.lte('reservation_date', dateTo);
    }

    const { data: reservations, error } = await query;

    if (error) {
      console.error('[API] Analytics fetch error:', error);
      return NextResponse.json(
        { error: '予約データの取得に失敗しました' },
        { status: 500 }
      );
    }

    if (!reservations || reservations.length === 0) {
      return NextResponse.json({
        daily_stats: [],
        monthly_stats: [],
        menu_popularity: [],
        time_slot_distribution: [],
        customer_demographics: {
          gender: {},
          visit_count: {},
          coupon_usage: {}
        },
        status_distribution: {},
        revenue_analysis: {
          total_revenue: 0,
          by_menu: [],
          by_month: []
        }
      });
    }

    // 日別集計
    const dailyStats: Record<string, { date: string; count: number }> = {};
    reservations.forEach((r: any) => {
      const date = r.reservation_date;
      if (!dailyStats[date]) {
        dailyStats[date] = { date, count: 0 };
      }
      dailyStats[date].count++;
    });
    const dailyStatsArray = Object.values(dailyStats).sort((a, b) => 
      a.date.localeCompare(b.date)
    );

    // 月別集計
    const monthlyStats: Record<string, { month: string; count: number }> = {};
    reservations.forEach((r: any) => {
      const date = new Date(r.reservation_date);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyStats[month]) {
        monthlyStats[month] = { month, count: 0 };
      }
      monthlyStats[month].count++;
    });
    const monthlyStatsArray = Object.values(monthlyStats).sort((a, b) => 
      a.month.localeCompare(b.month)
    );

    // メニュー別人気度
    const menuCounts: Record<string, { 
      menu_id: string; 
      menu_name: string; 
      category_name: string;
      count: number;
      revenue: number;
    }> = {};
    
    reservations.forEach((r: any) => {
      const selectedMenus = r.selected_menus || [];
      selectedMenus.forEach((menu: any) => {
        const key = menu.menu_id || menu.menu_name;
        if (!menuCounts[key]) {
          menuCounts[key] = {
            menu_id: menu.menu_id || '',
            menu_name: menu.menu_name || menu.menu_name || '不明',
            category_name: menu.category_name || '',
            count: 0,
            revenue: 0
          };
        }
        menuCounts[key].count++;
        menuCounts[key].revenue += menu.price || 0;
      });
    });
    const menuPopularity = Object.values(menuCounts)
      .sort((a, b) => b.count - a.count);

    // 時間帯別分布
    const timeSlotCounts: Record<string, number> = {};
    reservations.forEach((r: any) => {
      if (r.reservation_time) {
        const hour = r.reservation_time.split(':')[0];
        const timeSlot = `${hour}:00`;
        timeSlotCounts[timeSlot] = (timeSlotCounts[timeSlot] || 0) + 1;
      }
    });
    const timeSlotDistribution = Object.entries(timeSlotCounts)
      .map(([time, count]) => ({ time, count }))
      .sort((a, b) => a.time.localeCompare(b.time));

    // 顧客属性分析
    const genderCounts: Record<string, number> = {};
    const visitCountCounts: Record<string, number> = {};
    const couponCounts: Record<string, number> = {};
    
    reservations.forEach((r: any) => {
      const customerInfo = r.customer_info || {};
      
      if (customerInfo.gender) {
        genderCounts[customerInfo.gender] = (genderCounts[customerInfo.gender] || 0) + 1;
      }
      
      if (customerInfo.visit_count) {
        visitCountCounts[customerInfo.visit_count] = (visitCountCounts[customerInfo.visit_count] || 0) + 1;
      }
      
      if (customerInfo.coupon) {
        couponCounts[customerInfo.coupon] = (couponCounts[customerInfo.coupon] || 0) + 1;
      }
    });

    // ステータス別集計
    const statusCounts: Record<string, number> = {};
    reservations.forEach((r: any) => {
      const status = r.status || 'pending';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    // 売上分析
    let totalRevenue = 0;
    const revenueByMenu: Record<string, { menu_name: string; revenue: number }> = {};
    const revenueByMonth: Record<string, { month: string; revenue: number }> = {};
    
    reservations.forEach((r: any) => {
      const selectedMenus = r.selected_menus || [];
      const date = new Date(r.reservation_date);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      selectedMenus.forEach((menu: any) => {
        const price = menu.price || 0;
        totalRevenue += price;
        
        const menuKey = menu.menu_name || '不明';
        if (!revenueByMenu[menuKey]) {
          revenueByMenu[menuKey] = { menu_name: menuKey, revenue: 0 };
        }
        revenueByMenu[menuKey].revenue += price;
        
        if (!revenueByMonth[month]) {
          revenueByMonth[month] = { month, revenue: 0 };
        }
        revenueByMonth[month].revenue += price;
      });
    });

    return NextResponse.json({
      daily_stats: dailyStatsArray,
      monthly_stats: monthlyStatsArray,
      menu_popularity: menuPopularity,
      time_slot_distribution: timeSlotDistribution,
      customer_demographics: {
        gender: genderCounts,
        visit_count: visitCountCounts,
        coupon_usage: couponCounts
      },
      status_distribution: statusCounts,
      revenue_analysis: {
        total_revenue: totalRevenue,
        by_menu: Object.values(revenueByMenu).sort((a, b) => b.revenue - a.revenue),
        by_month: Object.values(revenueByMonth).sort((a, b) => a.month.localeCompare(b.month))
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

