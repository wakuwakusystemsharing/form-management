import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  SalonBoardCredentials,
  SalonBoardCredentialsInput,
  SaveCredentialsResponse,
} from '@/types/salon-board';

const DATA_DIR = path.join(process.cwd(), 'data');

// 暗号化キー（本番環境では環境変数から取得）
const ENCRYPTION_KEY = process.env.SALON_BOARD_ENCRYPTION_KEY || 'default-32-char-encryption-key!!';
const ENCRYPTION_IV_LENGTH = 16;

/**
 * 文字列を暗号化
 */
function encrypt(text: string): string {
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * 暗号化された文字列を復号
 */
function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * ローカル環境用のファイルパス
 */
function getCredentialsFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_credentials_${storeId}.json`);
}

/**
 * GET /api/stores/[storeId]/salon-board/credentials
 * 認証情報のメタデータを取得（パスワードは含まない）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON から読み込み
      const filePath = getCredentialsFilePath(storeId);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json(null);
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      const credentials = JSON.parse(data);

      // パスワードは返さない
      const { encrypted_password, encrypted_login_id, ...metadata } = credentials;

      return NextResponse.json(metadata);
    }

    // staging/production: Supabase から取得
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const { data: credentials, error } = await adminClient
      .from('salon_board_credentials')
      .select(`
        id,
        store_id,
        salon_board_salon_id,
        hotpepper_salon_id,
        connection_status,
        last_connection_test_at,
        last_connection_error,
        sync_enabled,
        auto_sync_reservations,
        auto_sync_cancellations,
        created_at,
        updated_at
      `)
      .eq('store_id', storeId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = No rows found
      console.error('[API] Salon Board Credentials fetch error:', error);
      return NextResponse.json(
        { error: '認証情報の取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(credentials);
  } catch (error) {
    console.error('Credentials fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stores/[storeId]/salon-board/credentials
 * 認証情報を新規登録
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = (await request.json()) as SalonBoardCredentialsInput;

    // バリデーション
    if (!body.login_id || !body.password) {
      return NextResponse.json(
        { error: 'ログインIDとパスワードは必須です' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON に保存
      const filePath = getCredentialsFilePath(storeId);

      // 既存チェック
      if (fs.existsSync(filePath)) {
        return NextResponse.json(
          { error: '認証情報は既に登録されています' },
          { status: 409 }
        );
      }

      const now = new Date().toISOString();
      const credentials = {
        id: `sbcred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        store_id: storeId,
        encrypted_login_id: encrypt(body.login_id),
        encrypted_password: encrypt(body.password),
        salon_board_salon_id: body.salon_board_salon_id || null,
        hotpepper_salon_id: body.hotpepper_salon_id || null,
        connection_status: 'pending',
        last_connection_test_at: null,
        last_connection_error: null,
        sync_enabled: body.sync_enabled ?? true,
        auto_sync_reservations: body.auto_sync_reservations ?? true,
        auto_sync_cancellations: body.auto_sync_cancellations ?? true,
        created_at: now,
        updated_at: now,
      };

      // ディレクトリが存在しない場合は作成
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      fs.writeFileSync(filePath, JSON.stringify(credentials, null, 2));

      // パスワードは返さない
      const { encrypted_password, encrypted_login_id, ...metadata } = credentials;

      const response: SaveCredentialsResponse = {
        success: true,
        credentials: metadata as SalonBoardCredentials,
      };

      return NextResponse.json(response, { status: 201 });
    }

    // staging/production: Supabase に保存
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 既存チェック
    const { data: existing } = await adminClient
      .from('salon_board_credentials')
      .select('id')
      .eq('store_id', storeId)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: '認証情報は既に登録されています' },
        { status: 409 }
      );
    }

    const { data: credentials, error } = await adminClient
      .from('salon_board_credentials' as any)
      .insert({
        store_id: storeId,
        encrypted_login_id: encrypt(body.login_id),
        encrypted_password: encrypt(body.password),
        salon_board_salon_id: body.salon_board_salon_id || null,
        hotpepper_salon_id: body.hotpepper_salon_id || null,
        sync_enabled: body.sync_enabled ?? true,
        auto_sync_reservations: body.auto_sync_reservations ?? true,
        auto_sync_cancellations: body.auto_sync_cancellations ?? true,
      } as any)
      .select(`
        id,
        store_id,
        salon_board_salon_id,
        hotpepper_salon_id,
        connection_status,
        last_connection_test_at,
        last_connection_error,
        sync_enabled,
        auto_sync_reservations,
        auto_sync_cancellations,
        created_at,
        updated_at
      `)
      .single();

    if (error) {
      console.error('[API] Salon Board Credentials insert error:', error);
      return NextResponse.json(
        { error: '認証情報の保存に失敗しました' },
        { status: 500 }
      );
    }

    const response: SaveCredentialsResponse = {
      success: true,
      credentials: credentials as SalonBoardCredentials,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Credentials save error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/stores/[storeId]/salon-board/credentials
 * 認証情報を更新
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = (await request.json()) as Partial<SalonBoardCredentialsInput>;
    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON を更新
      const filePath = getCredentialsFilePath(storeId);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json(
          { error: '認証情報が見つかりません' },
          { status: 404 }
        );
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      const existing = JSON.parse(data);

      const updated = {
        ...existing,
        ...(body.login_id && { encrypted_login_id: encrypt(body.login_id) }),
        ...(body.password && { encrypted_password: encrypt(body.password) }),
        ...(body.salon_board_salon_id !== undefined && { salon_board_salon_id: body.salon_board_salon_id }),
        ...(body.hotpepper_salon_id !== undefined && { hotpepper_salon_id: body.hotpepper_salon_id }),
        ...(body.sync_enabled !== undefined && { sync_enabled: body.sync_enabled }),
        ...(body.auto_sync_reservations !== undefined && { auto_sync_reservations: body.auto_sync_reservations }),
        ...(body.auto_sync_cancellations !== undefined && { auto_sync_cancellations: body.auto_sync_cancellations }),
        updated_at: new Date().toISOString(),
      };

      fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));

      // パスワードは返さない
      const { encrypted_password, encrypted_login_id, ...metadata } = updated;

      const response: SaveCredentialsResponse = {
        success: true,
        credentials: metadata as SalonBoardCredentials,
      };

      return NextResponse.json(response);
    }

    // staging/production: Supabase を更新
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 更新データを構築
    const updateData: Record<string, unknown> = {};
    if (body.login_id) updateData.encrypted_login_id = encrypt(body.login_id);
    if (body.password) updateData.encrypted_password = encrypt(body.password);
    if (body.salon_board_salon_id !== undefined) updateData.salon_board_salon_id = body.salon_board_salon_id;
    if (body.hotpepper_salon_id !== undefined) updateData.hotpepper_salon_id = body.hotpepper_salon_id;
    if (body.sync_enabled !== undefined) updateData.sync_enabled = body.sync_enabled;
    if (body.auto_sync_reservations !== undefined) updateData.auto_sync_reservations = body.auto_sync_reservations;
    if (body.auto_sync_cancellations !== undefined) updateData.auto_sync_cancellations = body.auto_sync_cancellations;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: credentials, error } = await ((adminClient as any)
      .from('salon_board_credentials')
      .update(updateData)
      .eq('store_id', storeId)
      .select(`
        id,
        store_id,
        salon_board_salon_id,
        hotpepper_salon_id,
        connection_status,
        last_connection_test_at,
        last_connection_error,
        sync_enabled,
        auto_sync_reservations,
        auto_sync_cancellations,
        created_at,
        updated_at
      `)
      .single() as any);

    if (error) {
      console.error('[API] Salon Board Credentials update error:', error);
      return NextResponse.json(
        { error: '認証情報の更新に失敗しました' },
        { status: 500 }
      );
    }

    const response: SaveCredentialsResponse = {
      success: true,
      credentials: credentials as SalonBoardCredentials,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Credentials update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/stores/[storeId]/salon-board/credentials
 * 認証情報を削除
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON を削除
      const filePath = getCredentialsFilePath(storeId);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json(
          { error: '認証情報が見つかりません' },
          { status: 404 }
        );
      }

      fs.unlinkSync(filePath);

      return NextResponse.json({ success: true });
    }

    // staging/production: Supabase から削除
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const { error } = await adminClient
      .from('salon_board_credentials')
      .delete()
      .eq('store_id', storeId);

    if (error) {
      console.error('[API] Salon Board Credentials delete error:', error);
      return NextResponse.json(
        { error: '認証情報の削除に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Credentials delete error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * 内部用: 復号化された認証情報を取得
 * スクレイピング処理から使用
 */
export async function getDecryptedCredentials(
  storeId: string
): Promise<{ loginId: string; password: string } | null> {
  const env = getAppEnvironment();

  if (env === 'local') {
    const filePath = getCredentialsFilePath(storeId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    const credentials = JSON.parse(data);

    return {
      loginId: decrypt(credentials.encrypted_login_id),
      password: decrypt(credentials.encrypted_password),
    };
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return null;
  }

  const { data: credentials, error } = await adminClient
    .from('salon_board_credentials' as any)
    .select('encrypted_login_id, encrypted_password')
    .eq('store_id', storeId)
    .single();

  if (error || !credentials) {
    return null;
  }

  return {
    loginId: decrypt((credentials as any).encrypted_login_id),
    password: decrypt((credentials as any).encrypted_password),
  };
}
