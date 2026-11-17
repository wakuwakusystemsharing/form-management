/**
 * LINE の「予約を変更」: 変更できるかの判定・日付と時間の〇✕・ボタンの data・カードの中身
 */
import { describe, expect, it } from 'vitest';
import {
  buildChangePostback,
  evaluateChangeDays,
  evaluateDaySlots,
  isChangeEnabled,
  listChangeWindowDates,
  listGridTimes,
  parseChangePostback,
  reservationDurationMinutes,
  resolveChangeEligibility,
  type ChangeSlotContext,
} from '@/lib/reservation-change';
import {
  buildChangeConfirmMessage,
  buildChangeDatesMessage,
  buildChangeMenuMessage,
  buildChangeTimesMessage,
} from '@/lib/reservation-change-flex';
import { buildChangeFormUrl, buildChangeNotificationEmail } from '@/lib/reservation-change-service';
import { computeReservationAnalytics } from '@/lib/reservation-analytics';
import type { FormConfig } from '@/types/form';

// 2026-11-17（火）10:00 JST
const NOW = new Date('2026-11-17T10:00:00+09:00');
const RID = '3f2b8c1e-1111-4222-8333-444455556666';

const open = { open: '10:00', close: '18:00', closed: false };
const cs = {
  booking_mode: 'calendar',
  time_interval: 60,
  advance_booking_days: 14,
  business_hours: {
    monday: { ...open, closed: true },
    tuesday: open,
    wednesday: open,
    thursday: open,
    friday: open,
    saturday: open,
    sunday: open,
  },
} as unknown as FormConfig['calendar_settings'];

const config = (over: Record<string, unknown> = {}) =>
  ({ basic_info: { liff_id: '1234567890-abcdefgh' }, calendar_settings: cs, ...over }) as unknown as FormConfig;

const ctx = (over: Partial<ChangeSlotContext> = {}): ChangeSlotContext => ({
  cs,
  durationMinutes: 60,
  events: [],
  staffMode: false,
  capacity: 1,
  ...over,
});

const ev = (start: string, end: string, summary = '予約') => ({ start: { dateTime: start }, end: { dateTime: end }, summary });

const reservation = {
  id: RID,
  reservation_date: '2026-11-20',
  reservation_time: '14:00:00',
  status: 'pending',
  menu_name: 'カット',
  submenu_name: null,
  staff_name: null,
  customer_info: { total_duration: 60 },
};

function collect(node: unknown, pred: (o: Record<string, unknown>) => boolean, out: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => collect(n, pred, out));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (pred(o)) out.push(o);
    Object.values(o).forEach((v) => collect(v, pred, out));
  }
  return out;
}
const postbackData = (msg: unknown) =>
  collect(msg, (o) => o.type === 'postback').map((o) => String(o.data));
const texts = (msg: unknown) => collect(msg, (o) => o.type === 'text').map((o) => String(o.text));

describe('ボタンの data', () => {
  it('組み立てと読み取りが往復する', () => {
    const actions = [
      { kind: 'dates', reservationId: RID, page: 2 },
      { kind: 'times', reservationId: RID, date: '2026-11-20' },
      { kind: 'confirm', reservationId: RID, date: '2026-11-20', time: '09:30' },
      { kind: 'apply', reservationId: RID, date: '2026-11-20', time: '09:30' },
    ] as const;
    for (const a of actions) {
      const data = buildChangePostback(a);
      expect(data.length).toBeLessThanOrEqual(300);
      expect(parseChangePostback(data)).toEqual(a);
    }
  });

  it('形式が違うものは読まない', () => {
    expect(parseChangePostback('lf:abc:1')).toBeNull();
    expect(parseChangePostback('rc:t:abc:2026-11-20')).toBeNull();
    expect(parseChangePostback('rc:x:abc:20261120:2560')).toBeNull();
    expect(parseChangePostback('rc:x:a b:20261120:1000')).toBeNull();
    expect(parseChangePostback(null)).toBeNull();
  });
});

