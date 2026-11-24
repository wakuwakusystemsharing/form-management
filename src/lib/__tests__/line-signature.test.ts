import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  buildLineWebhookUrl,
  classifyWebhookEndpoint,
  computeLineSignature,
  decideWebhookSignature,
  normalizeChannelSecret,
  verifyLineSignature,
} from '../line-signature';

const SECRET = '0123456789abcdef0123456789abcdef';
const BODY = '{"destination":"U1","events":[{"type":"message","message":{"type":"text","text":"こんにちは"}}]}';
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('base64');

describe('署名の計算と確認', () => {
  it('LINE と同じ計算（HMAC-SHA256 → Base64）になる', () => {
    expect(computeLineSignature(BODY, SECRET)).toBe(sign(BODY));
  });

  it('正しい署名は通り、内容が 1 文字でも違うと通らない', () => {
    expect(verifyLineSignature(BODY, SECRET, sign(BODY))).toBe(true);
    expect(verifyLineSignature(BODY + ' ', SECRET, sign(BODY))).toBe(false);
    expect(verifyLineSignature(BODY.replace('こんにちは', 'こんばんは'), SECRET, sign(BODY))).toBe(false);
  });

  it('別のシークレットで作った署名・空の署名・長さの違う署名は通らない', () => {
    expect(verifyLineSignature(BODY, SECRET, sign(BODY, 'ffffffffffffffffffffffffffffffff'))).toBe(false);
    expect(verifyLineSignature(BODY, SECRET, '')).toBe(false);
    expect(verifyLineSignature(BODY, SECRET, null)).toBe(false);
    expect(verifyLineSignature(BODY, SECRET, 'abc')).toBe(false);
    expect(verifyLineSignature(BODY, '', sign(BODY, ''))).toBe(false);
  });

  it('JSON にしてから文字列に戻したものでは通らない（届いた文字列そのままを使う必要がある）', () => {
    const spaced = '{ "events": [] }';
    const signature = sign(spaced);
    expect(verifyLineSignature(spaced, SECRET, signature)).toBe(true);
    expect(verifyLineSignature(JSON.stringify(JSON.parse(spaced)), SECRET, signature)).toBe(false);
  });
});

describe('Webhook をどう扱うか', () => {
  it('シークレット未登録の店舗は確認せずに通す（今までと同じ）', () => {
    expect(decideWebhookSignature({ secret: null, rawBody: BODY, signature: null })).toBe('unverified');
    expect(decideWebhookSignature({ secret: '   ', rawBody: BODY, signature: 'でたらめ' })).toBe('unverified');
  });

  it('登録済みの店舗は、正しい署名だけ受け付ける', () => {
    expect(decideWebhookSignature({ secret: SECRET, rawBody: BODY, signature: sign(BODY) })).toBe('verified');
    expect(decideWebhookSignature({ secret: SECRET, rawBody: BODY, signature: null })).toBe('rejected');
    expect(decideWebhookSignature({ secret: SECRET, rawBody: BODY, signature: sign('別の内容') })).toBe('rejected');
  });

  it('LINE の「検証」ボタン（events が空）も署名が合えば通る', () => {
    const empty = '{"destination":"U1","events":[]}';
    expect(decideWebhookSignature({ secret: SECRET, rawBody: empty, signature: sign(empty) })).toBe('verified');
  });
});

describe('チャネルシークレットの入力', () => {
  it('前後の空白を除き、英数字 16〜128 文字だけ受け付ける', () => {
    expect(normalizeChannelSecret(`  ${SECRET}\n`)).toBe(SECRET);
    expect(normalizeChannelSecret('short')).toBeNull();
    expect(normalizeChannelSecret('0123456789abcdef 0123456789abcdef')).toBeNull();
    expect(normalizeChannelSecret('あ'.repeat(32))).toBeNull();
    expect(normalizeChannelSecret(123)).toBeNull();
    expect(normalizeChannelSecret('')).toBeNull();
  });
});

describe('Webhook URL', () => {
  const origin = 'https://app.example';

  it('店舗ごとの URL を作る', () => {
    expect(buildLineWebhookUrl(origin, 'abc123')).toBe('https://app.example/api/webhooks/line?storeId=abc123');
    expect(buildLineWebhookUrl('https://app.example/', 'abc123')).toBe('https://app.example/api/webhooks/line?storeId=abc123');
  });

  it('LINE に登録されている URL がこの店舗のものかを見分ける', () => {
    expect(classifyWebhookEndpoint('https://app.example/api/webhooks/line?storeId=abc123', origin, 'abc123')).toBe('same');
    expect(classifyWebhookEndpoint('https://app.example/api/webhooks/line?storeId=zzz999', origin, 'abc123')).toBe('other_store');
    expect(classifyWebhookEndpoint('https://app.example/api/webhooks/line', origin, 'abc123')).toBe('other_store');
    expect(classifyWebhookEndpoint('https://other.example/api/webhooks/line?storeId=abc123', origin, 'abc123')).toBe('other');
    expect(classifyWebhookEndpoint('https://other.example/hook', origin, 'abc123')).toBe('other');
    expect(classifyWebhookEndpoint('', origin, 'abc123')).toBe('none');
    expect(classifyWebhookEndpoint(null, origin, 'abc123')).toBe('none');
    expect(classifyWebhookEndpoint('壊れた URL', origin, 'abc123')).toBe('other');
  });
});
