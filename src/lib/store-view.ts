/**
 * 店舗情報を「誰に返すか」で出し分ける（純粋ロジック）
 *
 * 店舗の行には、外に出してはいけない値が入っている:
 *   - google_calendar_refresh_token … Google カレンダー連携の鍵（誰にも返さない）
 *   - line_channel_access_token     … 公式 LINE を操作できる鍵（運営にだけ返す。店舗編集の入力欄で使うため）
 *
 * - public … ログインしていない人（店舗管理者ページのログイン画面が、店舗名・ロゴ・テーマカラーを出すのに使う）
 * - store  … 店舗管理者（鍵は返さず、設定済みかどうかだけ返す）
 * - upper  … 運営（マスター管理者・システム管理者）
 */

export type StoreViewer = 'public' | 'store' | 'upper';

/** ログインしていない人に返してよい項目（これ以外は返さない） */
export const PUBLIC_STORE_KEYS = ['id', 'name', 'logo_url', 'theme_color'] as const;

/** 誰にも返さない項目 */
export const STORE_SECRET_KEYS = ['google_calendar_refresh_token'] as const;

/** 運営にだけ返す項目（店舗管理者には「設定済みか」だけを `{key}_set` で返す） */
export const STORE_UPPER_ONLY_KEYS = ['line_channel_access_token'] as const;

type Row = Record<string, unknown>;

export function toStoreView(store: Row | null | undefined, viewer: StoreViewer): Row {
  if (!store || typeof store !== 'object') return {};
  if (viewer === 'public') {
    const out: Row = {};
    for (const key of PUBLIC_STORE_KEYS) if (key in store) out[key] = store[key];
    return out;
  }
  const out: Row = { ...store };
  for (const key of STORE_SECRET_KEYS) delete out[key];
  if (viewer === 'store') {
    for (const key of STORE_UPPER_ONLY_KEYS) {
      out[`${key}_set`] = typeof store[key] === 'string' && (store[key] as string).trim() !== '';
      delete out[key];
    }
  }
  return out;
}

/**
 * 更新のときに、送られてきても反映しない項目を取り除く。
 * - id / created_at … 変えられない
 * - google_calendar_refresh_token … 連携の API だけが書く
 * - org_id（テナントの付け替え）… マスター管理者だけ
 * - `*_set` … 表示用に足した項目（列ではない）
 */
export function sanitizeStoreUpdate(body: Row | null | undefined, opts: { isMaster: boolean }): Row {
  const out: Row = { ...(body && typeof body === 'object' ? body : {}) };
  delete out.id;
  delete out.created_at;
  for (const key of STORE_SECRET_KEYS) delete out[key];
  for (const key of STORE_UPPER_ONLY_KEYS) delete out[`${key}_set`];
  if (!opts.isMaster) delete out.org_id;
  return out;
}
