import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  buildMonthGrid,
  busyBlocksFromGoogle,
  countOverlappingEvents,
  describeSlot,
  dragSnapMinutes,
  isDraggableEvent,
  isReservationStale,
  isSameSlot,
  moveTarget,
  overlapsBusy,
  slotAtPointer,
  calendarRange,
  calendarTitle,
  diffDays,
  eventsForDate,
  isValidYmd,
  jstNowMinutes,
  jstToday,
  layoutDayEvents,
  monthCellEvents,
  reservationDurationMinutes,
  shiftAnchor,
  timeToMinutes,
  toCalendarEvent,
  toCalendarEvents,
  validateCalendarRange,
  visibleHourRange,
  weekDates,
  weekdayOf,
  type CalendarEvent,
} from '../reservation-calendar';

describe('日付の計算', () => {
  it('無い日付をはじく', () => {
    expect(isValidYmd('2026-11-24')).toBe(true);
    expect(isValidYmd('2026-02-29')).toBe(false);
    expect(isValidYmd('2028-02-29')).toBe(true); // うるう年
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('2026-1-1')).toBe(false);
    expect(isValidYmd(null)).toBe(false);
  });

  it('月末・年またぎ・うるう年でも 1 日ずつ進む', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('月をずらすと、無い日は月末になる', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('曜日と週（日曜始まり）', () => {
    expect(weekdayOf('2026-11-24')).toBe(2); // 火
    expect(weekDates('2026-11-24')).toEqual(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']);
    // 年をまたぐ週
    expect(weekDates('2027-01-01')[0]).toBe('2026-12-27');
  });

  it('「今日」は日本時間で求める（UTC では前日の 15 時 = 日本の 0 時）', () => {
    expect(jstToday(new Date('2026-11-23T15:00:00Z'))).toBe('2026-11-24');
    expect(jstToday(new Date('2026-11-23T14:59:59Z'))).toBe('2026-11-23');
    expect(jstNowMinutes(new Date('2026-11-23T15:30:00Z'))).toBe(30);
  });
});

describe('buildMonthGrid', () => {
  it('2026 年 11 月: 1 日が日曜、5 週', () => {
    const grid = buildMonthGrid(2026, 11);
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toMatchObject({ date: '2026-11-01', inMonth: true, weekday: 0 });
    expect(grid[4][6]).toMatchObject({ date: '2026-12-05', inMonth: false });
  });

  it('前の月の日から始まり、どの週も 7 日', () => {
    const grid = buildMonthGrid(2026, 12); // 12/1 は火曜
    expect(grid[0][0]).toMatchObject({ date: '2026-11-29', inMonth: false });
    expect(grid[0][2]).toMatchObject({ date: '2026-12-01', inMonth: true });
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[grid.length - 1][6].date).toBe('2027-01-02'); // 年またぎ
  });

  it('4 週で収まる月（2026 年 2 月 = 1 日が日曜で 28 日）と 6 週の月', () => {
    expect(buildMonthGrid(2026, 2)).toHaveLength(4);
    expect(buildMonthGrid(2026, 8)).toHaveLength(6); // 8/1 は土曜
  });

  it('うるう年の 2 月は 29 日まで', () => {
    const days = buildMonthGrid(2028, 2).flat().filter((d) => d.inMonth);
    expect(days).toHaveLength(29);
  });
});

describe('表示する期間と見出し', () => {
  it('期間', () => {
    expect(calendarRange('day', '2026-11-24')).toEqual({ from: '2026-11-24', to: '2026-11-24' });
    expect(calendarRange('week', '2026-11-24')).toEqual({ from: '2026-11-22', to: '2026-11-28' });
    expect(calendarRange('month', '2026-12-15')).toEqual({ from: '2026-11-29', to: '2027-01-02' });
  });

  it('前へ / 次へ', () => {
    expect(shiftAnchor('day', '2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftAnchor('week', '2026-12-28', 1)).toBe('2027-01-04');
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftAnchor('month', '2026-01-15', -1)).toBe('2025-12-01');
  });

  it('見出し', () => {
    expect(calendarTitle('month', '2026-11-24')).toBe('2026年11月');
    expect(calendarTitle('day', '2026-11-24')).toBe('2026年11月24日(火)');
    expect(calendarTitle('week', '2026-11-24')).toBe('2026年11/22(日) 〜 11/28(土)');
  });

  it('期間の確認（API 用）', () => {
    expect(validateCalendarRange('2026-11-01', '2026-11-30')).toBeNull();
    expect(validateCalendarRange('2026-11-01', '2027-01-01')).toBeNull(); // 62 日
    expect(validateCalendarRange('2026-11-01', '2027-01-02')).toContain('62 日以内');
    expect(validateCalendarRange('2026-11-30', '2026-11-01')).toContain('前に');
    expect(validateCalendarRange('2026/11/01', '2026-11-30')).toContain('YYYY-MM-DD');
    expect(validateCalendarRange(null, null)).toContain('YYYY-MM-DD');
  });
});

describe('予約 → 帯', () => {
  it('時刻の読み取り', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('09:30:00')).toBe(570);
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
  });

  it('所要時間: 予約時の合計時間 → メニューの所要時間 → 60 分', () => {
    expect(reservationDurationMinutes({ id: 'a', customer_info: { total_duration: 90 }, selected_menus: [{ duration: 30 }] })).toBe(90);
    expect(reservationDurationMinutes({ id: 'a', selected_menus: [{ duration: 30 }, { duration: 45 }], selected_options: [{ duration: 15 }] })).toBe(90);
    expect(reservationDurationMinutes({ id: 'a', selected_menus: [] })).toBe(60);
    expect(reservationDurationMinutes({ id: 'a', customer_info: 'こわれた値' })).toBe(60);
  });

  it('ふつうの予約', () => {
    const ev = toCalendarEvent({
      id: 'r1',
      customer_name: '山田 花子',
      reservation_date: '2026-11-24',
      reservation_time: '14:00:00',
      status: 'confirmed',
      selected_menus: [{ menu_name: 'カット', duration: 45 }, { menu_name: 'カラー', submenu_name: 'リタッチ', duration: 60 }],
      staff_name: '佐藤',
    });
    expect(ev).toMatchObject({ kind: 'timed', date: '2026-11-24', startMin: 840, endMin: 945, title: '山田 花子', subtitle: 'カット、カラー（リタッチ）', staffName: '佐藤', cancelled: false });
  });

  it('深夜の予約は、その日のうち（24:00 まで）に描く', () => {
    const ev = toCalendarEvent({ id: 'r1', reservation_date: '2026-11-30', reservation_time: '23:30', customer_info: { total_duration: 90 } });
    expect(ev).toMatchObject({ kind: 'timed', date: '2026-11-30', startMin: 1410, endMin: 1440, durationMinutes: 90 });
  });

  it('0 時台の予約は、その日に出る（前日にずれない）', () => {
    expect(toCalendarEvent({ id: 'r1', reservation_date: '2026-12-01', reservation_time: '00:15' })).toMatchObject({ date: '2026-12-01', startMin: 15, endMin: 75 });
  });

  it('時刻の無い予約は「時間未定」', () => {
    expect(toCalendarEvent({ id: 'r1', reservation_date: '2026-11-24', reservation_time: null })).toMatchObject({ kind: 'untimed', startMin: null });
    expect(toCalendarEvent({ id: 'r1', reservation_date: '2026-11-24', reservation_time: '' })).toMatchObject({ kind: 'untimed' });
  });

  it('宿泊は数日にまたがる帯', () => {
    const ev = toCalendarEvent({ id: 's1', reservation_date: '2026-11-29', reservation_time: '15:00', checkout_date: '2026-12-02', customer_name: '田中' });
    expect(ev).toMatchObject({ kind: 'stay', date: '2026-11-29', endDate: '2026-12-02', subtitle: '3泊' });
  });

  it('日付の無い・こわれた予約は捨てる', () => {
    expect(toCalendarEvent({ id: 'r1', reservation_date: null })).toBeNull();
    expect(toCalendarEvent({ id: 'r1', reservation_date: '2026-02-30' })).toBeNull();
  });

  it('キャンセルは既定で出さない。「キャンセルも表示」で出す', () => {
    const rows = [
      { id: 'a', reservation_date: '2026-11-24', reservation_time: '10:00', status: 'confirmed' },
      { id: 'b', reservation_date: '2026-11-24', reservation_time: '11:00', status: 'cancelled' },
    ];
    expect(toCalendarEvents(rows).map((e) => e.id)).toEqual(['a']);
    expect(toCalendarEvents(rows, { includeCancelled: true }).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('日ごとの振り分け: 宿泊はチェックイン日からチェックアウト日まで', () => {
    const events = toCalendarEvents([
      { id: 's1', reservation_date: '2026-11-29', reservation_time: '15:00', checkout_date: '2026-12-01' },
      { id: 'r1', reservation_date: '2026-11-30', reservation_time: '10:00' },
      { id: 'u1', reservation_date: '2026-11-30', reservation_time: null },
    ]);
    expect(eventsForDate(events, '2026-11-28').allDay).toHaveLength(0);
    const d = eventsForDate(events, '2026-11-30');
    expect(d.timed.map((e) => e.id)).toEqual(['r1']);
    expect(d.allDay.map((e) => e.id).sort()).toEqual(['s1', 'u1']);
    expect(eventsForDate(events, '2026-12-01').allDay.map((e) => e.id)).toEqual(['s1']);
    expect(eventsForDate(events, '2026-12-02').allDay).toHaveLength(0);
  });

  it('月表示の 1 マスは 3 件まで。残りは「ほか N 件」', () => {
    const events = toCalendarEvents(
      ['09:00', '10:00', '11:00', '12:00', '13:00'].map((t, i) => ({ id: `r${i}`, reservation_date: '2026-11-24', reservation_time: t }))
    );
    const cell = monthCellEvents(events, '2026-11-24');
    expect(cell.shown.map((e) => e.id)).toEqual(['r0', 'r1', 'r2']);
    expect(cell.more).toBe(2);
    expect(cell.total).toBe(5);
    expect(monthCellEvents(events, '2026-11-25')).toEqual({ shown: [], more: 0, total: 0 });
  });
});

describe('layoutDayEvents（重なりの配置）', () => {
  const ev = (id: string, start: string, minutes: number): CalendarEvent =>
    toCalendarEvent({ id, reservation_date: '2026-11-24', reservation_time: start, customer_info: { total_duration: minutes } }) as CalendarEvent;
  const pick = (list: ReturnType<typeof layoutDayEvents>) => Object.fromEntries(list.map((p) => [p.event.id, [p.column, p.columns]]));

  it('重ならない予約は 1 列', () => {
    expect(pick(layoutDayEvents([ev('a', '10:00', 60), ev('b', '11:00', 60)]))).toEqual({ a: [0, 1], b: [0, 1] });
  });

  it('2 件が重なると 2 列に分ける', () => {
    expect(pick(layoutDayEvents([ev('a', '10:00', 60), ev('b', '10:30', 60)]))).toEqual({ a: [0, 2], b: [1, 2] });
  });

  it('3 件が同時に重なると 3 列', () => {
    expect(pick(layoutDayEvents([ev('a', '10:00', 120), ev('b', '10:30', 60), ev('c', '10:45', 30)]))).toEqual({ a: [0, 3], b: [1, 3], c: [2, 3] });
  });

  it('長い予約の中に、順番に 2 件入る（空いた列を使い回す）', () => {
    expect(pick(layoutDayEvents([ev('a', '10:00', 180), ev('b', '10:00', 60), ev('c', '11:00', 60)]))).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] });
  });

  it('離れたかたまりは、それぞれの列の数で幅を決める', () => {
    const r = pick(layoutDayEvents([ev('a', '10:00', 60), ev('b', '10:30', 60), ev('c', '15:00', 60)]));
    expect(r.c).toEqual([0, 1]);
    expect(r.a).toEqual([0, 2]);
  });

  it('短い予約は読める長さまで伸ばして配置する', () => {
    const [p] = layoutDayEvents([ev('a', '10:00', 5)]);
    expect(p.endMin - p.startMin).toBe(20);
  });

  it('時間未定・宿泊は対象外', () => {
    const untimed = toCalendarEvent({ id: 'u', reservation_date: '2026-11-24', reservation_time: null }) as CalendarEvent;
    expect(layoutDayEvents([untimed])).toEqual([]);
  });
});

