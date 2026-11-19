/**
 * 配信の成果（local = JSON）: タップした人の記録 → 一覧用の要約 / 配信ごとの詳細
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Broadcast } from '@/types/broadcast';

let tmpDir = '';
let originalCwd = '';
let repo: typeof import('@/lib/broadcast-repository');
let service: typeof import('@/lib/broadcast-results-service');

const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const SENT = '2026-11-01T01:00:00.000Z';
const at = (days: number, hours = 0) => new Date(Date.parse(SENT) + (days * 24 + hours) * 60 * 60 * 1000).toISOString();
const NOW = new Date(at(20));
const ORIGIN = 'https://app.example.com';

function sentBroadcast(id: string, patch: Partial<Broadcast> = {}): Broadcast {
  return {
    id, store_id: 'st0001', name: '秋のキャンペーン', status: 'sent', audience: {}, items: [],
    payloads: [{ type: 'flex', altText: 'a', contents: { type: 'bubble', footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: '予約', uri: `${ORIGIN}/go/b/${id}/1?r=__RID__` } }] } } }],
    has_personalization: false, track_taps: true, links: { '1': 'https://liff.line.me/1234-abcd' }, tap_counts: {}, scheduled_at: SENT, claimed_at: null, started_at: SENT, finished_at: SENT,
    recipient_count: 2, sent_count: 2, failed_count: 0, error: null, automation_id: null, created_by: null, created_at: SENT, updated_at: SENT, ...patch,
  };
}

/** Edge Function の代わりに、宛先を送信済みにする */
function markAllSent() {
  const file = dataFile('broadcast_data.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  for (const r of data.recipients) {
    r.status = 'sent';
    r.sent_at = SENT;
  }
  fs.writeFileSync(file, JSON.stringify(data));
}

let idA = '';
let idOld = '';
let idDraft = '';

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broadcast-results-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: 'st0001', name: 'A店' }, { id: 'st0002', name: 'B店' }]));
  fs.writeFileSync(dataFile('reservations.json'), JSON.stringify([
    { id: 'r1', store_id: 'st0001', customer_id: 'c1', line_user_id: 'U1', created_at: at(1), reservation_date: '2026-11-10', reservation_time: '10:00', status: 'confirmed', selected_menus: [{ menu_name: 'カット', price: 5000 }] },
    { id: 'r2', store_id: 'st0001', customer_id: 'c2', line_user_id: 'U2', created_at: at(2), reservation_date: '2026-11-11', reservation_time: '11:00', status: 'confirmed', selected_menus: [{ menu_name: 'カラー', price: 8000 }] },
    { id: 'r3', store_id: 'st0001', customer_id: 'c2', line_user_id: 'U2', created_at: at(10), reservation_date: '2026-11-20', reservation_time: '11:00', status: 'confirmed', selected_menus: [{ menu_name: 'カット', price: 5000 }] },
    { id: 'x1', store_id: 'st0002', customer_id: 'c1', line_user_id: 'U1', created_at: at(1), reservation_date: '2026-11-10', status: 'confirmed', selected_menus: [{ menu_name: '他店', price: 99999 }] },
  ]));
  repo = await import('@/lib/broadcast-repository');
  service = await import('@/lib/broadcast-results-service');

  idA = repo.newBroadcastId();
  idOld = repo.newBroadcastId();
  idDraft = repo.newBroadcastId();
  await repo.insertBroadcast(sentBroadcast(idA));
  await repo.insertBroadcast(sentBroadcast(idOld, { name: '古い配信', payloads: [{ type: 'text', text: 'こんにちは' }], links: {} }));
  await repo.insertBroadcast(sentBroadcast(idDraft, { name: '下書き', status: 'draft', started_at: null, finished_at: null }));
  for (const id of [idA, idOld]) {
    await repo.replaceBroadcastRecipients('st0001', id, [{ customer_id: 'c1', line_user_id: 'U1', display_name: '山田' }, { customer_id: 'c2', line_user_id: 'U2', display_name: '佐藤' }]);
  }
  markAllSent();
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('タップした人の記録（local）', () => {
  it('最初のタップの日時を残し、2 回目以降は回数だけ増える。知らない ID は無視', async () => {
    const { recipients } = await repo.listBroadcastRecipients(idA);
    const yamada = recipients.find((r) => r.customer_id === 'c1')!;
    expect(yamada.tapped_at).toBeNull();
    await repo.recordBroadcastTap(yamada.id, new Date(at(0, 2)));
    await repo.recordBroadcastTap(yamada.id, new Date(at(0, 5)));
    await repo.recordBroadcastTap('00000000-0000-0000-0000-000000000000', new Date(at(0, 5)));
    const after = (await repo.listBroadcastRecipients(idA)).recipients;
    expect(after.find((r) => r.customer_id === 'c1')).toMatchObject({ tapped_at: at(0, 2), tap_count: 2 });
    expect(after.find((r) => r.customer_id === 'c2')).toMatchObject({ tapped_at: null, tap_count: 0 });
  });
});

describe('配信の成果（local）', () => {
  it('一覧用: 送信済みの配信ごとに要約を返す（下書きは含めない）', async () => {
    const r = await service.getBroadcastResultSummaries('st0001', 7, NOW);
    expect(r.days).toBe(7);
    expect(Object.keys(r.results).sort()).toEqual([idA, idOld].sort());
    expect(r.results[idA]).toMatchObject({
      tracked: true, sent: 2, tapped_people: 1, counting: false,
      tapped: { people: 1, reservations: 1, revenue: 5000 },
      received: { people: 2, reservations: 2, revenue: 13000 },
    });
    // 誰がタップしたかを記録していない配信は、受け取った人の予約だけ
    expect(r.results[idOld]).toMatchObject({ tracked: false, tapped: { reservations: 0 }, received: { reservations: 2 } });
    expect(r.results[idA]).not.toHaveProperty('rows');
  });

  it('期間を 14 日にすると 10 日後の予約も入る', async () => {
    const r = await service.getBroadcastResultSummaries('st0001', 14, NOW);
    expect(r.results[idA].received).toEqual({ people: 2, reservations: 3, revenue: 18000 });
  });

  it('配信ごとの詳細: 予約した人の一覧を返す。LINE ユーザー ID は含めない', async () => {
    const r = await service.getBroadcastResultDetail('st0001', idA, 7, NOW);
    expect(r?.rows.map((x) => [x.name, x.tapped, x.reservations.map((y) => y.id)])).toEqual([['山田', true, ['r1']], ['佐藤', false, ['r2']]]);
    expect(JSON.stringify(r)).not.toContain('U1');
    expect(await service.getBroadcastResultDetail('st0002', idA, 7, NOW)).toBeNull();
    expect(await service.getBroadcastResultDetail('st0001', idDraft, 7, NOW)).toBeNull();
  });
});
