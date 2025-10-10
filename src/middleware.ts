/**
 * 認証ミドルウェア
 * 
 * 【現在の状態】
 * - 認証機能は未実装（開発中）
 * - 全てのルートがオープンアクセス
 * 
 * 【将来の実装予定】
 * - Supabase Authとの統合
 * - 店舗管理者の認証チェック
 * - Row Level Security適用
 * 
 * 保護対象ルート:
 * - /{storeId}/admin - 店舗管理者ダッシュボード
 * - /{storeId}/forms/* - フォーム編集画面
 * - /{storeId}/reservations - 予約一覧
 * 
 * 認証フロー:
 * 1. 未認証ユーザーが保護されたルートにアクセス
 * 2. /login?redirect={元のURL} にリダイレクト
 * 3. ログイン成功後、元のURLに戻る
 * 4. store_id を確認してアクセス権限を検証
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // TODO: Supabase Authとの統合
  // 現在は認証チェックをスキップ
  
  // 店舗管理画面のパターン: /st0001/admin, /st0001/forms/*, etc.
  const storeAdminPattern = /^\/st\d{4}\/(admin|forms|reservations)/;
  
  if (storeAdminPattern.test(pathname)) {
    // TODO: セッションチェック
    // const supabase = createMiddlewareClient({ req: request });
    // const { data: { session } } = await supabase.auth.getSession();
    
    // if (!session) {
    //   // 未認証 → ログインページへリダイレクト
    //   return NextResponse.redirect(
    //     new URL(`/login?redirect=${pathname}`, request.url)
    //   );
    // }
    
    // TODO: store_id のアクセス権限チェック
    // const storeId = pathname.match(/^\/st\d{4}/)?.[0].slice(1);
    // const userStoreId = session.user.user_metadata.store_id;
    
    // if (userStoreId !== storeId) {
    //   // 他店舗へのアクセス試行 → 403
    //   return NextResponse.json(
    //     { error: 'この店舗へのアクセス権限がありません' },
    //     { status: 403 }
    //   );
    // }
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
