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

beforeEach(() => {
  writeStores();
  fs.rmSync(path.join(tmpDir, 'data', 'follow_messages.json'), { force: true });
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
