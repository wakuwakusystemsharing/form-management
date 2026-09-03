import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUserRole } from '@/lib/auth-helper';
import { listFormAuditLogs, FormAuditFormType } from '@/lib/form-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/stores/[storeId]/forms/[formId]/history?type=reservation|survey|lottery
// フォームの操作履歴（監査ログ）。テナントのシステム管理者 / マスター管理者のみ閲覧可。
// 店舗管理者は 403（店舗側には履歴を見せない）。
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string; formId: string }> }
) {
  try {
    const { storeId, formId } = await params;
    const url = new URL(request.url);
    const typeParam = url.searchParams.get('type');
    const formType: FormAuditFormType = typeParam === 'survey' ? 'survey' : typeParam === 'lottery' ? 'lottery' : 'reservation';

    const env = getAppEnvironment();
    if (env !== 'local') {
      const roleInfo = await getCurrentUserRole(request);
      if (!roleInfo) {
        return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
      }
      if (roleInfo.role !== 'master' && roleInfo.role !== 'system') {
        return NextResponse.json({ error: '操作履歴は管理者のみ閲覧できます' }, { status: 403 });
      }
      if (roleInfo.role === 'system') {
        // システム管理者は自テナントの店舗のみ
        const token =
          request.headers.get('cookie')
            ?.split(';')
            .find((c) => c.trim().startsWith('sb-access-token='))
            ?.trim()
            .substring('sb-access-token='.length) ||
          request.headers.get('authorization')?.replace('Bearer ', '');
        const authClient = token ? createAuthenticatedClient(token) : null;
        if (!authClient) {
          return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
        }
        const hasAccess = await checkStoreAccess(roleInfo.userId, storeId, roleInfo.email, authClient);
        if (!hasAccess) {
          return NextResponse.json({ error: 'この店舗へのアクセス権限がありません' }, { status: 403 });
        }
      }
    }

    const logs = await listFormAuditLogs(storeId, formId, formType, 200);
    return NextResponse.json({ logs });
  } catch (error) {
    console.error('[API] form history error:', error);
    return NextResponse.json({ error: '操作履歴の取得に失敗しました' }, { status: 500 });
  }
}
