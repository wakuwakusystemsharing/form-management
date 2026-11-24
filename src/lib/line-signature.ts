/**
 * LINE Webhook の署名チェック（純粋ロジック）
 *
 * LINE は Webhook を送るとき、「届ける内容そのもの（文字列）」と「チャネルシークレット」から計算した値を
 * ヘッダー `x-line-signature` に付ける（HMAC-SHA256 → Base64）。同じ計算をして一致すれば、送り主は LINE。
 *
 * - 計算には **届いた文字列をそのまま** 使う（JSON にしてから文字列に戻すと 1 文字でも変わって不一致になる）
 * - チャネルシークレットを登録していない店舗は確認しない（今までどおり通す）。設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 4 章
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const LINE_SIGNATURE_HEADER = 'x-line-signature';

/** 届いた内容とチャネルシークレットから署名を計算する */
export function computeLineSignature(rawBody: string, channelSecret: string): string {
  return createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest('base64');
}

/** 署名が正しいか（時間差で推測されない比べ方をする） */
export function verifyLineSignature(rawBody: string, channelSecret: string, signature: string | null | undefined): boolean {
  const given = (signature || '').trim();
  if (!channelSecret || !given) return false;
  const expected = Buffer.from(computeLineSignature(rawBody, channelSecret), 'utf8');
  const actual = Buffer.from(given, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Webhook をどう扱うか。
 * - unverified … シークレット未登録の店舗（確認せずに通す = 今までと同じ動き）
 * - verified   … 署名が正しい
 * - rejected   … シークレットは登録済みだが、署名が無い / 合わない（受け付けない）
 */
export type WebhookSignatureDecision = 'unverified' | 'verified' | 'rejected';

export function decideWebhookSignature(input: { secret: string | null | undefined; rawBody: string; signature: string | null | undefined }): WebhookSignatureDecision {
  const secret = (input.secret || '').trim();
  if (!secret) return 'unverified';
  return verifyLineSignature(input.rawBody, secret, input.signature) ? 'verified' : 'rejected';
}

/**
 * 入力されたチャネルシークレットを整える（前後の空白を除く）。形式が明らかにおかしければ null。
 * LINE のチャネルシークレットは 32 文字の英数字。将来の変更に備えて 16〜128 文字の英数字を受け付ける
 */
export function normalizeChannelSecret(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^[A-Za-z0-9]{16,128}$/.test(v) ? v : null;
}

/** この店舗の Webhook URL（LINE Developers に登録する URL） */
export function buildLineWebhookUrl(origin: string, storeId: string): string {
  return `${origin.replace(/\/+$/, '')}/api/webhooks/line?storeId=${encodeURIComponent(storeId)}`;
}

/**
 * LINE に登録されている Webhook URL が、この店舗のものか。
 * same = この店舗 / other_store = このシステムの別の店舗 / other = 別のシステム / none = 未登録
 */
export function classifyWebhookEndpoint(endpoint: string | null | undefined, origin: string, storeId: string): 'same' | 'other_store' | 'other' | 'none' {
  const raw = (endpoint || '').trim();
  if (!raw) return 'none';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'other';
  }
  if (url.pathname.replace(/\/+$/, '') !== '/api/webhooks/line') return 'other';
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = '';
  }
  if (originHost && url.host !== originHost) return 'other';
  return url.searchParams.get('storeId') === storeId ? 'same' : 'other_store';
}
