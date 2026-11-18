/**
 * 空き待ち（キャンセル待ち）の保存（local = data/waitlist.json）と、local での登録・終了
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let repo: typeof import('@/lib/waitlist-repository');
let service: typeof import('@/lib/waitlist-service');

const hours = { open: '09:00', close: '18:00', closed: false };
const business_hours = { monday: hours, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: hours };
const NOW = new Date('2026-11-20T10:00:00+09:00');

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlist-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'data', 'stores.json'), JSON.stringify([{ id: 'st0001', name: 'A店' }]));
  fs.writeFileSync(
    path.join(tmpDir, 'data', 'forms_st0001.json'),
    JSON.stringify([
      { id: 'f_on', store_id: 'st0001', form_type: 'line', config: { basic_info: { form_name: 'ON' }, calendar_settings: { booking_mode: 'calendar', business_hours, waitlist: { enabled: true, max_per_user: 2, deadline_hours: 1 } } } },
      { id: 'f_off', store_id: 'st0001', form_type: 'line', config: { basic_info: { form_name: 'OFF' }, calendar_settings: { booking_mode: 'calendar', business_hours } } },
    ])
  );
  repo = await import('@/lib/waitlist-repository');
  service = await import('@/lib/waitlist-service');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const reg = (formId: string, user: string, date: string, time: string) =>
  service.registerWaitlist({ storeId: 'st0001', formId, lineUserId: user, date, time, selectedMenus: [{ menu_id: 'm1', menu_name: 'カット', duration: 60 }], now: NOW });

describe('空き待ちの保存（local）', () => {
  it('空き待ちが無い店舗では何も返さない（ファイルが無くても落ちない）', async () => {
    expect(await repo.hasActiveWaitlist('st0001')).toBe(false);
    expect(await repo.listActiveWaitlist()).toEqual([]);
    expect(await repo.listWaitlistForStore('st0001')).toEqual([]);
    expect(await service.processWaitlist({ now: NOW })).toMatchObject({ checked: 0 });
  });

  it('ON のフォームだけ登録できる。OFF（未設定）のフォームは断る', async () => {
    expect(await reg('f_off', 'U1', '2026-11-25', '14:00')).toMatchObject({ ok: false, code: 'disabled' });
    const r = await reg('f_on', 'U1', '2026-11-25', '14:00');
    expect(r.ok).toBe(true);
    expect(await repo.hasActiveWaitlist('st0001')).toBe(true);
    expect(await reg('f_on', 'U1', '2026-11-25', '14:00')).toMatchObject({ ok: false, code: 'duplicate' });
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'data', 'waitlist.json'), 'utf-8'));
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({ status: 'waiting', duration_minutes: 60, reservation_time: '14:00' });
  });

  it('状態の書き換えは、指定した状態のときだけ（先に確保した 1 回だけ成功する）', async () => {
    const [entry] = await repo.listActiveWaitlistForUser('st0001', 'U1');
    expect(await repo.transitionWaitlistEntry(entry.id, ['waiting'], { status: 'notified' })).toBe(true);
    expect(await repo.transitionWaitlistEntry(entry.id, ['waiting'], { status: 'notified' })).toBe(false);
    expect((await repo.getWaitlistEntry(entry.id))?.status).toBe('notified');
  });

  it('予約が取れたら、その日時の空き待ちだけ「予約済み」になる', async () => {
    await reg('f_on', 'U1', '2026-11-26', '10:00');
    expect(await repo.fulfillWaitlistForSlot('st0001', 'U1', '2026-11-25', '14:00')).toBe(1);
    const rest = await repo.listActiveWaitlistForUser('st0001', 'U1');
    expect(rest.map((e) => e.reservation_date)).toEqual(['2026-11-26']);
  });

  it('送信履歴: 新しい順に、お客様名と希望日時を添えて返す。今月の送信数は成功と失敗を分けて数える', async () => {
    const [entry] = await repo.listWaitlistForStore('st0001', { statuses: ['fulfilled'] });
    await repo.recordWaitlistNotification({ waitlist_entry_id: entry.id, store_id: 'st0001', type: 'slot_opened', slot_start_at: null, result: 'success', error_message: null });
    await new Promise((r) => setTimeout(r, 5));
    await repo.recordWaitlistNotification({ waitlist_entry_id: entry.id, store_id: 'st0001', type: 'slot_filled', slot_start_at: null, result: 'failed', error_message: '400 blocked' });
    await repo.recordWaitlistNotification({ waitlist_entry_id: entry.id, store_id: 'st9999', type: 'slot_opened', slot_start_at: null, result: 'success', error_message: null });
    const list = await repo.listWaitlistNotifications('st0001');
    expect(list.map((n) => [n.type, n.result])).toEqual([['slot_filled', 'failed'], ['slot_opened', 'success']]);
    expect(list[0]).toMatchObject({ reservation_date: '2026-11-25', reservation_time: '14:00', error_message: '400 blocked' });
    const now = Date.now();
    expect(await repo.countWaitlistNotifications('st0001', new Date(now - 3600000).toISOString(), new Date(now + 3600000).toISOString())).toEqual({ sent: 1, failed: 1 });
    expect(await repo.countWaitlistNotifications('st0001', new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString())).toEqual({ sent: 0, failed: 0 });
  });

  it('日時を過ぎた空き待ちは、見回りで自動的に終了する', async () => {
    const summary = await service.processWaitlist({ now: new Date('2026-11-26T10:00:00+09:00') });
    expect(summary.expired).toBe(1);
    expect(await repo.hasActiveWaitlist('st0001')).toBe(false);
    const all = await repo.listWaitlistForStore('st0001');
    expect(all.map((e) => e.status).sort()).toEqual(['expired', 'fulfilled']);
  });
});
