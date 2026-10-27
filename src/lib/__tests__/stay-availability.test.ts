import { describe, expect, it } from 'vitest';
import { createDefaultStaySettings } from '@/lib/stay-pricing';
import {
  addDays,
  buildNightStatus,
  diffDays,
  isNightClosed,
  isRangeBookable,
  nightsBetween,
  occupiedCountByNight,
  selectableCheckoutDates,
} from '@/lib/stay-availability';

const noHoliday = () => false;
const range = { from: '2026-11-01', to: '2026-11-10' };
// 2026-10-20 10:00 JST
const NOW = new Date('2026-10-20T01:00:00Z');

describe('stay-availability: 日付ユーティリティ', () => {
  it('addDays / diffDays / nightsBetween（チェックアウト日の夜は含まない）', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(diffDays('2026-11-01', '2026-11-04')).toBe(3);
    expect(nightsBetween('2026-11-01', '2026-11-02')).toEqual(['2026-11-01']);
    expect(nightsBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(nightsBetween('2026-11-02', '2026-11-02')).toEqual([]);
    expect(nightsBetween('2026-11-03', '2026-11-02')).toEqual([]);
  });

  it('isNightClosed: 曜日 / 特定日 / 期間（両端含む）', () => {
    const s = createDefaultStaySettings();
    s.closed_weekdays = [2]; // 火曜
    s.closed_dates = ['2026-11-05'];
    s.closed_ranges = [{ start: '2026-12-29', end: '2027-01-03' }];
    expect(isNightClosed(s, '2026-11-03')).toBe(true);  // 火
    expect(isNightClosed(s, '2026-11-04')).toBe(false);
    expect(isNightClosed(s, '2026-11-05')).toBe(true);
    expect(isNightClosed(s, '2026-12-29')).toBe(true);
    expect(isNightClosed(s, '2027-01-03')).toBe(true);
    expect(isNightClosed(s, '2027-01-04')).toBe(false);
  });
});

describe('stay-availability: 夜ごとの使用数', () => {
  const s = createDefaultStaySettings();

  it('予約はチェックイン〜チェックアウト前日の夜を使う。キャンセルは数えない', () => {
    const occ = occupiedCountByNight(range, [
      { reservation_date: '2026-11-01', checkout_date: '2026-11-02', status: 'confirmed' },   // 11/1 の夜
      { reservation_date: '2026-11-02', checkout_date: '2026-11-04', status: 'pending' },     // 11/2, 11/3
      { reservation_date: '2026-11-05', checkout_date: '2026-11-06', status: 'cancelled' },
      { reservation_date: '2026-10-30', checkout_date: '2026-11-02', status: 'confirmed' },   // 範囲外から 10/30, 10/31, 11/1
      { reservation_date: '2026-11-09', checkout_date: null, status: 'confirmed' },           // 宿泊以外の予約は無視
    ], [], s);
    expect(occ.get('2026-11-01')).toBe(2);
    expect(occ.get('2026-11-02')).toBe(1);
    expect(occ.get('2026-11-03')).toBe(1);
    expect(occ.get('2026-11-04') ?? 0).toBe(0);
    expect(occ.get('2026-11-05') ?? 0).toBe(0);
    expect(occ.get('2026-11-09') ?? 0).toBe(0);
  });

  it('カレンダー予定: 夜の窓（15:00〜翌 10:00 JST）に重なるものだけ数える。終日予定は JST の日付で判定', () => {
    const occ = occupiedCountByNight(range, [], [
      { start: '2026-11-05', end: '2026-11-06' },                               // 終日 11/5 → 11/5 の夜
      { start: '2026-11-06T15:00:00+09:00', end: '2026-11-07T10:00:00+09:00' }, // 他媒体の宿泊 → 11/6 の夜
      { start: '2026-11-07T11:00:00+09:00', end: '2026-11-07T14:00:00+09:00' }, // 清掃（10:00〜15:00 の間）→ どの夜にも重ならない
      { start: '2026-11-08T09:00:00+09:00', end: '2026-11-08T11:00:00+09:00' }, // 11/7 の夜の窓（〜11/8 10:00）に重なる
      { start: '2026-11-09T06:00:00Z', end: '2026-11-11T01:00:00Z' },           // UTC 表記: 11/9 15:00 JST 〜 11/11 10:00 JST → 11/9, 11/10 の夜
    ], s);
    expect(occ.get('2026-11-05')).toBe(1);
    expect(occ.get('2026-11-06')).toBe(1);
    expect(occ.get('2026-11-07')).toBe(1);
    expect(occ.get('2026-11-04') ?? 0).toBe(0);
    expect(occ.get('2026-11-08') ?? 0).toBe(0);
    expect(occ.get('2026-11-09')).toBe(1);
    expect(occ.get('2026-11-10')).toBe(1);
  });
});

