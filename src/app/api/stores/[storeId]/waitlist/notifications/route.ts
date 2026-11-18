import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getAppEnvironment } from '@/lib/env';
import { jstMonthRange } from '@/lib/broadcast-quota';
import { fetchLineQuota } from '@/lib/broadcast-automation-service';
import { countWaitlistNotifications, listWaitlistNotifications } from '@/lib/waitlist-repository';

// GET /api/stores/{storeId}/waitlist/notifications - 空き待ちの通知の送信履歴（新しい順に最大 100 件）と、今月の送信数
//   month = 空き待ちのお知らせ・おわびで今月送った数 / line_quota = 公式 LINE 全体の今月の送信数と上限（取得できなければ null）
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const range = jstMonthRange(new Date());
    const [notifications, month, lineQuota] = await Promise.all([
      listWaitlistNotifications(storeId),
      countWaitlistNotifications(storeId, range.start, range.end),
      getAppEnvironment() === 'local' ? Promise.resolve(null) : fetchLineQuota(storeId).catch(() => null),
    ]);
    return NextResponse.json(
      {
        notifications: notifications.map((n) => ({
          id: n.id,
          type: n.type,
          result: n.result,
          error_message: n.error_message,
          sent_at: n.sent_at,
          customer_name: n.customer_name,
          reservation_date: n.reservation_date,
          reservation_time: n.reservation_time,
        })),
        month: { key: range.key, ...month },
        line_quota: lineQuota,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[API] waitlist notifications error:', error);
    return NextResponse.json({ error: '送信履歴の取得に失敗しました' }, { status: 500 });
  }
}
