import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { runDueAutomations } from '@/lib/broadcast-automation-service';

// Vercel の関数の上限（vercel.json = 30 秒）より手前で切り上げ、残りは次の回（1 時間後）に回す
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
 * POST /api/cron/broadcast-automations - 自動配信（ステップ配信）の毎時の判定
 * pg_cron（毎時 2 分）から呼ぶ。Authorization: Bearer <そのプロジェクトの Service Role Key>（cron の SQL に書くキーと同じ）
 * 実行時刻（店舗ごと。JST）を過ぎていて今日まだ判定していないルールだけを処理し、該当者がいれば配信を作って送信を始める
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  try {
    const startedAt = Date.now();
    const summary = await runDueAutomations(new Date(), new URL(request.url).origin, startedAt + TIME_BUDGET_MS);
    console.log(`[broadcast-automation] 判定=${summary.checked} 配信=${summary.created} 対象=${summary.recipients}人 見送り=${summary.skipped.length} 次回=${summary.deferred} (${Date.now() - startedAt}ms)`);
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] broadcast automations cron error:', error);
    return NextResponse.json({ error: '自動配信の実行に失敗しました' }, { status: 500 });
  }
}
