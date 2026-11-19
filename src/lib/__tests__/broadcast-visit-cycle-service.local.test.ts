/**
 * 自動配信「いつもの来店間隔に合わせてお誘い」（local = JSON）: 見積り → 実行 → 二重に送らない
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let svc: typeof import('@/lib/broadcast-automation-service');
let repo: typeof import('@/lib/broadcast-repository');

const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const origin = 'https://app.example.com';
const lineId = (n: number) => `U${String(n).padStart(32, '0')}`;
// JST 2026-11-10 12:00
const NOON = new Date('2026-11-10T03:00:00Z');
const FAR = Date.now() + 10 * 60 * 1000;
const trigger = { type: 'visit_cycle' as const, offset_days: 0, first_visit_days: null };

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broadcast-visit-cycle-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: 'st0001', name: 'A店', line_channel_access_token: 'token-a' }]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([
    // 30 日おきに 4 回、最終来店が 30 日前 → 今日が送る日
    { id: 'c1', store_id: 'st0001', name: 'そろそろ', line_user_id: lineId(1), line_friend_flag: true, total_visits: 4, first_visit_date: '2026-07-13', last_visit_date: '2026-10-11' },
    // 同じ条件だが、これからの予約がある
    { id: 'c2', store_id: 'st0001', name: '予約あり', line_user_id: lineId(2), line_friend_flag: true, total_visits: 4, first_visit_date: '2026-07-13', last_visit_date: '2026-10-11' },
    // 30 日おきで、最終来店が 10 日前 → まだ
    { id: 'c3', store_id: 'st0001', name: 'まだ早い', line_user_id: lineId(3), line_friend_flag: true, total_visits: 3, first_visit_date: '2026-09-01', last_visit_date: '2026-10-31' },
    // 来店 1 回・45 日前
    { id: 'c4', store_id: 'st0001', name: '来店1回', line_user_id: lineId(4), line_friend_flag: true, total_visits: 1, first_visit_date: '2026-09-26', last_visit_date: '2026-09-26' },
  ]));
  fs.writeFileSync(dataFile('reservations.json'), JSON.stringify([
    { id: 'r1', store_id: 'st0001', customer_id: 'c2', line_user_id: lineId(2), form_id: 'f1', reservation_date: '2026-11-20', status: 'confirmed', selected_menus: [] },
    // キャンセルした予約は「これからの予約」に数えない
    { id: 'r2', store_id: 'st0001', customer_id: 'c1', line_user_id: lineId(1), form_id: 'f1', reservation_date: '2026-11-25', status: 'cancelled', selected_menus: [] },
  ]));
  svc = await import('@/lib/broadcast-automation-service');
  repo = await import('@/lib/broadcast-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('いつもの来店間隔に合わせてお誘い（local）', () => {
  it('見積り: いつもの間隔がたった人だけ。これからの予約がある人は（絞り込みを足さなくても）除く', async () => {
    const p = await svc.previewAutomation('st0001', null, { trigger }, NOON);
    expect(p).toMatchObject({ ok: true, value: { count: 1, sample: ['そろそろ'], trigger: 'いつもの来店間隔がたった日' } });
  });

  it('来店 1 回の人の目安の日数を入れると、その人にも送る', async () => {
    const p = await svc.previewAutomation('st0001', null, { trigger: { ...trigger, first_visit_days: 45 } }, NOON);
    expect(p).toMatchObject({ ok: true, value: { count: 2, sample: ['そろそろ', '来店1回'] } });
  });

  it('実行すると配信ができ、翌日は同じ人に送らない', async () => {
    const saved = await svc.saveAutomation('st0001', null, { name: 'そろそろいかがですか', enabled: true, trigger, items: [{ key: 'a', type: 'text', text: '{name}さん、そろそろいかがですか？' }] }, origin);
    expect(saved).toMatchObject({ ok: true, value: { trigger, resend_after_days: null } });
    const first = await svc.runDueAutomations(NOON, origin, FAR);
    expect(first).toMatchObject({ checked: 1, created: 1, recipients: 1 });
    const b = (await repo.listBroadcasts('st0001'))[0];
    expect(b).toMatchObject({ name: '【自動】そろそろいかがですか', status: 'scheduled', recipient_count: 1 });
    expect((await repo.listBroadcastRecipients(b.id)).recipients.map((r) => r.customer_id)).toEqual(['c1']);

    const nextDay = await svc.runDueAutomations(new Date(NOON.getTime() + 24 * 60 * 60 * 1000), origin, FAR);
    expect(nextDay).toMatchObject({ checked: 1, created: 0 });
  });
});
