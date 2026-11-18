import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { processWaitlist } from '@/lib/waitlist-service';

// Vercel の関数の上限（vercel.json = 30 秒）より手前で切り上げ、残りは次の回（10 分後）に回す
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
 * POST /api/cron/waitlist - 空き待ち（キャンセル待ち）の見回り
 * pg_cron（10 分おき）から呼ぶ。Authorization: Bearer <そのプロジェクトの Service Role Key>
 * 店舗が Google カレンダーの予定を直接消したときの空きもここで見つける。過ぎた空き待ちの終了もここで行う
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  try {
    const startedAt = Date.now();
    const summary = await processWaitlist({ deadlineMs: startedAt + TIME_BUDGET_MS });
    if (summary.checked > 0) {
      console.log(`[waitlist] 確認=${summary.checked} お知らせ=${summary.notified} おわび=${summary.apologized} 終了=${summary.expired} 失敗=${summary.failed} 次回=${summary.deferred} (${Date.now() - startedAt}ms)`);
    }
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] waitlist cron error:', error);
    return NextResponse.json({ error: '空き待ちの見回りに失敗しました' }, { status: 500 });
  }
}
