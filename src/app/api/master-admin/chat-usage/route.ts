import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helper';
import { getAppEnvironment } from '@/lib/env';
import { isMasterAdmin } from '@/lib/supabase';
import { getChatUsageReport } from '@/lib/chat-service';
import { chatUsageCsv } from '@/lib/chat-events';

export const dynamic = 'force-dynamic';

/**
 * GET /api/master-admin/chat-usage?month=YYYY-MM&format=csv
 * 1 対 1 トークの、全店舗の利用状況（その月と前の月の 受信数・返信数・保存した画像の容量）。**マスター管理者だけ**
 * - month を省略すると今月（日本時間）
 * - format=csv で CSV（UTF-8 BOM つき）をダウンロード
 * 件数だけを返し、会話の中身・お客様の情報は返さない
 */
export async function GET(request: NextRequest) {
  try {
    if (getAppEnvironment() !== 'local') {
      const user = await getCurrentUser(request);
      if (!user) return NextResponse.json({ error: '認証されていません' }, { status: 401 });
      if (!(await isMasterAdmin(user.id))) return NextResponse.json({ error: 'マスター管理者権限が必要です' }, { status: 403 });
    }
    const url = new URL(request.url);
    const report = await getChatUsageReport(url.searchParams.get('month'));
    if (url.searchParams.get('format') === 'csv') {
      return new NextResponse(chatUsageCsv(report.month, report.rows), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="chat-usage-${report.month}.csv"`, 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] chat usage error:', error);
    return NextResponse.json({ error: 'トークの利用状況の取得に失敗しました' }, { status: 500 });
  }
}