describe('busyBlocksFromGoogle（予約以外の予定）', () => {
  const range = { from: '2026-11-22', to: '2026-11-28' };

  it('時刻を日本時間に直す', () => {
    const blocks = busyBlocksFromGoogle([{ id: 'g1', summary: '打ち合わせ', start: { dateTime: '2026-11-24T01:00:00Z' }, end: { dateTime: '2026-11-24T02:30:00Z' } }], range);
    expect(blocks).toEqual([{ date: '2026-11-24', startMin: 600, endMin: 690, allDay: false }]);
  });

  it('予定の中身（タイトル）は持たない', () => {
    const blocks = busyBlocksFromGoogle([{ id: 'g1', summary: '通院', start: { dateTime: '2026-11-24T10:00:00+09:00' }, end: { dateTime: '2026-11-24T11:00:00+09:00' } }], range);
    expect(JSON.stringify(blocks)).not.toContain('通院');
  });

  it('このシステムの予約から作った予定・「営業日」・取り消された予定は除く', () => {
    const blocks = busyBlocksFromGoogle(
      [
        { id: 'rsv', summary: '予約', start: { dateTime: '2026-11-24T10:00:00+09:00' }, end: { dateTime: '2026-11-24T11:00:00+09:00' } },
        { id: 'open', summary: '営業日', start: { dateTime: '2026-11-24T09:00:00+09:00' }, end: { dateTime: '2026-11-24T18:00:00+09:00' } },
        { id: 'x', status: 'cancelled', start: { dateTime: '2026-11-24T12:00:00+09:00' }, end: { dateTime: '2026-11-24T13:00:00+09:00' } },
      ],
      { ...range, reservationEventIds: ['rsv'] }
    );
    expect(blocks).toEqual([]);
  });

  it('終日の予定は、その日の全部（終わりの日は含まない）', () => {
    const blocks = busyBlocksFromGoogle([{ id: 'g', start: { date: '2026-11-24' }, end: { date: '2026-11-26' } }], range);
    expect(blocks).toEqual([
      { date: '2026-11-24', startMin: 0, endMin: 1440, allDay: true },
      { date: '2026-11-25', startMin: 0, endMin: 1440, allDay: true },
    ]);
  });

  it('日をまたぐ予定は日ごとに分け、期間の外は捨てる', () => {
    const blocks = busyBlocksFromGoogle([{ id: 'g', start: { dateTime: '2026-11-27T22:00:00+09:00' }, end: { dateTime: '2026-11-29T03:00:00+09:00' } }], range);
    expect(blocks).toEqual([
      { date: '2026-11-27', startMin: 1320, endMin: 1440, allDay: false },
      { date: '2026-11-28', startMin: 0, endMin: 1440, allDay: true },
    ]);
  });
});

