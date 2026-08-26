import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import {
  createAuthClient,
  verifyStoreAdmin,
  applySessionCookies,
  clientIp,
  isLoginLocked,
  recordLoginFailure,
  clearLoginFailures,
} from '@/lib/manual-form-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC_ERROR = '店舗ID・メールアドレス・パスワードのいずれかが正しくありません';

// POST /api/stores/[storeId]/forms/[formId]/manual-form/login
// 店舗側手動予約フォーム専用ログイン。店舗ID（URLと一致必須）+ メール + パスワードで認証し、
// その店舗の管理者であれば Cookie を発行する。
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string; formId: string }> }
) {
  try {
    const { storeId, formId } = await params;
    const body = await request.json().catch(() => ({}));
    const typedStoreId = typeof body.store_id === 'string' ? body.store_id.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const remember = body.remember === true;

    if (!typedStoreId || !email || !password) {
      return NextResponse.json({ error: '店舗ID・メールアドレス・パスワードをすべて入力してください' }, { status: 400 });
    }

    if (getAppEnvironment() === 'local') {
      // ローカル環境は認証を使わないため常に成功扱い
      return NextResponse.json({ success: true });
    }

    // 失敗回数制限
    const limiterKey = `${clientIp(request)}:${email}`;
    if (isLoginLocked(limiterKey)) {
      return NextResponse.json(
        { error: 'ログイン失敗が続いたため一時的にロックしています。15分ほど待ってからお試しください。' },
        { status: 429 }
      );
    }

    // 店舗IDは URL の店舗と一致していなければならない（理由は伏せて汎用エラー）
    if (typedStoreId !== storeId) {
      recordLoginFailure(limiterKey);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    const authClient = createAuthClient();
    if (!authClient) {
      return NextResponse.json({ error: '認証サービスに接続できません' }, { status: 500 });
    }

    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session?.access_token) {
      recordLoginFailure(limiterKey);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    // その店舗の管理者か（マスター / システム管理者もアクセス可）
    const verified = await verifyStoreAdmin(data.session.access_token, storeId);
    if (!verified.ok) {
      recordLoginFailure(limiterKey);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    clearLoginFailures(limiterKey);

    const response = NextResponse.json({ success: true });
    applySessionCookies(response, {
      storeId,
      formId,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token || null,
      remember,
    });
    return response;
  } catch (error) {
    console.error('[API] manual-form login error:', error);
    return NextResponse.json({ error: 'ログイン処理でエラーが発生しました' }, { status: 500 });
  }
}
