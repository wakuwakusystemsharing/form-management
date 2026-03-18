/**
 * APIルートで認証情報を取得するヘルパー関数
 * 
 * Next.jsのAPIルートでは、リクエストごとに新しいコンテキストが作成されるため、
 * グローバルな状態でユーザー情報を保持することはできません。
 * しかし、このヘルパー関数を使用することで、各APIエンドポイントで簡単に
 * 現在ログイン中のユーザー情報を取得できます。
 */

import { NextRequest } from 'next/server';
import { createAuthenticatedClient } from './supabase';

/**
 * リクエストからアクセストークンを取得
 * @param request NextRequestまたはRequestオブジェクト
 * @returns アクセストークン（見つからない場合はnull）
 */
function getAccessToken(request: NextRequest | Request): string | null {
  // クッキーからアクセストークンを取得
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';');
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith('sb-access-token=')) {
        return trimmed.split('=')[1];
      }
    }
  }
  
  // Authorizationヘッダーから取得
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '');
  }
  
  return null;
}

/**
 * リクエストから認証済みユーザーIDを取得
 * @param request NextRequestまたはRequestオブジェクト
 * @returns ユーザーID（認証されていない場合はnull）
 */
export async function getCurrentUserId(request: NextRequest | Request): Promise<string | null> {
  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return null;
    }

    // 認証済みクライアントを作成
    const supabase = createAuthenticatedClient(accessToken);
    if (!supabase) {
      return null;
    }

    // ユーザー情報を取得
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      return null;
    }

    return user.id;
  } catch (error) {
    console.error('[getCurrentUserId] Error:', error);
    return null;
  }
}

/**
 * リクエストから認証済みユーザー情報を取得
 * @param request NextRequestオブジェクト
 * @returns ユーザー情報（認証されていない場合はnull）
 */
export async function getCurrentUser(request: NextRequest | Request): Promise<{ id: string; email: string | undefined } | null> {
  try {
    // クッキーからアクセストークンを取得
    const accessToken = request.headers.get('cookie')
      ?.split(';')
      .find(c => c.trim().startsWith('sb-access-token='))
      ?.split('=')[1]
      || request.headers.get('authorization')?.replace('Bearer ', '');

    if (!accessToken) {
      return null;
    }

    // 認証済みクライアントを作成
    const supabase = createAuthenticatedClient(accessToken);
    if (!supabase) {
      return null;
    }

    // ユーザー情報を取得
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email
    };
  } catch (error) {
    console.error('[getCurrentUser] Error:', error);
    return null;
  }
}

