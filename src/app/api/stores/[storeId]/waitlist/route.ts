import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { listWaitlistForStore } from '@/lib/waitlist-repository';
import { WAITLIST_ACTIVE_STATUSES, waitlistMenuText } from '@/lib/waitlist';

// GET /api/stores/{storeId}/waitlist?scope=active|all - 空き待ちの一覧（管理画面用。新しい登録順に最大 200 件）
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const scope = new URL(request.url).searchParams.get('scope');
    const entries = await listWaitlistForStore(storeId, scope === 'all' ? {} : { statuses: WAITLIST_ACTIVE_STATUSES });
    return NextResponse.json(
      {
        entries: entries.map((e) => ({
          id: e.id,
          form_id: e.form_id,
          customer_id: e.customer_id,
          customer_name: e.customer_name,
          reservation_date: e.reservation_date,
          reservation_time: e.reservation_time,
          menu_text: waitlistMenuText(e),
          staff_name: e.staff_name,
          status: e.status,
          notified_at: e.notified_at,
          notify_count: e.notify_count,
          created_at: e.created_at,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[API] waitlist list error:', error);
    return NextResponse.json(
      { error: '空き待ちの取得に失敗しました', details: 'データベースの更新（空き待ち機能のマイグレーション）が済んでいない可能性があります' },
      { status: 500 }
    );
  }
}
