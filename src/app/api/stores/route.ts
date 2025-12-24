import { NextRequest, NextResponse } from 'next/server'
import { getAppEnvironment } from '../../../lib/env'
import { getSupabaseClient, createAdminClient, isServiceAdmin } from '../../../lib/supabase'
import { generateStoreId } from '../../../lib/store-id-generator'
import { promises as fs } from 'fs'
import path from 'path'

// Edge Runtime ではなく Node.js Runtime を使用
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATA_DIR = path.join(process.cwd(), 'data')

interface Store {
  id: string
  name: string
  owner_name: string
  owner_email: string
  phone?: string
  address?: string
  description?: string
  website_url?: string
  created_at: string
  updated_at: string
}

// data ディレクトリ初期化
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
  }
}

// JSON ファイルから店舗読み込み（local 環境用）
async function loadStoresFromJSON(): Promise<Store[]> {
  await ensureDataDir()
  const filePath = path.join(DATA_DIR, 'stores.json')
  
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

// JSON ファイルに店舗保存（local 環境用）
async function saveStoresToJSON(stores: Store[]): Promise<void> {
  await ensureDataDir()
  const filePath = path.join(DATA_DIR, 'stores.json')
  await fs.writeFile(filePath, JSON.stringify(stores, null, 2), 'utf-8')
}

// GET /api/stores - 店舗一覧取得
export async function GET() {
  const env = getAppEnvironment()

  // ローカル環境: JSON から読み込み
  if (env === 'local') {
    const stores = await loadStoresFromJSON()
    return NextResponse.json({ stores })
  }

  // staging/production: Supabase から取得
  // Admin Client を使用してRLSをバイパス（サービス管理者が全店舗を閲覧）
  const adminClient = createAdminClient()
  if (!adminClient) {
    return NextResponse.json(
      { error: 'Supabase 接続エラー' },
      { status: 500 }
    )
  }

  try {
    // サービス管理者の場合は全店舗取得
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stores, error } = await (adminClient as any)
      .from('stores')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[API] Stores fetch error:', error)
      return NextResponse.json(
        { error: 'データ取得に失敗しました' },
        { status: 500 }
      )
    }

    return NextResponse.json({ stores: stores || [] })
  } catch (err) {
    console.error('[API] Stores GET error:', err)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}

// POST /api/stores - 店舗新規作成
export async function POST(request: NextRequest) {
  const env = getAppEnvironment()
  console.log('[API] POST /api/stores - Environment:', env)

  try {
    const body = await request.json()
    const { name, owner_name, owner_email, phone, address, description, website_url } = body
    console.log('[API] POST /api/stores - Body:', { name, owner_name, owner_email })

    // バリデーション
    if (!name || !owner_name || !owner_email) {
      return NextResponse.json(
        { error: '必須項目が不足しています' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    
    // ローカル環境: JSON に保存（重複チェック付き）
    if (env === 'local') {
      const stores = await loadStoresFromJSON()
      
      // 重複しないIDを生成
      let storeId: string
      let attempts = 0
      const maxAttempts = 10
      do {
        storeId = generateStoreId()
        attempts++
        if (attempts > maxAttempts) {
          return NextResponse.json(
            { error: '店舗IDの生成に失敗しました。しばらく経ってから再度お試しください。' },
            { status: 500 }
          )
        }
      } while (stores.some((s: Store) => s.id === storeId))
      
      console.log('[API] Generated unique store ID:', storeId, `(attempts: ${attempts})`)
      
      const newStore: Store = {
        id: storeId,
        name,
        owner_name,
        owner_email,
        phone: phone || '',
        address: address || '',
        description: description || '',
        website_url: website_url || '',
        status: 'active',
        created_at: now,
        updated_at: now
      }
      stores.push(newStore)
      await saveStoresToJSON(stores)
      return NextResponse.json({ success: true, store: newStore })
    }

    // staging/production: 6文字のランダムIDを明示的に指定

    // staging/production: Supabase に保存
    console.log('[API] Creating admin client...')
    const adminClient = createAdminClient()
    if (!adminClient) {
      console.error('[API] Admin client initialization failed')
      return NextResponse.json(
        { error: 'Supabase 管理クライアント初期化エラー' },
        { status: 500 }
      )
    }

    // 認証確認（サービス管理者のみ店舗作成可能）
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    console.log('[API] Auth token present:', !!token)

    if (!token) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      )
    }

    // トークンからユーザー情報取得
    const supabase = getSupabaseClient()
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      )
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    console.log('[API] User fetch result:', { user: user?.email, error: userError?.message })
    
    if (userError || !user) {
      console.error('[API] User authentication failed:', userError)
      return NextResponse.json(
        { error: '認証が無効です' },
        { status: 401 }
      )
    }

    // サービス管理者チェック
    const isAdmin = isServiceAdmin(user.email || '')
    console.log('[API] Admin check:', { email: user.email, isAdmin })
    
    if (!isAdmin) {
      return NextResponse.json(
        { error: '店舗作成権限がありません' },
        { status: 403 }
      )
    }

    // Supabase に挿入（RLS をバイパスするため adminClient 使用）
    // 重複しない6文字のランダムIDを生成して挿入
    let storeId: string
    let attempts = 0
    const maxAttempts = 10
    
    // 重複チェック関数
    const checkStoreExists = async (id: string): Promise<boolean> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (adminClient as any)
        .from('stores')
        .select('id')
        .eq('id', id)
        .single()
      
      if (error && error.code !== 'PGRST116') { // PGRST116 = not found (正常)
        console.error('[API] Store existence check error:', error)
        throw error
      }
      
      return !!data
    }
    
    // 重複しないIDを生成
    do {
      storeId = generateStoreId()
      attempts++
      
      if (attempts > maxAttempts) {
        return NextResponse.json(
          { error: '店舗IDの生成に失敗しました。しばらく経ってから再度お試しください。' },
          { status: 500 }
        )
      }
      
      const exists = await checkStoreExists(storeId)
      if (!exists) {
        break
      }
      
      console.log(`[API] Store ID ${storeId} already exists, retrying... (attempt ${attempts})`)
    } while (true)
    
    console.log('[API] Generated unique store ID:', storeId, `(attempts: ${attempts})`)
    
    // 店舗を挿入
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as any)
      .from('stores')
      .insert([{
        id: storeId, // 明示的に6文字のランダムIDを指定
        name,
        owner_name,
        owner_email,
        phone: phone || '',
        address: address || '',
        description: description || '',
        website_url: website_url || '',
        status: 'active'
      }])
      .select()
      .single()

    if (error) {
      console.error('[API] Store insert error:', error)
      // 重複エラーの場合（通常は発生しないはずだが、念のため）
      if (error.code === '23505') { // PostgreSQL unique violation
        return NextResponse.json(
          { error: '店舗IDが重複しています。再度お試しください。' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: `店舗作成に失敗しました: ${error.message}` },
        { status: 500 }
      )
    }

    console.log('[API] Store created successfully:', data.id)
    return NextResponse.json({ success: true, store: data })
  } catch (err) {
    console.error('[API] Store POST error:', err)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
