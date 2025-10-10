/**
 * 認証ミドルウェア
 * 
 * 保護対象ルート:
 * - /{storeId}/admin - 店舗管理者ダッシュボード
 * - /{storeId}/forms/* - フォーム編集画面
 * - /{storeId}/reservations - 予約一覧
 * - /api/* - API ルート (一部除外あり)
 * 
 * 認証フロー:
 * 1. 未認証ユーザーが保護されたルートにアクセス
 * 2. /login?redirect={元のURL} にリダイレクト
 * 3. ログイン成功後、元のURLに戻る
 * 4. store_id を確認してアクセス権限を検証
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isLocal } from './lib/env';
import { createAuthenticatedClient, checkStoreAccess } from './lib/supabase';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ローカル開発環境では認証をスキップ
  if (isLocal()) {
    return NextResponse.next();
  }

  // 店舗管理画面のパターン: /st0001/admin, /st0001/forms/*, etc.
  const storeAdminPattern = /^\/st\d{4}\/(admin|forms|reservations)/;
  // API 保護パターン (公開 API は除外)
  const protectedApiPattern = /^\/api\/(forms|stores|reservations)/;
  
  const isProtectedRoute = storeAdminPattern.test(pathname) || protectedApiPattern.test(pathname);
  
  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // アクセストークン取得
  const accessToken = request.cookies.get('sb-access-token')?.value;
  
  if (!accessToken) {
    // 未認証 → ログインページへリダイレクト
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 認証済みクライアント作成
  const supabase = createAuthenticatedClient(accessToken);
  
  if (!supabase) {
    // Supabase 接続エラー
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // ユーザー情報取得
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    // セッション無効 → ログインページへ
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 店舗 ID 抽出
  const storeIdMatch = pathname.match(/\/st(\d{4})/);
  const storeId = storeIdMatch ? `st${storeIdMatch[1]}` : null;
  
  if (storeId) {
    // 店舗アクセス権限チェック
    const hasAccess = await checkStoreAccess(user.id, storeId);
    
    if (!hasAccess) {
      // アクセス権限なし → 403
      return new NextResponse(
        JSON.stringify({ error: 'この店舗へのアクセス権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  return NextResponse.next();
}

// ミドルウェアを適用するパス
export const config = {
  matcher: [
    /*
     * 以下のパスを除く全てのパスにマッチ:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public フォルダ内のファイル
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
