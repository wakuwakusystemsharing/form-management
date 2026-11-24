/**
 * LINE Messaging API のリッチメニューの呼び出し（サーバー専用）
 * 例外を投げず、結果（ok / status / body）を返す。通信できなかったときは status = 0
 *
 * エンドポイント（2026-11 に公式ドキュメントで確認）:
 *   作る            POST   https://api.line.me/v2/bot/richmenu                       → { richMenuId }
 *   画像を送る      POST   https://api-data.line.me/v2/bot/richmenu/{id}/content     （ホストが違う）
 *   全員向けにする  POST   https://api.line.me/v2/bot/user/all/richmenu/{id}
 *   全員向けを見る  GET    https://api.line.me/v2/bot/user/all/richmenu              → { richMenuId } / 無ければ 404 / ほかの場所で設定されていれば 403
 *   全員向けを外す  DELETE https://api.line.me/v2/bot/user/all/richmenu
 *   消す            DELETE https://api.line.me/v2/bot/richmenu/{id}
 *   名札を付ける    POST   https://api.line.me/v2/bot/richmenu/alias                 { richMenuAliasId, richMenuId }（画像を入れたメニューにだけ付けられる）
 *   名札の一覧      GET    https://api.line.me/v2/bot/richmenu/alias/list            → { aliases: [{ richMenuAliasId, richMenuId }] }
 *   名札を外す      DELETE https://api.line.me/v2/bot/richmenu/alias/{aliasId}       （1 時間に 100 回まで）
 */

const API = 'https://api.line.me/v2/bot';
const API_DATA = 'https://api-data.line.me/v2/bot';
const TIMEOUT_MS = 15000;

export interface LineApiResult {
  ok: boolean;
  status: number;
  body: string;
}

type FetchImpl = typeof fetch;

async function call(fetchImpl: FetchImpl, url: string, init: RequestInit): Promise<LineApiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const idPath = (id: string) => encodeURIComponent(id);

/** メニューを作る。成功したら richMenuId を返す */
export async function createLineRichMenu(token: string, object: Record<string, unknown>, fetchImpl: FetchImpl = fetch): Promise<LineApiResult & { richMenuId: string | null }> {
  const res = await call(fetchImpl, `${API}/richmenu`, { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify(object) });
  let richMenuId: string | null = null;
  if (res.ok) {
    try {
      const id = (JSON.parse(res.body) as { richMenuId?: unknown }).richMenuId;
      richMenuId = typeof id === 'string' && id ? id : null;
    } catch {
      richMenuId = null;
    }
  }
  return { ...res, ok: res.ok && !!richMenuId, richMenuId };
}

export function uploadLineRichMenuImage(token: string, richMenuId: string, bytes: Uint8Array, contentType: 'image/jpeg' | 'image/png', fetchImpl: FetchImpl = fetch): Promise<LineApiResult> {
  return call(fetchImpl, `${API_DATA}/richmenu/${idPath(richMenuId)}/content`, { method: 'POST', headers: { ...auth(token), 'Content-Type': contentType }, body: bytes as unknown as BodyInit });
}

export function setDefaultLineRichMenu(token: string, richMenuId: string, fetchImpl: FetchImpl = fetch): Promise<LineApiResult> {
  return call(fetchImpl, `${API}/user/all/richmenu/${idPath(richMenuId)}`, { method: 'POST', headers: auth(token) });
}

export function clearDefaultLineRichMenu(token: string, fetchImpl: FetchImpl = fetch): Promise<LineApiResult> {
  return call(fetchImpl, `${API}/user/all/richmenu`, { method: 'DELETE', headers: auth(token) });
}

export function deleteLineRichMenu(token: string, richMenuId: string, fetchImpl: FetchImpl = fetch): Promise<LineApiResult> {
  return call(fetchImpl, `${API}/richmenu/${idPath(richMenuId)}`, { method: 'DELETE', headers: auth(token) });
}

/**
 * LINE がいま全員向けにしているメニュー。
 * - id: その ID / null: 設定なし / 'other': ほかの場所（公式 LINE の管理画面など）で設定されている / 'unknown': 分からなかった
 */
export async function getDefaultLineRichMenu(token: string, fetchImpl: FetchImpl = fetch): Promise<string | null | 'other' | 'unknown'> {
  const res = await call(fetchImpl, `${API}/user/all/richmenu`, { method: 'GET', headers: auth(token) });
  if (res.status === 404) return null;
  if (res.status === 403) return 'other';
  if (!res.ok) return 'unknown';
  try {
    const id = (JSON.parse(res.body) as { richMenuId?: unknown }).richMenuId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return 'unknown';
  }
}

