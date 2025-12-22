import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createAuthenticatedClient } from '@/lib/supabase'
import { isLocal } from '@/lib/env'

const ADMIN_EMAILS = [
  'wakuwakusystemsharing@gmail.com',
  'admin@wakuwakusystemsharing.com',
  'manager@wakuwakusystemsharing.com'
]

export default async function Home() {
  // ローカル環境では /admin にリダイレクト
  if (isLocal()) {
    redirect('/admin')
  }

  // 認証チェック
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('sb-access-token')?.value

  if (!accessToken) {
    // 未認証 → /login にリダイレクト
    redirect('/login?redirect=/admin')
  }

  // 認証済みクライアント作成
  const supabase = createAuthenticatedClient(accessToken)
  
  if (!supabase) {
    redirect('/login?redirect=/admin')
  }

  // ユーザー情報取得
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  
  if (userError || !user) {
    redirect('/login?redirect=/admin')
  }

  // サービス管理者チェック
  if (!ADMIN_EMAILS.includes(user.email || '')) {
    redirect('/login?redirect=/admin')
  }

  // 認証済み → /admin にリダイレクト
  redirect('/admin')
}
