import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedClient } from '../../../../lib/supabase'

export async function GET(req: NextRequest) {
  try {
    // まずクッキーからアクセストークンを取得
    const accessToken = req.cookies.get('sb-access-token')?.value
    
    // クッキーにトークンがない場合、Authorizationヘッダーを確認
    const authHeader = req.headers.get('authorization')
    const token = accessToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
    
    if (!token) {
      return NextResponse.json({ error: 'トークンが必要です' }, { status: 401 })
    }

    const client = createAuthenticatedClient(token)
    
    if (!client) {
      return NextResponse.json({ error: 'Supabase クライアント作成に失敗しました' }, { status: 500 })
    }

    const { data: { user }, error } = await client.auth.getUser()
    
    if (error || !user) {
      return NextResponse.json({ error: '無効なトークンです' }, { status: 401 })
    }

    // セッション情報も返す（クライアント側でセッションを復元するため）
    // リフレッシュトークンはクッキーから取得できないため、アクセストークンのみ返す
    return NextResponse.json({ 
      user: { id: user.id, email: user.email },
      accessToken: token,
      refreshToken: null // クッキーにはリフレッシュトークンがないため
    })
  } catch (error) {
    console.error('認証エラー:', error)
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 500 })
  }
}