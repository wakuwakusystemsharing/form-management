/**
 * Supabase クライアント初期化
 * 環境に応じて接続を切り替え (dev: モック, staging/prod: 実接続)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isLocal } from './env';

// Supabase クライアント型定義
export type Database = {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['stores']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['stores']['Insert']>;
      };
      forms: {
        Row: {
          id: string;
          store_id: string;
          status: 'active' | 'inactive';
          draft_status: 'none' | 'draft' | 'ready_to_publish';
          config: Record<string, unknown>; // FormConfig 型 (後で types/form.ts から import 予定)
          static_deploy: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
          last_published_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['forms']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['forms']['Insert']>;
      };
      reservations: {
        Row: {
          id: string;
          form_id: string;
          store_id: string;
          customer_name: string;
          customer_phone: string;
          reservation_date: string;
          reservation_time: string;
          menu_name: string;
          submenu_name: string | null;
          gender: string | null;
          visit_count: string | null;
          coupon: string | null;
          message: string | null;
          status: 'pending' | 'confirmed' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['reservations']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['reservations']['Insert']>;
      };
      store_admins: {
        Row: {
          id: string;
          user_id: string; // Supabase Auth user_id
          store_id: string;
          role: 'admin' | 'staff';
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['store_admins']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['store_admins']['Insert']>;
      };
    };
  };
};

let supabaseClient: SupabaseClient<Database> | null = null;

/**
 * Supabase クライアントを取得 (シングルトン)
 * ローカル環境では null を返し、JSON ファイル永続化にフォールバック
 */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  // すでに初期化済みの場合は再利用
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 環境変数が設定されていない場合
  if (!supabaseUrl || !supabaseAnonKey) {
    if (isLocal()) {
      console.log('[Supabase] Local mode: using JSON file storage (Supabase env vars not set)');
    } else {
      console.error('[Supabase] Missing environment variables: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    return null;
  }

  // 環境変数が設定されている場合はSupabase接続を試みる（ローカル環境でも）
  supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey);
  if (isLocal()) {
    console.log('[Supabase] Client initialized for local development (Supabase env vars set)');
  } else {
    console.log('[Supabase] Client initialized for staging/production');
  }
  
  return supabaseClient;
}

/**
 * サービスロールキーで管理者権限クライアントを取得
 * RLS をバイパスして全データアクセス可能
 * サーバーサイド API でのみ使用すること
 */
export function getSupabaseAdminClient(): SupabaseClient<Database> | null {
  if (isLocal()) {
    console.log('[Supabase Admin] Local mode: using JSON file storage');
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Supabase Admin] Missing environment variables');
    return null;
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * アクセストークンから認証済みクライアントを作成
 * ミドルウェアや Server Components で使用
 */
export function createAuthenticatedClient(accessToken: string): SupabaseClient<Database> | null {
  if (isLocal()) {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * ユーザーの店舗アクセス権限を確認
 * @param userId Supabase Auth の user_id
 * @param storeId 店舗 ID
 * @returns アクセス可能な場合 true
 */
export async function checkStoreAccess(userId: string, storeId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    // ローカル環境では認証をスキップ
    return true;
  }

  const { data, error } = await supabase
    .from('store_admins')
    .select('id')
    .eq('user_id', userId)
    .eq('store_id', storeId)
    .single();

  if (error || !data) {
    return false;
  }

  return true;
}

/**
 * 管理者クライアントのエイリアス（後方互換性のため）
 */
export function createAdminClient() {
  return getSupabaseAdminClient()
}

/**
 * ユーザーがサービス管理者かどうかを確認
 * @param email ユーザーのメールアドレス
 * @returns サービス管理者の場合 true
 */
export function isServiceAdmin(email: string): boolean {
  const adminEmails = [
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]
  return adminEmails.includes(email)
}
