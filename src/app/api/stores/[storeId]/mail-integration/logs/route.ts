// 外部予約メール連携: 受信ログの取得
// Gmail の転送確認メールと解析失敗メールは本文（抜粋）も返し、管理画面で確認できるようにする

import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorizeStoreAccess(
  request: Request,
  storeId: string
): Promise<NextResponse | null> {
  const env = getAppEnvironment();
  if (env === 'local') return null;

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const token =
    request.headers.get('cookie')
      ?.split(';')
      .find((c) => c.trim().startsWith('sb-access-token='))
      ?.trim()
      .substring('sb-access-token='.length) ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const authClient = createAuthenticatedClient(token);
  if (!authClient) {
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
  }

  const hasAccess = await checkStoreAccess(user.id, storeId, user.email, authClient);
  if (!hasAccess) {
    return NextResponse.json({ error: 'この店舗へのアクセス権限がありません' }, { status: 403 });
  }

  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();
    if (env === 'local') {
      return NextResponse.json({ logs: [] });
    }

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    const { data: logs, error } = await (adminClient as any)
      .from('external_reservations')
      .select('id,source,status,reservation_number,reservation_date,reservation_time,duration_minutes,customer_name,mail_subject,mail_from,raw_body,error_message,created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('[mail-integration/logs] error:', error);
      return NextResponse.json({ error: '受信ログの取得に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({
      logs: (logs || []).map((log: any) => ({
        id: log.id,
        source: log.source,
        status: log.status,
        reservation_number: log.reservation_number,
        reservation_date: log.reservation_date,
        reservation_time: log.reservation_time,
        duration_minutes: log.duration_minutes,
        customer_name: log.customer_name,
        mail_subject: log.mail_subject,
        mail_from: log.mail_from,
        error_message: log.error_message,
        created_at: log.created_at,
        // 本文はGmail転送確認・解析失敗・不明メールのみ返す（確認リンクの表示 / 原因調査用）
        raw_body: ['gmail_forwarding', 'parse_failed', 'unknown'].includes(log.status) || log.source === 'gmail_forwarding'
          ? (log.raw_body || '').slice(0, 3000)
          : null,
      })),
    });
  } catch (error) {
    console.error('[mail-integration/logs] GET error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
