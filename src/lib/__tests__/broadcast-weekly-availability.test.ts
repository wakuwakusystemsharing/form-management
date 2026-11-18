/**
 * 自動配信のきっかけ「特定の曜日に 1 週間の空き状況」
 * 純粋ロジック（設定・日付・〇△✕ の集計・カード）と、local（JSON）での実行（曜日・空きの数・対象者・二重送信防止）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATION_TEMPLATES, describeAutomationTrigger, isEventTrigger, normalizeAutomationTrigger } from '@/lib/broadcast-automation';
import {
  WEEKLY_DEFAULT_TRIGGER,
  buildWeeklyAvailabilityFlex,
  hasEnoughOpenSlots,
  isWeeklyAvailabilityDay,
  normalizeWeeklyAvailabilityTrigger,
  sampleAvailabilitySummary,
  summarizeAvailability,
  weeklyAvailabilityDates,
  weeklyAvailabilityMarker,
} from '@/lib/broadcast-weekly-availability';

const at = (iso: string) => new Date(iso);
// 日本時間 2026-11-20（金）10:00
const NOW = at('2026-11-20T10:00:00+09:00');
const lineId = (n: number) => `U${String(n).padStart(32, '0')}`;
const slots = (spec: Record<string, boolean>) => Object.entries(spec).map(([time, ok]) => ({ time, ok }));

describe('きっかけの設定', () => {
  it('テンプレートに「特定の曜日に1週間の空き状況」がある（既定: 月曜・翌日から 7 日間・予約済みの人には送らない）', () => {
    const t = AUTOMATION_TEMPLATES.find((x) => x.id === 'weekly_availability');
    expect(t?.label).toBe('特定の曜日に1週間の空き状況');
    expect(t?.trigger).toMatchObject({ type: 'weekly_availability', weekdays: [1], days: 7, include_today: false, min_open_slots: 1, staff_id: null });
    expect(t?.audience).toEqual({ upcoming_reservation: false });
  });

  it('曜日が無ければ保存できない。値は範囲に収め、文言が空なら既定', () => {
    expect(normalizeAutomationTrigger({ type: 'weekly_availability', weekdays: [] })).toBeNull();
    expect(normalizeAutomationTrigger({ type: 'weekly_availability', weekdays: [9, -1] })).toBeNull();
    const t = normalizeWeeklyAvailabilityTrigger({ weekdays: [5, 1, 5, '3'], form_id: ' f1 ', days: 8, include_today: true, duration_minutes: 9999, min_open_slots: 0, staff_id: ' s1 ', few_threshold: 99, card: { title: '', text: 'あ'.repeat(400), button_label: '予約はこちら' } });
    expect(t).toMatchObject({ weekdays: [1, 3, 5], form_id: 'f1', days: 7, include_today: true, duration_minutes: 600, min_open_slots: 1, staff_id: 's1', few_threshold: 20 });
    expect(t?.card.title).toBe('今週の空き状況');
    expect(t?.card.text).toHaveLength(300);
    expect(normalizeWeeklyAvailabilityTrigger({ weekdays: [1], days: 14 })?.days).toBe(14);
  });

  it('1 日 1 回の判定で扱う（その場で動くきっかけではない）。一覧の説明', () => {
    expect(isEventTrigger(WEEKLY_DEFAULT_TRIGGER)).toBe(false);
    expect(describeAutomationTrigger(WEEKLY_DEFAULT_TRIGGER)).toBe('毎週 月曜に空き状況を送る（翌日から 7 日間）');
    expect(describeAutomationTrigger({ ...WEEKLY_DEFAULT_TRIGGER, weekdays: [1, 4], include_today: true, days: 14, duration_minutes: 60, min_open_slots: 5, staff_id: 's1' })).toBe('毎週 月・木曜に空き状況を送る（当日から 14 日間・60 分の空き・空き 5 枠以上の時だけ・スタッフ指定）');
    expect(describeAutomationTrigger({ ...WEEKLY_DEFAULT_TRIGGER, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toContain('毎日');
  });
});

describe('曜日と日付（日本時間）', () => {
  it('送る曜日かどうか（日本時間の曜日で見る）', () => {
    expect(isWeeklyAvailabilityDay({ weekdays: [5] }, NOW)).toBe(true);
    expect(isWeeklyAvailabilityDay({ weekdays: [1] }, NOW)).toBe(false);
    // UTC ではまだ木曜でも、日本時間では金曜
    expect(isWeeklyAvailabilityDay({ weekdays: [5] }, at('2026-11-19T15:30:00Z'))).toBe(true);
  });

  it('載せる日付: 翌日から / 当日から', () => {
    expect(weeklyAvailabilityDates({ days: 3, include_today: false }, NOW)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23']);
    expect(weeklyAvailabilityDates({ days: 3, include_today: true }, NOW)).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(weeklyAvailabilityDates({ days: 7, include_today: false }, at('2026-11-28T10:00:00+09:00')).slice(-2)).toEqual(['2026-12-04', '2026-12-05']);
    expect(weeklyAvailabilityMarker(NOW)).toBe('week:2026-11-20');
  });
});

describe('〇△✕ の集計', () => {
  const input = [
    { date: '2026-11-21', slots: slots({ '09:00': true, '09:30': true, '10:00': true, '13:00': true, '14:00': false, '17:00': false, '17:30': false }) },
    { date: '2026-11-22', slots: [] },
    { date: '2026-11-23', slots: slots({ '09:00': false, '13:00': false }) },
  ];

  it('時間帯ごとに 〇（空きあり）△（残りわずか）✕（満席）、受付の無い時間帯は none、受付の無い日は休み', () => {
    const s = summarizeAvailability(input, 2);
    expect(s.totalOpen).toBe(4);
    expect(s.bands).toEqual(['morning', 'afternoon', 'evening']);
    expect(s.days[0]).toMatchObject({ closed: false, open: 4 });
    expect(s.days[0].bands.morning).toEqual({ mark: 'ok', open: 3, total: 3 });
    expect(s.days[0].bands.afternoon).toEqual({ mark: 'few', open: 1, total: 2 });
    expect(s.days[0].bands.evening).toEqual({ mark: 'ng', open: 0, total: 2 });
    expect(s.days[1].closed).toBe(true);
    expect(s.days[2].bands.morning.mark).toBe('ng');
    expect(s.days[2].bands.evening.mark).toBe('none');
  });

  it('△ の枠数を 0 にすると △ は出ない。期間中に受付の無い時間帯は表に出さない', () => {
    const s = summarizeAvailability(input, 0);
    expect(s.days[0].bands.afternoon.mark).toBe('ok');
    const noEvening = summarizeAvailability([{ date: '2026-11-21', slots: slots({ '09:00': true, '13:00': true }) }], 2);
    expect(noEvening.bands).toEqual(['morning', 'afternoon']);
  });

  it('空きの合計が設定した枠数以上の時だけ送る', () => {
    const s = summarizeAvailability(input, 2);
    expect(hasEnoughOpenSlots({ min_open_slots: 4 }, s)).toBe(true);
    expect(hasEnoughOpenSlots({ min_open_slots: 5 }, s)).toBe(false);
    expect(hasEnoughOpenSlots({ min_open_slots: 1 }, summarizeAvailability([input[2]], 2))).toBe(false);
  });
});

describe('空き状況のカード', () => {
  const summary = summarizeAvailability(
    [
      { date: '2026-11-21', slots: slots({ '09:00': true, '09:30': true, '10:00': true, '13:00': true, '17:00': false }) },
      { date: '2026-11-22', slots: [] },
    ],
    2
  );

  it('日付（曜日つき）・時間帯の見出し・〇△✕・休み・凡例・注意書き・予約ボタンが入る', () => {
    const card = buildWeeklyAvailabilityFlex(WEEKLY_DEFAULT_TRIGGER.card, summary, { storeName: 'テスト店', bookingUrl: 'https://liff.line.me/1234567890-abcdefgh' });
    const s = JSON.stringify(card.contents);
    expect(card.alt_text).toBe('【今週の空き状況】11/21〜11/22');
    for (const word of ['テスト店', '今週の空き状況', '11/21(土)', '11/22(日)', '午前', '午後', '夕方', '〇', '△', '✕', '休み', '空きあり', '残りわずか', '満席', '配信時点の空き状況です', '先着順', 'https://liff.line.me/1234567890-abcdefgh', '"label":"予約する"']) {
      expect(s).toContain(word);
    }
  });

  it('文言を変えられる（{店名} {期間}）。スタッフを選ぶと担当名が入る。URL が無ければボタンを付けない', () => {
    const card = buildWeeklyAvailabilityFlex({ title: '{店名}の空き', text: '{期間} の空きです。', button_label: '今すぐ予約' }, summary, { storeName: 'テスト店', bookingUrl: null, staffName: '佐藤' });
    const s = JSON.stringify(card.contents);
    expect(s).toContain('テスト店の空き');
    expect(s).toContain('11/21〜11/22 の空きです。');
    expect(s).toContain('担当: 佐藤');
    expect(card.contents.footer).toBeUndefined();
  });

  it('14 日間でも LINE の上限（30KB）に収まる', () => {
    const big = sampleAvailabilitySummary(weeklyAvailabilityDates({ days: 14, include_today: false }, NOW));
    const card = buildWeeklyAvailabilityFlex(WEEKLY_DEFAULT_TRIGGER.card, big, { storeName: 'テスト店', bookingUrl: 'https://liff.line.me/1234567890-abcdefgh' });
    expect(Buffer.byteLength(JSON.stringify(card.contents), 'utf8')).toBeLessThan(30 * 1024);
    expect(big.days).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// local（JSON）での実行
// ---------------------------------------------------------------------------

describe('選んだ曜日の実行（local）', () => {
  let tmpDir = '';
  let originalCwd = '';
  let svc: typeof import('@/lib/broadcast-automation-service');
  let repo: typeof import('@/lib/broadcast-repository');
  const origin = 'https://app.example.com';
  const hours = { open: '09:00', close: '18:00', closed: false };
  const closed = { open: '09:00', close: '18:00', closed: true };
  const business_hours = { monday: hours, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: closed };
  const dataFile = (name: string) => path.join(tmpDir, 'data', name);
  const trigger = (over: Record<string, unknown> = {}) => ({ ...WEEKLY_DEFAULT_TRIGGER, weekdays: [5], form_id: 'f_cal', ...over });
  const far = () => Date.now() + 60000;
  let ruleId = '';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-availability-'));
    process.chdir(tmpDir);
    process.env.NEXT_PUBLIC_APP_ENV = 'local';
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: 'st0001', name: 'A店', line_channel_access_token: 'token-a' }]));
    fs.writeFileSync(dataFile('customers.json'), JSON.stringify([
      { id: 'c1', store_id: 'st0001', name: '予約あり', line_user_id: lineId(1), line_friend_flag: true, tags: [] },
      { id: 'c2', store_id: 'st0001', name: '佐藤', line_user_id: lineId(2), line_friend_flag: true, tags: ['VIP'] },
      { id: 'c3', store_id: 'st0001', name: '鈴木', line_user_id: lineId(3), line_friend_flag: true, tags: [] },
      { id: 'c4', store_id: 'st0001', name: '配信停止', line_user_id: lineId(4), line_friend_flag: true, line_opt_out_at: '2026-11-01T00:00:00Z', tags: [] },
    ]));
    fs.writeFileSync(dataFile('reservations.json'), JSON.stringify([
      { id: 'r1', store_id: 'st0001', form_id: 'f_cal', customer_id: 'c1', line_user_id: lineId(1), reservation_date: '2026-11-24', reservation_time: '10:00', status: 'confirmed' },
    ]));
    fs.writeFileSync(dataFile('forms_st0001.json'), JSON.stringify([
      { id: 'f_cal', store_id: 'st0001', form_type: 'line', config: { basic_info: { form_name: '予約', liff_id: '1234567890-abcdefgh' }, calendar_settings: { booking_mode: 'calendar', business_hours, advance_booking_days: 30, time_interval: 30 } } },
      { id: 'f_md', store_id: 'st0001', form_type: 'line', config: { basic_info: { form_name: '第三希望', liff_id: '1234567890-abcdefgh' }, calendar_settings: { booking_mode: 'multiple_dates', business_hours } } },
      { id: 'f_staff', store_id: 'st0001', form_type: 'line', config: { basic_info: { form_name: 'スタッフ', liff_id: '1234567890-abcdefgh' }, calendar_settings: { booking_mode: 'calendar', business_hours, advance_booking_days: 30 }, staff_selection: { enabled: true, staff: [{ id: 's1', name: '佐藤', calendar_id: 'cal-1' }, { id: 's2', name: '田中', calendar_id: 'cal-2', schedule: { business_hours: { ...business_hours, saturday: closed } } }] } } },
    ]));
    svc = await import('@/lib/broadcast-automation-service');
    repo = await import('@/lib/broadcast-repository');
  }, 120000);

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('空き状況の集計: 翌日から 7 日間。定休日は休み、営業日は時間帯ごとの空き', async () => {
    const r = await svc.computeWeeklyAvailability('st0001', trigger() as never, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.days.map((d) => d.date)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    expect(r.summary.days[1].closed).toBe(true); // 日曜は定休
    // 9:00〜18:00 の 30 分間隔 = 午前 6 枠 / 午後 10 枠 / 夕方 2 枠
    expect(r.summary.days[0].bands.morning).toMatchObject({ mark: 'ok', open: 6 });
    expect(r.summary.days[0].bands.afternoon).toMatchObject({ mark: 'ok', open: 10 });
    expect(r.summary.days[0].bands.evening).toMatchObject({ mark: 'few', open: 2 });
    expect(r.summary.totalOpen).toBe(18 * 6);
    expect(r.bookingUrl).toBe('https://liff.line.me/1234567890-abcdefgh');
  });

  it('基準の所要時間を長くすると、営業時間の終わりに収まらない枠は空きに数えない', async () => {
    const r = await svc.computeWeeklyAvailability('st0001', trigger({ duration_minutes: 120 }) as never, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 18:00 までに 120 分が収まるのは 16:00 開始まで → 夕方（17 時〜）は満席扱い
    expect(r.summary.days[0].bands.evening.mark).toBe('ng');
    expect(r.summary.days[0].bands.afternoon.open).toBe(9);
  });

  it('フォーム未選択・カレンダー表示モード以外・存在しないスタッフは集計できない（理由を返す）', async () => {
    expect(await svc.computeWeeklyAvailability('st0001', trigger({ form_id: '' }) as never, NOW)).toMatchObject({ ok: false, error: expect.stringContaining('予約フォームを選んで') });
    expect(await svc.computeWeeklyAvailability('st0001', trigger({ form_id: 'f_md' }) as never, NOW)).toMatchObject({ ok: false, error: expect.stringContaining('Googleカレンダー連携') });
    expect(await svc.computeWeeklyAvailability('st0001', trigger({ form_id: 'nope' }) as never, NOW)).toMatchObject({ ok: false, error: expect.stringContaining('見つかりません') });
    expect(await svc.computeWeeklyAvailability('st0001', trigger({ form_id: 'f_staff', staff_id: 'zzz' }) as never, NOW)).toMatchObject({ ok: false, staff: [{ id: 's1', name: '佐藤' }, { id: 's2', name: '田中' }] });
  });

  it('スタッフ選択のフォーム: スタッフを選ぶとそのスタッフの設定で、選ばなければ誰か 1 人でも受け付けていれば空き', async () => {
    const tanaka = await svc.computeWeeklyAvailability('st0001', trigger({ form_id: 'f_staff', staff_id: 's2' }) as never, NOW);
    expect(tanaka).toMatchObject({ ok: true, staffName: '田中' });
    if (tanaka.ok) expect(tanaka.summary.days[0].closed).toBe(true); // 田中は土曜休み
    const any = await svc.computeWeeklyAvailability('st0001', trigger({ form_id: 'f_staff' }) as never, NOW);
    expect(any).toMatchObject({ ok: true, staffName: null });
    if (any.ok) expect(any.summary.days[0].closed).toBe(false); // 佐藤が土曜も受けている
  });

  it('ON にするには予約フォームが必要。追加メッセージが無くても保存できる', async () => {
    expect(await svc.saveAutomation('st0001', null, { name: '空き状況', enabled: true, trigger: trigger({ form_id: '' }) as never }, origin)).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('予約フォームを選んで') });
    expect(await svc.saveAutomation('st0001', null, { name: '空き状況', enabled: true, trigger: { type: 'weekly_availability', weekdays: [] } as never }, origin)).toMatchObject({ ok: false, status: 400 });
    const saved = await svc.saveAutomation('st0001', null, { name: '空き状況', enabled: true, trigger: trigger() as never, audience: { upcoming_reservation: false } }, origin);
    expect(saved).toMatchObject({ ok: true, value: { enabled: true, items: [], trigger: { type: 'weekly_availability', weekdays: [5], form_id: 'f_cal' } } });
    if (saved.ok) ruleId = saved.value.id;
  });

  it('見積り: 送られる人数（予約済み・配信停止は除く）と、いまの空き状況', async () => {
    const p = await svc.previewAutomation('st0001', ruleId, { trigger: trigger() as never, audience: { upcoming_reservation: false } }, NOW);
    expect(p).toMatchObject({ ok: true, value: { count: 2, sample: ['佐藤', '鈴木'], availability_error: null } });
    if (p.ok) expect(p.value.availability?.totalOpen).toBe(108);
    const noForm = await svc.previewAutomation('st0001', ruleId, { trigger: trigger({ form_id: '' }) as never }, NOW);
    expect(noForm).toMatchObject({ ok: true, value: { count: 3, availability: null, availability_error: expect.stringContaining('予約フォームを選んで') } });
  });

  it('選んだ曜日でない日は動かない（その日の判定も使わない）', async () => {
    const thursday = at('2026-11-19T10:00:00+09:00');
    const s = await svc.runDueAutomations(thursday, origin, far(), { storeId: 'st0001', ignoreTime: true });
    expect(s).toMatchObject({ checked: 0, created: 0 });
    expect(await repo.listBroadcasts('st0001')).toEqual([]);
  });

  it('選んだ曜日: 空き状況のカードを作って、予約済み・配信停止以外へ送信を始める', async () => {
    const s = await svc.runDueAutomations(NOW, origin, far(), { storeId: 'st0001', ignoreTime: true });
    expect(s).toMatchObject({ checked: 1, created: 1, recipients: 2, skipped: [] });
    const [b] = await repo.listBroadcasts('st0001');
    expect(b).toMatchObject({ status: 'scheduled', automation_id: ruleId, recipient_count: 2, name: '【自動】空き状況' });
    expect(b.payloads).toHaveLength(1);
    const payload = JSON.stringify(b.payloads);
    for (const word of ['今週の空き状況', '11/21(土)', '11/27(金)', '午前', '休み', 'A店']) expect(payload).toContain(word);
    expect(Object.values(b.links)).toContain('https://liff.line.me/1234567890-abcdefgh');
    const { recipients } = await repo.listBroadcastRecipients(b.id);
    expect(recipients.map((r) => r.display_name).sort()).toEqual(['佐藤', '鈴木']);
  });

  it('同じ日にもう一度判定しても送らない（1 日 1 回）', async () => {
    const s = await svc.runDueAutomations(NOW, origin, far(), { storeId: 'st0001', ignoreTime: true });
    expect(s).toMatchObject({ checked: 0, created: 0 });
    expect((await repo.listBroadcasts('st0001')).length).toBe(1);
  });

  it('翌週の同じ曜日にはまた全員へ送る。追加メッセージ・文言の変更も反映される', async () => {
    await svc.saveAutomation('st0001', ruleId, { name: '空き状況', enabled: true, trigger: trigger({ card: { title: '来週の空き', text: '{期間} の空き状況です。', button_label: '空きを見る' } }) as never, audience: { upcoming_reservation: false }, items: [{ key: 'a', type: 'text', text: 'お待ちしております！' }] }, origin);
    const nextFriday = at('2026-11-27T10:00:00+09:00');
    const s = await svc.runDueAutomations(nextFriday, origin, far(), { storeId: 'st0001', ignoreTime: true });
    // 11/24 の予約は過ぎたので、予約ありだった人にも送る
    expect(s).toMatchObject({ created: 1, recipients: 3 });
    const b = (await repo.listBroadcasts('st0001')).find((x) => JSON.stringify(x.payloads).includes('来週の空き'))!;
    expect(b.payloads).toHaveLength(2);
    const payload = JSON.stringify(b.payloads);
    expect(payload).toContain('11/28〜12/4 の空き状況です。');
    expect(payload).toContain('空きを見る');
    expect(payload).toContain('お待ちしております！');
  });

  it('空きが設定した枠数に足りない週は送らず、理由を返す', async () => {
    await svc.saveAutomation('st0001', ruleId, { name: '空き状況', enabled: true, trigger: trigger({ min_open_slots: 500 }) as never }, origin);
    const s = await svc.runDueAutomations(at('2026-12-04T10:00:00+09:00'), origin, far(), { storeId: 'st0001', ignoreTime: true });
    expect(s.created).toBe(0);
    expect(s.skipped[0].reason).toContain('空きが少ないため見送り');
  });

  it('集計できないフォーム（カレンダー表示モード以外）のルールは送らず、理由を返す', async () => {
    await svc.saveAutomation('st0001', ruleId, { name: '空き状況', enabled: true, trigger: trigger({ form_id: 'f_md' }) as never }, origin);
    const s = await svc.runDueAutomations(at('2026-12-11T10:00:00+09:00'), origin, far(), { storeId: 'st0001', ignoreTime: true });
    expect(s.created).toBe(0);
    expect(s.skipped[0].reason).toContain('Googleカレンダー連携');
  });
});
