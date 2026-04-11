import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helper';
import { getAppEnvironment } from '@/lib/env';
import { getSupabaseAdminClient, isMasterAdmin } from '@/lib/supabase';

/**
 * DELETE /api/master-admin/organizations/[orgId]
 * テナント削除（マスター管理者のみ）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const env = getAppEnvironment();
  const { orgId } = await params;

  if (env === 'local') return NextResponse.json({ error: 'ローカル環境では利用できません' }, { status: 400 });

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: '認証されていません' }, { status: 401 });
  if (!(await isMasterAdmin(user.id))) return NextResponse.json({ error: 'マスター管理者権限が必要です' }, { status: 403 });

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'データベース接続エラー' }, { status: 500 });

  // テナントに紐づく店舗があるか確認
  const { count } = await (supabase as any)
    .from('stores')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);

  if (count && count > 0) {
    return NextResponse.json({ error: 'このテナントには店舗が紐づいています。先に店舗を移動または削除してください。' }, { status: 400 });
  }

  const { error } = await (supabase as any)
    .from('organizations')
    .delete()
    .eq('id', orgId);

  if (error) return NextResponse.json({ error: `削除に失敗しました: ${error.message}` }, { status: 500 });

  return NextResponse.json({ success: true });
}
