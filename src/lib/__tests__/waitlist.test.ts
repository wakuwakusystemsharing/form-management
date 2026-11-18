/**
 * 空き待ち（キャンセル待ち）の純粋ロジック
 */
import { describe, expect, it } from 'vitest';
import { normalizeForm } from '../form-normalizer';
import { groupWaitlistBySlot } from '../waitlist-summary';
import {
  isWaitlistQuietTime,
  renderWaitlistMessageText,
  resolveWaitlistMessageTemplate,
  buildWaitlistBookingUrl,
  buildWaitlistCancelPostback,
  checkWaitlistRegistration,
  decideWaitlistAction,
  isBeforeWaitlistDeadline,
  isWaitlistActive,
  isWaitlistSlotPast,
  parseWaitlistPostback,
  resolveWaitlistSettings,
  sanitizeWaitlistSettings,
  waitlistMenuText,
} from '../waitlist';
import { buildWaitlistListMessage, buildWaitlistRegisteredMessage, buildWaitlistSlotFilledMessage, buildWaitlistSlotOpenedMessage } from '../waitlist-flex';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-20T10:00:00+09:00');

describe('設定', () => {
  it('未設定は OFF・上限 3 件・締切 1 時間前', () => {
    const off = { enabled: false, max_per_user: 3, deadline_hours: 1, quiet_hours: { enabled: false, start: 22, end: 8 }, messages: {} };
    expect(resolveWaitlistSettings(undefined)).toEqual(off);
    expect(resolveWaitlistSettings({})).toEqual(off);
    expect(sanitizeWaitlistSettings(undefined)).toBeUndefined();
  });

  it('値を範囲に収める。enabled は true のときだけ ON', () => {
    expect(resolveWaitlistSettings({ waitlist: { enabled: true, max_per_user: 99, deadline_hours: -5 } })).toMatchObject({ enabled: true, max_per_user: 10, deadline_hours: 0 });
    expect(resolveWaitlistSettings({ waitlist: { enabled: 'true', max_per_user: 0, deadline_hours: '6' } })).toMatchObject({ enabled: false, max_per_user: 1, deadline_hours: 6 });
  });

  it('LINE フォーム × カレンダー表示モードで ON のときだけ動く', () => {
    const on = { enabled: true };
    expect(isWaitlistActive({ form_type: 'line', calendar_settings: { booking_mode: 'calendar', waitlist: on } })).toBe(true);
    expect(isWaitlistActive({ calendar_settings: { waitlist: on } })).toBe(true);
    expect(isWaitlistActive({ form_type: 'web', calendar_settings: { booking_mode: 'calendar', waitlist: on } })).toBe(false);
    expect(isWaitlistActive({ form_type: 'line', calendar_settings: { booking_mode: 'multiple_dates', waitlist: on } })).toBe(false);
    expect(isWaitlistActive({ form_type: 'line', calendar_settings: { booking_mode: 'stay', waitlist: on } })).toBe(false);
    expect(isWaitlistActive({ form_type: 'line', calendar_settings: { booking_mode: 'calendar' } })).toBe(false);
    expect(isWaitlistActive(null)).toBe(false);
  });

  it('normalizeForm: 未設定のフォームにはキーを作らない（= OFF のまま）。設定済みは保持する', () => {
    const base = { id: 'f1', store_id: 's1', config: { basic_info: { form_name: 'a' }, calendar_settings: { booking_mode: 'calendar' } } };
    expect((normalizeForm(base as never).config.calendar_settings as { waitlist?: unknown }).waitlist).toBeUndefined();
    const withWl = { ...base, config: { ...base.config, calendar_settings: { booking_mode: 'calendar', waitlist: { enabled: true, max_per_user: 5, deadline_hours: 2 } } } };
    expect(normalizeForm(withWl as never).config.calendar_settings.waitlist).toEqual({ enabled: true, max_per_user: 5, deadline_hours: 2, quiet_hours: { enabled: false, start: 22, end: 8 }, messages: {} });
    // 第 1 弾で保存した設定（夜間・文面なし）も、そのまま読める
    const full = { ...base, config: { ...base.config, calendar_settings: { booking_mode: 'calendar', waitlist: { enabled: true, max_per_user: 5, deadline_hours: 2, quiet_hours: { enabled: true, start: 21, end: 9 }, messages: { slot_opened: '  空きました  ', slot_filled: '' } } } } };
    expect(normalizeForm(full as never).config.calendar_settings.waitlist).toMatchObject({ quiet_hours: { enabled: true, start: 21, end: 9 }, messages: { slot_opened: '空きました' } });
  });
});

