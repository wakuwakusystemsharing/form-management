/**
 * 認証ミドルウェア
 *
 * ロール階層:
 * - マスター管理者: /master-admin/* 全アクセス
 * - システム管理者: /tenant/{slug}/admin/* 自テナントのみ
 * - 店舗管理者: /{storeId}/admin, /{storeId}/forms/* のみ
 *
 * 保護対象ルート:
 * - /master-admin/* - マスター管理者専用
 * - /tenant/{slug}/admin/* - システム管理者（同テナント）以上
 * - /{storeId}/admin - 店舗管理者以上
 * - /{storeId}/forms/* - 店舗管理者以上
 * - /{storeId}/reservations - システム管理者以上
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { shouldSkipAuth } from './lib/env';
import { createAuthenticatedClient, checkStoreAccess, isMasterAdmin, isSystemAdminById, getUserRole } from './lib/supabase';

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

  // ルート分類
  const isMasterAdminRoute = pathname.startsWith('/master-admin');
  const isTenantAdminRoute = pathname.startsWith('/tenant/');
  const storeAdminPattern = /^\/([a-z0-9]{6}|st\d{4})\/(admin|forms|reservations)/;
  const isStoreRoute = storeAdminPattern.test(pathname);

  // 旧 /admin ルートは廃止 → トップへリダイレクト
  if (pathname.startsWith('/admin')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const isProtectedRoute = isMasterAdminRoute || isTenantAdminRoute || isStoreRoute;

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // /master-admin ルート自体は認証チェックスキップ（ページ内でログイン画面表示）
  if (pathname === '/master-admin') {
    return NextResponse.next();
  }

  // /tenant/{slug}/admin 自体は認証チェックスキップ（ページ内でログイン画面表示）
  const tenantAdminPageMatch = pathname.match(/^\/tenant\/([a-z0-9-]+)\/admin$/);
  if (tenantAdminPageMatch) {
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
    if (isTenantAdminRoute) {
      const slugMatch = pathname.match(/^\/tenant\/([a-z0-9-]+)\//);
      const slug = slugMatch ? slugMatch[1] : '';
      return NextResponse.redirect(new URL(`/tenant/${slug}/admin`, request.url));
    }
    const storeIdMatch = pathname.match(/\/([a-z0-9]{6}|st\d{4})\//);
    if (storeIdMatch) {
      return NextResponse.redirect(new URL(`/${storeIdMatch[1]}/admin`, request.url));
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  // 認証済みクライアント作成
  const supabase = createAuthenticatedClient(accessToken);
  if (!supabase) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // ユーザー情報取得
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.redirect(new URL('/', request.url));
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

  // テナント管理者ルートの場合（/tenant/{slug}/admin/*）
  if (isTenantAdminRoute) {
    const isMaster = await isMasterAdmin(user.id);
    if (isMaster) {
      return NextResponse.next(); // マスターは全テナントにアクセス可能
    }

    const roleInfo = await getUserRole(user.id);
    if (roleInfo.role !== 'system') {
      return new NextResponse(
        JSON.stringify({ error: 'システム管理者権限が必要です' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // テナントスラッグの一致確認
    const slugMatch = pathname.match(/^\/tenant\/([a-z0-9-]+)\//);
    if (slugMatch && roleInfo.orgSlug !== slugMatch[1]) {
      return new NextResponse(
        JSON.stringify({ error: 'このテナントへのアクセス権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return NextResponse.next();
  }

  // 店舗ルートの場合
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ]
};
