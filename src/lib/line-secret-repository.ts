/**
 * LINE チャネルシークレットの保存先 — サーバー専用（fs / Supabase に依存。クライアントから import しない）
 *
 * - local 環境は data/store_line_secrets.json、それ以外は store_line_secrets テーブル
 * - テーブルは API（service_role）からだけ読み書きする（RLS のポリシーは作らない）。
 *   stores の列にしないのは、stores は店舗管理者も読めるため（シークレットを画面・API に出さない）
 * - **シークレットそのものは、この外（API のレスポンス・ログ）に出さない**
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

export interface StoreLineSecretRow {
  store_id: string;
  channel_secret: string;
  updated_at: string;
}

/**
 * 読み取りの結果。
 * - set   … 登録済み
 * - none  … 未登録（テーブルが未適用の環境も含む = 署名を確認せずに通す）
 * - error … 読み取りに失敗（登録済みかどうか分からない。呼び出し元は受け付けない側に倒す）
 */
export type StoreLineSecretState = { status: 'set'; secret: string; updated_at: string } | { status: 'none' } | { status: 'error'; message: string };

const TABLE = 'store_line_secrets';
const DATA_DIR = path.join(process.cwd(), 'data');
const localFile = () => path.join(DATA_DIR, 'store_line_secrets.json');

function readLocal(): StoreLineSecretRow[] {
  try {
    if (!fs.existsSync(localFile())) return [];
    const data = JSON.parse(fs.readFileSync(localFile(), 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLocal(rows: StoreLineSecretRow[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(localFile(), JSON.stringify(rows, null, 2));
}

function client(): any {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c;
}

/** テーブルが無い（マイグレーション未適用）ときのエラーか */
export function isMissingSecretTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes(TABLE) && (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache'));
}

export async function getStoreLineSecret(storeId: string): Promise<StoreLineSecretState> {
  if (getAppEnvironment() === 'local') {
    const row = readLocal().find((r) => r.store_id === storeId);
    return row?.channel_secret ? { status: 'set', secret: row.channel_secret, updated_at: row.updated_at } : { status: 'none' };
  }
  try {
    const { data, error } = await client().from(TABLE).select('channel_secret, updated_at').eq('store_id', storeId).maybeSingle();
    if (error) {
      if (isMissingSecretTable(error)) return { status: 'none' };
      return { status: 'error', message: error.message || '読み取りエラー' };
    }
    if (!data?.channel_secret) return { status: 'none' };
    return { status: 'set', secret: data.channel_secret, updated_at: data.updated_at };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : '読み取りエラー' };
  }
}

/** 登録 / 上書き。失敗時はエラーメッセージ（日本語）を返す。成功は null */
export async function setStoreLineSecret(storeId: string, secret: string, now: Date = new Date()): Promise<string | null> {
  const row: StoreLineSecretRow = { store_id: storeId, channel_secret: secret, updated_at: now.toISOString() };
  if (getAppEnvironment() === 'local') {
    writeLocal([...readLocal().filter((r) => r.store_id !== storeId), row]);
    return null;
  }
  const { error } = await client().from(TABLE).upsert(row, { onConflict: 'store_id' });
  if (!error) return null;
  if (isMissingSecretTable(error)) return 'データベースの更新（マイグレーション）がまだ適用されていません';
  console.error('[line-secret] 保存エラー:', error.message);
  return 'チャネルシークレットの保存に失敗しました';
}

/** 削除（署名の確認をやめる）。失敗時はエラーメッセージ。成功は null */
export async function deleteStoreLineSecret(storeId: string): Promise<string | null> {
  if (getAppEnvironment() === 'local') {
    writeLocal(readLocal().filter((r) => r.store_id !== storeId));
    return null;
  }
  const { error } = await client().from(TABLE).delete().eq('store_id', storeId);
  if (!error || isMissingSecretTable(error)) return null;
  console.error('[line-secret] 削除エラー:', error.message);
  return 'チャネルシークレットの削除に失敗しました';
}
