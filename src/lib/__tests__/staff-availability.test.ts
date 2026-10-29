import { describe, it, expect } from 'vitest';
import {
  resolveEventRange,
  isBusinessDayEvent,
  eventOverlapsSlot,
  busyCalendarIdsFromEvents,
  normalizeEventTimeForClient,
  countEventsOverlappingSlot,
  isSlotFull,
  resolveMaxConcurrentEvents,
  resolveReservationSlotWindow,
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

describe('店舗カレンダーの同時刻上限（countEventsOverlappingSlot / isSlotFull）', () => {
  const timed = (s: string, e: string, summary = '予約') => ({ start: { dateTime: s }, end: { dateTime: e }, summary });
  const s1530 = slot('2026-10-29T15:30:00+09:00', '2026-10-29T16:00:00+09:00');

  it('重なる予定を数える（直前に終わる予定は数えない）', () => {
    const events = [
      timed('2026-10-29T14:30:00+09:00', '2026-10-29T15:30:00+09:00', '予約: 前葉'),
      timed('2026-10-29T15:30:00+09:00', '2026-10-29T16:00:00+09:00', '予約: 宮嶋'),
    ];
    expect(countEventsOverlappingSlot(events, s1530.start, s1530.end)).toBe(1);
    expect(isSlotFull(events, s1530.start, s1530.end, 1)).toBe(true);
    expect(isSlotFull(events, s1530.start, s1530.end, 2)).toBe(false);
  });

  it('営業日イベントは数えない。終日予定は数える', () => {
    const events = [
      timed('2026-10-29T09:00:00+09:00', '2026-10-29T18:00:00+09:00', '営業日'),
      { start: { date: '2026-10-29' }, end: { date: '2026-10-30' }, summary: '休み' },
    ];
    expect(countEventsOverlappingSlot(events, s1530.start, s1530.end)).toBe(1);
  });

  it('予定が無ければ 0', () => {
    expect(countEventsOverlappingSlot([], s1530.start, s1530.end)).toBe(0);
    expect(isSlotFull([], s1530.start, s1530.end, 1)).toBe(false);
  });
});

describe('resolveMaxConcurrentEvents', () => {
  it('未設定・不正は 1、小数は切り捨て', () => {
    expect(resolveMaxConcurrentEvents(null)).toBe(1);
    expect(resolveMaxConcurrentEvents({ max_concurrent_events: 0 })).toBe(1);
    expect(resolveMaxConcurrentEvents({ max_concurrent_events: 2.7 })).toBe(2);
    expect(resolveMaxConcurrentEvents({ max_concurrent_events: '3' })).toBe(1);
  });
});

describe('resolveReservationSlotWindow', () => {
  it('所要時間があればその長さ（JST）', () => {
    const w = resolveReservationSlotWindow('2026-10-29', '15:30', 25, { time_interval: 30 });
    expect(w?.slotStart.toISOString()).toBe('2026-10-29T06:30:00.000Z');
    expect(w?.slotEnd.toISOString()).toBe('2026-10-29T06:55:00.000Z');
  });
  it('所要時間が無ければ時間間隔ぶん、間隔も無ければ 30 分', () => {
    expect(resolveReservationSlotWindow('2026-10-29', '15:30', 0, { time_interval: 15 })?.slotEnd.toISOString()).toBe('2026-10-29T06:45:00.000Z');
    expect(resolveReservationSlotWindow('2026-10-29', '15:30', undefined, null)?.slotEnd.toISOString()).toBe('2026-10-29T07:00:00.000Z');
  });
  it('日付・時刻が不正なら null', () => {
    expect(resolveReservationSlotWindow('2026/10/29', '15:30', 30, null)).toBeNull();
    expect(resolveReservationSlotWindow('2026-10-29', '', 30, null)).toBeNull();
  });
});
