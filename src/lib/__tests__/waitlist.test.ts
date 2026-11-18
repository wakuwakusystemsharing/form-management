/**
 * 空き待ち（キャンセル待ち）の純粋ロジック
 */
import { describe, expect, it } from 'vitest';
import { normalizeForm } from '../form-normalizer';
import {
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
    expect(resolveWaitlistSettings(undefined)).toEqual({ enabled: false, max_per_user: 3, deadline_hours: 1 });
    expect(resolveWaitlistSettings({})).toEqual({ enabled: false, max_per_user: 3, deadline_hours: 1 });
    expect(sanitizeWaitlistSettings(undefined)).toBeUndefined();
  });

  it('値を範囲に収める。enabled は true のときだけ ON', () => {
    expect(resolveWaitlistSettings({ waitlist: { enabled: true, max_per_user: 99, deadline_hours: -5 } })).toEqual({ enabled: true, max_per_user: 10, deadline_hours: 0 });
    expect(resolveWaitlistSettings({ waitlist: { enabled: 'true', max_per_user: 0, deadline_hours: '6' } })).toEqual({ enabled: false, max_per_user: 1, deadline_hours: 6 });
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
    expect(normalizeForm(withWl as never).config.calendar_settings.waitlist).toEqual({ enabled: true, max_per_user: 5, deadline_hours: 2 });
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
