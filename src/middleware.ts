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
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ローカル環境のみ認証をスキップ
  if (shouldSkipAuth()) {
    return NextResponse.next();
  }

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
  if (pathname === '/admin' || pathname === '/admin/help' || pathname.match(/^\/admin\/([a-z0-9]{6}|st\d{4})$/)) {
    return NextResponse.next();
  }

  // 店舗管理者ページ（/{storeId}/admin）へのアクセス時は、未認証でもページを表示
  // ページ内でログイン画面を表示するため
  const storeAdminPageMatch = pathname.match(/^\/([a-z0-9]{6}|st\d{4})\/admin$/);
  if (storeAdminPageMatch) {
    return NextResponse.next();
  }

  // アクセストークン取得
  const accessToken = request.cookies.get('sb-access-token')?.value;
  
  if (!accessToken) {
    // サービス管理者ルートの場合は /admin にリダイレクト
    // 店舗管理者ルートの場合は既に上で許可されているので、ここには来ない
    if (isServiceAdminRoute) {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
    // その他の保護されたルート（/{storeId}/forms, /{storeId}/reservations など）は認証必須
    // 店舗管理者ページにリダイレクト（ログイン後、元のページに戻れるように）
    const storeIdMatch = pathname.match(/\/([a-z0-9]{6}|st\d{4})\//);
    if (storeIdMatch) {
      const storeId = storeIdMatch[1];
      return NextResponse.redirect(new URL(`/${storeId}/admin`, request.url));
    }
    // フォールバック: /admin にリダイレクト
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
  if (isServiceAdminRoute) {
    // サービス管理者でない場合、店舗管理者ページにリダイレクト
    if (!ADMIN_EMAILS.includes(user.email || '')) {
      // 店舗管理者の場合、自分の店舗の管理者ページにリダイレクト
      // まず、ユーザーがアクセス権限を持つ店舗を取得
      const { data: storeAdmins } = await (supabase as any)
        .from('store_admins')
        .select('store_id')
        .limit(1);
      
      if (storeAdmins && storeAdmins.length > 0) {
        const firstStoreId = (storeAdmins[0] as { store_id: string }).store_id;
        return NextResponse.redirect(new URL(`/${firstStoreId}/admin`, request.url));
      }
      
      // 店舗管理者として登録されていない場合、403エラー
      return new NextResponse(
        JSON.stringify({ error: 'アクセス権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // 店舗 ID 抽出（パスから）
  const storeIdMatch = pathname.match(/\/([a-z0-9]{6}|st\d{4})\//);
  const storeId: string | null = storeIdMatch ? storeIdMatch[1] : null;
  
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
      // サービス管理者の場合は既にチェック済みなので、通常ユーザーのみチェック
      if (!ADMIN_EMAILS.includes(user.email || '')) {
        // 認証済みクライアントを渡してRLSをバイパス
        const hasAccess = await checkStoreAccess(user.id, storeId, user.email, supabase);
        
        if (!hasAccess) {
          // アクセス権限なし → 403
          return new NextResponse(
            JSON.stringify({ error: 'この店舗へのアクセス権限がありません' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 静的ファイルとNext.js内部ファイルは除外
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ]
};
