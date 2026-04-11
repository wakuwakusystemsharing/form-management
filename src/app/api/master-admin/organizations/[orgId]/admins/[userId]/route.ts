import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helper';
import { getAppEnvironment } from '@/lib/env';
import { getSupabaseAdminClient, isMasterAdmin } from '@/lib/supabase';

/**
 * DELETE /api/master-admin/organizations/[orgId]/admins/[userId]
 * テナントからシステム管理者を削除（マスター管理者のみ）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> }
) {
  const env = getAppEnvironment();
  const { orgId, userId: targetUserId } = await params;

  if (env === 'local') return NextResponse.json({ error: 'ローカル環境では利用できません' }, { status: 400 });

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: '認証されていません' }, { status: 401 });
  if (!(await isMasterAdmin(user.id))) return NextResponse.json({ error: 'マスター管理者権限が必要です' }, { status: 403 });

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'データベース接続エラー' }, { status: 500 });

  const { error } = await (supabase as any)
    .from('system_admins')
    .delete()
    .eq('user_id', targetUserId)
    .eq('org_id', orgId);

  if (error) return NextResponse.json({ error: `削除に失敗しました: ${error.message}` }, { status: 500 });

  return NextResponse.json({ success: true });
}
