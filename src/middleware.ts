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
import { shouldSkipAuth } from './lib/env';
import { createAuthenticatedClient, checkStoreAccess } from './lib/supabase';

const ADMIN_EMAILS = [
  'wakuwakusystemsharing@gmail.com',
  'admin@wakuwakusystemsharing.com',
  'manager@wakuwakusystemsharing.com'
];

export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  // デバッグ: 環境変数の値を確認
  console.log('[Middleware] Environment check:', {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    hostname,
    shouldSkipAuth: shouldSkipAuth(),
    pathname,
  });

  // ローカル環境のみ認証をスキップ
  // development環境でも認証は必要（stagingプロジェクトを使用）
  if (shouldSkipAuth()) {
    console.log('[Middleware] Skipping authentication for local environment');
    return NextResponse.next();
  }
  
  console.log('[Middleware] Authentication required');

  // 公開APIパスは常に許可
  if (pathname.startsWith('/api/public-form')) {
    return NextResponse.next();
  }

  // /admin パスの保護（サービス管理者）
  const isServiceAdminRoute = pathname.startsWith('/admin');
  
  // 店舗管理画面のパターン
  // - 6文字のランダム文字列: /[a-z0-9]{6}/(admin|forms|reservations)
  // - 旧形式（後方互換性のため）: /st\d{4}/(admin|forms|reservations)
  const storeAdminPattern = /^\/([a-z0-9]{6}|st\d{4})\/(admin|forms|reservations)/;
  
  // API 保護パターン (公開 API は除外)
  // - GET /api/forms/{formId} は公開（顧客向け）
  // - その他の /api/(forms|reservations) は保護されない（API ルート内で認証を行う）
  // 注: API ルートの認証チェックは削除（API ルート内で行う）
  
  const isProtectedRoute = isServiceAdminRoute || storeAdminPattern.test(pathname);
  
  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // /admin ルート自体では認証チェックをスキップ（ページ内でログイン画面表示）
  // /admin/[storeId] も許可（サービス管理者の店舗詳細ページ）
  // 6文字のランダム文字列または旧形式（st0001）に対応
  if (pathname === '/admin' || pathname.match(/^\/admin\/([a-z0-9]{6}|st\d{4})$/)) {
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
  // 6文字のランダム文字列または旧形式（st0001）を抽出
  const storeIdMatch = pathname.match(/\/([a-z0-9]{6}|st\d{4})\//);
  const storeId = storeIdMatch ? storeIdMatch[1] : null;
  
  // /{storeId}/reservations はサービス管理者のみアクセス可能
  const isReservationsRoute = pathname.match(/^\/([a-z0-9]{6}|st\d{4})\/reservations/);
  
  if (storeId) {
    // reservations ルートの場合はサービス管理者チェック
    if (isReservationsRoute) {
      if (!ADMIN_EMAILS.includes(user.email || '')) {
        return NextResponse.redirect(new URL('/admin', request.url));
      }
    } else {
      // その他の店舗管理画面は店舗アクセス権限チェック
      const hasAccess = await checkStoreAccess(user.id, storeId);
      
      if (!hasAccess) {
        // アクセス権限なし → 403
        return new NextResponse(
          JSON.stringify({ error: 'この店舗へのアクセス権限がありません' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*', 
    // 6文字のランダム文字列または旧形式（st0001）の店舗管理画面
    '/:storeId([a-z0-9]{6}|st\\d{4})/(admin|forms|reservations)/:path*',
    // public-form API は除外（一般公開）
    '/((?!api/public-form)api)/(forms|stores|reservations)/:path*'
  ]
};
