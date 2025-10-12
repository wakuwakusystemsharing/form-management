import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedClient } from '../../../../lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'トークンが必要です' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const client = createAuthenticatedClient(token)
    
    if (!client) {
      return NextResponse.json({ error: 'Supabase クライアント作成に失敗しました' }, { status: 500 })
    }

    const { data: { user }, error } = await client.auth.getUser()
    
    if (error || !user) {
      return NextResponse.json({ error: '無効なトークンです' }, { status: 401 })
    }

    return NextResponse.json({ user: { id: user.id, email: user.email } })
  } catch (error) {
    console.error('認証エラー:', error)
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 500 })
  }
}