describe('visibleHourRange', () => {
  it('何も無ければ 9〜20 時。はみ出す予約があれば広げる', () => {
    expect(visibleHourRange([], [], ['2026-11-24'])).toEqual({ startHour: 9, endHour: 20 });
    const events = toCalendarEvents([
      { id: 'a', reservation_date: '2026-11-24', reservation_time: '07:30' },
      { id: 'b', reservation_date: '2026-11-24', reservation_time: '21:00', customer_info: { total_duration: 90 } },
      { id: 'c', reservation_date: '2026-11-25', reservation_time: '05:00' }, // 表示していない日
    ]);
    expect(visibleHourRange(events, [], ['2026-11-24'])).toEqual({ startHour: 7, endHour: 23 });
  });
});

describe('ドラッグで移動・空いている所から手動予約', () => {
  const ev = (id: string, date: string, start: string | null, minutes = 60, extra: Record<string, unknown> = {}): CalendarEvent =>
    toCalendarEvent({ id, reservation_date: date, reservation_time: start, customer_info: { total_duration: minutes }, ...extra }) as CalendarEvent;

  it('時刻の刻み: 10 分・20 分間隔のフォームは 10 分、それ以外は 15 分', () => {
    expect(dragSnapMinutes(10)).toBe(10);
    expect(dragSnapMinutes(20)).toBe(10);
    expect(dragSnapMinutes(30)).toBe(15);
    expect(dragSnapMinutes(45)).toBe(15);
    expect(dragSnapMinutes(undefined)).toBe(15);
  });

  it('moveTarget: つかんだ位置を引いてから、刻みに丸める', () => {
    // 14:20 の位置に落とした。帯の上から 20 分の所をつかんでいた → 14:00 開始
    expect(moveTarget({ pointerMin: 860, grabOffsetMin: 20, snapMinutes: 15 })).toBe(840);
    // 近いほうの刻みに丸める
    expect(moveTarget({ pointerMin: 848, grabOffsetMin: 0, snapMinutes: 15 })).toBe(855);
    expect(moveTarget({ pointerMin: 847, grabOffsetMin: 0, snapMinutes: 15 })).toBe(840);
    expect(moveTarget({ pointerMin: 846, grabOffsetMin: 0, snapMinutes: 10 })).toBe(850);
  });

  it('moveTarget: その日の外には出ない', () => {
    expect(moveTarget({ pointerMin: 5, grabOffsetMin: 40, snapMinutes: 15 })).toBe(0);
    expect(moveTarget({ pointerMin: 1500, grabOffsetMin: 0, snapMinutes: 15 })).toBe(1425); // 23:45
  });

  it('slotAtPointer: 押した枠の開始時刻（切り捨て）', () => {
    expect(slotAtPointer(869)).toBe(840); // 14:29 → 14:00
    expect(slotAtPointer(870)).toBe(870); // 14:30
    expect(slotAtPointer(-10)).toBe(0);
    expect(slotAtPointer(1439)).toBe(1410); // 23:30
  });

  it('動かせるのは、時間の決まっている・キャンセルしていない予約だけ', () => {
    expect(isDraggableEvent(ev('a', '2026-11-24', '10:00'))).toBe(true);
    expect(isDraggableEvent(ev('b', '2026-11-24', null))).toBe(false);
    expect(isDraggableEvent(ev('c', '2026-11-24', '10:00', 60, { status: 'cancelled' }))).toBe(false);
    expect(isDraggableEvent(ev('d', '2026-11-24', '15:00', 60, { checkout_date: '2026-11-26' }))).toBe(false);
  });

  it('同じ場所に落としたかどうか', () => {
    const a = ev('a', '2026-11-24', '10:00');
    expect(isSameSlot(a, '2026-11-24', 600)).toBe(true);
    expect(isSameSlot(a, '2026-11-24', 615)).toBe(false);
    expect(isSameSlot(a, '2026-11-25', 600)).toBe(false);
  });

  it('動かした先に重なる予約の数（自分・キャンセル・別の日・隣り合うだけの予約は数えない）', () => {
    const events = [
      ev('self', '2026-11-25', '14:00'),
      ev('hit1', '2026-11-25', '14:30'),
      ev('hit2', '2026-11-25', '13:30', 60),
      ev('touch', '2026-11-25', '15:00'), // ちょうど終わりに始まる
      ev('cancel', '2026-11-25', '14:00', 60, { status: 'cancelled' }),
      ev('other', '2026-11-26', '14:00'),
      ev('untimed', '2026-11-25', null),
    ];
    expect(countOverlappingEvents(events, { excludeId: 'self', date: '2026-11-25', startMin: 840, endMin: 900 })).toBe(2);
    expect(countOverlappingEvents(events, { excludeId: 'self', date: '2026-11-27', startMin: 840, endMin: 900 })).toBe(0);
  });

  it('予約以外の予定との重なり', () => {
    const busy = [{ date: '2026-11-25', startMin: 600, endMin: 690, allDay: false }];
    expect(overlapsBusy(busy, { date: '2026-11-25', startMin: 660, endMin: 720 })).toBe(true);
    expect(overlapsBusy(busy, { date: '2026-11-25', startMin: 690, endMin: 750 })).toBe(false);
    expect(overlapsBusy(busy, { date: '2026-11-26', startMin: 600, endMin: 660 })).toBe(false);
  });

  it('確認の文に出す日時', () => {
    expect(describeSlot('2026-11-25', 840, 60)).toBe('11/25(水) 14:00〜15:00');
    expect(describeSlot('2026-11-30', 1410, 90)).toBe('11/30(月) 23:30〜24:00');
  });

  it('ほかの人が先に変更したかどうか（更新日時の比較）', () => {
    expect(isReservationStale('2026-11-24T05:00:00.000Z', '2026-11-24T05:00:00+00:00')).toBe(false); // 書き方が違うだけ
    expect(isReservationStale('2026-11-24T05:00:00.000Z', '2026-11-24T05:03:00.000Z')).toBe(true);
    expect(isReservationStale(undefined, '2026-11-24T05:03:00.000Z')).toBe(false);
    expect(isReservationStale('2026-11-24T05:00:00.000Z', null)).toBe(false);
    expect(isReservationStale('こわれた値', '2026-11-24T05:03:00.000Z')).toBe(false);
  });
});
