/**
 * LINE メッセージのあいさつメッセージ（友だち追加されたときに送る）の通し確認（local = JSON）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/line-flex-service');
let repo: typeof import('@/lib/line-flex-repository');

const origin = 'https://app.example.com';
const card = (title: string) => ({ title, text: '本文', buttons: [] }) as never;

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-flex-greeting-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'data', 'stores.json'), JSON.stringify([{ id: 'st0001', name: 'A店' }]));
  service = await import('@/lib/line-flex-service');
  repo = await import('@/lib/line-flex-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('あいさつメッセージ（友だち追加されたときに送る）', () => {
  it('ON のメッセージが無ければ何も返さない（既定は OFF）', async () => {
    const r = await service.createLineFlexMessage('st0001', { id: 'normal000001', name: '通常', template: 'booking_card', alt_text: '通常', data: card('通常') }, origin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.send_on_follow).toBe(false);
    expect(await service.listLineFlexGreetingMessages('st0001')).toBeNull();
  });

  it('ON のメッセージを、追加のメッセージも含めて返す。送った回数を数える', async () => {
    const r = await service.createLineFlexMessage(
      'st0001',
      {
        id: 'greeting0001', name: 'あいさつ', template: 'booking_card', alt_text: 'ようこそ', data: card('ようこそ'), send_on_follow: true,
        items: [{ key: 't1', type: 'text', text: '友だち追加ありがとうございます' }, { key: 'main', type: 'main' }],
      },
      origin
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.send_on_follow).toBe(true);

    const messages = await service.listLineFlexGreetingMessages('st0001');
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toEqual({ type: 'text', text: '友だち追加ありがとうございます' });
    expect((messages?.[1] as { type: string; altText: string }).type).toBe('flex');
    expect((messages?.[1] as { type: string; altText: string }).altText).toBe('ようこそ');

    const saved = await repo.getLineFlexMessage('st0001', 'greeting0001');
    expect(saved?.reply_count).toBe(1);
    // 他の店舗には出ない
    expect(await service.listLineFlexGreetingMessages('st9999')).toBeNull();
  });

  it('無効にしたメッセージは送らない。複数あれば合わせて 5 通まで', async () => {
    const first = await repo.getLineFlexMessage('st0001', 'greeting0001');
    const off = await service.saveLineFlexMessage('st0001', 'greeting0001', { ...first!, enabled: false }, origin);
    expect(off.ok).toBe(true);
    expect(await service.listLineFlexGreetingMessages('st0001')).toBeNull();

    for (const id of ['greeting0002', 'greeting0003']) {
      const r = await service.createLineFlexMessage(
        'st0001',
        {
          id, name: id, template: 'booking_card', alt_text: id, data: card(id), send_on_follow: true,
          items: [{ key: 'main', type: 'main' }, { key: 't1', type: 'text', text: 'a' }, { key: 't2', type: 'text', text: 'b' }],
        },
        origin
      );
      expect(r.ok).toBe(true);
    }
    const messages = await service.listLineFlexGreetingMessages('st0001');
    expect(messages).toHaveLength(5);
  });
});
