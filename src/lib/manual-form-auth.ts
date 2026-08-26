/**
 * 店舗側手動予約フォーム専用の認証まわり
 *
 * 手動フォームは静的 HTML のため、管理画面（SPA）のようなトークン自動更新が効かない。
 * そこで:
 *  - 未認証時は JSON ではなく専用ログイン画面（店舗ID・メール・パスワード・30日保持）を返す
 *  - ログイン成功時にアクセストークン Cookie（既存の sb-access-token）と、
 *    手動フォーム URL 配下だけに限定したリフレッシュトークン Cookie を発行する
 *  - アクセストークン失効時はリフレッシュトークンでサーバー側が自動更新する
 *
 * セキュリティ方針:
 *  - Cookie は HttpOnly / Secure（本番）/ SameSite=Lax
 *  - リフレッシュトークン Cookie は Path をその手動フォーム URL に限定（他のページ・API には送られない）
 *  - 入力された店舗IDが URL の店舗と一致し、かつその店舗の管理者であることを検証
 *  - 失敗理由は区別せず汎用メッセージ（アカウント存在の推測を防ぐ）
 *  - ログイン失敗回数制限（同一 IP + メール: 5 回 / 15 分。サーバーレスのためベストエフォート）
 */
import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';

export const ACCESS_COOKIE = 'sb-access-token';
export const REFRESH_COOKIE = 'mf-refresh-token';
export const REMEMBER_DAYS = 30;

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

/** 手動フォーム URL（リフレッシュ Cookie の Path 制限に使う） */
export function manualFormPath(storeId: string, formId: string): string {
  return `/api/stores/${encodeURIComponent(storeId)}/forms/${encodeURIComponent(formId)}/manual-form`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(name + '=')) {
      return decodeURIComponent(trimmed.substring(name.length + 1));
    }
  }
  return null;
}

function isSecureCookie(): boolean {
  return process.env.NEXT_PUBLIC_APP_ENV !== 'local';
}

/** ログイン成功 / トークン更新時に Cookie を設定する */
export function applySessionCookies(
  response: NextResponse,
  params: { storeId: string; formId: string; accessToken: string; refreshToken: string | null; remember: boolean }
): void {
  const secure = isSecureCookie();
  const rememberMaxAge = REMEMBER_DAYS * 24 * 60 * 60;
  // アクセストークン（既存の管理画面と同じ Cookie 名。JWT 自体の有効期限は Supabase 側で約1時間）
  response.cookies.set(ACCESS_COOKIE, params.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    ...(params.remember ? { maxAge: rememberMaxAge } : {}),
  });
  // リフレッシュトークン（この手動フォーム URL 配下にのみ送信される）
  if (params.refreshToken) {
    response.cookies.set(REFRESH_COOKIE, params.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: manualFormPath(params.storeId, params.formId),
      ...(params.remember ? { maxAge: rememberMaxAge } : {}),
    });
  }
}

/** ログアウト: 両 Cookie を削除 */
export function clearSessionCookies(response: NextResponse, storeId: string, formId: string): void {
  const secure = isSecureCookie();
  response.cookies.set(ACCESS_COOKIE, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, '', { httpOnly: true, secure, sameSite: 'lax', path: manualFormPath(storeId, formId), maxAge: 0 });
}

/** 認証用の Supabase クライアント（anon キー・セッション非永続） */
export function createAuthClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** 指定ユーザーがその店舗の管理者か（アクセストークンで RLS 越しに検証） */
export async function verifyStoreAdmin(
  accessToken: string,
  storeId: string
): Promise<{ ok: true; userId: string; email: string | undefined } | { ok: false }> {
  const client = createAuthenticatedClient(accessToken);
  if (!client) return { ok: false };
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { ok: false };
  const hasAccess = await checkStoreAccess(user.id, storeId, user.email, client);
  if (!hasAccess) return { ok: false };
  return { ok: true, userId: user.id, email: user.email };
}

/**
 * リフレッシュトークン Cookie からセッションを更新する。
 * 成功時は新しいトークン（Cookie に反映が必要）を返す。
 */
