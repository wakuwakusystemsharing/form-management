/**
 * 寄せ書きウォールの投稿者ハッシュ — サーバー専用（node:crypto）
 *
 * author_hash = HMAC-SHA256(WALL_AUTHOR_HASH_SECRET, `${store_id}:${line_user_id}`)
 * - 店舗 ID を混ぜるので、同じ人でも店舗が違えば別の値（店舗をまたいだ突合ができない）
 * - 秘密鍵は環境変数。local 環境だけは未設定でも開発用の固定値で動く
 * - 鍵を変えると本人削除・通報の重複判定ができなくなるため、ローテーションは想定しない
 */
import { createHmac } from 'crypto';
import { getAppEnvironment } from '@/lib/env';

const LOCAL_DEV_SECRET = 'local-dev-wall-author-hash-secret-not-for-production';

export class WallSecretMissingError extends Error {
  constructor() {
    super('WALL_AUTHOR_HASH_SECRET が設定されていません');
  }
}

export function getWallHashSecret(): string {
  const secret = (process.env.WALL_AUTHOR_HASH_SECRET || '').trim();
  if (secret.length >= 32) return secret;
  if (getAppEnvironment() === 'local') return LOCAL_DEV_SECRET;
  throw new WallSecretMissingError();
}

export function computeWallAuthorHash(storeId: string, lineUserId: string, secret: string = getWallHashSecret()): string {
  return createHmac('sha256', secret).update(`${storeId}:${lineUserId}`).digest('hex');
}
