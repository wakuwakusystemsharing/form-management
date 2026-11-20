/**
 * チャネルシークレットの保存（local = JSON）と、接続の確認の動作確認
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLineWebhook } from '@/lib/line-webhook-check';

let tmpDir = '';
let originalCwd = '';
let repo: typeof import('@/lib/line-secret-repository');

const SECRET = '0123456789abcdef0123456789abcdef';

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-secret-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  repo = await import('@/lib/line-secret-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('チャネルシークレットの保存（local）', () => {
  it('未登録は none。登録すると店舗ごとに読め、上書き・削除できる', async () => {
    expect(await repo.getStoreLineSecret('st0001')).toEqual({ status: 'none' });
    expect(await repo.setStoreLineSecret('st0001', SECRET, new Date('2026-11-20T00:00:00Z'))).toBeNull();
    expect(await repo.getStoreLineSecret('st0001')).toEqual({ status: 'set', secret: SECRET, updated_at: '2026-11-20T00:00:00.000Z' });
    // 他の店舗には影響しない
    expect(await repo.getStoreLineSecret('st0002')).toEqual({ status: 'none' });
    // 上書き（1 店舗 1 行のまま）
    await repo.setStoreLineSecret('st0001', 'f'.repeat(32));
    const state = await repo.getStoreLineSecret('st0001');
    expect(state.status === 'set' && state.secret).toBe('f'.repeat(32));
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, 'data', 'store_line_secrets.json'), 'utf-8'))).toHaveLength(1);
    // 削除すると未登録に戻る（何度削除してもエラーにならない）
    expect(await repo.deleteStoreLineSecret('st0001')).toBeNull();
    expect(await repo.deleteStoreLineSecret('st0001')).toBeNull();
    expect(await repo.getStoreLineSecret('st0001')).toEqual({ status: 'none' });
  });

  it('テーブルが無い（マイグレーション未適用）エラーを見分ける', () => {
    expect(repo.isMissingSecretTable({ code: '42P01', message: 'relation "store_line_secrets" does not exist' })).toBe(true);
    expect(repo.isMissingSecretTable({ code: 'PGRST205', message: "Could not find the table 'public.store_line_secrets' in the schema cache" })).toBe(true);
    expect(repo.isMissingSecretTable({ message: "Could not find the table 'public.store_line_secrets' in the schema cache" })).toBe(true);
    expect(repo.isMissingSecretTable({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(repo.isMissingSecretTable(null)).toBe(false);
  });
});

/** LINE の API の代わり（URL の末尾で答えを決める） */
function fakeLine(answers: Record<string, { status: number; json: unknown }>): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const key = Object.keys(answers).find((k) => u.endsWith(k)) ?? u.replace('https://api.line.me/v2/bot', '');
    calls.push(`${init?.method ?? 'GET'} ${key}`);
    const a = answers[key] ?? { status: 500, json: null };
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('接続を確認', () => {
  const base = { token: 't', origin: 'https://app.example', storeId: 'abc123' };
  const mine = 'https://app.example/api/webhooks/line?storeId=abc123';

  it('この店舗の URL が登録されていて、テストの通知を受け取れたら OK', async () => {
    const { fetchImpl, calls } = fakeLine({
      '/channel/webhook/endpoint': { status: 200, json: { endpoint: mine, active: true } },
      '/channel/webhook/test': { status: 200, json: { success: true, statusCode: 200 } },
    });
    const r = await checkLineWebhook({ ...base, secretSet: true, fetchImpl });
    expect(r).toMatchObject({ ok: true, endpoint: mine, endpoint_status: 'same', test_success: true });
    expect(r.messages[0]).toContain('署名のチェックも通っています');
    expect(calls).toEqual(['GET /channel/webhook/endpoint', 'POST /channel/webhook/test']);
    // シークレット未登録なら、その旨を添える
    const r2 = await checkLineWebhook({ ...base, secretSet: false, fetchImpl });
    expect(r2.ok).toBe(true);
    expect(r2.messages[0]).toContain('未登録');
  });

  it('シークレットが違うと（こちらが 401 を返すので）失敗し、直し方を案内する', async () => {
    const { fetchImpl } = fakeLine({
      '/channel/webhook/endpoint': { status: 200, json: { endpoint: mine, active: true } },
      '/channel/webhook/test': { status: 200, json: { success: false, statusCode: 401, reason: 'COULD_NOT_CONNECT' } },
    });
    const r = await checkLineWebhook({ ...base, secretSet: true, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.test_success).toBe(false);
    expect(r.messages.join('')).toContain('チャネルシークレット');
    expect(r.messages.join('')).toContain('いったん削除');
  });

  it('別の店舗の URL・未登録・Webhook が OFF のときは、テストを送らずに理由を返す', async () => {
    const other = fakeLine({ '/channel/webhook/endpoint': { status: 200, json: { endpoint: 'https://app.example/api/webhooks/line?storeId=zzz999', active: true } } });
    const r1 = await checkLineWebhook({ ...base, secretSet: true, fetchImpl: other.fetchImpl });
    expect(r1).toMatchObject({ ok: false, endpoint_status: 'other_store', test_success: null });
    expect(r1.messages[0]).toContain('別の店舗');
    expect(other.calls).toEqual(['GET /channel/webhook/endpoint']);

    const none = fakeLine({ '/channel/webhook/endpoint': { status: 404, json: { message: 'Not found' } } });
    expect(await checkLineWebhook({ ...base, secretSet: false, fetchImpl: none.fetchImpl })).toMatchObject({ ok: false, endpoint_status: 'none' });

    const off = fakeLine({ '/channel/webhook/endpoint': { status: 200, json: { endpoint: mine, active: false } } });
    const r3 = await checkLineWebhook({ ...base, secretSet: true, fetchImpl: off.fetchImpl });
    expect(r3.ok).toBe(false);
    expect(r3.messages[0]).toContain('OFF');
    expect(off.calls).toEqual(['GET /channel/webhook/endpoint']);
  });

  it('トークンが無効なら、その旨を返す', async () => {
    const { fetchImpl } = fakeLine({ '/channel/webhook/endpoint': { status: 401, json: { message: 'invalid token' } } });
    const r = await checkLineWebhook({ ...base, secretSet: false, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toContain('トークンが無効');
  });
});
