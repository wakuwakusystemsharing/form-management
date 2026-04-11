import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helper';
import { getAppEnvironment } from '@/lib/env';
import { getSupabaseAdminClient, isMasterAdmin } from '@/lib/supabase';

/**
 * DELETE /api/master-admin/system-admins/[userId]
 * システム管理者を削除（マスター管理者のみ）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const env = getAppEnvironment();
  const { userId: targetUserId } = await params;

  if (env === 'local') {
    return NextResponse.json({ error: 'ローカル環境では利用できません' }, { status: 400 });
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '認証されていません' }, { status: 401 });
  }

  const isMaster = await isMasterAdmin(user.id);
  if (!isMaster) {
    return NextResponse.json({ error: 'マスター管理者権限が必要です' }, { status: 403 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'データベース接続エラー' }, { status: 500 });
  }

  // 削除対象がマスター管理者でないことを確認
  const { data: masterCheck } = await (supabase as any)
    .from('master_admins')
    .select('id')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (masterCheck) {
    return NextResponse.json({ error: 'マスター管理者はシステム管理者から削除できません' }, { status: 400 });
  }

  const { error } = await (supabase as any)
    .from('system_admins')
    .delete()
    .eq('user_id', targetUserId);

  if (error) {
    return NextResponse.json({ error: `削除に失敗しました: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
