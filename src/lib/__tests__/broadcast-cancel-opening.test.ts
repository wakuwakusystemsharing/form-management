/**
 * 自動配信のきっかけ「予約フォームでキャンセルが出た時」
 * 純粋ロジック（条件の判定・カード・送る相手）と、local（JSON）での実行（配信の作成・見送り・空き待ちの優先）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATION_TEMPLATES, describeAutomationTrigger, evaluateAutomationTrigger, isEventTrigger, normalizeAutomationTrigger } from '@/lib/broadcast-automation';
import {
  CANCEL_OPENING_DEFAULT_TRIGGER,
  buildCancelOpeningFlex,
  checkCancelOpeningRule,
  formatOpeningSlot,
  isCancelOpeningQuietTime,
  normalizeCancelOpeningTrigger,
  pickCancelOpeningTargets,
  renderCancelOpeningText,
} from '@/lib/broadcast-cancel-opening';
import type { AudienceCustomer } from '@/types/broadcast';

const at = (iso: string) => new Date(iso);
// 日本時間 2026-11-20 10:00
const NOW = at('2026-11-20T10:00:00+09:00');
const slotMs = (iso: string) => Date.parse(iso);
const lineId = (n: number) => `U${String(n).padStart(32, '0')}`;

describe('きっかけの設定', () => {
  it('テンプレートに「予約フォームでキャンセルが出た時」がある（既定: 空いた時だけ・3 時間前まで・夜間は送らない・1 日 3 回・お客様のキャンセルだけ）', () => {
    const t = AUTOMATION_TEMPLATES.find((x) => x.id === 'reservation_cancelled');
    expect(t?.label).toBe('予約フォームでキャンセルが出た時');
    expect(t?.trigger).toMatchObject({ type: 'reservation_cancelled', only_if_open: true, min_hours_before: 3, quiet_hours: { enabled: true, start: 22, end: 8 }, max_per_day: 3, include_store_cancel: false });
  });

  it('足りない項目は既定値で補い、範囲に収める。文言が空なら既定の文言', () => {
    expect(normalizeAutomationTrigger({ type: 'reservation_cancelled' })).toEqual(CANCEL_OPENING_DEFAULT_TRIGGER);
    const t = normalizeCancelOpeningTrigger({
      only_if_open: false,
      min_hours_before: 999,
      quiet_hours: { enabled: false, start: 30, end: -1 },
      max_per_day: -3,
      include_store_cancel: true,
      card: { title: '  ', text: 'あ'.repeat(500), button_label: 'ご予約はこちら' },
    });
    expect(t).toMatchObject({ only_if_open: false, min_hours_before: 72, quiet_hours: { enabled: false, start: 23, end: 0 }, max_per_day: 0, include_store_cancel: true });
    expect(t.card.title).toBe('空きが出ました');
    expect(t.card.text).toHaveLength(300);
    expect(t.card.button_label).toBe('ご予約はこちら');
  });

  it('1 日 1 回の判定では扱わない（その場で動くきっかけ）', () => {
    expect(isEventTrigger(CANCEL_OPENING_DEFAULT_TRIGGER)).toBe(true);
    expect(isEventTrigger({ type: 'dormant', days: 90 })).toBe(false);
    expect(evaluateAutomationTrigger(CANCEL_OPENING_DEFAULT_TRIGGER, { id: 'c', line_user_id: 'U1' } as AudienceCustomer, NOW)).toBeNull();
  });

  it('一覧の説明に条件が出る', () => {
    expect(describeAutomationTrigger(CANCEL_OPENING_DEFAULT_TRIGGER)).toBe('お客様が LINE で予約をキャンセルした時（実際に空いた時だけ・予約の 3 時間前まで・22:00〜8:00 は送らない・1 日 3 回まで）');
    expect(describeAutomationTrigger({ ...CANCEL_OPENING_DEFAULT_TRIGGER, only_if_open: false, min_hours_before: 0, max_per_day: 0, include_store_cancel: true, quiet_hours: { enabled: false, start: 22, end: 8 } })).toBe('お客様・店舗のキャンセルで空きが出た時');
  });
});

describe('送ってよいか（カレンダーを見る前の条件）', () => {
  const t = CANCEL_OPENING_DEFAULT_TRIGGER;
  const base = { source: 'customer' as const, slotStartMs: slotMs('2026-11-21T14:00:00+09:00'), now: NOW, sentToday: 0 };

  it('お客様のキャンセルで、先の予約なら送る', () => {
    expect(checkCancelOpeningRule(t, base)).toEqual({ ok: true });
  });

  it('店舗のキャンセルは、ルールで ON にした時だけ送る', () => {
    expect(checkCancelOpeningRule(t, { ...base, source: 'store' })).toEqual({ ok: false, reason: 'source' });
    expect(checkCancelOpeningRule({ ...t, include_store_cancel: true }, { ...base, source: 'store' })).toEqual({ ok: true });
  });

  it('過ぎた予約・直前のキャンセルは送らない', () => {
    expect(checkCancelOpeningRule(t, { ...base, slotStartMs: slotMs('2026-11-20T09:00:00+09:00') })).toEqual({ ok: false, reason: 'past' });
    expect(checkCancelOpeningRule(t, { ...base, slotStartMs: slotMs('2026-11-20T12:59:00+09:00') })).toEqual({ ok: false, reason: 'too_close' });
    expect(checkCancelOpeningRule(t, { ...base, slotStartMs: slotMs('2026-11-20T13:00:00+09:00') })).toEqual({ ok: true });
    expect(checkCancelOpeningRule({ ...t, min_hours_before: 0 }, { ...base, slotStartMs: slotMs('2026-11-20T10:30:00+09:00') })).toEqual({ ok: true });
  });

  it('夜間のキャンセルは送らない（日付をまたぐ時間帯）', () => {
    expect(checkCancelOpeningRule(t, { ...base, now: at('2026-11-20T23:00:00+09:00') })).toEqual({ ok: false, reason: 'quiet' });
    expect(checkCancelOpeningRule(t, { ...base, now: at('2026-11-21T07:59:00+09:00') })).toEqual({ ok: false, reason: 'quiet' });
    expect(checkCancelOpeningRule(t, { ...base, now: at('2026-11-21T08:00:00+09:00') })).toEqual({ ok: true });
    expect(isCancelOpeningQuietTime({ enabled: true, start: 9, end: 9 }, at('2026-11-21T09:00:00+09:00'))).toBe(false);
    expect(isCancelOpeningQuietTime({ enabled: false, start: 22, end: 8 }, at('2026-11-20T23:00:00+09:00'))).toBe(false);
  });

  it('1 日の回数の上限に達したら送らない（0 = 上限なし）', () => {
    expect(checkCancelOpeningRule(t, { ...base, sentToday: 2 })).toEqual({ ok: true });
    expect(checkCancelOpeningRule(t, { ...base, sentToday: 3 })).toEqual({ ok: false, reason: 'daily_limit' });
    expect(checkCancelOpeningRule({ ...t, max_per_day: 0 }, { ...base, sentToday: 99 })).toEqual({ ok: true });
  });
});

describe('「空きが出ました」カード', () => {
  it('日時・案内文・先着順の注意・予約ボタンが入る', () => {
    const card = buildCancelOpeningFlex(CANCEL_OPENING_DEFAULT_TRIGGER.card, { storeName: 'テスト店', date: '2026-11-25', time: '14:00', bookingUrl: 'https://liff.line.me/1234567890-abcdefgh' });
    const s = JSON.stringify(card.contents);
    expect(card.alt_text).toBe('【空きが出ました】11/25（水）14:00');
    expect(s).toContain('テスト店');
    expect(s).toContain('11/25（水）14:00');
    expect(s).toContain('ご都合の合う方は、ぜひご予約ください');
    expect(s).toContain('先着順');
    expect(s).toContain('https://liff.line.me/1234567890-abcdefgh');
    expect(s).toContain('"label":"予約する"');
  });

  it('文言を変えられる（{日時} {店名} を差し込める）。予約フォームの URL が無ければボタンを付けない', () => {
    const card = buildCancelOpeningFlex({ title: '{店名}からのお知らせ', text: '{日時} が空きました！', button_label: '今すぐ予約' }, { storeName: 'テスト店', date: '2026-11-25', time: '09:30', bookingUrl: null });
    const s = JSON.stringify(card.contents);
    expect(s).toContain('テスト店からのお知らせ');
    expect(s).toContain('11/25（水）09:30 が空きました！');
    expect(s).not.toContain('"uri"');
    expect(card.contents.footer).toBeUndefined();
  });

  it('日時の表示と差し込み', () => {
    expect(formatOpeningSlot('2026-12-01', '09:00:00')).toBe('12/1（火）09:00');
    expect(renderCancelOpeningText('{店名} {日時} {その他}', { 日時: 'A', 店名: 'B' })).toBe('B A {その他}');
  });
});

describe('送る相手', () => {
  const customers = [
    { id: 'c1', line_user_id: lineId(1), tags: ['VIP'] },
    { id: 'c2', line_user_id: lineId(2), tags: [] },
    { id: 'c3', line_user_id: lineId(3), tags: [], line_opt_out_at: '2026-11-01T00:00:00Z' },
    { id: 'c4', line_user_id: lineId(4), tags: [], line_blocked_at: '2026-11-01T00:00:00Z' },
    { id: 'c5', line_user_id: null, tags: [] },
    { id: 'c6', line_user_id: lineId(1), tags: [] },
  ] as unknown as AudienceCustomer[];
  const base = { customers, facts: new Map(), audience: {}, marker: 'cancel:r1', resend_after_days: null, sends: [], now: NOW };

  it('キャンセルした本人・配信停止・ブロック・LINE 未連携を除く。同じ LINE ユーザーは 1 人', () => {
    expect(pickCancelOpeningTargets({ ...base, excludeLineUserId: lineId(2) }).map((c) => c.id)).toEqual(['c1']);
    expect(pickCancelOpeningTargets({ ...base, excludeLineUserId: null }).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(pickCancelOpeningTargets({ ...base, excludeLineUserId: lineId(1) }).map((c) => c.id)).toEqual(['c2']);
  });

  it('追加の絞り込み（タグ）に合う人だけ', () => {
    expect(pickCancelOpeningTargets({ ...base, excludeLineUserId: null, audience: { tags: { mode: 'any', values: ['VIP'] } } }).map((c) => c.id)).toEqual(['c1']);
  });

  it('同じキャンセルで 2 回は送らない。再送間隔を入れると、その日数は別のキャンセルでも送らない', () => {
    const sends = [{ customer_id: 'c1', marker: 'cancel:r1', sent_at: '2026-11-19T10:00:00+09:00' }];
    expect(pickCancelOpeningTargets({ ...base, excludeLineUserId: null, sends }).map((c) => c.id)).toEqual(['c2']);
    expect(pickCancelOpeningTargets({ ...base, excludeLineUserId: null, sends, marker: 'cancel:r2' }).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(pickCancelOpeningTargets({ ...base, excludeLineUserId: null, sends, marker: 'cancel:r2', resend_after_days: 7 }).map((c) => c.id)).toEqual(['c2']);
  });
});

// ---------------------------------------------------------------------------
// local（JSON）での実行
// ---------------------------------------------------------------------------

describe('キャンセル時の実行（local）', () => {
  let tmpDir = '';
  let originalCwd = '';
  let svc: typeof import('@/lib/broadcast-automation-service');
  let repo: typeof import('@/lib/broadcast-repository');
  let waitlist: typeof import('@/lib/waitlist-service');
  const origin = 'https://app.example.com';
  const hours = { open: '09:00', close: '18:00', closed: false };
  const business_hours = { monday: hours, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: hours };
  const dataFile = (name: string) => path.join(tmpDir, 'data', name);
  const reservation = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    store_id: 'st0001',
    form_id: 'f_cal',
    line_user_id: lineId(1),
    reservation_date: '2026-11-25',
    reservation_time: '14:00',
    selected_menus: [{ menu_id: 'm1', menu_name: 'カット', duration: 60 }],
    ...over,
  });
  const run = (over: Record<string, unknown> = {}, opts: { source?: 'customer' | 'store'; now?: Date; storeId?: string } = {}) =>
    svc.runCancelOpeningAutomations({ storeId: opts.storeId || 'st0001', reservation: reservation(over) as never, source: opts.source || 'customer', origin, now: opts.now || NOW });
  let ruleId = '';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-opening-'));
    process.chdir(tmpDir);
    process.env.NEXT_PUBLIC_APP_ENV = 'local';
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    fs.writeFileSync(dataFile('stores.json'), JSON.stringify([
      { id: 'st0001', name: 'A店', line_channel_access_token: 'token-a' },
      { id: 'st0002', name: 'ルールなし', line_channel_access_token: 'token-b' },
    ]));
    fs.writeFileSync(dataFile('customers.json'), JSON.stringify([
      { id: 'c1', store_id: 'st0001', name: 'キャンセルした人', line_user_id: lineId(1), line_friend_flag: true, tags: [] },
      { id: 'c2', store_id: 'st0001', name: '佐藤', line_user_id: lineId(2), line_friend_flag: true, tags: ['VIP'] },
      { id: 'c3', store_id: 'st0001', name: '鈴木', line_user_id: lineId(3), line_friend_flag: true, tags: [] },
      { id: 'c4', store_id: 'st0001', name: '配信停止', line_user_id: lineId(4), line_friend_flag: true, line_opt_out_at: '2026-11-01T00:00:00Z', tags: [] },
      { id: 'd1', store_id: 'st0002', name: '他店', line_user_id: lineId(9), line_friend_flag: true },
    ]));
    fs.writeFileSync(dataFile('forms_st0001.json'), JSON.stringify([
      { id: 'f_cal', store_id: 'st0001', form_type: 'line', config: { basic_info: { form_name: '予約', liff_id: '1234567890-abcdefgh' }, calendar_settings: { booking_mode: 'calendar', business_hours } } },
      { id: 'f_wl', store_id: 'st0001', form_type: 'line', config: { basic_info: { form_name: '空き待ちあり', liff_id: '1234567890-abcdefgh' }, calendar_settings: { booking_mode: 'calendar', business_hours, waitlist: { enabled: true } } } },
      { id: 'f_md', store_id: 'st0001', form_type: 'line', config: { basic_info: { form_name: '第三希望', liff_id: '1234567890-abcdefgh' }, calendar_settings: { booking_mode: 'multiple_dates', business_hours } } },
    ]));
    svc = await import('@/lib/broadcast-automation-service');
    repo = await import('@/lib/broadcast-repository');
    waitlist = await import('@/lib/waitlist-service');
  }, 120000);

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ルールが無い（または OFF の）店舗では何もしない', async () => {
    expect(await run()).toEqual({ created: 0, recipients: 0, skipped: [] });
    const off = await svc.saveAutomation('st0001', null, { name: 'キャンセルが出た時', enabled: false, trigger: CANCEL_OPENING_DEFAULT_TRIGGER }, origin);
    expect(off.ok).toBe(true);
    expect(await run()).toEqual({ created: 0, recipients: 0, skipped: [] });
    expect(await repo.listBroadcasts('st0001')).toEqual([]);
    if (off.ok) ruleId = off.value.id;
  });

  it('追加メッセージが無くても ON にできる（カードが自動で付く）。追加は 4 通まで', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, type: 'text' as const, text: `t${i}` }));
    expect(await svc.saveAutomation('st0001', ruleId, { name: 'キャンセルが出た時', enabled: true, trigger: CANCEL_OPENING_DEFAULT_TRIGGER, items: five }, origin)).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('4 通まで') });
    const on = await svc.saveAutomation('st0001', ruleId, { name: 'キャンセルが出た時', enabled: true, trigger: CANCEL_OPENING_DEFAULT_TRIGGER }, origin);
    expect(on).toMatchObject({ ok: true, value: { enabled: true, items: [], trigger: { type: 'reservation_cancelled' } } });
  });

  it('見積り: キャンセル 1 回につき送られる人数（配信停止は除く）', async () => {
    const p = await svc.previewAutomation('st0001', ruleId, { trigger: CANCEL_OPENING_DEFAULT_TRIGGER }, NOW);
    expect(p).toMatchObject({ ok: true, value: { count: 3 } });
    const narrowed = await svc.previewAutomation('st0001', ruleId, { trigger: CANCEL_OPENING_DEFAULT_TRIGGER, audience: { tags: { mode: 'any', values: ['VIP'] } } }, NOW);
    expect(narrowed).toMatchObject({ ok: true, value: { count: 1 } });
  });

  it('1 日 1 回の判定（cron）では動かない', async () => {
    const s = await svc.runDueAutomations(NOW, origin, Date.now() + 60000, { storeId: 'st0001', ignoreTime: true });
    expect(s).toMatchObject({ checked: 0, created: 0 });
    expect(await repo.listBroadcasts('st0001')).toEqual([]);
  });

  it('送らない: 店舗のキャンセル / 直前 / 夜間 / 宿泊・時刻なし / 第三希望日時のフォーム', async () => {
    expect((await run({}, { source: 'store' })).skipped[0].reason).toContain('店舗によるキャンセル');
    expect((await run({ reservation_date: '2026-11-20', reservation_time: '12:00' })).skipped[0].reason).toContain('直前');
    expect((await run({}, { now: at('2026-11-20T23:00:00+09:00') })).skipped[0].reason).toContain('夜間');
    expect(await run({ checkout_date: '2026-11-27' })).toEqual({ created: 0, recipients: 0, skipped: [] });
    expect(await run({ reservation_time: null })).toEqual({ created: 0, recipients: 0, skipped: [] });
    expect((await run({ form_id: 'f_md' })).skipped[0].reason).toContain('カレンダー表示モード');
    expect(await repo.listBroadcasts('st0001')).toEqual([]);
  });

  it('お客様のキャンセル: 本人以外へ「空きが出ました」の配信を作って送信を始める', async () => {
    const s = await run();
    expect(s).toMatchObject({ created: 1, recipients: 2, skipped: [] });
    const [b] = await repo.listBroadcasts('st0001');
    expect(b).toMatchObject({ status: 'scheduled', automation_id: ruleId, recipient_count: 2 });
    expect(b.name).toBe('【自動】キャンセルが出た時（11/25（水）14:00）');
    const payload = JSON.stringify(b.payloads);
    expect(b.payloads).toHaveLength(1);
    expect(payload).toContain('空きが出ました');
    expect(payload).toContain('11/25（水）14:00');
    expect(payload).toContain('A店');
    // ボタンは計測リンク（タップ数を数える）。本来のリンク先は予約フォーム
    expect(Object.values(b.links)).toContain('https://liff.line.me/1234567890-abcdefgh');
    const { recipients } = await repo.listBroadcastRecipients(b.id);
    expect(recipients.map((r) => r.display_name).sort()).toEqual(['佐藤', '鈴木']);
  });

  it('同じキャンセルを 2 回処理しても、同じ人には 2 回送らない', async () => {
    const s = await run();
    expect(s.created).toBe(0);
    expect(s.skipped[0].reason).toContain('送る相手がいない');
  });

  it('1 日の回数の上限（3 回）に達したら送らない。翌日はまた送る', async () => {
    expect((await run({ id: 'r2', reservation_time: '15:00' })).created).toBe(1);
    expect((await run({ id: 'r3', reservation_time: '16:00' })).created).toBe(1);
    const fourth = await run({ id: 'r4', reservation_time: '17:00' });
    expect(fourth.created).toBe(0);
    expect(fourth.skipped[0].reason).toContain('1 日の回数の上限');
    expect((await repo.listBroadcasts('st0001')).length).toBe(3);
  });

  it('空き待ちの人がいる枠は、空き待ちの人を優先して一斉配信しない', async () => {
    // 上限に掛からないよう、上限なし・絞り込みなしのルールに変える
    await svc.saveAutomation('st0001', ruleId, { name: 'キャンセルが出た時', enabled: true, trigger: { ...CANCEL_OPENING_DEFAULT_TRIGGER, max_per_day: 0 } }, origin);
    const reg = await waitlist.registerWaitlist({ storeId: 'st0001', formId: 'f_wl', lineUserId: lineId(3), date: '2026-11-26', time: '10:00', selectedMenus: [{ menu_id: 'm1', menu_name: 'カット', duration: 60 }], now: NOW });
    expect(reg.ok).toBe(true);
    const s = await run({ id: 'r5', form_id: 'f_wl', reservation_date: '2026-11-26', reservation_time: '10:00' });
    expect(s.created).toBe(0);
    expect(s.skipped[0].reason).toContain('空き待ちの人がいる枠');
    // 空き待ちの人がいない時間は送る
    expect((await run({ id: 'r6', form_id: 'f_wl', reservation_date: '2026-11-26', reservation_time: '11:00' })).created).toBe(1);
  });

  it('店舗のキャンセルも送る設定・追加メッセージつき・カードの文言変更', async () => {
    await svc.saveAutomation(
      'st0001',
      ruleId,
      {
        name: 'キャンセルが出た時',
        enabled: true,
        trigger: { ...CANCEL_OPENING_DEFAULT_TRIGGER, max_per_day: 0, include_store_cancel: true, card: { title: 'キャンセルが出ました', text: '{日時} にお席が空きました。', button_label: '今すぐ予約' } },
        items: [{ key: 'a', type: 'text', text: 'お待ちしております！' }],
      },
      origin
    );
    const s = await run({ id: 'r7', line_user_id: null, reservation_date: '2026-11-27', reservation_time: '09:30' }, { source: 'store' });
    expect(s).toMatchObject({ created: 1, recipients: 3 });
    const b = (await repo.listBroadcasts('st0001')).find((x) => x.name.includes('11/27'))!;
    expect(b.payloads).toHaveLength(2);
    const payload = JSON.stringify(b.payloads);
    expect(payload).toContain('キャンセルが出ました');
    expect(payload).toContain('11/27（金）09:30 にお席が空きました。');
    expect(payload).toContain('今すぐ予約');
    expect(payload).toContain('お待ちしております！');
  });

  it('月間上限を超えるときは送らず、理由を配信一覧に残す', async () => {
    await repo.updateBroadcastSettings('st0001', { ...(await repo.getBroadcastSettings('st0001')), monthly_limit: 1, over_limit: 'block' });
    const s = await run({ id: 'r8', reservation_date: '2026-11-28', reservation_time: '10:00' });
    expect(s.created).toBe(0);
    expect(s.skipped[0].reason).toBe('月間上限');
    const b = (await repo.listBroadcasts('st0001')).find((x) => x.name.includes('11/28'))!;
    expect(b).toMatchObject({ status: 'cancelled' });
    expect(b.error).toContain('配信上限');
  });

  it('ルールの無い店舗のキャンセルでは何も作らない', async () => {
    expect(await run({ store_id: 'st0002' }, { storeId: 'st0002' })).toEqual({ created: 0, recipients: 0, skipped: [] });
    expect(await repo.listBroadcasts('st0002')).toEqual([]);
  });
});