describe('変更できるか', () => {
  it('既定は受け付ける。OFF にしたフォームは受け付けない', () => {
    expect(isChangeEnabled(config())).toBe(true);
    expect(resolveChangeEligibility(reservation, config(), NOW)).toMatchObject({ allowed: true, mode: 'calendar' });
    const off = config({ cancel_rules: { allow_change: false } });
    expect(resolveChangeEligibility(reservation, off, NOW)).toMatchObject({ allowed: false, reason: 'disabled' });
  });

  it('期限はキャンセル期限と同じ', () => {
    // 11/20 14:00 の 24 時間前 = 11/19 14:00
    const c = config({ cancel_rules: { deadline_hours: 24 } });
    expect(resolveChangeEligibility(reservation, c, new Date('2026-11-19T13:59:00+09:00')).allowed).toBe(true);
    expect(resolveChangeEligibility(reservation, c, new Date('2026-11-19T14:01:00+09:00'))).toMatchObject({ allowed: false, reason: 'deadline' });
  });

  it('過ぎた予約・キャンセル済み・宿泊・フォームが無い予約は変更できない', () => {
    expect(resolveChangeEligibility(reservation, config(), new Date('2026-11-20T14:00:00+09:00')).reason).toBe('past');
    expect(resolveChangeEligibility({ ...reservation, status: 'cancelled' }, config(), NOW).reason).toBe('cancelled');
    expect(resolveChangeEligibility({ ...reservation, checkout_date: '2026-11-22' }, config(), NOW).reason).toBe('stay');
    expect(resolveChangeEligibility(reservation, null, NOW).reason).toBe('no_form');
  });

  it('第三希望日時モードは予約フォームを開いて変更する', () => {
    const c = config({ calendar_settings: { ...cs, booking_mode: 'multiple_dates' } });
    expect(resolveChangeEligibility(reservation, c, NOW)).toMatchObject({ allowed: true, mode: 'form_only' });
  });

  it('所要時間は保存された合計、無ければメニュー + オプションの合計', () => {
    expect(reservationDurationMinutes(reservation)).toBe(60);
    expect(
      reservationDurationMinutes({ ...reservation, customer_info: {}, selected_menus: [{ duration: 45 }], selected_options: [{ duration: 15 }, {}] })
    ).toBe(60);
  });
});

describe('選べる日付', () => {
  it('今日から事前予約可能日数まで', () => {
    const dates = listChangeWindowDates(cs, NOW);
    expect(dates[0]).toBe('2026-11-17');
    expect(dates[dates.length - 1]).toBe('2026-12-01');
    expect(dates).toHaveLength(15);
  });

  it('定休日は closed、空きが無い日は full、空きがある日は open', () => {
    // 11/18（水）は 10:00〜18:00 が終日埋まっている
    const events = [ev('2026-11-18T10:00:00+09:00', '2026-11-18T18:00:00+09:00')];
    const days = evaluateChangeDays(ctx({ events }), ['2026-11-18', '2026-11-19', '2026-11-23'], NOW);
    expect(days).toEqual([
      { date: '2026-11-18', status: 'full' },
      { date: '2026-11-19', status: 'open' },
      { date: '2026-11-23', status: 'closed' }, // 月曜 = 定休
    ]);
  });

  it('いまの予約の時間しか空いていない日は full', () => {
    // 11/20 は 14:00 以外すべて埋まっている
    const events = [ev('2026-11-20T10:00:00+09:00', '2026-11-20T14:00:00+09:00'), ev('2026-11-20T15:00:00+09:00', '2026-11-20T18:00:00+09:00')];
    expect(evaluateChangeDays(ctx({ events }), ['2026-11-20'], NOW, { date: '2026-11-20', time: '14:00' })[0].status).toBe('full');
    expect(evaluateChangeDays(ctx({ events }), ['2026-11-20'], NOW)[0].status).toBe('open');
  });
});