describe('日時の判定（日本時間）', () => {
  it('開始時刻を過ぎたら終了扱い', () => {
    expect(isWaitlistSlotPast('2026-11-20', '10:00', NOW)).toBe(true);
    expect(isWaitlistSlotPast('2026-11-20', '10:30', NOW)).toBe(false);
    expect(isWaitlistSlotPast('2026-11-19', '23:00', NOW)).toBe(true);
    expect(isWaitlistSlotPast('bad', '10:00', NOW)).toBe(true);
  });

  it('受付締切: 開始の N 時間前より前だけ', () => {
    expect(isBeforeWaitlistDeadline({ deadline_hours: 2 }, '2026-11-20', '12:30', NOW)).toBe(true);
    expect(isBeforeWaitlistDeadline({ deadline_hours: 2 }, '2026-11-20', '12:00', NOW)).toBe(false);
    expect(isBeforeWaitlistDeadline({ deadline_hours: 0 }, '2026-11-20', '10:01', NOW)).toBe(true);
  });
});

describe('見回りで何をするか', () => {
  const settings = { deadline_hours: 1 };
  const entry = (status: 'waiting' | 'notified', time = '15:00') => ({ status, reservation_date: '2026-11-20', reservation_time: time });

  it('空き待ち中: 空いたら知らせる。満席・受付時間外・不明は何もしない', () => {
    expect(decideWaitlistAction(entry('waiting'), 'open', settings, NOW)).toBe('notify');
    expect(decideWaitlistAction(entry('waiting'), 'full', settings, NOW)).toBe('none');
    expect(decideWaitlistAction(entry('waiting'), 'closed', settings, NOW)).toBe('none');
    expect(decideWaitlistAction(entry('waiting'), 'unknown', settings, NOW)).toBe('none');
  });

  it('受付締切を過ぎた枠は、空いていても知らせない', () => {
    expect(decideWaitlistAction(entry('waiting', '10:30'), 'open', settings, NOW)).toBe('none');
    expect(decideWaitlistAction(entry('waiting', '11:30'), 'open', settings, NOW)).toBe('notify');
  });

  it('お知らせ済み: また埋まったらおわび。空いたまま・不明なら何もしない（二重に知らせない）', () => {
    expect(decideWaitlistAction(entry('notified'), 'full', settings, NOW)).toBe('apologize');
    expect(decideWaitlistAction(entry('notified'), 'open', settings, NOW)).toBe('none');
    expect(decideWaitlistAction(entry('notified'), 'unknown', settings, NOW)).toBe('none');
    expect(decideWaitlistAction(entry('notified'), 'closed', settings, NOW)).toBe('none');
  });

  it('日時を過ぎたら終了。終了済みの空き待ちには何もしない', () => {
    expect(decideWaitlistAction(entry('waiting', '09:00'), 'open', settings, NOW)).toBe('expire');
    expect(decideWaitlistAction(entry('notified', '09:00'), 'full', settings, NOW)).toBe('expire');
    expect(decideWaitlistAction({ ...entry('waiting'), status: 'cancelled' as never }, 'open', settings, NOW)).toBe('none');
  });
});

