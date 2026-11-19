/**
 * 複数店舗をまたぐ管理 API（全予約一覧・集計ダウンロード）の「見てよい店舗」を決める。
 * - マスター管理者: 全店舗
 * - システム管理者: 同じテナントの店舗
 * - 店舗管理者: 自分の店舗
 * local 環境は認証をスキップする（呼び出し側で分岐）。
 */
import type { NextRequest } from 'next/server';
import { getCurrentUserRole } from '@/lib/auth-helper';

export type StoreScope = { ok: true; storeIds: string[] | null } | { ok: false };

/**
 * 見てよい店舗（null = 全店舗）と、絞り込みの店舗 ID から、実際に検索する店舗を決める。
 * storeIds: null = 絞り込みなし（全店舗）。
 */
export function resolveStoreScope(allowed: string[] | null, requestedStoreId: string | null): StoreScope {
  if (requestedStoreId) {
    if (allowed && !allowed.includes(requestedStoreId)) return { ok: false };
    return { ok: true, storeIds: [requestedStoreId] };
  }
  return { ok: true, storeIds: allowed };
}

export type AccessibleStores =
  | { ok: true; storeIds: string[] | null }
  | { ok: false; status: number; error: string };

/** ログイン中のユーザーが見てよい店舗 ID（null = 全店舗）。staging / production 用 */
export async function getAccessibleStoreIds(
  request: NextRequest | Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
): Promise<AccessibleStores> {
  const roleInfo = await getCurrentUserRole(request);
  if (!roleInfo) return { ok: false, status: 401, error: '認証が必要です' };

  if (roleInfo.role === 'master') return { ok: true, storeIds: null };

  if (roleInfo.role === 'system') {
    if (!roleInfo.orgId) return { ok: false, status: 403, error: '所属テナントが見つかりません' };
    const { data, error } = await db.from('stores').select('id').eq('org_id', roleInfo.orgId);
    if (error) return { ok: false, status: 500, error: '店舗の取得に失敗しました' };
    return { ok: true, storeIds: (data || []).map((s: { id: string }) => s.id) };
  }

  if (roleInfo.role === 'store') {
    const { data, error } = await db.from('store_admins').select('store_id').eq('user_id', roleInfo.userId);
    if (error) return { ok: false, status: 500, error: '店舗の取得に失敗しました' };
    return { ok: true, storeIds: (data || []).map((s: { store_id: string }) => s.store_id) };
  }

  return { ok: false, status: 403, error: 'この操作を行う権限がありません' };
}
