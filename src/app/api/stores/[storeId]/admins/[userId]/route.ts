import { NextResponse } from 'next/server';
import { getSupabaseAdminClient, isServiceAdmin } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import { getCurrentUser } from '@/lib/auth-helper';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

// DELETE /api/stores/[storeId]/admins/[userId] - 店舗管理者削除
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ storeId: string; userId: string }> }
) {
  try {
    const { storeId, userId } = await params;

    const env = getAppEnvironment();
    
    // ローカル環境: JSON から削除
    if (env === 'local') {
      const adminsPath = path.join(DATA_DIR, `store_admins_${storeId}.json`);
      
      if (!fs.existsSync(adminsPath)) {
        return NextResponse.json(
          { error: '店舗管理者が見つかりません' },
          { status: 404 }
        );
      }
      
      const data = fs.readFileSync(adminsPath, 'utf-8');
      const admins = JSON.parse(data);
      
      const filteredAdmins = admins.filter((a: any) => a.user_id !== userId);
      
      if (filteredAdmins.length === admins.length) {
        return NextResponse.json(
          { error: '店舗管理者が見つかりません' },
          { status: 404 }
        );
      }
      
      fs.writeFileSync(adminsPath, JSON.stringify(filteredAdmins, null, 2));
      
      return NextResponse.json({ success: true });
    }

    // staging/production: Supabase から削除
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 店舗管理者を削除
    const { error: deleteError } = await adminClient
      .from('store_admins')
      .delete()
      .eq('user_id', userId)
      .eq('store_id', storeId);

    if (deleteError) {
      console.error('[API] Store Admin delete error:', deleteError);
      return NextResponse.json(
        { error: '店舗管理者の削除に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Store Admin delete error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/stores/[storeId]/admins/[userId] - ユーザー情報更新
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ storeId: string; userId: string }> }
) {
  try {
    const { storeId, userId } = await params;
    const body = await request.json();
    const { email, password } = body;

    // email と password が両方省略の場合はエラー
    if (!email && !password) {
      return NextResponse.json(
        { error: '更新する項目（メールアドレスまたはパスワード）を指定してください' },
        { status: 400 }
      );
    }

    // パスワードが指定されている場合は6文字以上チェック
    if (password && password.length < 6) {
      return NextResponse.json(
        { error: 'パスワードは6文字以上で入力してください' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();

    // ローカル環境: JSON ファイルのメールアドレスのみ更新
    if (env === 'local') {
      const adminsPath = path.join(DATA_DIR, `store_admins_${storeId}.json`);

      if (!fs.existsSync(adminsPath)) {
        return NextResponse.json(
          { error: '店舗管理者が見つかりません' },
          { status: 404 }
        );
      }

      const data = fs.readFileSync(adminsPath, 'utf-8');
      const admins = JSON.parse(data) as Array<{ user_id: string; email?: string }>;
      const adminIndex = admins.findIndex(a => a.user_id === userId);

      if (adminIndex === -1) {
        return NextResponse.json(
          { error: '店舗管理者が見つかりません' },
          { status: 404 }
        );
      }

      if (email) {
        admins[adminIndex].email = email;
      }
      // パスワード変更はローカル環境ではスキップ

      fs.writeFileSync(adminsPath, JSON.stringify(admins, null, 2));
      return NextResponse.json({ success: true, email: admins[adminIndex].email });
    }

    // staging/production: 認証・認可チェック（ファイル冒頭で静的 import 済み）
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    if (!currentUser.email || !isServiceAdmin(currentUser.email)) {
      return NextResponse.json(
        { error: 'この操作はサービス管理者のみ実行できます' },
        { status: 403 }
      );
    }

    // Supabase Admin API でユーザー情報を更新
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
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

    const updatePayload: { email?: string; password?: string } = {};
    if (email) updatePayload.email = email;
    if (password) updatePayload.password = password;

    const { data: updatedUser, error: updateError } = await adminClient.auth.admin.updateUserById(
      userId,
      updatePayload
    );

    if (updateError) {
      console.error('[API] User update error:', updateError);
      // メール重複エラーの判定
      if (updateError.message?.includes('already been registered') || updateError.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'このメールアドレスは既に使用されています' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: `ユーザー情報の更新に失敗しました: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      email: updatedUser.user?.email,
    });
  } catch (error) {
    console.error('Store Admin update error:', error);
    return NextResponse.json(
      { error: '内部サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
