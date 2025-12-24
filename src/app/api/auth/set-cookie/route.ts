import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient } from '@/lib/supabase';

/**
 * POST /api/auth/set-cookie
 * ログイン後にアクセストークンをクッキーに設定
 */
export async function POST(request: NextRequest) {
  try {
    // リクエストボディからトークンを取得
    const body = await request.json().catch(() => ({}));
    const accessToken = body.accessToken || request.headers.get('authorization')?.replace('Bearer ', '');

    if (!accessToken) {
      return NextResponse.json(
        { error: 'アクセストークンが必要です' },
        { status: 400 }
      );
    }

    // トークンの有効性を確認
    const supabase = createAuthenticatedClient(accessToken);
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      return NextResponse.json(
        { error: '無効なトークンです' },
        { status: 401 }
      );
    }

    // クッキーにアクセストークンを設定
    const response = NextResponse.json({ success: true });
    
    response.cookies.set('sb-access-token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7日間
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[API] Set cookie error:', error);
    return NextResponse.json(
      { error: 'クッキーの設定に失敗しました' },
      { status: 500 }
    );
  }
}

