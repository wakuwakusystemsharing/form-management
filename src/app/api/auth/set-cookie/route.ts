import { NextRequest, NextResponse } from 'next/server';

/**
 * ログイン成功時にアクセストークンをCookieに設定するAPI
 * クライアント側から呼び出して、サーバー側でCookieを設定
 */
export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        { error: 'アクセストークンが必要です' },
        { status: 400 }
      );
    }

    const response = NextResponse.json({ success: true });

    // アクセストークンをCookieに設定
    // HttpOnly: false にすることで、クライアント側からも読み取り可能（ミドルウェアで使用）
    // Secure: true にすることで、HTTPS接続時のみ送信
    // SameSite: 'lax' にすることで、CSRF攻撃を防ぐ
    response.cookies.set('sb-access-token', accessToken, {
      httpOnly: false, // ミドルウェアで読み取るため
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7日間
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Cookie設定エラー:', error);
    return NextResponse.json(
      { error: 'Cookie設定に失敗しました' },
      { status: 500 }
    );
  }
}

