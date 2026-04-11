import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserRole } from '@/lib/auth-helper';
import { getAppEnvironment } from '@/lib/env';

/**
 * GET /api/auth/role
 * 現在認証済みユーザーのロールを返す
 */
export async function GET(request: NextRequest) {
  const env = getAppEnvironment();

  // ローカル環境ではマスター管理者として返す
  if (env === 'local') {
    return NextResponse.json({
      role: 'master',
      userId: 'local-user',
      email: 'local@example.com'
    });
  }

  const userRole = await getCurrentUserRole(request);

  if (!userRole) {
    return NextResponse.json({ error: '認証されていません' }, { status: 401 });
  }

  return NextResponse.json({
    role: userRole.role,
    userId: userRole.userId,
    email: userRole.email,
    orgId: userRole.orgId || null,
    orgSlug: userRole.orgSlug || null,
  });
}