describe('stay-availability: 夜の状態と範囲選択', () => {
  function settings() {
    return createDefaultStaySettings();
  }
  const cs = { min_advance_days: 0, advance_booking_days: 365 };

  it('buildNightStatus: 埋まった夜は full、空きは料金付き', () => {
    const s = settings();
    const occ = new Map([['2026-11-01', 1], ['2026-11-05', 1]]);
    const st = buildNightStatus(range, occ, s, cs, NOW, noHoliday, () => false, { adult: 2 });
    expect(st['2026-11-01']).toMatchObject({ available: false, remaining: 0, reason: 'full' });
    expect(st['2026-11-02']).toMatchObject({ available: true, remaining: 1, price: 20000 });
    expect(st['2026-11-05'].available).toBe(false);
  });

  it('room_count = 2 なら 1 件入っていても空き', () => {
    const s = settings();
    s.room_count = 2;
    const st = buildNightStatus(range, new Map([['2026-11-01', 1], ['2026-11-02', 2]]), s, cs, NOW, noHoliday, () => false, { adult: 1 });
    expect(st['2026-11-01']).toMatchObject({ available: true, remaining: 1 });
    expect(st['2026-11-02']).toMatchObject({ available: false, remaining: 0 });
  });

  it('休業・祝日不可・受付期間外・料金なしは理由付きで不可', () => {
    const s = settings();
    s.closed_dates = ['2026-11-03'];
    const st = buildNightStatus(
      { from: '2026-10-19', to: '2026-11-10' },
      new Map(),
      s,
      { min_advance_days: 1, advance_booking_days: 15 },
      NOW, // 10/20
      noHoliday,
      (d) => d === '2026-11-04',
      { adult: 4 }, // 表は 3 名まで → 料金なし
    );
    expect(st['2026-10-19']).toMatchObject({ available: false, reason: 'out_of_range' });
    expect(st['2026-10-20']).toMatchObject({ available: false, reason: 'out_of_range' }); // 1 日後から
    expect(st['2026-10-21']).toMatchObject({ available: false, reason: 'no_price' });
    expect(st['2026-11-03']).toMatchObject({ available: false, reason: 'closed' });
    expect(st['2026-11-04']).toMatchObject({ available: false, reason: 'holiday' });
    expect(st['2026-11-04'].price).toBeNull();
    expect(st['2026-11-05']).toMatchObject({ available: false, reason: 'out_of_range' }); // 15 日先まで（11/4 が最終）
  });

  it('条件付き受付開始: 12:00 を過ぎたら翌日は不可（前日の午前中まで）', () => {
    const s = settings();
    const rules = { min_advance_days: 1, advance_booking_days: 365, conditional_advance_rules: [{ id: 'r', from_time: '12:00', min_days: 2 }] };
    const r = { from: '2026-10-20', to: '2026-10-23' };
    const before = buildNightStatus(r, new Map(), s, rules, new Date('2026-10-20T02:59:00Z'), noHoliday, () => false, { adult: 1 }); // 11:59 JST
    expect(before['2026-10-21'].available).toBe(true);
    const after = buildNightStatus(r, new Map(), s, rules, new Date('2026-10-20T03:00:00Z'), noHoliday, () => false, { adult: 1 }); // 12:00 JST
    expect(after['2026-10-21']).toMatchObject({ available: false, reason: 'out_of_range' });
    expect(after['2026-10-22'].available).toBe(true);
  });

  it('isRangeBookable / selectableCheckoutDates: チェックアウト日の夜は埋まっていてもよい。途中の夜が埋まると不可。泊数の範囲', () => {
    const s = settings();
    s.max_nights = 3;
    // 11/4 と 11/8 の夜が埋まっている
    const st = buildNightStatus(range, new Map([['2026-11-04', 1], ['2026-11-08', 1]]), s, cs, NOW, noHoliday, () => false, { adult: 1 });
    expect(isRangeBookable(st, '2026-11-02', '2026-11-04', s)).toEqual({ ok: true });     // 11/2, 11/3 → 11/4 でアウト OK
    expect(isRangeBookable(st, '2026-11-02', '2026-11-05', s).ok).toBe(false);           // 11/4 の夜をまたぐ
    expect(isRangeBookable(st, '2026-11-04', '2026-11-05', s).ok).toBe(false);           // 埋まった夜からイン
    expect(isRangeBookable(st, '2026-11-05', '2026-11-09', s).ok).toBe(false);           // 4 泊 > max 3
    expect(isRangeBookable(st, '2026-11-05', '2026-11-05', s).ok).toBe(false);           // 0 泊
    expect(selectableCheckoutDates(st, '2026-11-02', s)).toEqual(['2026-11-03', '2026-11-04']);
    expect(selectableCheckoutDates(st, '2026-11-05', s)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
    expect(selectableCheckoutDates(st, '2026-11-04', s)).toEqual([]);
  });

  it('min_nights = 2 なら 1 泊のチェックアウト日は選べない', () => {
    const s = settings();
    s.min_nights = 2;
    const st = buildNightStatus(range, new Map(), s, cs, NOW, noHoliday, () => false, { adult: 1 });
    expect(selectableCheckoutDates(st, '2026-11-02', s)[0]).toBe('2026-11-04');
    expect(isRangeBookable(st, '2026-11-02', '2026-11-03', s).ok).toBe(false);
  });
});