/** LINE にあるメニューの一覧（ID と名前）。取得できなければ null */
export async function listLineRichMenus(token: string, fetchImpl: FetchImpl = fetch): Promise<Array<{ richMenuId: string; name: string }> | null> {
  const res = await call(fetchImpl, `${API}/richmenu/list`, { method: 'GET', headers: auth(token) });
  if (!res.ok) return null;
  try {
    const list = (JSON.parse(res.body) as { richmenus?: unknown }).richmenus;
    if (!Array.isArray(list)) return [];
    return list
      .map((m) => ({ richMenuId: typeof m?.richMenuId === 'string' ? m.richMenuId : '', name: typeof m?.name === 'string' ? m.name : '' }))
      .filter((m) => m.richMenuId);
  } catch {
    return null;
  }
}

/** メニューに名札（エイリアス）を付ける。タブ切り替えのボタンは、この名札で切り替え先を指す */
export function createLineRichMenuAlias(token: string, aliasId: string, richMenuId: string, fetchImpl: FetchImpl = fetch): Promise<LineApiResult> {
  return call(fetchImpl, `${API}/richmenu/alias`, { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }) });
}

export function deleteLineRichMenuAlias(token: string, aliasId: string, fetchImpl: FetchImpl = fetch): Promise<LineApiResult> {
  return call(fetchImpl, `${API}/richmenu/alias/${idPath(aliasId)}`, { method: 'DELETE', headers: auth(token) });
}

/** LINE にある名札の一覧。取得できなければ null */
export async function listLineRichMenuAliases(token: string, fetchImpl: FetchImpl = fetch): Promise<Array<{ richMenuAliasId: string; richMenuId: string }> | null> {
  const res = await call(fetchImpl, `${API}/richmenu/alias/list`, { method: 'GET', headers: auth(token) });
  if (!res.ok) return null;
  try {
    const list = (JSON.parse(res.body) as { aliases?: unknown }).aliases;
    if (!Array.isArray(list)) return [];
    return list
      .map((a) => ({ richMenuAliasId: typeof a?.richMenuAliasId === 'string' ? a.richMenuAliasId : '', richMenuId: typeof a?.richMenuId === 'string' ? a.richMenuId : '' }))
      .filter((a) => a.richMenuAliasId);
  } catch {
    return null;
  }
}

/** 反映の処理が使う LINE の呼び出し（テストでは差し替える） */
export interface RichMenuLineApi {
  create: (object: Record<string, unknown>) => Promise<LineApiResult & { richMenuId: string | null }>;
  uploadImage: (richMenuId: string, bytes: Uint8Array, contentType: 'image/jpeg' | 'image/png') => Promise<LineApiResult>;
  setDefault: (richMenuId: string) => Promise<LineApiResult>;
  clearDefault: () => Promise<LineApiResult>;
  remove: (richMenuId: string) => Promise<LineApiResult>;
  getDefault: () => Promise<string | null | 'other' | 'unknown'>;
  list: () => Promise<Array<{ richMenuId: string; name: string }> | null>;
  createAlias: (aliasId: string, richMenuId: string) => Promise<LineApiResult>;
  removeAlias: (aliasId: string) => Promise<LineApiResult>;
  listAliases: () => Promise<Array<{ richMenuAliasId: string; richMenuId: string }> | null>;
}

export function createRichMenuLineApi(token: string, fetchImpl: FetchImpl = fetch): RichMenuLineApi {
  return {
    create: (object) => createLineRichMenu(token, object, fetchImpl),
    uploadImage: (id, bytes, contentType) => uploadLineRichMenuImage(token, id, bytes, contentType, fetchImpl),
    setDefault: (id) => setDefaultLineRichMenu(token, id, fetchImpl),
    clearDefault: () => clearDefaultLineRichMenu(token, fetchImpl),
    remove: (id) => deleteLineRichMenu(token, id, fetchImpl),
    getDefault: () => getDefaultLineRichMenu(token, fetchImpl),
    list: () => listLineRichMenus(token, fetchImpl),
    createAlias: (aliasId, id) => createLineRichMenuAlias(token, aliasId, id, fetchImpl),
    removeAlias: (aliasId) => deleteLineRichMenuAlias(token, aliasId, fetchImpl),
    listAliases: () => listLineRichMenuAliases(token, fetchImpl),
  };
}
