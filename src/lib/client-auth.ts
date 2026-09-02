'use client';

import { getSupabaseClient } from '@/lib/supabase';

/**
 * ブラウザ側の認証ヘルパー（店舗管理者ページ用）
 *
 * サーバー API は Cookie（sb-access-token）を最優先で認証する。
 * Supabase のアクセストークンは約 1 時間で失効し、ブラウザ側のセッションは自動更新されるが
 * Cookie は自動では更新されないため、放置すると API が 401（認証が必要です）を返す。
 * - syncAuthCookie(): 現在のセッションのトークンで Cookie を更新
 * - fetchWithAuth(): 401 のとき Cookie を同期して 1 回だけ再試行。それでも 401 なら
 *   AUTH_REQUIRED_EVENT を発火し、ページ側で再ログインへ誘導する
 */

export const AUTH_REQUIRED_EVENT = 'store-admin-auth-required';

let syncInFlight: Promise<boolean> | null = null;

/** 現在のセッションのアクセストークンでサーバー用 Cookie を更新する。成功なら true */
export function syncAuthCookie(): Promise<boolean> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return false;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return false;
      const res = await fetch('/api/auth/set-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accessToken: session.access_token }),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

/** 再ログインが必要になったことをページに通知する */
export function notifyAuthRequired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
}

/**
 * fetch のラッパ。credentials: 'include' を付与し、401 の場合は Cookie を同期して 1 回だけ再試行する。
 * 再試行後も 401 のときは AUTH_REQUIRED_EVENT を発火する（呼び出し側は 401 用のトーストを出さなくてよい）
 */
export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const withCreds: RequestInit = { credentials: 'include', ...init };
  let res = await fetch(input, withCreds);
  if (res.status !== 401) return res;

  const synced = await syncAuthCookie();
  if (synced) {
    res = await fetch(input, withCreds);
    if (res.status !== 401) return res;
  }
  notifyAuthRequired();
  return res;
}
