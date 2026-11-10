import { describe, expect, it } from 'vitest';
import {
  composeLocalScheduleValue,
  defaultScheduleValue,
  parseLocalScheduleValue,
  roundUpToScheduleStep,
  SCHEDULE_HOUR_OPTIONS,
  SCHEDULE_MINUTE_OPTIONS,
  toLocalScheduleValue,
} from '@/lib/broadcast-schedule';

describe('配信の送信日時（5 分刻み）', () => {
  it('分の選択肢は 0, 5, …, 55 の 12 個、時は 0〜23', () => {
    expect(SCHEDULE_MINUTE_OPTIONS).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(SCHEDULE_HOUR_OPTIONS).toHaveLength(24);
  });

  it('次の 5 分刻みに切り上げる（ちょうどならそのまま。秒は捨てる）', () => {
    expect(roundUpToScheduleStep(new Date('2026-11-10T01:03:20Z')).toISOString()).toBe('2026-11-10T01:05:00.000Z');
    expect(roundUpToScheduleStep(new Date('2026-11-10T01:05:00Z')).toISOString()).toBe('2026-11-10T01:05:00.000Z');
    expect(roundUpToScheduleStep(new Date('2026-11-10T01:05:01Z')).toISOString()).toBe('2026-11-10T01:10:00.000Z');
    expect(roundUpToScheduleStep(new Date('2026-11-10T23:58:00Z')).toISOString()).toBe('2026-11-11T00:00:00.000Z');
  });

  it('ローカル時刻の文字列との相互変換', () => {
    const d = new Date(2026, 10, 10, 9, 5); // ローカル 2026-11-10 09:05
    expect(toLocalScheduleValue(d)).toBe('2026-11-10T09:05');
    expect(parseLocalScheduleValue('2026-11-10T09:05')).toEqual({ date: '2026-11-10', hour: 9, minute: 5 });
    expect(parseLocalScheduleValue('2026-11-10T09:05:30')).toEqual({ date: '2026-11-10', hour: 9, minute: 5 });
    expect(parseLocalScheduleValue('')).toBeNull();
    expect(parseLocalScheduleValue('2026-11-10')).toBeNull();
    expect(parseLocalScheduleValue('2026-11-10T25:00')).toBeNull();
    // new Date で読み直しても同じ時刻になる
    expect(new Date('2026-11-10T09:05').getTime()).toBe(d.getTime());
  });

  it('日付 / 時 / 分から組み立てる。分は 5 分刻みに切り捨てる', () => {
    expect(composeLocalScheduleValue('2026-11-10', 9, 5)).toBe('2026-11-10T09:05');
    expect(composeLocalScheduleValue('2026-11-10', 18, 0)).toBe('2026-11-10T18:00');
    expect(composeLocalScheduleValue('2026-11-10', 9, 7)).toBe('2026-11-10T09:05');
    expect(composeLocalScheduleValue('2026-11-10', 30, 99)).toBe('2026-11-10T23:55');
  });

  it('既定は 1 時間後を 5 分刻みに切り上げた時刻', () => {
    const now = new Date(2026, 10, 10, 9, 3, 30);
    expect(defaultScheduleValue(now)).toBe('2026-11-10T10:05');
    expect(parseLocalScheduleValue(defaultScheduleValue(new Date()))!.minute % 5).toBe(0);
  });
});
