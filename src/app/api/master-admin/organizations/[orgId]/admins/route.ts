import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helper';
import { getAppEnvironment } from '@/lib/env';
import { getSupabaseAdminClient, isMasterAdmin } from '@/lib/supabase';

/**
 * GET /api/master-admin/organizations/[orgId]/admins
 * テナント内のシステム管理者一覧（マスター管理者のみ）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const env = getAppEnvironment();
  const { orgId } = await params;

  if (env === 'local') return NextResponse.json({ admins: [] });

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: '認証されていません' }, { status: 401 });
  if (!(await isMasterAdmin(user.id))) return NextResponse.json({ error: 'マスター管理者権限が必要です' }, { status: 403 });

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'データベース接続エラー' }, { status: 500 });

  const { data, error } = await (supabase as any)
    .from('system_admins')
    .select('id, user_id, email, name, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: '管理者の取得に失敗しました' }, { status: 500 });

  return NextResponse.json({ admins: data || [] });
}

/**
 * POST /api/master-admin/organizations/[orgId]/admins
 * テナントにシステム管理者を追加（マスター管理者のみ）
 * Body: { email: string, name?: string, password?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const env = getAppEnvironment();
  const { orgId } = await params;

  if (env === 'local') return NextResponse.json({ error: 'ローカル環境では利用できません' }, { status: 400 });

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: '認証されていません' }, { status: 401 });
  if (!(await isMasterAdmin(user.id))) return NextResponse.json({ error: 'マスター管理者権限が必要です' }, { status: 403 });

  const body = await request.json();
  const { email, name, password } = body;

  if (!email) return NextResponse.json({ error: 'メールアドレスは必須です' }, { status: 400 });

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'データベース接続エラー' }, { status: 500 });

  // テナントの存在確認
  const { data: org } = await (supabase as any)
    .from('organizations')
    .select('id')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: 'テナントが見つかりません' }, { status: 404 });

  // 既にこのテナントに登録されていないか確認
  const { data: existing } = await (supabase as any)
    .from('system_admins')
    .select('id')
    .eq('email', email)
    .eq('org_id', orgId)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: 'このメールアドレスは既にこのテナントに登録されています' }, { status: 409 });

  // Supabase Auth でユーザーを検索または作成
  let authUserId: string;
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find(u => u.email === email);

  if (existingUser) {
    authUserId = existingUser.id;
    // 既存ユーザーのパスワードを更新（指定された場合）
    if (password) {
      await supabase.auth.admin.updateUserById(authUserId, { password });
    }
  } else {
    const userPassword = password || Math.random().toString(36).slice(-12) + 'A1!';
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: userPassword,
      email_confirm: true,
    });
    if (createError || !newUser.user) {
      return NextResponse.json({ error: `ユーザーの作成に失敗しました: ${createError?.message}` }, { status: 500 });
    }
    authUserId = newUser.user.id;
  }

  // system_admins テーブルに追加
  const { data: admin, error: insertError } = await (supabase as any)
    .from('system_admins')
    .insert({
      user_id: authUserId,
      email,
      name: name || null,
      org_id: orgId,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: `管理者の登録に失敗しました: ${insertError.message}` }, { status: 500 });
  }

  return NextResponse.json({ admin }, { status: 201 });
}
