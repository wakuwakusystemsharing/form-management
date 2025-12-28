import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isServiceAdmin } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

// GET /api/stores/[storeId]/admins - 店舗管理者一覧取得
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    
    // 認証チェック（サービス管理者のみ）
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie');
    let userEmail: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      // TODO: JWTからemailを取得
    } else if (cookieHeader) {
      // クッキーからアクセストークンを取得
      const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
      
      const accessToken = cookies['sb-access-token'];
      if (accessToken) {
        // TODO: トークンからemailを取得（簡易実装のため、ここでは認証をスキップ）
      }
    }

    // ローカル環境では認証をスキップ
    const env = getAppEnvironment();
    if (env === 'local') {
      // ローカル環境: JSON から読み込み
      const adminsPath = path.join(DATA_DIR, `store_admins_${storeId}.json`);
      
      if (!fs.existsSync(adminsPath)) {
        return NextResponse.json([]);
      }
      
      const data = fs.readFileSync(adminsPath, 'utf-8');
      const admins = JSON.parse(data);
      
      // ユーザー情報を取得（簡易実装）
      return NextResponse.json(admins);
    }

    // staging/production: Supabase から取得
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const { data: admins, error } = await adminClient
      .from('store_admins')
      .select(`
        id,
        user_id,
        store_id,
        created_at,
        user:auth.users!store_admins_user_id_fkey(email)
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[API] Store Admins fetch error:', error);
      return NextResponse.json(
        { error: '店舗管理者の取得に失敗しました' },
        { status: 500 }
      );
    }

    // ユーザー情報を取得
    const adminsWithUserInfo = await Promise.all(
      (admins || []).map(async (admin: { id: string; user_id: string; store_id: string; created_at: string }) => {
        // Supabase Admin APIでユーザー情報を取得
        const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(admin.user_id);
        
        return {
          id: admin.id,
          user_id: admin.user_id,
          store_id: admin.store_id,
          email: userData?.user?.email || null,
          created_at: admin.created_at,
        };
      })
    );

    return NextResponse.json(adminsWithUserInfo);
  } catch (error) {
    console.error('Store Admins fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// ランダムパスワード生成関数
function generateRandomPassword(): string {
  const length = 12;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

// POST /api/stores/[storeId]/admins - 店舗管理者追加
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();
    const { email, password, createUser = false } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'メールアドレスが必要です' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();
    
    // ローカル環境: JSON に保存
    if (env === 'local') {
      const adminsPath = path.join(DATA_DIR, `store_admins_${storeId}.json`);
      let admins: any[] = [];
      
      if (fs.existsSync(adminsPath)) {
        const data = fs.readFileSync(adminsPath, 'utf-8');
        admins = JSON.parse(data);
      }
      
      // 既存のユーザーを検索（簡易実装）
      const existingAdmin = admins.find(a => a.email === email);
      if (existingAdmin) {
        return NextResponse.json(
          { error: 'このユーザーは既に店舗管理者として登録されています' },
          { status: 400 }
        );
      }
      
      // 新しい管理者を追加
      const newAdmin = {
        id: `admin_${Date.now()}`,
        user_id: `user_${Date.now()}`,
        store_id: storeId,
        email,
        created_at: new Date().toISOString(),
      };
      
      admins.push(newAdmin);
      fs.writeFileSync(adminsPath, JSON.stringify(admins, null, 2));
      
      return NextResponse.json(newAdmin, { status: 201 });
    }

    // staging/production: Supabase に保存
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // メールアドレスでユーザーを検索
    const { data: users, error: userError } = await adminClient.auth.admin.listUsers();
    
    if (userError) {
      console.error('[API] User search error:', userError);
      return NextResponse.json(
        { error: 'ユーザーの検索に失敗しました' },
        { status: 500 }
      );
    }

    let user = users.users.find(u => u.email === email);
    let userCreated = false;
    
    // ユーザーが見つからない場合、自動的に作成
    if (!user && createUser) {
      // パスワードが指定されていない場合は自動生成
      const userPassword = password || generateRandomPassword();
      
      const { data: newUserData, error: createError } = await adminClient.auth.admin.createUser({
        email: email,
        password: userPassword,
        email_confirm: true, // メール確認をスキップ
      });

      if (createError) {
        console.error('[API] User creation error:', createError);
        return NextResponse.json(
          { error: `ユーザーの作成に失敗しました: ${createError.message}` },
          { status: 500 }
        );
      }

      if (!newUserData.user) {
        return NextResponse.json(
          { error: 'ユーザーの作成に失敗しました' },
          { status: 500 }
        );
      }

      user = newUserData.user;
      userCreated = true;
      
      // パスワードが自動生成された場合は、ログに記録
      if (!password) {
        console.log(`[API] User created with auto-generated password. Email: ${email}`);
      }
    }

    if (!user) {
      return NextResponse.json(
        { 
          error: 'このメールアドレスのユーザーが見つかりません。',
          suggestion: '「新規ユーザーを作成して追加」オプションを有効にしてください。'
        },
        { status: 404 }
      );
    }

    // 既存の店舗管理者をチェック
    const { data: existingAdmin, error: checkError } = await adminClient
      .from('store_admins')
      .select('id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .single();

    if (existingAdmin) {
      return NextResponse.json(
        { error: 'このユーザーは既に店舗管理者として登録されています' },
        { status: 400 }
      );
    }

    // 店舗管理者を追加
    const { data: newAdmin, error: insertError } = await adminClient
      .from('store_admins')
      .insert({
        user_id: user.id,
        store_id: storeId,
      } as never)
      .select()
      .single();

    if (insertError) {
      console.error('[API] Store Admin insert error:', insertError);
      return NextResponse.json(
        { error: '店舗管理者の追加に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...(newAdmin as { id: string; user_id: string; store_id: string; created_at: string }),
      email: user.email,
      userCreated, // 新規作成されたかどうか
    }, { status: 201 });
  } catch (error) {
    console.error('Store Admin create error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

