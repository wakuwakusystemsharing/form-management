/**
 * LINE Messaging API push 送信（Node / API ルート用）
 *
 * Edge Function `send-reminders` の sendLinePush と同じ呼び方。
 * 失敗しても呼び出し元の処理（抽選結果の返却など）は止めない前提で、例外を投げず結果を返す。
 */

export const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

export interface LinePushResult {
  ok: boolean;
  status: number;
  body: string;
}

export async function pushLineMessages(
  accessToken: string,
  to: string,
  messages: Array<Record<string, unknown>>,
  fetchImpl: typeof fetch = fetch
): Promise<LinePushResult> {
  if (!accessToken || !to || messages.length === 0) {
    return { ok: false, status: 0, body: 'missing accessToken / to / messages' };
  }
  try {
    const res = await fetchImpl(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.warn('[line-push] push failed:', res.status, body.slice(0, 300));
    }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    console.error('[line-push] request error:', error);
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}
