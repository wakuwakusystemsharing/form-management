/**
 * 空き待ち（キャンセル待ち）のサーバー側処理。
 * Supabase / Google カレンダー / LINE 送信は偽物に差し替えて、登録 → 空きのお知らせ → おわび → 再通知 → 終了 の流れを確かめる
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaitlistEntry, WaitlistStatus } from '../waitlist';

type Event = { start: { dateTime: string }; end: { dateTime: string }; summary?: string };

const h = vi.hoisted(() => ({
  entries: [] as any[],
  notifications: [] as any[],
  events: {} as Record<string, any[] | null>,
  pushes: [] as Array<{ to: string; messages: any[] }>,
  pushOk: true,
  config: null as any,
  seq: 0,
}));

vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn(); } }));
vi.mock('@/lib/env', () => ({ getAppEnvironment: () => 'staging' }));
vi.mock('@/lib/google-calendar', () => ({
  listCalendarEventsAll: async (calendarId: string) => {
    const ev = h.events[calendarId];
    if (ev === null) throw new Error('calendar error');
    return ev || [];
  },
}));
vi.mock('@/lib/line-push', () => ({
  pushLineMessages: async (_token: string, to: string, messages: any[]) => {
    h.pushes.push({ to, messages });
    return { ok: h.pushOk, status: h.pushOk ? 200 : 400, body: h.pushOk ? '{}' : 'blocked' };
  },
}));
vi.mock('@/lib/reservation-change-service', () => ({
  loadForm: async () => (h.config ? { config: h.config, staticDeploy: null } : null),
  loadLocalFormConfig: () => h.config,
}));
vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const rows = table === 'stores' ? [{ id: 'st1', name: 'テスト店', google_calendar_id: 'store-cal', line_channel_access_token: 'token' }] : [];
      const q: any = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] || null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/waitlist-repository', () => {
  const active = (e: any) => e.status === 'waiting' || e.status === 'notified';
  return {
    listActiveWaitlistForUser: async (storeId: string, userId: string) => h.entries.filter((e) => e.store_id === storeId && e.line_user_id === userId && active(e)),
    listActiveWaitlist: async (storeId?: string | null) => h.entries.filter((e) => active(e) && (!storeId || e.store_id === storeId)).map((e) => ({ ...e })),
    hasActiveWaitlist: async (storeId: string) => h.entries.some((e) => e.store_id === storeId && active(e)),
    getWaitlistEntry: async (id: string) => h.entries.find((e) => e.id === id) || null,
    insertWaitlistEntry: async (input: any) => {
      const dup = h.entries.some(
        (e) => active(e) && e.form_id === input.form_id && e.line_user_id === input.line_user_id && e.reservation_date === input.reservation_date && e.reservation_time === input.reservation_time && (e.staff_id || null) === (input.staff_id || null)
      );
      if (dup) return 'duplicate';
      const entry = { ...input, id: `e${++h.seq}`, status: 'waiting', notified_at: null, notify_count: 0, fail_count: 0, created_at: new Date(Date.now() + h.seq).toISOString(), updated_at: '' };
      h.entries.push(entry);
      return entry;
    },
    transitionWaitlistEntry: async (id: string, from: WaitlistStatus[], patch: any) => {
      const e = h.entries.find((x) => x.id === id && from.includes(x.status));
      if (!e) return false;
      Object.assign(e, patch);
      return true;
    },
    fulfillWaitlistForSlot: async (storeId: string, userId: string, date: string, time: string) => {
      const hit = h.entries.filter((e) => e.store_id === storeId && e.line_user_id === userId && e.reservation_date === date && e.reservation_time === time && active(e));
      hit.forEach((e) => { e.status = 'fulfilled'; });
      return hit.length;
    },
    recordWaitlistNotification: async (n: any) => { h.notifications.push(n); },
  };
});

import {
  cancelMyWaitlist,
  evaluateWaitlistSlot,
  getWaitlistSourceForForm,
  handleWaitlistPostback,
  listMyWaitlist,
  onReservationCreatedForWaitlist,
  processWaitlist,
  registerWaitlist,
} from '../waitlist-service';

const NOW = new Date('2026-11-20T10:00:00+09:00');
const DATE = '2026-11-25';
const hours = { open: '09:00', close: '18:00', closed: false };
const business_hours = { monday: hours, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: hours };
const store = { id: 'st1', name: 'テスト店', google_calendar_id: 'store-cal', line_channel_access_token: 'token' };

function config(over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): any {
  return {
    form_type: 'line',
    basic_info: { form_name: 'テスト', liff_id: '1234567890-abcdefgh' },
    calendar_settings: { booking_mode: 'calendar', business_hours, advance_booking_days: 60, time_interval: 30, max_concurrent_events: 1, waitlist: { enabled: true, max_per_user: 2, deadline_hours: 1 }, ...over },
    ...extra,
  };
}

const ev = (date: string, from: string, to: string, summary = '予約'): Event => ({ start: { dateTime: `${date}T${from}:00+09:00` }, end: { dateTime: `${date}T${to}:00+09:00` }, summary });

const input = (user: string, time = '14:00', over: Record<string, unknown> = {}) => ({
  storeId: 'st1',
  formId: 'f1',
  lineUserId: user,
  customerName: `客${user}`,
  date: DATE,
  time,
  selectedMenus: [{ menu_id: 'm1', menu_name: 'カット', duration: 60 }],
  selectedOptions: [],
  totalDuration: 60,
  now: NOW,
  ...over,
});

const statusOf = (id: string) => (h.entries.find((e) => e.id === id) as WaitlistEntry).status;

beforeEach(() => {
  h.entries = [];
  h.notifications = [];
  h.events = { 'store-cal': [ev(DATE, '14:00', '15:00')] };
  h.pushes = [];
  h.pushOk = true;
  h.config = config();
  h.seq = 0;
});

describe('登録', () => {
  it('満席の枠に登録できる（所要時間・メニュー・お名前を保存）', async () => {
    const r = await registerWaitlist(input('U1'));
    expect(r.ok).toBe(true);
    expect(h.entries[0]).toMatchObject({ store_id: 'st1', form_id: 'f1', line_user_id: 'U1', reservation_date: DATE, reservation_time: '14:00', duration_minutes: 60, status: 'waiting', staff_id: null, customer_name: '客U1' });
  });

  it('機能が OFF のフォームでは登録できない（既定は OFF）', async () => {
    h.config = config({ waitlist: undefined });
    expect(await registerWaitlist(input('U1'))).toMatchObject({ ok: false, status: 409, code: 'disabled' });
    h.config = config({ waitlist: { enabled: false } });
    expect(await registerWaitlist(input('U1'))).toMatchObject({ ok: false, code: 'disabled' });
    expect(h.entries).toHaveLength(0);
  });

  it('LINE のユーザーが分からなければ登録できない', async () => {
    expect(await registerWaitlist(input(''))).toMatchObject({ ok: false, status: 400, code: 'no_line' });
  });

  it('空いている枠・受付していない時間には登録できない（満席の枠だけ）', async () => {
    expect(await registerWaitlist(input('U1', '10:00'))).toMatchObject({ ok: false, code: 'slot_open' });
    expect(await registerWaitlist(input('U1', '20:00'))).toMatchObject({ ok: false, code: 'closed' });
    expect(h.entries).toHaveLength(0);
  });

  it('所要時間が長くて予定に重なる枠も満席として登録できる', async () => {
    // 13:30 から 60 分 → 14:00 の予定に重なる
    expect((await registerWaitlist(input('U1', '13:30'))).ok).toBe(true);
  });

  it('二重登録・上限超えはできない', async () => {
    h.events['store-cal'] = [ev(DATE, '09:00', '18:00')];
    expect((await registerWaitlist(input('U1', '14:00'))).ok).toBe(true);
    expect(await registerWaitlist(input('U1', '14:00'))).toMatchObject({ ok: false, code: 'duplicate' });
    expect((await registerWaitlist(input('U1', '15:00'))).ok).toBe(true);
    expect(await registerWaitlist(input('U1', '16:00'))).toMatchObject({ ok: false, code: 'limit' });
    // 別の人は登録できる
    expect((await registerWaitlist(input('U2', '14:00'))).ok).toBe(true);
  });

  it('カレンダーの予定を取得できないときも登録は受け付ける（知らせるのは確認できてから）', async () => {
    h.events['store-cal'] = null;
    expect((await registerWaitlist(input('U1'))).ok).toBe(true);
  });
});

describe('見回り: お知らせ → おわび → 再通知', () => {
  it('満席のままなら何も送らない', async () => {
    await registerWaitlist(input('U1'));
    const s = await processWaitlist({ now: NOW });
    expect(s).toMatchObject({ checked: 1, notified: 0, apologized: 0 });
    expect(h.pushes).toHaveLength(0);
    expect(statusOf('e1')).toBe('waiting');
  });

  it('キャンセルで空いたら、条件が合う空き待ち全員に知らせる（別の時間の人には送らない）', async () => {
    h.events['store-cal'] = [ev(DATE, '14:00', '15:00'), ev(DATE, '16:00', '17:00')];
    await registerWaitlist(input('U1'));
    await registerWaitlist(input('U2'));
    await registerWaitlist(input('U3', '16:00'));
    h.events['store-cal'] = [ev(DATE, '16:00', '17:00')];
    const s = await processWaitlist({ storeId: 'st1', now: NOW });
    expect(s.notified).toBe(2);
    expect(h.pushes.map((p) => p.to).sort()).toEqual(['U1', 'U2']);
    expect(JSON.stringify(h.pushes[0].messages)).toContain('https://liff.line.me/1234567890-abcdefgh?waitlist=e1');
    expect(statusOf('e1')).toBe('notified');
    expect(statusOf('e3')).toBe('waiting');
    expect(h.notifications.filter((n) => n.type === 'slot_opened' && n.result === 'success')).toHaveLength(2);
  });

  it('空いたままなら、見回りを繰り返しても二重に知らせない', async () => {
    await registerWaitlist(input('U1'));
    h.events['store-cal'] = [];
    await processWaitlist({ now: NOW });
    await processWaitlist({ now: NOW });
    expect(h.pushes).toHaveLength(1);
  });

  it('1 人が予約して埋まったら、予約しなかった人におわびを 1 回だけ送り、空き待ちに戻す。再び空けばもう一度知らせる', async () => {
    await registerWaitlist(input('U1'));
    await registerWaitlist(input('U2'));
    h.events['store-cal'] = [];
    await processWaitlist({ now: NOW });
    expect(h.pushes).toHaveLength(2);

    // U1 が予約 → 枠が埋まる
    h.events['store-cal'] = [ev(DATE, '14:00', '15:00')];
    await onReservationCreatedForWaitlist({ storeId: 'st1', lineUserId: 'U1', date: DATE, time: '14:00' });
    await new Promise((r) => setTimeout(r, 20));
    expect(statusOf('e1')).toBe('fulfilled');
    expect(statusOf('e2')).toBe('waiting');
    const apologies = h.pushes.slice(2);
    expect(apologies.map((p) => p.to)).toEqual(['U2']);
    expect(JSON.stringify(apologies[0].messages)).toContain('埋まりました');

    // 満席のまま見回っても、おわびは 1 回だけ
    await processWaitlist({ now: NOW });
    expect(h.pushes).toHaveLength(3);

    // また空いた → U2 にもう一度知らせる（予約した U1 には送らない）
    h.events['store-cal'] = [];
    await processWaitlist({ now: NOW });
    expect(h.pushes).toHaveLength(4);
    expect(h.pushes[3].to).toBe('U2');
    expect(statusOf('e2')).toBe('notified');
  });

  it('受付締切を過ぎた枠は、空いても知らせない。日時を過ぎたら自動で終了する', async () => {
    await registerWaitlist(input('U1'));
    h.events['store-cal'] = [];
    const late = new Date(`${DATE}T13:30:00+09:00`);
    expect((await processWaitlist({ now: late })).notified).toBe(0);
    expect(statusOf('e1')).toBe('waiting');
    const after = new Date(`${DATE}T14:00:00+09:00`);
    expect((await processWaitlist({ now: after })).expired).toBe(1);
    expect(statusOf('e1')).toBe('expired');
    expect(h.pushes).toHaveLength(0);
  });

  it('カレンダーの予定を取得できないときは、何も送らない（誤って「埋まりました」を送らない）', async () => {
    await registerWaitlist(input('U1'));
    h.events['store-cal'] = [];
    await processWaitlist({ now: NOW });
    h.events['store-cal'] = null;
    const s = await processWaitlist({ now: NOW });
    expect(s.apologized).toBe(0);
    expect(h.pushes).toHaveLength(1);
    expect(statusOf('e1')).toBe('notified');
  });

  it('機能を OFF にしたフォームの空き待ちには送らない', async () => {
    await registerWaitlist(input('U1'));
    h.events['store-cal'] = [];
    h.config = config({ waitlist: { enabled: false } });
    expect((await processWaitlist({ now: NOW })).notified).toBe(0);
    expect(h.pushes).toHaveLength(0);
  });

  it('送信に失敗したら空き待ちに戻し、2 回続けて失敗したら終了（inactive）にする', async () => {
    await registerWaitlist(input('U1'));
    h.events['store-cal'] = [];
    h.pushOk = false;
    expect((await processWaitlist({ now: NOW })).failed).toBe(1);
    expect(statusOf('e1')).toBe('waiting');
    await processWaitlist({ now: NOW });
    expect(statusOf('e1')).toBe('inactive');
    expect(h.notifications.filter((n) => n.result === 'failed')).toHaveLength(2);
  });

  it('同時刻に埋まるイベント数が 2 のフォーム: 1 件に減ったら知らせる', async () => {
    h.config = config({ max_concurrent_events: 2 });
    h.events['store-cal'] = [ev(DATE, '14:00', '15:00'), ev(DATE, '14:00', '15:00')];
    await registerWaitlist(input('U1'));
    expect((await processWaitlist({ now: NOW })).notified).toBe(0);
    h.events['store-cal'] = [ev(DATE, '14:00', '15:00')];
    expect((await processWaitlist({ now: NOW })).notified).toBe(1);
  });
});

describe('スタッフ選択のフォーム', () => {
  const staffConfig = (over: Record<string, unknown> = {}) =>
    config({}, {
      staff_selection: {
        enabled: true,
        staff: [
          { id: 's1', name: '佐藤', calendar_id: 'cal-s1' },
          { id: 's2', name: '鈴木', calendar_id: 'cal-s2', hidden_menu_ids: ['m9'] },
          { id: 's3', name: '田中', calendar_id: 'cal-s3', no_preference_assignable: false },
        ],
        ...over,
      },
    });
  const entry = (staffId: string | null, menus: unknown[] = [{ menu_id: 'm1' }]) => ({ reservation_date: DATE, reservation_time: '14:00', duration_minutes: 60, staff_id: staffId, selected_menus: menus, selected_options: [] });
  const busy = [ev(DATE, '14:00', '15:00')];

  it('指名あり: そのスタッフのカレンダーだけを見る', async () => {
    h.events = { 'cal-s1': busy, 'cal-s2': [], 'cal-s3': [] };
    expect(await evaluateWaitlistSlot(store, staffConfig(), entry('s1'), NOW)).toBe('full');
    expect(await evaluateWaitlistSlot(store, staffConfig(), entry('s2'), NOW)).toBe('open');
  });

  it('指名なし: 自動割当の対象で、メニューに対応できるスタッフの誰かが空いていれば空き', async () => {
    h.events = { 'cal-s1': busy, 'cal-s2': busy, 'cal-s3': [] };
    // s3 は「指名なし」の対象外なので、空いていても数えない
    expect(await evaluateWaitlistSlot(store, staffConfig(), entry(null), NOW)).toBe('full');
    h.events['cal-s2'] = [];
    expect(await evaluateWaitlistSlot(store, staffConfig(), entry(null), NOW)).toBe('open');
    // s2 が対応できないメニューなら、s2 が空いていても満席
    expect(await evaluateWaitlistSlot(store, staffConfig(), entry(null, [{ menu_id: 'm9' }]), NOW)).toBe('full');
  });

  it('指名ありで登録すると担当名も保存し、そのスタッフが空いたときだけ知らせる', async () => {
    h.config = staffConfig();
    h.events = { 'cal-s1': busy, 'cal-s2': [], 'cal-s3': [] };
    const r = await registerWaitlist(input('U1', '14:00', { staffId: 's1' }));
    expect(r.ok).toBe(true);
    expect(h.entries[0]).toMatchObject({ staff_id: 's1', staff_name: '佐藤' });
    expect((await processWaitlist({ now: NOW })).notified).toBe(0);
    h.events['cal-s1'] = [];
    expect((await processWaitlist({ now: NOW })).notified).toBe(1);
  });

  it('存在しないスタッフでは登録できない', async () => {
    h.config = staffConfig();
    expect(await registerWaitlist(input('U1', '14:00', { staffId: 'zzz' }))).toMatchObject({ ok: false, status: 400 });
  });
});

describe('一覧・取り消し・お知らせから開いたとき', () => {
  it('自分の空き待ちだけを返し、本人だけが取り消せる', async () => {
    await registerWaitlist(input('U1'));
    await registerWaitlist(input('U2'));
    const mine = await listMyWaitlist('st1', 'U1', NOW);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: 'e1', date: DATE, time: '14:00', menu_text: 'カット', status: 'waiting' });
    expect(JSON.stringify(mine)).not.toContain('line_user_id');

    expect((await cancelMyWaitlist({ entryId: 'e1', storeId: 'st1', lineUserId: 'U2' })).ok).toBe(false);
    expect(statusOf('e1')).toBe('waiting');
    expect((await cancelMyWaitlist({ entryId: 'e1', storeId: 'st1', lineUserId: 'U1' })).ok).toBe(true);
    expect(statusOf('e1')).toBe('cancelled');
    expect(await listMyWaitlist('st1', 'U1', NOW)).toHaveLength(0);
  });

  it('取り消した空き待ちには、空いても知らせない', async () => {
    await registerWaitlist(input('U1'));
    await handleWaitlistPostback(store, 'U1', 'wl:x:e1');
    h.events['store-cal'] = [];
    expect((await processWaitlist({ now: NOW })).notified).toBe(0);
    expect(h.pushes).toHaveLength(0);
  });

  it('LINE の取り消しボタン: 他人の空き待ちは取り消せない', async () => {
    await registerWaitlist(input('U1'));
    const reply = await handleWaitlistPostback(store, 'U2', 'wl:x:e1');
    expect(JSON.stringify(reply)).toContain('見つかりませんでした');
    expect(statusOf('e1')).toBe('waiting');
  });

  it('お知らせから開いたとき: 空いていれば open、埋まっていれば open = false（空き待ちは有効のまま）', async () => {
    await registerWaitlist(input('U1'));
    const filled = await getWaitlistSourceForForm({ entryId: 'e1', storeId: 'st1', lineUserId: 'U1', now: NOW });
    expect(filled).toMatchObject({ ok: true, entry: { open: false, active: true, date: DATE, time: '14:00' } });
    h.events['store-cal'] = [];
    const open = await getWaitlistSourceForForm({ entryId: 'e1', storeId: 'st1', lineUserId: 'U1', now: NOW });
    expect(open).toMatchObject({ ok: true, entry: { open: true, active: true } });
    expect((await getWaitlistSourceForForm({ entryId: 'e1', storeId: 'st1', lineUserId: 'U9', now: NOW })).ok).toBe(false);
  });

  it('別の日時を予約しても、ほかの空き待ちは消さない', async () => {
    await registerWaitlist(input('U1'));
    await onReservationCreatedForWaitlist({ storeId: 'st1', lineUserId: 'U1', date: DATE, time: '10:00' });
    expect(statusOf('e1')).toBe('waiting');
  });
});
