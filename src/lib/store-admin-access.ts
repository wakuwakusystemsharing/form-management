/**
 * 店舗管理者ページを開いたときのアクセス確認
 *
 * 確認には GET /api/stores/{storeId}?full=1 を使う（マスター / 同じテナントのシステム管理者 /
 * その店舗の店舗管理者なら 200、別の店舗は 403、未ログインは 401）。
 * 店舗管理者の一覧（GET /api/stores/{storeId}/admins）は運営だけが呼べる API なので、
 * ここでは使わない（使うと店舗管理者が自分のページを開けなくなる）。
 */

/** 店舗管理者ページのアクセス確認に使う URL */
export function storeAdminAccessCheckUrl(storeId: string): string {
  return `/api/stores/${encodeURIComponent(storeId)}?full=1`;
}

export const STORE_ACCESS_DENIED_MESSAGE = 'この店舗へのアクセス権限がありません';
export const STORE_NOT_FOUND_MESSAGE = '店舗が見つかりません';
export const STORE_SESSION_EXPIRED_MESSAGE = 'ログインの有効期限が切れました。もう一度ログインしてください';
export const STORE_LOAD_FAILED_MESSAGE = 'データの取得に失敗しました';

/** アクセス確認の応答の状態コード → 画面に出す文言（開いてよいときは null） */
export function storeAdminAccessError(status: number): string | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return STORE_SESSION_EXPIRED_MESSAGE;
  if (status === 403) return STORE_ACCESS_DENIED_MESSAGE;
  if (status === 404) return STORE_NOT_FOUND_MESSAGE;
  return STORE_LOAD_FAILED_MESSAGE;
}
