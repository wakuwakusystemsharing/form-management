/**
 * Google サービスアカウント（マスター管理の設定 `google_service_account_json`、または環境変数）の読み出し
 * Google カレンダー作成と Google スプレッドシート書き込みで共通に使う（サーバー専用）。
 */
import { createAdminClient } from './supabase';

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

export function parseServiceAccountJson(raw: string): { client_email?: string; private_key?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

export async function getServiceAccountJson(): Promise<string | null> {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  }

  const adminClient = createAdminClient();
  if (!adminClient) return null;

  const { data, error } = await (adminClient as any)
    .from('admin_settings')
    .select('value')
    .eq('key', 'google_service_account_json')
    .maybeSingle();

  if (error) {
    console.error('[GoogleServiceAccount] admin_settings fetch error:', error);
    return null;
  }

  return data?.value || null;
}

/** 有効なサービスアカウント資格情報。未設定 / 不正なら null */
export async function getServiceAccountCredentials(): Promise<ServiceAccountCredentials | null> {
  const rawJson = await getServiceAccountJson();
  if (!rawJson) return null;
  const credentials = parseServiceAccountJson(rawJson);
  if (!credentials?.client_email || !credentials?.private_key) {
    console.error('[GoogleServiceAccount] Invalid service account JSON');
    return null;
  }
  return { client_email: credentials.client_email, private_key: credentials.private_key };
}

/** 共有先として案内するサービスアカウントのメールアドレス（未設定なら null） */
export async function getServiceAccountEmail(): Promise<string | null> {
  const creds = await getServiceAccountCredentials();
  return creds?.client_email ?? null;
}
