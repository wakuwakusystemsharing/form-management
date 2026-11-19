import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { runDueDigests } from '@/lib/store-digest-service';

// Vercel の関数の上限（vercel.json = 30 秒）より手前で切り上げ、残りは次の回（1 時間後。設定時刻から 3 時間以内なら送る）に回す
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
 * POST /api/cron/store-digest - 朝の「今日の予約まとめ」・月次レポートの送信
 * pg_cron（毎時 0 分）から呼ぶ。Authorization: Bearer <そのプロジェクトの Service Role Key>
 * 送る時刻（店舗ごと。JST）を過ぎた店舗へ、今日ぶんのまとめと（毎月 1〜3 日は）前月のレポートを 1 回だけ送る
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  try {
    const startedAt = Date.now();
    const summary = await runDueDigests(new Date(), new URL(request.url).origin, startedAt + TIME_BUDGET_MS);
    if (summary.checked > 0 || summary.deferred > 0) {
      console.log(`[store-digest] 店舗=${summary.checked} 朝=${summary.morning} 月次=${summary.monthly} 見送り=${summary.skipped} 失敗=${summary.failed} 次回=${summary.deferred} (${Date.now() - startedAt}ms)`);
    }
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] store digest cron error:', error);
    return NextResponse.json({ error: 'まとめ・レポートの送信に失敗しました' }, { status: 500 });
  }
}
