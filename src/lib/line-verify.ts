/**
 * LINE ログインの ID トークン検証（サーバー側）
 *
 * 抽選は金銭価値のある結果を返すため、クライアント申告の LINE ユーザー ID を信用せず、
 * LIFF から受け取った ID トークンを LINE の verify エンドポイントで検証して `sub` を使う。
 *
 * チャネル ID の解決順: stores.line_channel_id → 環境変数 NEXT_PUBLIC_LINE_CHANNEL_ID
 */

export interface LineIdTokenPayload {
  userId: string;          // sub
  displayName: string | null;
  pictureUrl: string | null;
}

export type LineVerifyResult =
  | { ok: true; payload: LineIdTokenPayload }
  | { ok: false; status: number; error: string };

export const LINE_VERIFY_ENDPOINT = 'https://api.line.me/oauth2/v2.1/verify';

export function resolveLineChannelId(storeChannelId: string | null | undefined): string | null {
  const fromStore = typeof storeChannelId === 'string' ? storeChannelId.trim() : '';
  if (fromStore) return fromStore;
  const fromEnv = (process.env.NEXT_PUBLIC_LINE_CHANNEL_ID || '').trim();
  return fromEnv || null;
}

/**
 * ID トークンを検証して LINE ユーザー ID を返す。
 * ネットワークエラー・期限切れ・チャネル不一致はすべて ok:false（HTTP 401 相当）。
 */
export async function verifyLineIdToken(
  idToken: string,
  channelId: string,
  fetchImpl: typeof fetch = fetch
): Promise<LineVerifyResult> {
  if (!idToken || !channelId) {
    return { ok: false, status: 401, error: 'LINE の認証情報がありません。LINE アプリから開き直してください' };
  }
  try {
    const body = new URLSearchParams({ id_token: idToken, client_id: channelId });
    const res = await fetchImpl(LINE_VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json || typeof json.sub !== 'string' || !json.sub) {
      const detail = json && typeof json.error_description === 'string' ? json.error_description : '';
      console.warn('[line-verify] verify failed:', res.status, detail);
      return { ok: false, status: 401, error: 'LINE の認証に失敗しました。もう一度開き直してください' };
    }
    return {
      ok: true,
      payload: {
        userId: json.sub,
        displayName: typeof json.name === 'string' ? json.name : null,
        pictureUrl: typeof json.picture === 'string' ? json.picture : null,
      },
    };
  } catch (error) {
    console.error('[line-verify] request error:', error);
    return { ok: false, status: 502, error: 'LINE の認証サーバーに接続できませんでした。時間をおいて再度お試しください' };
  }
}
