import { NextRequest, NextResponse } from 'next/server';

/**
 * ログイン成功時にアクセストークンをCookieに設定するAPI
 * クライアント側から呼び出して、サーバー側でCookieを設定
 */

// CORSプリフライトリクエスト対応
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json();

    console.log('[SetCookie] Received request, accessToken:', accessToken ? 'Present' : 'Missing');

    if (!accessToken) {
      console.error('[SetCookie] Access token missing');
      return NextResponse.json(
        { error: 'アクセストークンが必要です' },
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true',
          },
        }
      );
    }

    const isSecure = request.url.startsWith('https://');
    console.log('[SetCookie] Setting cookie, secure:', isSecure, 'url:', request.url);

    const response = NextResponse.json(
      { success: true },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );

    // アクセストークンをCookieに設定
    // HttpOnly: false にすることで、クライアント側からも読み取り可能（ミドルウェアで使用）
    // Secure: true にすることで、HTTPS接続時のみ送信（staging/productionはHTTPS）
    // SameSite: 'lax' にすることで、CSRF攻撃を防ぐ
    response.cookies.set('sb-access-token', accessToken, {
      httpOnly: false, // ミドルウェアで読み取るため
      secure: isSecure, // HTTPS接続時のみ
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7日間
      path: '/',
    });

    console.log('[SetCookie] Cookie set successfully');
    return response;
  } catch (error) {
    console.error('Cookie設定エラー:', error);
    return NextResponse.json(
      { error: 'Cookie設定に失敗しました' },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }
}

