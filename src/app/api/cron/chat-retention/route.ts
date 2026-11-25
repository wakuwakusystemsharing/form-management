import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { runChatRetention } from '@/lib/chat-service';

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
 * POST /api/cron/chat-retention - 1 対 1 トークの、保存期間を過ぎた会話の自動削除
 * pg_cron（1 日 1 回）から呼ぶ。Authorization: Bearer <そのプロジェクトの Service Role Key>
 * 店舗ごとの保存期間（1 / 2 / 3 年）を過ぎたメッセージを、古い順に 1 回 5000 通まで消す（残りは次の日）
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  try {
    return NextResponse.json(await runChatRetention(new Date()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] chat-retention cron error:', error);
    return NextResponse.json({ error: '会話の自動削除に失敗しました' }, { status: 500 });
  }
}
