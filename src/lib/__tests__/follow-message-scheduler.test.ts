import { describe, it, expect } from 'vitest';
import {
  resolveBaseDate,
  computeScheduledAt,
  hasRebooking,
  isReminderSameDay,
  normalizeFollowDaysAfter,
  normalizeFollowTime,
  normalizeFollowBase,
  toJstDateString,
  FOLLOW_DAYS_AFTER_OPTIONS,
} from '@/lib/follow-message-scheduler';

describe('toJstDateString', () => {
  it('UTC の時刻を JST の日付にする（日付境界）', () => {
    // 2026-09-08T15:30Z = 2026-09-09 00:30 JST
    expect(toJstDateString(new Date('2026-09-08T15:30:00Z'))).toBe('2026-09-09');
    // 2026-09-08T14:59Z = 2026-09-08 23:59 JST
    expect(toJstDateString(new Date('2026-09-08T14:59:00Z'))).toBe('2026-09-08');
  });
});

describe('resolveBaseDate', () => {
  const reservation = { reservation_date: '2026-09-20', created_at: '2026-09-08T15:30:00Z' };
  it('予約日基準', () => {
    expect(resolveBaseDate(reservation, 'reservation_date')).toBe('2026-09-20');
  });
  it('予約受付日基準は created_at を JST の日付にする', () => {
    expect(resolveBaseDate(reservation, 'created_at')).toBe('2026-09-09');
  });
  it('created_at が無ければ現在時刻（JST）', () => {
    const now = new Date('2026-01-31T20:00:00Z'); // 2026-02-01 05:00 JST
    expect(resolveBaseDate({ reservation_date: '2026-03-01' }, 'created_at', now)).toBe('2026-02-01');
  });
});

describe('computeScheduledAt', () => {
  it('基準日 + N 日 の HH:00 JST を UTC ISO で返す', () => {
    // 2026-09-20 + 7 = 2026-09-27 12:00 JST = 2026-09-27T03:00:00.000Z
    expect(computeScheduledAt('2026-09-20', 7, '12:00')).toBe('2026-09-27T03:00:00.000Z');
  });
  it('月またぎ・年またぎ', () => {
    expect(computeScheduledAt('2026-12-30', 3, '09:00')).toBe('2027-01-02T00:00:00.000Z');
    // 2026-02-27 + 2 = 2026-03-01 07:00 JST = 2026-02-28T22:00Z
    expect(computeScheduledAt('2026-02-27', 2, '07:00')).toBe('2026-02-28T22:00:00.000Z');
  });
  it('不正な日付は null', () => {
    expect(computeScheduledAt('invalid', 7, '12:00')).toBeNull();
    expect(computeScheduledAt('', 7, '12:00')).toBeNull();
  });
});

describe('hasRebooking', () => {
  const base = '2026-09-20';
  it('基準日より後の未キャンセル予約があれば true', () => {
    expect(hasRebooking([{ id: 'r2', reservation_date: '2026-09-25', status: 'pending' }], base, 'r1')).toBe(true);
  });
  it('フォロー元の予約自身は除外', () => {
    expect(hasRebooking([{ id: 'r1', reservation_date: '2026-09-25', status: 'pending' }], base, 'r1')).toBe(false);
  });
  it('キャンセル済みは無視', () => {
    expect(hasRebooking([{ id: 'r2', reservation_date: '2026-09-25', status: 'cancelled' }], base, 'r1')).toBe(false);
  });
  it('基準日と同日・それ以前は再予約とみなさない', () => {
    expect(hasRebooking([
      { id: 'r2', reservation_date: '2026-09-20', status: 'confirmed' },
      { id: 'r3', reservation_date: '2026-09-10', status: 'confirmed' },
    ], base, 'r1')).toBe(false);
  });
  it('空なら false', () => {
    expect(hasRebooking([], base, 'r1')).toBe(false);
    expect(hasRebooking(undefined as any, base, 'r1')).toBe(false);
  });
});

describe('isReminderSameDay', () => {
  const today = '2026-09-27';
  it('リマインダー OFF なら常に false', () => {
    expect(isReminderSameDay({ reminder_enabled: false, reminder_days_before: 1 }, [{ reservation_date: '2026-09-28', status: 'pending' }], today)).toBe(false);
  });
  it('今日 + days_before の未キャンセル予約があれば true', () => {
    expect(isReminderSameDay({ reminder_enabled: true, reminder_days_before: 1 }, [{ reservation_date: '2026-09-28', status: 'pending' }], today)).toBe(true);
    expect(isReminderSameDay({ reminder_enabled: true, reminder_days_before: 3 }, [{ reservation_date: '2026-09-30', status: 'confirmed' }], today)).toBe(true);
  });
  it('日付が合わない・キャンセル済みは false', () => {
    expect(isReminderSameDay({ reminder_enabled: true, reminder_days_before: 1 }, [{ reservation_date: '2026-09-29', status: 'pending' }], today)).toBe(false);
    expect(isReminderSameDay({ reminder_enabled: true, reminder_days_before: 1 }, [{ reservation_date: '2026-09-28', status: 'cancelled' }], today)).toBe(false);
  });
  it('days_before 未設定は 1（前日）扱い。reminder_enabled 未設定は ON（既存の既定値）', () => {
    expect(isReminderSameDay({}, [{ reservation_date: '2026-09-28', status: 'pending' }], today)).toBe(true);
  });
});

describe('normalize', () => {
  it('days_after は 1〜60 の整数。範囲外・不正は 7', () => {
    expect(normalizeFollowDaysAfter(14)).toBe(14);
    expect(normalizeFollowDaysAfter(0)).toBe(7);
    expect(normalizeFollowDaysAfter(61)).toBe(7);
    expect(normalizeFollowDaysAfter('3')).toBe(7);
    expect(normalizeFollowDaysAfter(undefined)).toBe(7);
    expect(FOLLOW_DAYS_AFTER_OPTIONS).toContain(7);
  });
  it('time は HH:00 のみ。不正は 12:00', () => {
    expect(normalizeFollowTime('09:00')).toBe('09:00');
    expect(normalizeFollowTime('9:00')).toBe('12:00');
    expect(normalizeFollowTime('09:30')).toBe('12:00');
    expect(normalizeFollowTime(undefined)).toBe('12:00');
  });
  it('base は reservation_date / created_at のみ', () => {
    expect(normalizeFollowBase('created_at')).toBe('created_at');
    expect(normalizeFollowBase('foo')).toBe('reservation_date');
    expect(normalizeFollowBase(undefined)).toBe('reservation_date');
  });
});
