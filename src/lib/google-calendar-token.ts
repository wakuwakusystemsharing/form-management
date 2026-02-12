import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const KEY_LEN = 32;

function getEncryptionKey(): Buffer | null {
  const raw = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.length >= 32 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
}

/**
 * Encrypts a refresh token for storage. Returns null if encryption key is not set.
 */
export function encryptRefreshToken(plain: string): string | null {
  const key = getEncryptionKey();
  if (!key || key.length !== KEY_LEN) return null;

  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

/**
 * Decrypts a stored refresh token. Returns null if key is missing or decryption fails.
 */
export function decryptRefreshToken(encrypted: string): string | null {
  const key = getEncryptionKey();
  if (!key || key.length !== KEY_LEN) return null;

  let buf: Buffer;
  try {
    buf = Buffer.from(encrypted, 'base64');
  } catch {
    return null;
  }
  if (buf.length < IV_LEN + AUTH_TAG_LEN) return null;

  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);

  try {
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(enc).toString('utf8') + decipher.final('utf8');
  } catch {
    return null;
  }
}
