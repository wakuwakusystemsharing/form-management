import { describe, it, expect } from 'vitest';
import {
  resolveEventRange,
  isBusinessDayEvent,
  eventOverlapsSlot,
  busyCalendarIdsFromEvents,
  normalizeEventTimeForClient,
} from '../staff-availability';

const slot = (s: string, e: string) => ({ start: new Date(s), end: new Date(e) });

describe('resolveEventRange', () => {
  it('時間指定の予定はそのまま', () => {
    const r = resolveEventRange({ start: { dateTime: '2026-10-30T10:00:00+09:00' }, end: { dateTime: '2026-10-30T11:00:00+09:00' } });
    expect(r?.start.toISOString()).toBe('2026-10-30T01:00:00.000Z');
    expect(r?.end.toISOString()).toBe('2026-10-30T02:00:00.000Z');
  });
  it('終日予定は JST の 0:00 〜 翌日 0:00（UTC 解釈で 9:00 にずれない）', () => {
    const r = resolveEventRange({ start: { date: '2026-10-30' }, end: { date: '2026-10-31' } });
    expect(r?.start.toISOString()).toBe('2026-10-29T15:00:00.000Z');
    expect(r?.end.toISOString()).toBe('2026-10-30T15:00:00.000Z');
  });
  it('開始・終了が無ければ null', () => {
    expect(resolveEventRange({})).toBeNull();
    expect(resolveEventRange({ start: { date: 'bad' }, end: { date: '2026-10-31' } })).toBeNull();
  });
});

describe('eventOverlapsSlot', () => {
  const allDay = { start: { date: '2026-10-30' }, end: { date: '2026-10-31' }, summary: '予約不可' };
  it('終日予定は当日 14:30 の枠と重なる（freeBusy では Free 扱いだった事象）', () => {
    const s = slot('2026-10-30T14:30:00+09:00', '2026-10-30T15:30:00+09:00');
    expect(eventOverlapsSlot(allDay, s.start, s.end)).toBe(true);
  });
  it('終日予定は当日 9:00 より前の枠とも重なり、翌日の枠とは重ならない', () => {
    const early = slot('2026-10-30T08:00:00+09:00', '2026-10-30T09:00:00+09:00');
    expect(eventOverlapsSlot(allDay, early.start, early.end)).toBe(true);
    const next = slot('2026-10-31T08:00:00+09:00', '2026-10-31T09:00:00+09:00');
    expect(eventOverlapsSlot(allDay, next.start, next.end)).toBe(false);
  });
  it('「営業日」イベントは埋まり扱いにしない', () => {
    const biz = { start: { dateTime: '2026-10-30T10:00:00+09:00' }, end: { dateTime: '2026-10-30T19:00:00+09:00' }, summary: '営業日' };
    expect(isBusinessDayEvent(biz)).toBe(true);
    const s = slot('2026-10-30T14:30:00+09:00', '2026-10-30T15:30:00+09:00');
    expect(eventOverlapsSlot(biz, s.start, s.end)).toBe(false);
  });
  it('端が接しているだけの予定は重ならない', () => {
    const ev = { start: { dateTime: '2026-10-30T13:30:00+09:00' }, end: { dateTime: '2026-10-30T14:30:00+09:00' } };
    const s = slot('2026-10-30T14:30:00+09:00', '2026-10-30T15:30:00+09:00');
    expect(eventOverlapsSlot(ev, s.start, s.end)).toBe(false);
  });
});

describe('busyCalendarIdsFromEvents', () => {
  it('終日予定のスタッフは埋まり、空いているスタッフだけが残る', () => {
    const s = slot('2026-10-30T14:30:00+09:00', '2026-10-30T15:30:00+09:00');
    const busy = busyCalendarIdsFromEvents(
      {
        konda: [{ start: { date: '2026-10-30' }, end: { date: '2026-10-31' } }],
        sato: [{ start: { dateTime: '2026-10-30T10:00:00+09:00' }, end: { dateTime: '2026-10-30T11:00:00+09:00' } }],
      },
      s.start,
      s.end
    );
    expect(busy.has('konda')).toBe(true);
    expect(busy.has('sato')).toBe(false);
  });
  it('取得に失敗したカレンダー（null）は安全側で埋まり扱い', () => {
    const s = slot('2026-10-30T14:30:00+09:00', '2026-10-30T15:30:00+09:00');
    const busy = busyCalendarIdsFromEvents({ broken: null, ok: [] }, s.start, s.end);
    expect(busy.has('broken')).toBe(true);
    expect(busy.has('ok')).toBe(false);
  });
});

describe('normalizeEventTimeForClient', () => {
  it('終日の日付は JST 0:00 の ISO 文字列にする', () => {
    expect(normalizeEventTimeForClient({ dateTime: '2026-10-30T10:00:00+09:00' })).toBe('2026-10-30T10:00:00+09:00');
    expect(normalizeEventTimeForClient({ date: '2026-10-30' })).toBe('2026-10-30T00:00:00+09:00');
    expect(normalizeEventTimeForClient(undefined)).toBe('');
  });
});
