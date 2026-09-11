/**
 * フォローメッセージ配信予定（ローカル JSON モード）の結合テスト
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let repo: typeof import('@/lib/follow-message-repository');

const NOW = new Date('2026-09-08T03:00:00Z'); // 2026-09-08 12:00 JST

function writeStores(overrides: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(tmpDir, 'data', 'stores.json'), JSON.stringify([
    { id: 'st1', name: '店', follow_enabled: true, follow_base: 'reservation_date', follow_days_after: 7, follow_time: '12:00', ...overrides },
    { id: 'st2', name: '店2', follow_enabled: false },
  ]));
}

function readRows(): any[] {
  const f = path.join(tmpDir, 'data', 'follow_messages.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : [];
}

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-repo-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  repo = await import('@/lib/follow-message-repository');
});

function writeReservations(rows: Array<Record<string, unknown>>) {
  fs.writeFileSync(path.join(tmpDir, 'data', 'reservations.json'), JSON.stringify(rows));
}

beforeEach(() => {
  writeStores();
  fs.rmSync(path.join(tmpDir, 'data', 'follow_messages.json'), { force: true });
  writeReservations([]);
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const rsv = (id: string, extra: Record<string, unknown> = {}) => ({
  id, store_id: 'st1', line_user_id: 'U1', customer_id: 'c1', reservation_date: '2026-09-10', created_at: '2026-09-08T02:00:00Z', status: 'pending', ...extra,
});

describe('scheduleFollowMessageForReservation', () => {
  it('予約日 + 7 日 12:00 JST に予定を作る', async () => {
    const row = await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    expect(row).not.toBeNull();
    expect(row!.base_date).toBe('2026-09-10');
    expect(row!.scheduled_at).toBe('2026-09-17T03:00:00.000Z');
    expect(row!.status).toBe('scheduled');
    expect(readRows()).toHaveLength(1);
  });

  it('予約受付日基準は created_at（JST）を基準にする', async () => {
    writeStores({ follow_base: 'created_at', follow_days_after: 1, follow_time: '09:00' });
    const row = await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    expect(row!.base_date).toBe('2026-09-08');
    expect(row!.scheduled_at).toBe('2026-09-09T00:00:00.000Z');
  });

  it('フォロー OFF の店舗・LINE ID 無し・キャンセル済み・過去の予定は作らない', async () => {
    expect(await repo.scheduleFollowMessageForReservation(rsv('r1', { store_id: 'st2' }), NOW)).toBeNull();
    expect(await repo.scheduleFollowMessageForReservation(rsv('r2', { line_user_id: null }), NOW)).toBeNull();
    expect(await repo.scheduleFollowMessageForReservation(rsv('r3', { status: 'cancelled' }), NOW)).toBeNull();
    expect(await repo.scheduleFollowMessageForReservation(rsv('r4', { reservation_date: '2026-08-01' }), NOW)).toBeNull();
    expect(readRows()).toHaveLength(0);
  });

  it('同じ顧客の再予約は古い予定を superseded にして新しい予約基準で作る', async () => {
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    const row2 = await repo.scheduleFollowMessageForReservation(rsv('r2', { reservation_date: '2026-09-20' }), NOW);
    const rows = readRows();
    expect(rows.find((r) => r.reservation_id === 'r1').status).toBe('superseded');
    expect(row2!.base_date).toBe('2026-09-20');
    expect(rows.filter((r) => r.status === 'scheduled')).toHaveLength(1);
  });

  it('別の顧客の予定は差し替えない', async () => {
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    await repo.scheduleFollowMessageForReservation(rsv('r2', { line_user_id: 'U2' }), NOW);
    expect(readRows().filter((r) => r.status === 'scheduled')).toHaveLength(2);
  });

  it('送信済みの行は作り直さない', async () => {
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    const rows = readRows();
    rows[0].status = 'sent';
    fs.writeFileSync(path.join(tmpDir, 'data', 'follow_messages.json'), JSON.stringify(rows));
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    expect(readRows()[0].status).toBe('sent');
  });
});

describe('cancel / reschedule', () => {
  it('キャンセルで cancelled になり、復元で scheduled に戻る', async () => {
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    expect(await repo.cancelFollowMessageForReservation('r1', NOW)).toBe(true);
    expect(readRows()[0]).toMatchObject({ status: 'cancelled', skip_reason: 'reservation_cancelled' });
    // 復元（cancelled → pending）
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    expect(readRows()[0]).toMatchObject({ status: 'scheduled', skip_reason: null });
    expect(readRows()).toHaveLength(1);
  });

  it('存在しない予約のキャンセルは false', async () => {
    expect(await repo.cancelFollowMessageForReservation('nope', NOW)).toBe(false);
  });

  it('予約日の変更で予定日を計算し直す（未送信のみ）', async () => {
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    expect(await repo.rescheduleFollowMessageForReservation(rsv('r1', { reservation_date: '2026-09-12' }), NOW)).toBe(true);
    expect(readRows()[0]).toMatchObject({ base_date: '2026-09-12', scheduled_at: '2026-09-19T03:00:00.000Z' });
    // 差替済みは触らない
    await repo.scheduleFollowMessageForReservation(rsv('r2'), NOW);
    expect(await repo.rescheduleFollowMessageForReservation(rsv('r1', { reservation_date: '2026-09-13' }), NOW)).toBe(false);
    expect(readRows().find((r) => r.reservation_id === 'r1').base_date).toBe('2026-09-12');
  });

  it('予約日の変更で予定が過去になっても scheduled のまま残す（次回実行で送る）', async () => {
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    expect(await repo.rescheduleFollowMessageForReservation(rsv('r1', { reservation_date: '2026-08-01' }), NOW)).toBe(true);
    expect(readRows()[0]).toMatchObject({ status: 'scheduled', base_date: '2026-08-01', scheduled_at: '2026-08-08T03:00:00.000Z' });
  });

  it('店舗が OFF になっていれば store_disabled で見送り', async () => {
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    writeStores({ follow_enabled: false });
    await repo.rescheduleFollowMessageForReservation(rsv('r1', { reservation_date: '2026-09-12' }), NOW);
    expect(readRows()[0]).toMatchObject({ status: 'skipped', skip_reason: 'store_disabled' });
  });
});

describe('restoreFollowMessageForUser（再予約のキャンセルで元の予定を復活）', () => {
  it('新しい予約をキャンセルすると、差し替えられていた古い予定が scheduled に戻る', async () => {
    writeReservations([{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'cancelled' }]);
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    await repo.scheduleFollowMessageForReservation(rsv('r2', { reservation_date: '2026-09-20' }), NOW);
    await repo.cancelFollowMessageForReservation('r2', NOW);
    const restored = await repo.restoreFollowMessageForUser('st1', 'U1', NOW);
    expect(restored?.reservation_id).toBe('r1');
    const rows = readRows();
    expect(rows.find((r) => r.reservation_id === 'r1').status).toBe('scheduled');
    expect(rows.find((r) => r.reservation_id === 'r2').status).toBe('cancelled');
  });

  it('元の予約もキャンセル済み・有効な予定が既にある場合は復活しない', async () => {
    writeReservations([{ id: 'r1', status: 'cancelled' }, { id: 'r2', status: 'pending' }]);
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    await repo.scheduleFollowMessageForReservation(rsv('r2', { reservation_date: '2026-09-20' }), NOW);
    await repo.cancelFollowMessageForReservation('r2', NOW);
    expect(await repo.restoreFollowMessageForUser('st1', 'U1', NOW)).toBeNull();
    await repo.scheduleFollowMessageForReservation(rsv('r3', { reservation_date: '2026-09-21' }), NOW);
    expect(await repo.restoreFollowMessageForUser('st1', 'U1', NOW)).toBeNull();
    expect(await repo.restoreFollowMessageForUser('st1', null, NOW)).toBeNull();
  });
});

describe('applyFollowSettingsToScheduledRows（設定変更を未送信予定に反映）', () => {
  it('何日後・時刻を変えると未送信行が再計算され、送信済みは変わらない', async () => {
    writeReservations([
      { id: 'r1', status: 'pending', reservation_date: '2026-09-10', created_at: '2026-09-08T02:00:00Z' },
      { id: 'r2', status: 'pending', reservation_date: '2026-09-12', created_at: '2026-09-08T02:00:00Z' },
    ]);
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    await repo.scheduleFollowMessageForReservation(rsv('r2', { line_user_id: 'U2', reservation_date: '2026-09-12' }), NOW);
    const rows0 = readRows();
    rows0.find((r) => r.reservation_id === 'r2').status = 'sent';
    fs.writeFileSync(path.join(tmpDir, 'data', 'follow_messages.json'), JSON.stringify(rows0));

    writeStores({ follow_days_after: 30, follow_time: '21:00' });
    expect(await repo.applyFollowSettingsToScheduledRows('st1', NOW)).toBe(1);
    const rows = readRows();
    expect(rows.find((r) => r.reservation_id === 'r1')).toMatchObject({ scheduled_at: '2026-10-10T12:00:00.000Z', status: 'scheduled' });
    expect(rows.find((r) => r.reservation_id === 'r2').status).toBe('sent');
  });

  it('基準日を受付日に変えると created_at 基準になる。計算結果が過去でも scheduled のまま', async () => {
    writeReservations([{ id: 'r1', status: 'pending', reservation_date: '2026-09-10', created_at: '2026-08-01T02:00:00Z' }]);
    await repo.scheduleFollowMessageForReservation(rsv('r1', { created_at: '2026-08-01T02:00:00Z' }), NOW);
    writeStores({ follow_base: 'created_at', follow_days_after: 1 });
    expect(await repo.applyFollowSettingsToScheduledRows('st1', NOW)).toBe(1);
    expect(readRows()[0]).toMatchObject({ base_date: '2026-08-01', scheduled_at: '2026-08-02T03:00:00.000Z', status: 'scheduled' });
  });

  it('OFF の店舗は何もしない', async () => {
    expect(await repo.applyFollowSettingsToScheduledRows('st2', NOW)).toBe(0);
  });
});

describe('backfillFollowMessagesForStore（ON にしたとき未来の予約に予定を作る）', () => {
  it('今日以降・LINE 経由・未キャンセルで行が無い予約に作る。同じ顧客は最新の予約が残る', async () => {
    writeReservations([
      { id: 'a', store_id: 'st1', line_user_id: 'U1', reservation_date: '2026-09-15', created_at: '2026-09-01T00:00:00Z', status: 'pending' },
      { id: 'b', store_id: 'st1', line_user_id: 'U1', reservation_date: '2026-09-25', created_at: '2026-09-02T00:00:00Z', status: 'confirmed' },
      { id: 'c', store_id: 'st1', line_user_id: 'U2', reservation_date: '2026-09-08', created_at: '2026-09-02T00:00:00Z', status: 'pending' },
      { id: 'd', store_id: 'st1', line_user_id: 'U3', reservation_date: '2026-09-01', created_at: '2026-09-01T00:00:00Z', status: 'pending' },
      { id: 'e', store_id: 'st1', line_user_id: null, reservation_date: '2026-09-20', created_at: '2026-09-01T00:00:00Z', status: 'pending' },
      { id: 'f', store_id: 'st1', line_user_id: 'U4', reservation_date: '2026-09-20', created_at: '2026-09-01T00:00:00Z', status: 'cancelled' },
      { id: 'g', store_id: 'st2', line_user_id: 'U5', reservation_date: '2026-09-20', created_at: '2026-09-01T00:00:00Z', status: 'pending' },
    ]);
    expect(await repo.backfillFollowMessagesForStore('st1', NOW)).toBe(3);
    const rows = readRows();
    expect(rows.find((r) => r.reservation_id === 'a').status).toBe('superseded');
    expect(rows.find((r) => r.reservation_id === 'b').status).toBe('scheduled');
    expect(rows.find((r) => r.reservation_id === 'c').status).toBe('scheduled');
    for (const id of ['d', 'e', 'f', 'g']) expect(rows.find((r) => r.reservation_id === id)).toBeUndefined();
    expect(await repo.backfillFollowMessagesForStore('st1', NOW)).toBe(0);
  });
});

describe('getFollowMessageSummariesByReservationIds', () => {
  it('予約 ID ごとの要約を返す', async () => {
    await repo.scheduleFollowMessageForReservation(rsv('r1'), NOW);
    const map = await repo.getFollowMessageSummariesByReservationIds(['r1', 'zzz']);
    expect(Object.keys(map)).toEqual(['r1']);
    expect(map.r1).toMatchObject({ status: 'scheduled', skip_reason: null, sent_at: null });
    expect(await repo.getFollowMessageSummariesByReservationIds([])).toEqual({});
  });
});

describe('getReminderPlansForReservations（送信予定の表示用）', () => {
  it('店舗設定から予約日 - N 日 の HH:00 を計算する。記録あり・キャンセル・LINE なし・過ぎたものは出さない', async () => {
    writeStores({ reminder_enabled: true, reminder_days_before: 1, reminder_time: '19:00', line_channel_access_token: 'tok' });
    const rsvs = [
      { id: 'a', reservation_date: '2026-09-20', line_user_id: 'U1', status: 'pending' },
      { id: 'b', reservation_date: '2026-09-20', line_user_id: 'U1', status: 'cancelled' },
      { id: 'c', reservation_date: '2026-09-20', line_user_id: null, status: 'pending' },
      { id: 'd', reservation_date: '2026-09-01', line_user_id: 'U1', status: 'pending' },
      { id: 'e', reservation_date: '2026-09-09', line_user_id: 'U1', status: 'pending' }, // 送信日 = 今日（9/8）→ 出す
      { id: 'f', reservation_date: '2026-09-20', line_user_id: 'U1', status: 'pending' },
    ];
    const logs = { f: { status: 'sent' as const, target_date: '2026-09-20', skip_reason: null, sent_at: null, last_error: null } };
    const plans = await repo.getReminderPlansForReservations('st1', rsvs, logs, NOW);
    expect(Object.keys(plans).sort()).toEqual(['a', 'e']);
    expect(plans.a.scheduled_at).toBe('2026-09-19T10:00:00.000Z');
  });

  it('リマインダー OFF / トークン無しの店舗は空', async () => {
    writeStores({ reminder_enabled: true, line_channel_access_token: '' });
    expect(await repo.getReminderPlansForReservations('st1', [{ id: 'a', reservation_date: '2026-09-20', line_user_id: 'U1', status: 'pending' }], {}, NOW)).toEqual({});
    writeStores({ reminder_enabled: false, line_channel_access_token: 'tok' });
    expect(await repo.getReminderPlansForReservations('st1', [{ id: 'a', reservation_date: '2026-09-20', line_user_id: 'U1', status: 'pending' }], {}, NOW)).toEqual({});
  });
});
