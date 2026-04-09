/**
 * 認証ミドルウェア
 *
 * ロール階層:
 * - マスター管理者: /master-admin/*, /admin/* 全アクセス
 * - システム管理者: /admin/* 自分の店舗のみ
 * - 店舗管理者: /{storeId}/admin, /{storeId}/forms/* のみ
 *
 * 保護対象ルート:
 * - /master-admin/* - マスター管理者専用
 * - /admin/* - システム管理者以上
 * - /{storeId}/admin - 店舗管理者以上
 * - /{storeId}/forms/* - 店舗管理者以上
 * - /{storeId}/reservations - システム管理者以上
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { shouldSkipAuth } from './lib/env';
import { createAuthenticatedClient, checkStoreAccess, isMasterAdmin, isSystemAdminById } from './lib/supabase';

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

  // マスター管理者ルート
  const isMasterAdminRoute = pathname.startsWith('/master-admin');
  // システム管理者ルート（旧サービス管理者）
  const isSystemAdminRoute = pathname.startsWith('/admin');

  // 店舗管理画面のパターン
  const storeAdminPattern = /^\/([a-z0-9]{6}|st\d{4})\/(admin|forms|reservations)/;

  const isProtectedRoute = isMasterAdminRoute || isSystemAdminRoute || storeAdminPattern.test(pathname);

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // /admin ルート自体では認証チェックをスキップ（ページ内でログイン画面表示）
  if (pathname === '/admin' || pathname === '/admin/help' || pathname.match(/^\/admin\/([a-z0-9]{6}|st\d{4})$/)) {
    return NextResponse.next();
  }

  // /master-admin ルート自体も認証チェックスキップ（ページ内でログイン画面表示）
  if (pathname === '/master-admin') {
    return NextResponse.next();
  }

  // 店舗管理者ページ（/{storeId}/admin）へのアクセス時は、未認証でもページを表示
  const storeAdminPageMatch = pathname.match(/^\/([a-z0-9]{6}|st\d{4})\/admin$/);
  if (storeAdminPageMatch) {
    return NextResponse.next();
  }

  // アクセストークン取得
  const accessToken = request.cookies.get('sb-access-token')?.value;

  if (!accessToken) {
    if (isMasterAdminRoute) {
      return NextResponse.redirect(new URL('/master-admin', request.url));
    }
    if (isSystemAdminRoute) {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
    const storeIdMatch = pathname.match(/\/([a-z0-9]{6}|st\d{4})\//);
    if (storeIdMatch) {
      const storeId = storeIdMatch[1];
      return NextResponse.redirect(new URL(`/${storeId}/admin`, request.url));
    }
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // 認証済みクライアント作成
  const supabase = createAuthenticatedClient(accessToken);

  if (!supabase) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // ユーザー情報取得
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // マスター管理者ルートの場合
  if (isMasterAdminRoute) {
    const isMaster = await isMasterAdmin(user.id);
    if (!isMaster) {
      return new NextResponse(
        JSON.stringify({ error: 'マスター管理者権限が必要です' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return NextResponse.next();
  }

  // システム管理者ルートの場合（/admin/*）
  if (isSystemAdminRoute) {
    const isMaster = await isMasterAdmin(user.id);
    const isSystem = await isSystemAdminById(user.id);

    if (!isMaster && !isSystem) {
      // 店舗管理者の場合、自分の店舗の管理者ページにリダイレクト
      const { data: storeAdmins } = await (supabase as any)
        .from('store_admins')
        .select('store_id')
        .limit(1);

      if (storeAdmins && storeAdmins.length > 0) {
        const firstStoreId = (storeAdmins[0] as { store_id: string }).store_id;
        return NextResponse.redirect(new URL(`/${firstStoreId}/admin`, request.url));
      }

      return new NextResponse(
        JSON.stringify({ error: 'アクセス権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return NextResponse.next();
  }

  // 店舗 ID 抽出（パスから）
  const storeIdMatch = pathname.match(/\/([a-z0-9]{6}|st\d{4})\//);
  const storeId: string | null = storeIdMatch ? storeIdMatch[1] : null;

  // /{storeId}/reservations はシステム管理者以上のみ
  const isReservationsRoute = pathname.match(/^\/([a-z0-9]{6}|st\d{4})\/reservations/);

  if (storeId) {
    if (isReservationsRoute) {
      const isMaster = await isMasterAdmin(user.id);
      const isSystem = await isSystemAdminById(user.id);
      if (!isMaster && !isSystem) {
        return NextResponse.redirect(new URL(`/${storeId}/admin`, request.url));
      }
    } else {
      // その他の店舗管理画面は店舗アクセス権限チェック
      const hasAccess = await checkStoreAccess(user.id, storeId, user.email, supabase);

      if (!hasAccess) {
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
    // 静的ファイルとNext.js内部ファイルは除外
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ]
};