describe('夜間に送らない', () => {
  const quiet = (start: number, end: number, enabled = true) => ({ quiet_hours: { enabled, start, end } });
  it('日付をまたぐ時間帯（22:00〜8:00）', () => {
    expect(isWaitlistQuietTime(quiet(22, 8), at('2026-11-20T21:59:00+09:00'))).toBe(false);
    expect(isWaitlistQuietTime(quiet(22, 8), at('2026-11-20T22:00:00+09:00'))).toBe(true);
    expect(isWaitlistQuietTime(quiet(22, 8), at('2026-11-21T03:00:00+09:00'))).toBe(true);
    expect(isWaitlistQuietTime(quiet(22, 8), at('2026-11-21T07:59:00+09:00'))).toBe(true);
    expect(isWaitlistQuietTime(quiet(22, 8), at('2026-11-21T08:00:00+09:00'))).toBe(false);
  });
  it('同じ日の中の時間帯・OFF・開始と終了が同じ', () => {
    expect(isWaitlistQuietTime(quiet(1, 6), at('2026-11-21T05:30:00+09:00'))).toBe(true);
    expect(isWaitlistQuietTime(quiet(1, 6), at('2026-11-21T06:00:00+09:00'))).toBe(false);
    expect(isWaitlistQuietTime(quiet(22, 8, false), at('2026-11-21T03:00:00+09:00'))).toBe(false);
    expect(isWaitlistQuietTime(quiet(9, 9), at('2026-11-21T09:00:00+09:00'))).toBe(false);
    expect(isWaitlistQuietTime(undefined, at('2026-11-21T03:00:00+09:00'))).toBe(false);
  });
  it('送らない時間帯は、お知らせもおわびも送らない。日時を過ぎた空き待ちの終了は行う', () => {
    const night = at('2026-11-20T23:00:00+09:00');
    const settings = { deadline_hours: 1, ...quiet(22, 8) };
    const e = (status: 'waiting' | 'notified', date = '2026-11-21') => ({ status, reservation_date: date, reservation_time: '15:00' });
    expect(decideWaitlistAction(e('waiting'), 'open', settings, night)).toBe('none');
    expect(decideWaitlistAction(e('notified'), 'full', settings, night)).toBe('none');
    expect(decideWaitlistAction(e('waiting', '2026-11-20'), 'open', settings, night)).toBe('expire');
    // 明けたら送る
    expect(decideWaitlistAction(e('waiting'), 'open', settings, at('2026-11-21T08:00:00+09:00'))).toBe('notify');
  });
});

describe('お知らせの文面', () => {
  it('未設定・空白だけは既定の文面', () => {
    expect(resolveWaitlistMessageTemplate(resolveWaitlistSettings({}), 'slot_opened')).toBe('お待ちいただいていた日時に空きが出ました。');
    expect(resolveWaitlistMessageTemplate({ messages: { slot_filled: '   ' } }, 'slot_filled')).toContain('埋まりました');
    expect(resolveWaitlistMessageTemplate({ messages: { registered: '受け付けました！' } }, 'registered')).toBe('受け付けました！');
  });
  it('{日時} {メニュー} {店名} {予約URL} を置き換える。値が無い変数は空、知らない変数はそのまま', () => {
    expect(renderWaitlistMessageText('{店名}です。{日時} の {メニュー} が空きました。{日時}', { 日時: '11/25（水） 14:00', メニュー: 'カット', 店名: 'テスト店' }))
      .toBe('テスト店です。11/25（水） 14:00 の カット が空きました。11/25（水） 14:00');
    expect(renderWaitlistMessageText('予約はこちら {予約URL}', {})).toBe('予約はこちら');
    expect(renderWaitlistMessageText('{名前}様', { 日時: 'x' })).toBe('{名前}様');
  });
  it('文面は 300 文字まで', () => {
    const s = resolveWaitlistSettings({ waitlist: { messages: { slot_opened: 'あ'.repeat(500) } } });
    expect(s.messages.slot_opened).toHaveLength(300);
  });
});

