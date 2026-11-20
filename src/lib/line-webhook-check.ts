/**
 * LINE Webhook の「接続を確認」— サーバー専用
 *
 * LINE に 2 つのことを聞く:
 *   1. いま登録されている Webhook URL（この店舗のものか）
 *   2. その URL にテストの通知を送ってもらい、受け取れたか（署名チェックを通ったか）
 * チャネルシークレットを間違えて登録すると 2 が失敗する（こちらが 401 を返すため）ので、登録の確かめに使う。
 */
import { classifyWebhookEndpoint } from '@/lib/line-signature';

const LINE_API = 'https://api.line.me/v2/bot';
const TIMEOUT_MS = 10000;

export interface LineWebhookCheckResult {
  /** LINE に登録されている Webhook URL（取得できなければ null） */
  endpoint: string | null;
  /** LINE 側で「Webhook の利用」が ON か（取得できなければ null） */
  active: boolean | null;
  /** 登録されている URL がこの店舗のものか */
  endpoint_status: 'same' | 'other_store' | 'other' | 'none' | 'unknown';
  /** テストの通知を受け取れたか（送っていなければ null） */
  test_success: boolean | null;
  /** 画面に出す説明（日本語） */
  messages: string[];
  /** すべて問題なし */
  ok: boolean;
}

async function lineFetch(path: string, token: string, init: RequestInit, fetchImpl: typeof fetch): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${LINE_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLineWebhook(input: { token: string; origin: string; storeId: string; secretSet: boolean; fetchImpl?: typeof fetch }): Promise<LineWebhookCheckResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const result: LineWebhookCheckResult = { endpoint: null, active: null, endpoint_status: 'unknown', test_success: null, messages: [], ok: false };

  const info = await lineFetch('/channel/webhook/endpoint', input.token, { method: 'GET' }, fetchImpl);
  if (!info.ok || !info.json) {
    if (info.status === 401) result.messages.push('LINE チャネルアクセストークンが無効です。店舗編集で登録し直してください。');
    else if (info.status === 404) {
      result.endpoint_status = 'none';
      result.messages.push('LINE に Webhook URL が登録されていません。LINE Developers の「Messaging API 設定」で登録してください。');
    } else result.messages.push(`LINE から Webhook の設定を取得できませんでした（${info.status || '通信エラー'}）。時間をおいてもう一度お試しください。`);
    return result;
  }

  result.endpoint = typeof info.json.endpoint === 'string' ? info.json.endpoint : null;
  result.active = typeof info.json.active === 'boolean' ? info.json.active : null;
  result.endpoint_status = classifyWebhookEndpoint(result.endpoint, input.origin, input.storeId);

  if (result.endpoint_status === 'none') {
    result.messages.push('LINE に Webhook URL が登録されていません。LINE Developers の「Messaging API 設定」で登録してください。');
    return result;
  }
  if (result.endpoint_status === 'other_store') {
    result.messages.push('LINE に登録されている Webhook URL は、別の店舗のものです。公式 LINE 1 つにつき Webhook URL は 1 つだけなので、この店舗には通知が届きません。');
    return result;
  }
  if (result.endpoint_status === 'other') {
    result.messages.push('LINE に登録されている Webhook URL は、この店舗のものではありません。上の「この店舗の Webhook URL」を LINE Developers に登録してください。');
    return result;
  }
  if (result.active === false) {
    result.messages.push('LINE 側で「Webhook の利用」が OFF になっています。LINE Developers の「Messaging API 設定」で ON にしてください。');
    return result;
  }

  const test = await lineFetch('/channel/webhook/test', input.token, { method: 'POST', body: JSON.stringify({}) }, fetchImpl);
  if (!test.ok || !test.json) {
    result.messages.push(`LINE からテストの通知を送れませんでした（${test.status || '通信エラー'}）。時間をおいてもう一度お試しください。`);
    return result;
  }
  result.test_success = test.json.success === true;
  if (result.test_success) {
    result.ok = true;
    result.messages.push(input.secretSet ? 'LINE からの通知を受け取れました。署名のチェックも通っています。' : 'LINE からの通知を受け取れました（チャネルシークレットは未登録のため、署名のチェックはしていません）。');
    return result;
  }
  const statusCode = typeof test.json.statusCode === 'number' ? test.json.statusCode : null;
  if (statusCode === 401 && input.secretSet) {
    result.messages.push('署名が合いませんでした。登録したチャネルシークレットが、この公式 LINE のものと違う可能性があります。LINE Developers の「チャネル基本設定」のチャネルシークレットを確認して、登録し直してください。');
    result.messages.push('このままだと、この店舗の LINE の自動応答（予約確認・キャンセルなど）が動きません。正しいシークレットが分からないときは、いったん削除してください。');
  } else {
    result.messages.push(`LINE からの通知を受け取れませんでした（応答: ${statusCode ?? '不明'}）。時間をおいてもう一度お試しください。`);
  }
  return result;
}
