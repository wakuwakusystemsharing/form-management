import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helper';
import { getAppEnvironment } from '@/lib/env';
import { getSupabaseAdminClient, isMasterAdmin } from '@/lib/supabase';

/**
 * GET /api/master-admin/system-admins
 * システム管理者一覧を取得（マスター管理者のみ）
 */
export async function GET(request: NextRequest) {
  const env = getAppEnvironment();

  if (env === 'local') {
    return NextResponse.json({ systemAdmins: [] });
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

  const { data, error } = await (supabase as any)
    .from('system_admins')
    .select('id, user_id, email, name, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'システム管理者の取得に失敗しました' }, { status: 500 });
  }

  // 各システム管理者の店舗数を取得
  const systemAdmins = await Promise.all(
    (data || []).map(async (admin: any) => {
      const { count } = await (supabase as any)
        .from('stores')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', admin.user_id);
      return { ...admin, store_count: count || 0 };
    })
  );

  return NextResponse.json({ systemAdmins });
}

/**
 * POST /api/master-admin/system-admins
 * システム管理者を追加（マスター管理者のみ）
 * Body: { email: string, name?: string, password?: string }
 */
export async function POST(request: NextRequest) {
  const env = getAppEnvironment();

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

  const body = await request.json();
  const { email, name, password } = body;

  if (!email) {
    return NextResponse.json({ error: 'メールアドレスは必須です' }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'データベース接続エラー' }, { status: 500 });
  }

  // 既にシステム管理者として登録されていないか確認
  const { data: existing } = await (supabase as any)
    .from('system_admins')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'このメールアドレスは既にシステム管理者として登録されています' }, { status: 409 });
  }

  // Supabase Auth でユーザーを検索または作成
  let authUserId: string;

  // 既存ユーザーを検索
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find(u => u.email === email);

  if (existingUser) {
    authUserId = existingUser.id;
  } else {
    // 新規ユーザー作成
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
  const { data: systemAdmin, error: insertError } = await (supabase as any)
    .from('system_admins')
    .insert({
      user_id: authUserId,
      email,
      name: name || null,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: `システム管理者の登録に失敗しました: ${insertError.message}` }, { status: 500 });
  }

  return NextResponse.json({ systemAdmin }, { status: 201 });
}