describe('日時ごとの人数', () => {
  const e = (date: string, time: string, status: string, name: string, staff: string | null = null) => ({ reservation_date: date, reservation_time: time, status: status as never, customer_name: name, staff_name: staff });
  it('受付中の空き待ちだけを、日付 → 時間の早い順にまとめる', () => {
    const days = groupWaitlistBySlot([
      e('2026-11-26', '10:00', 'waiting', 'A'),
      e('2026-11-25', '14:00', 'waiting', 'B', '佐藤'),
      e('2026-11-25', '14:00', 'notified', 'C', '佐藤'),
      e('2026-11-25', '14:00', 'waiting', 'D'),
      e('2026-11-25', '09:30', 'waiting', 'E'),
      e('2026-11-25', '14:00', 'cancelled', 'F'),
      e('2026-11-25', '14:00', 'fulfilled', 'G'),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-11-25', '2026-11-26']);
    expect(days[0].total).toBe(4);
    expect(days[0].slots.map((s) => [s.time, s.count, s.notified])).toEqual([['09:30', 1, 0], ['14:00', 3, 1]]);
    expect(days[0].slots[1].names).toEqual(['B', 'C', 'D']);
    expect(days[0].slots[1].staffNames).toEqual(['佐藤']);
    expect(groupWaitlistBySlot([])).toEqual([]);
  });
});

describe('登録できるか', () => {
  const settings = { enabled: true, max_per_user: 2, deadline_hours: 1 };
  const base = { settings, formId: 'f1', staffId: null, activeEntries: [], now: NOW };

  it('先の日時は登録できる', () => {
    expect(checkWaitlistRegistration({ ...base, date: '2026-11-21', time: '14:00' })).toEqual({ ok: true });
  });

  it('形式不正・過去・締切後は登録できない', () => {
    expect(checkWaitlistRegistration({ ...base, date: '2026/11/21', time: '14:00' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkWaitlistRegistration({ ...base, date: '2026-11-21', time: '25:00' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkWaitlistRegistration({ ...base, date: '2026-11-20', time: '09:00' })).toMatchObject({ ok: false, reason: 'past' });
    expect(checkWaitlistRegistration({ ...base, date: '2026-11-20', time: '10:30' })).toMatchObject({ ok: false, reason: 'deadline' });
  });

  it('同じ条件の二重登録はできない（スタッフが違えば別）', () => {
    const activeEntries = [{ form_id: 'f1', reservation_date: '2026-11-21', reservation_time: '14:00', staff_id: null }];
    expect(checkWaitlistRegistration({ ...base, activeEntries, date: '2026-11-21', time: '14:00' })).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(checkWaitlistRegistration({ ...base, activeEntries, staffId: 's1', date: '2026-11-21', time: '14:00' })).toEqual({ ok: true });
  });

  it('1 人あたりの上限を超えると登録できない', () => {
    const activeEntries = [
      { form_id: 'f1', reservation_date: '2026-11-21', reservation_time: '14:00', staff_id: null },
      { form_id: 'f1', reservation_date: '2026-11-22', reservation_time: '14:00', staff_id: null },
    ];
    expect(checkWaitlistRegistration({ ...base, activeEntries, date: '2026-11-23', time: '14:00' })).toMatchObject({ ok: false, reason: 'limit' });
  });
});

describe('ボタンの data と URL', () => {
  it('取り消しボタンの data を往復できる。形式が違えば null', () => {
    const id = '3f2b8c1e-1111-4222-8333-444455556666';
    expect(parseWaitlistPostback(buildWaitlistCancelPostback(id))).toEqual({ kind: 'cancel', entryId: id });
    expect(parseWaitlistPostback('wl:x:')).toBeNull();
    expect(parseWaitlistPostback('wl:y:abc')).toBeNull();
    expect(parseWaitlistPostback('rc:x:abc')).toBeNull();
    expect(parseWaitlistPostback('wl:x:a b')).toBeNull();
  });

  it('予約フォームの URL は LIFF ID があるときだけ', () => {
    expect(buildWaitlistBookingUrl('1234567890-abcdefgh', 'e1')).toBe('https://liff.line.me/1234567890-abcdefgh?waitlist=e1');
    expect(buildWaitlistBookingUrl('', 'e1')).toBeNull();
    expect(buildWaitlistBookingUrl(null, 'e1')).toBeNull();
  });

  it('メニュー名の表示', () => {
    expect(waitlistMenuText({ menu_text: null, selected_menus: [{ menu_name: 'カット' }, { menu_name: 'カラー', submenu_name: 'ロング' }] })).toBe('カット、カラー > ロング');
    expect(waitlistMenuText({ menu_text: 'おまかせ', selected_menus: [] })).toBe('おまかせ');
  });
});

describe('LINE のカード', () => {
  const entry = {
    id: 'e1',
    reservation_date: '2026-11-25',
    reservation_time: '14:00',
    menu_text: null,
    selected_menus: [{ menu_name: 'カット' }],
    staff_name: '佐藤',
    status: 'waiting' as const,
  };
  const text = (m: unknown) => JSON.stringify(m);

  it('受付: 日時・メニュー・担当と、保証しない旨・先着順の注意を載せる', () => {
    const s = text(buildWaitlistRegisteredMessage('テスト店', entry));
    expect(s).toContain('空き待ちを受け付けました');
    expect(s).toContain('11/25（水） 14:00');
    expect(s).toContain('カット');
    expect(s).toContain('佐藤');
    expect(s).toContain('お約束するものではありません');
    expect(s).toContain('先着順');
  });

  it('空きのお知らせ: 予約フォームへのボタンと先着順の注意', () => {
    const s = text(buildWaitlistSlotOpenedMessage('テスト店', entry, 'https://liff.line.me/1234567890-abcdefgh?waitlist=e1'));
    expect(s).toContain('空きが出ました');
    expect(s).toContain('https://liff.line.me/1234567890-abcdefgh?waitlist=e1');
    expect(s).toContain('先着順');
    expect(text(buildWaitlistSlotOpenedMessage('テスト店', entry, null))).not.toContain('"uri"');
  });

  it('文面を変えても、日時・注意書き・ボタンは必ず載る', () => {
    const opened = text(buildWaitlistSlotOpenedMessage('テスト店', entry, 'https://liff.line.me/1234567890-abcdefgh?waitlist=e1', 'お席が空きました！'));
    expect(opened).toContain('お席が空きました！');
    expect(opened).not.toContain('お待ちいただいていた日時に空きが出ました。');
    expect(opened).toContain('11/25（水） 14:00');
    expect(opened).toContain('先着順');
    expect(opened).toContain('この日時で予約する');
    const registered = text(buildWaitlistRegisteredMessage('テスト店', entry, 'ご登録ありがとうございます。'));
    expect(registered).toContain('ご登録ありがとうございます。');
    expect(registered).toContain('お約束するものではありません');
    const filled = text(buildWaitlistSlotFilledMessage('テスト店', entry, 'ごめんなさい、埋まってしまいました。'));
    expect(filled).toContain('ごめんなさい、埋まってしまいました。');
    expect(filled).toContain('空き待ちは継続しています');
    // 空の文面は既定に戻る
    expect(text(buildWaitlistSlotFilledMessage('テスト店', entry, ''))).toContain('ほかのお客様のご予約で埋まりました');
  });

  it('おわび: 埋まったことと、空き待ちが続くこと', () => {
    const s = text(buildWaitlistSlotFilledMessage('テスト店', entry));
    expect(s).toContain('埋まりました');
    expect(s).toContain('空き待ちは継続しています');
  });

  it('一覧: 1 件ごとに取り消しボタン。0 件なら案内だけ', () => {
    const s = text(buildWaitlistListMessage('テスト店', [entry, { ...entry, id: 'e2', status: 'notified' as const }]));
    expect(s).toContain('wl:x:e1');
    expect(s).toContain('wl:x:e2');
    expect(s).toContain('空きをお知らせ済み');
    expect(text(buildWaitlistListMessage('テスト店', []))).toContain('登録中の空き待ちはありません');
  });
});
