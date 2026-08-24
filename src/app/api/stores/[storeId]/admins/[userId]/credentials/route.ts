import { NextResponse } from 'next/server';
import { getSupabaseAdminClient, isServiceAdmin } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import { getCurrentUser } from '@/lib/auth-helper';

// GET /api/stores/[storeId]/admins/[userId]/credentials - ログイン情報確認（サービス管理者のみ）
// パスワードはこの管理画面で設定・変更されたもののみ返せる（Supabase Auth はハッシュ保存のため復元不可）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string; userId: string }> }
) {
  try {
    const { storeId, userId } = await params;

    const env = getAppEnvironment();
    if (env === 'local') {
      // ローカル環境は Supabase Auth を使わないため確認対象なし
      return NextResponse.json({ email: null, password: null });
    }

    // 認証・認可チェック（PATCH と同じ: サービス管理者のみ）
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    if (!currentUser.email || !isServiceAdmin(currentUser.email)) {
      return NextResponse.json(
        { error: 'この操作はサービス管理者のみ実行できます' },
        { status: 403 }
      );
    }

    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    // storeId に対する userId の所有権確認
    const { data: adminRecord, error: adminCheckError } = await adminClient
      .from('store_admins')
      .select('id')
      .eq('user_id', userId)
      .eq('store_id', storeId)
      .single();

    if (adminCheckError || !adminRecord) {
      return NextResponse.json(
        { error: '指定された店舗管理者が見つかりません' },
        { status: 404 }
      );
    }

    // メールアドレス
    const { data: userData } = await adminClient.auth.admin.getUserById(userId);
    const email = userData?.user?.email || null;

    // 保存済みパスワード（未保存 = このシステムで設定されていない → null）
    let password: string | null = null;
    try {
      const { data: cred } = await adminClient
        .from('admin_login_credentials')
        .select('password')
        .eq('user_id', userId)
        .maybeSingle();
      password = (cred as { password?: string } | null)?.password || null;
    } catch (credError) {
      console.error('[API] admin_login_credentials fetch error:', credError);
    }

    return NextResponse.json({ email, password });
  } catch (error) {
    console.error('Store Admin credentials fetch error:', error);
    return NextResponse.json(
      { error: '内部サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