export async function refreshManualSession(
  request: Request,
  storeId: string
): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const refreshToken = readCookie(request, REFRESH_COOKIE);
  if (!refreshToken) return null;
  const client = createAuthClient();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session?.access_token) return null;
    const verified = await verifyStoreAdmin(data.session.access_token, storeId);
    if (!verified.ok) return null;
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token || null };
  } catch {
    return null;
  }
}

// ===== ログイン失敗回数制限（メモリ・ベストエフォート） =====
const failureMap = new Map<string, { count: number; lockedUntil: number }>();

export function clientIp(request: Request): string {
  const xf = request.headers.get('x-forwarded-for') || '';
  return xf.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

export function isLoginLocked(key: string): boolean {
  const entry = failureMap.get(key);
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) failureMap.delete(key);
  return false;
}

export function recordLoginFailure(key: string): void {
  const entry = failureMap.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  failureMap.set(key, entry);
}

export function clearLoginFailures(key: string): void {
  failureMap.delete(key);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 手動フォーム専用のログイン画面 HTML */
export function renderManualLoginPage(storeId: string, formId: string, options: { message?: string } = {}): string {
  const loginUrl = manualFormPath(storeId, formId) + '/login';
  const message = options.message ? `<div class="msg">${escapeHtml(options.message)}</div>` : '';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>店舗側手動予約フォーム ログイン</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Noto Sans JP', -apple-system, sans-serif; background: #f3f4f6; color: #111827; }
  .wrap { max-width: 420px; margin: 40px auto; padding: 0 16px; }
  .card { background: #fff; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #6b7280; margin: 0 0 18px; line-height: 1.6; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input[type=text], input[type=email], input[type=password] { width: 100%; padding: 11px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; }
  .hint { font-size: 11px; color: #6b7280; margin-top: 4px; }
  .remember { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; font-size: 13px; }
  .remember input { margin-top: 3px; }
  .remember small { display: block; color: #6b7280; font-size: 11px; margin-top: 2px; }
  button { width: 100%; margin-top: 20px; padding: 13px; background: #1b2a4e; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .6; }
  .msg { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; padding: 10px 12px; border-radius: 6px; font-size: 13px; margin-bottom: 14px; }
  .err { background: #fee2e2; border: 1px solid #fca5a5; color: #b91c1c; padding: 10px 12px; border-radius: 6px; font-size: 13px; margin-top: 14px; display: none; }
  .note { font-size: 11px; color: #9ca3af; margin-top: 16px; line-height: 1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>🏪 店舗側手動予約フォーム</h1>
    <p class="sub">スタッフ用のページです。店舗管理者のログイン情報を入力してください。</p>
    ${message}
    <form id="login-form" autocomplete="on">
      <label for="store-id">店舗ID</label>
      <input type="text" id="store-id" name="store_id" autocomplete="off" autocapitalize="none" required>
      <p class="hint">店舗管理者ページのURL（https://…/店舗ID/admin）に含まれる店舗IDです</p>
      <label for="email">メールアドレス</label>
      <input type="email" id="email" name="email" autocomplete="username" required>
      <label for="password">パスワード</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      <label class="remember">
        <input type="checkbox" id="remember" name="remember">
        <span>30日間ログイン状態を保持する<small>共用の端末では チェックを外してください。保持しない場合はブラウザを閉じると再ログインが必要です。</small></span>
      </label>
      <button type="submit" id="login-button">ログイン</button>
      <div class="err" id="login-error"></div>
    </form>
    <p class="note">ログイン情報が分からない場合は、システム管理者にお問い合わせください。</p>
  </div>
</div>
<script>
(function () {
  var form = document.getElementById('login-form');
  var btn = document.getElementById('login-button');
  var errEl = document.getElementById('login-error');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'ログイン中...';
    try {
      var res = await fetch(${JSON.stringify(loginUrl)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          store_id: document.getElementById('store-id').value.trim(),
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('password').value,
          remember: document.getElementById('remember').checked
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.success) {
        window.location.reload();
        return;
      }
      errEl.textContent = data.error || 'ログインに失敗しました';
      errEl.style.display = 'block';
    } catch (err) {
      errEl.textContent = '通信エラーが発生しました。もう一度お試しください。';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'ログイン';
    }
  });
})();
</script>
</body>
</html>`;
}
