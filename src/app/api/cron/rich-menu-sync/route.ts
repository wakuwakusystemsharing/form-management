import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { runRichMenuSyncForAllStores } from '@/lib/line-rich-menu-service';

// Vercel の関数の上限（vercel.json = 30 秒）より手前で切り上げ、残りは次の回に回す
const TIME_BUDGET_MS = 22 * 1000;

function authorized(request: Request): boolean {
  if (getAppEnvironment() === 'local') return true;
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/cron/rich-menu-sync - リッチメニューの「お客様ごとの切り替え」の見直し
 * pg_cron（1 日 1 回）から呼ぶ。Authorization: Bearer <そのプロジェクトの Service Role Key>
 * 予約・顧客情報の変更のときにも見直すが、日がたつと変わる条件（最終来店から ◯ 日・誕生月など）と、
 * アンケートなどで付いたタグは、ここで拾う
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  try {
    const startedAt = Date.now();
    const summary = await runRichMenuSyncForAllStores(startedAt + TIME_BUDGET_MS);
    if (summary.stores > 0) {
      console.log(`[rich-menu] 店舗=${summary.done}/${summary.stores} 設定=${summary.linked} 解除=${summary.unlinked} 失敗=${summary.failed} 残り=${summary.deferred} (${Date.now() - startedAt}ms)`);
    }
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] rich-menu-sync cron error:', error);
    return NextResponse.json({ error: 'リッチメニューの見直しに失敗しました' }, { status: 500 });
  }
}
