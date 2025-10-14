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

const ADMIN_EMAILS = [
  'wakuwakusystemsharing@gmail.com',
  'admin@wakuwakusystemsharing.com',
  'manager@wakuwakusystemsharing.com'
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ローカル開発環境では認証をスキップ
  if (isLocal()) {
    return NextResponse.next();
  }

  // /admin パスの保護（サービス管理者）
  const isServiceAdminRoute = pathname.startsWith('/admin');
  
  // 店舗管理画面のパターン: /st0001/admin, /st0001/forms/*, etc.
  const storeAdminPattern = /^\/st\d{4}\/(admin|forms|reservations)/;
  
  // API 保護パターン (公開 API は除外)
  // GET /api/stores は認証不要（店舗一覧取得）、POST は保護
  const protectedApiPattern = /^\/api\/(forms|reservations)/;
  const isProtectedApiStores = pathname.startsWith('/api/stores') && request.method !== 'GET';
  
  const isProtectedRoute = isServiceAdminRoute || storeAdminPattern.test(pathname) || protectedApiPattern.test(pathname) || isProtectedApiStores;
  
  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // /admin ルート自体では認証チェックをスキップ（ページ内でログイン画面表示）
  if (pathname === '/admin') {
    return NextResponse.next();
  }

  // アクセストークン取得
  const accessToken = request.cookies.get('sb-access-token')?.value;
  
  if (!accessToken) {
    // 未認証 → /admin にリダイレクト
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // 認証済みクライアント作成
  const supabase = createAuthenticatedClient(accessToken);
  
  if (!supabase) {
    // Supabase 接続エラー
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // ユーザー情報取得
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    // セッション無効 → /admin にリダイレクト
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // サービス管理者ルートの場合は管理者アカウント確認
  if (isServiceAdminRoute && !ADMIN_EMAILS.includes(user.email || '')) {
    return NextResponse.redirect(new URL('/admin', request.url));
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

export const config = {
  matcher: ['/admin/:path*', '/st:storeId*/(admin|forms|reservations)/:path*', '/api/(forms|stores|reservations)/:path*']
};
