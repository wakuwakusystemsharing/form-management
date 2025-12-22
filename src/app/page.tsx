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

  console.log('[Home] Access token:', accessToken ? 'Present' : 'Missing')

  if (!accessToken) {
    // 未認証 → /login にリダイレクト
    console.log('[Home] No access token, redirecting to /login')
    redirect('/login?redirect=/admin')
  }

  // 認証済みクライアント作成
  const supabase = createAuthenticatedClient(accessToken)
  
  if (!supabase) {
    console.log('[Home] Failed to create Supabase client')
    redirect('/login?redirect=/admin')
  }

  // ユーザー情報取得
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  
  if (userError || !user) {
    console.log('[Home] Failed to get user:', userError?.message)
    redirect('/login?redirect=/admin')
  }

  // サービス管理者チェック
  if (!ADMIN_EMAILS.includes(user.email || '')) {
    console.log('[Home] User not authorized:', user.email)
    redirect('/login?redirect=/admin')
  }

  // 認証済み → /admin にリダイレクト
  console.log('[Home] User authenticated, redirecting to /admin')
  redirect('/admin')
}
