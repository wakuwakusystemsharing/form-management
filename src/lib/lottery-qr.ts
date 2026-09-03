/**
 * 抽選の当選 QR コード（トークン形式と QR の中身）
 */
import { getBaseUrl } from '@/lib/env';

export const QR_TOKEN_PATTERN = /^[a-z0-9]{32}$/;

/** QR の中身: 店舗スタッフ用スキャン画面が読み取る URL */
export function buildQrPayload(token: string): string {
  return `${getBaseUrl()}/r/${token}`;
}

/** QR 画像（PNG）の URL。Flex メッセージと静的フォームから参照する */
export function buildQrImageUrl(token: string, baseUrl: string = getBaseUrl()): string {
  return `${baseUrl}/api/lotteries/qr/${encodeURIComponent(token)}.png`;
}

/** スキャン結果（URL または生トークン）からトークンを取り出す。不正なら null */
export function extractQrToken(scanned: string): string | null {
  const text = (scanned || '').trim();
  if (QR_TOKEN_PATTERN.test(text)) return text;
  const m = text.match(/\/r\/([a-z0-9]{32})(?:[/?#]|$)/);
  return m ? m[1] : null;
}