describe('時間の〇✕', () => {
  it('営業時間内の時刻を時間間隔で並べる', () => {
    expect(listGridTimes(cs, '2026-11-19').map((m) => m / 60)).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
    const slots = evaluateDaySlots(ctx(), '2026-11-19', NOW);
    expect(slots.map((s) => s.time)).toEqual(['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
    expect(slots.every((s) => s.ok)).toBe(true);
  });

  it('予定と重なる時間は ✕（所要時間ぶん）', () => {
    const events = [ev('2026-11-19T13:00:00+09:00', '2026-11-19T14:00:00+09:00')];
    const slots = evaluateDaySlots(ctx({ events, durationMinutes: 120 }), '2026-11-19', NOW);
    const ok = (t: string) => slots.find((s) => s.time === t)?.ok;
    expect(ok('11:00')).toBe(true);
    expect(ok('12:00')).toBe(false); // 12:00〜14:00 が 13:00 の予定と重なる
    expect(ok('13:00')).toBe(false);
    expect(ok('14:00')).toBe(true);
    expect(ok('17:00')).toBe(false); // 営業時間を超える
  });

  it('同時刻に埋まるイベント数まで入れられる', () => {
    const events = [ev('2026-11-19T13:00:00+09:00', '2026-11-19T14:00:00+09:00')];
    const at = (c: ChangeSlotContext) => evaluateDaySlots(c, '2026-11-19', NOW).find((s) => s.time === '13:00')?.ok;
    expect(at(ctx({ events, capacity: 2 }))).toBe(true);
    expect(at(ctx({ events: [...events, ...events], capacity: 2 }))).toBe(false);
  });

  it('終日の予定がある日はすべて ✕。予定を取得できなかったときもすべて ✕', () => {
    const allDay = [{ start: { date: '2026-11-19' }, end: { date: '2026-11-20' }, summary: '休み' }];
    expect(evaluateDaySlots(ctx({ events: allDay }), '2026-11-19', NOW).some((s) => s.ok)).toBe(false);
    expect(evaluateDaySlots(ctx({ events: null }), '2026-11-19', NOW).some((s) => s.ok)).toBe(false);
  });

  it('カレンダーが無い店舗は設定だけで判定する', () => {
    expect(evaluateDaySlots(ctx({ events: undefined }), '2026-11-19', NOW).every((s) => s.ok)).toBe(true);
  });

  it('当日は過ぎた時間が ✕。定休日は何も出さない', () => {
    const slots = evaluateDaySlots(ctx(), '2026-11-17', new Date('2026-11-17T10:30:00+09:00'));
    expect(slots.find((s) => s.time === '10:00')?.ok).toBe(false);
    expect(slots.find((s) => s.time === '11:00')?.ok).toBe(true);
    expect(evaluateDaySlots(ctx(), '2026-11-23', NOW)).toEqual([]);
  });

  it('スタッフのカレンダーは 1 件でも重なれば ✕。スタッフ同時刻上限にも従う', () => {
    const events = [ev('2026-11-19T13:00:00+09:00', '2026-11-19T14:00:00+09:00')];
    const at = (c: ChangeSlotContext, t: string) => evaluateDaySlots(c, '2026-11-19', NOW).find((s) => s.time === t)?.ok;
    expect(at(ctx({ events, staffMode: true, capacity: 5 }), '13:00')).toBe(false);
    expect(at(ctx({ events: [], staffMode: true, staffCap: 1, otherStaffEvents: [events] }), '13:00')).toBe(false);
    expect(at(ctx({ events: [], staffMode: true, staffCap: 2, otherStaffEvents: [events] }), '13:00')).toBe(true);
  });

  it('「営業日」の予定がある日は、その時間帯だけ予約できる', () => {
    const events = [ev('2026-11-19T12:00:00+09:00', '2026-11-19T15:00:00+09:00', '営業日')];
    const slots = evaluateDaySlots(ctx({ events }), '2026-11-19', NOW);
    expect(slots.filter((s) => s.ok).map((s) => s.time)).toEqual(['12:00', '13:00', '14:00']);
  });
});

describe('カード', () => {
  it('最初のカード: 日時 / 時間 / メニューの変更ボタン', () => {
    const formUrl = buildChangeFormUrl(config(), RID);
    expect(formUrl).toBe(`https://liff.line.me/1234567890-abcdefgh?change=${RID}`);
    const msg = buildChangeMenuMessage('A店', [{ reservation, allowed: true, mode: 'calendar', formUrl }]);
    expect(postbackData(msg)).toEqual([`rc:d:${RID}:0`, `rc:t:${RID}:20261120`]);
    expect(collect(msg, (o) => o.type === 'uri').map((o) => o.uri)).toEqual([formUrl]);
    expect(texts(msg)).toContain('11/20（金） 14:00');
  });

  it('変更できない予約はボタンを出さず案内だけ', () => {
    const msg = buildChangeMenuMessage('A店', [{ reservation, allowed: false, mode: 'calendar', blockText: '期限を過ぎています。' }]);
    expect(postbackData(msg)).toEqual([]);
    expect(texts(msg)).toContain('期限を過ぎています。');
  });

  it('LIFF ID の無いフォーム・Web フォームは「メニューを変更」を出さない', () => {
    expect(buildChangeFormUrl(config({ basic_info: { liff_id: '' } }), RID)).toBeNull();
    expect(buildChangeFormUrl(config({ form_type: 'web' }), RID)).toBeNull();
  });

  it('日付のカード: 空きのある日だけ押せる。定休日は出さない。注意書きと続きのボタン', () => {
    const msg = buildChangeDatesMessage({
      reservation,
      days: [
        { date: '2026-11-18', status: 'full' },
        { date: '2026-11-19', status: 'open' },
        { date: '2026-11-23', status: 'closed' },
      ],
      windowDays: 14,
      lastDate: '2026-12-01',
      nextPage: 1,
    });
    expect(postbackData(msg)).toEqual([`rc:t:${RID}:20261119`, `rc:d:${RID}:1`]);
    const t = texts(msg);
    expect(t).toContain('11/18（水）');
    expect(t).not.toContain('11/23（月）');
    expect(t).toContain('今日から 14 日先（12/1（火））までの日付に変更できます。');
  });

  it('時間のカード: 〇 だけ押せる。いまの予約の時間は「現在」で押せない', () => {
    const slots = [
      { time: '13:00', ok: false },
      { time: '14:00', ok: true },
      { time: '15:00', ok: true },
    ];
    const msg = buildChangeTimesMessage({ reservation, date: '2026-11-20', slots });
    expect(postbackData(msg)).toEqual([`rc:c:${RID}:20261120:1500`, `rc:d:${RID}:0`]);
    expect(texts(msg)).toEqual(expect.arrayContaining(['現在', '〇', '✕']));
  });

  it('空きが無い日は案内と「ほかの日付を選ぶ」だけ', () => {
    const msg = buildChangeTimesMessage({ reservation, date: '2026-11-19', slots: [{ time: '13:00', ok: false }] });
    expect(postbackData(msg)).toEqual([`rc:d:${RID}:0`]);
  });

  it('確認のカード: 変更前と変更後、確定のボタン', () => {
    const msg = buildChangeConfirmMessage('A店', reservation, '2026-11-21', '11:00');
    expect(postbackData(msg)).toEqual([`rc:x:${RID}:20261121:1100`, `rc:d:${RID}:0`]);
    expect(texts(msg)).toEqual(expect.arrayContaining(['11/20（金） 14:00', '11/21（土） 11:00']));
  });

  it('カードは LINE の上限（1 通 50KB・カルーセル 12 枚）に収まる', () => {
    const slots = Array.from({ length: 84 }, (_, i) => ({ time: `${String(8 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`, ok: i % 2 === 0 }));
    const msg = buildChangeTimesMessage({ reservation, date: '2026-11-19', slots }) as { contents: { contents: unknown[] } };
    expect(msg.contents.contents.length).toBeLessThanOrEqual(12);
    expect(Buffer.byteLength(JSON.stringify(msg.contents), 'utf8')).toBeLessThan(50000);
    expect(postbackData(msg).filter((d) => d.startsWith('rc:c:'))).toHaveLength(42);
  });
});

describe('店舗への通知メールと集計', () => {
  it('変更前と変更後の日時を載せる', () => {
    const mail = buildChangeNotificationEmail({
      storeName: 'A店',
      before: reservation,
      after: { ...reservation, customer_name: '山田', customer_phone: '090', reservation_date: '2026-11-21', reservation_time: '11:00:00' },
    });
    expect(mail.subject).toBe('【予約変更】山田様｜11/21（土） 11:00');
    expect(mail.body).toContain('■ 変更前　：11/20（金） 14:00');
    expect(mail.body).toContain('■ 変更後　：11/21（土） 11:00');
    expect(mail.body).toContain('■ メニュー：カット');
  });

  it('置き換えられた元の予約は、予約数にもキャンセル数にも数えない', () => {
    const base = { form_id: 'f1', reservation_date: '2026-11-20', reservation_time: '14:00', selected_menus: [], selected_options: [] };
    const result = computeReservationAnalytics([
      { ...base, status: 'pending' },
      { ...base, status: 'cancelled' },
      { ...base, status: 'cancelled', customer_info: { replaced_by_reservation_id: 'new' } },
    ] as never);
    expect(result.summary.total).toBe(1);
    expect(result.summary.cancelled).toBe(1);
  });
});
