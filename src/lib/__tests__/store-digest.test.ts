/**
 * 朝の「今日の予約まとめ」・月次レポート（純粋ロジック）
 */
import { describe, expect, it } from 'vitest';
import {
  DIGEST_DEFAULT_SETTINGS,
  buildMonthlyReportLineMessage,
  buildMorningDigest,
  buildMorningDigestLineMessage,
  computeMonthlyReport,
  generateStaffCode,
  isDigestTimeDue,
  listReportMonths,
  monthlyReportTargetMonth,
  normalizeDigestSettings,
  parseStaffCommand,
  renderMonthlyReportEmail,
  renderMorningDigestEmail,
  validateDigestSettings,
} from '@/lib/store-digest';

// JST 2026-11-20 08:30
const NOW = new Date('2026-11-19T23:30:00Z');

describe('設定', () => {
  it('未設定はすべて OFF', () => {
    expect(normalizeDigestSettings(null)).toEqual(DIGEST_DEFAULT_SETTINGS);
    expect(DIGEST_DEFAULT_SETTINGS.morning.enabled).toBe(false);
    expect(DIGEST_DEFAULT_SETTINGS.monthly.enabled).toBe(false);
  });

  it('不正な値を直す（時刻・メールの重複・上限）', () => {
    const s = normalizeDigestSettings({
      morning: { enabled: true, time: '25:00' },
      monthly: { enabled: 1 },
      channels: { email: true, line: 'yes' },
      emails: [' a@example.com ', 'a@example.com', '', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com', 'f@example.com'],
    });
    expect(s.morning).toEqual({ enabled: true, time: '08:00' });
    expect(s.monthly.enabled).toBe(false);
    expect(s.channels).toEqual({ email: true, line: false });
    expect(s.emails).toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com']);
  });

  it('ON にするには送り先が必要', () => {
    const base = { morning: { enabled: true, time: '08:00' }, monthly: { enabled: false } };
    expect(validateDigestSettings({ ...base, channels: { email: false, line: false }, emails: [] })).toMatchObject({ ok: false });
    expect(validateDigestSettings({ ...base, channels: { email: true, line: false }, emails: [] })).toMatchObject({ ok: false });
    expect(validateDigestSettings({ ...base, channels: { email: true, line: false }, emails: ['だめ'] })).toMatchObject({ ok: false });
    expect(validateDigestSettings({ ...base, channels: { email: true, line: false }, emails: ['a@example.com'] })).toMatchObject({ ok: true });
    expect(validateDigestSettings({ ...base, channels: { email: false, line: true }, emails: [] })).toMatchObject({ ok: true });
    // どちらも OFF なら送り先なしでも保存できる
    expect(validateDigestSettings({ morning: { enabled: false, time: '08:00' }, monthly: { enabled: false }, channels: { email: false, line: false }, emails: [] })).toMatchObject({ ok: true });
  });
});

describe('スタッフ登録の合言葉', () => {
  it('「スタッフ登録 4821」を読む（全角の数字・空白も）', () => {
    expect(parseStaffCommand('スタッフ登録 4821')).toEqual({ type: 'register', code: '4821' });
    expect(parseStaffCommand('スタッフ登録　４８２１')).toEqual({ type: 'register', code: '4821' });
    expect(parseStaffCommand('スタッフ登録4821')).toEqual({ type: 'register', code: '4821' });
    expect(parseStaffCommand('スタッフ登録')).toEqual({ type: 'register', code: null });
    expect(parseStaffCommand('スタッフ登録解除')).toEqual({ type: 'unregister' });
    expect(parseStaffCommand('スタッフ登録お願いします')).toBeNull();
    expect(parseStaffCommand('予約確認')).toBeNull();
  });

  it('合言葉は 4 桁の数字', () => {
    expect(generateStaffCode(() => 0)).toBe('1000');
    expect(generateStaffCode(() => 0.99999)).toBe('9999');
    expect(generateStaffCode()).toMatch(/^\d{4}$/);
  });
});

describe('送る時刻', () => {
  it('設定時刻を過ぎてから 3 時間以内だけ', () => {
    expect(isDigestTimeDue('08:00', NOW)).toBe(true); // 08:30
    expect(isDigestTimeDue('09:00', NOW)).toBe(false);
    expect(isDigestTimeDue('06:00', NOW)).toBe(true); // 2.5 時間後
    expect(isDigestTimeDue('05:00', NOW)).toBe(false); // 3.5 時間後 = 遅すぎるので送らない
  });

  it('月次は 1〜3 日に前月分', () => {
    expect(monthlyReportTargetMonth(new Date('2026-11-30T23:30:00Z'))).toBe('2026-11'); // JST 12/1
    expect(monthlyReportTargetMonth(new Date('2026-12-02T23:30:00Z'))).toBe('2026-11'); // JST 12/3
    expect(monthlyReportTargetMonth(new Date('2026-12-03T23:30:00Z'))).toBeNull(); // JST 12/4
    expect(monthlyReportTargetMonth(new Date('2025-12-31T23:30:00Z'))).toBe('2025-12'); // JST 1/1
  });
});

const customers = [
  { id: 'c1', name: '山田 花子', line_user_id: 'U1', total_visits: 1, total_spent: 0, birthday: '1990-11-03', allergies: 'ジアミン', medical_history: null },
  { id: 'c2', name: '佐藤 太郎', line_user_id: 'U2', total_visits: 12, total_spent: 80000, birthday: '1985-04-01', allergies: null, medical_history: null },
];

describe('朝のまとめ', () => {
  const digest = buildMorningDigest({
    date: '2026-11-20',
    storeName: 'A店',
    reservations: [
      { id: 'r2', reservation_date: '2026-11-20', reservation_time: '14:00', status: 'confirmed', customer_id: 'c2', customer_name: '佐藤 太郎', selected_menus: [{ menu_name: 'カラー', submenu_name: 'リタッチ' }], staff_name: '田中' },
      { id: 'r1', reservation_date: '2026-11-20', reservation_time: '10:00:00', status: 'pending', line_user_id: 'U1', customer_name: '山田 花子', selected_menus: [{ menu_name: 'カット' }, { menu_name: 'トリートメント' }] },
      { id: 'r3', reservation_date: '2026-11-20', reservation_time: '11:00', status: 'cancelled', customer_name: 'キャンセル', selected_menus: [] },
      { id: 'r4', reservation_date: '2026-11-21', reservation_time: '11:00', status: 'confirmed', customer_name: '明日', selected_menus: [] },
      { id: 'r5', reservation_date: '2026-11-20', reservation_time: '16:00', status: 'confirmed', customer_name: '台帳なし', menu_name: 'パーマ' },
    ],
    customers,
    notes: { c2: '前回は明るめを希望。次回は 1 トーン下げる' },
    waitlistCount: 2,
  });

  it('今日のキャンセル以外を時刻順に', () => {
    expect(digest.count).toBe(3);
    expect(digest.rows.map((r) => [r.time, r.name, r.menu, r.staff])).toEqual([
      ['10:00', '山田 花子', 'カット、トリートメント', null],
      ['14:00', '佐藤 太郎', 'カラー > リタッチ', '田中'],
      ['16:00', '台帳なし', 'パーマ', null],
    ]);
    expect(digest.waitlist_count).toBe(2);
  });

  it('しるし: 新規・VIP・誕生月、注意あり、申し送り', () => {
    expect(digest.rows[0]).toMatchObject({ marks: ['new', 'birthday'], caution: true, note: null });
    expect(digest.rows[1]).toMatchObject({ marks: ['vip'], caution: false, note: '前回は明るめを希望。次回は 1 トーン下げる' });
    expect(digest.rows[2]).toMatchObject({ marks: ['new'], caution: false });
  });

  it('メール: 件名と本文。アレルギーの中身は載せない', () => {
    const mail = renderMorningDigestEmail(digest, 'https://app.example.com/st1/admin');
    expect(mail.subject).toBe('【今日の予約】11/20（金）3件 - A店');
    expect(mail.body).toContain('10:00 山田 花子 様');
    expect(mail.body).toContain('カット、トリートメント');
    expect(mail.body).toContain('担当: 田中');
    expect(mail.body).toContain('注意あり');
    expect(mail.body).not.toContain('ジアミン');
    expect(mail.body).toContain('申し送り: 前回は明るめを希望');
    expect(mail.body).toContain('空き待ち: 2 件');
    expect(mail.body).toContain('https://app.example.com/st1/admin');
  });

  it('LINE: Flex 1 通。件数が多いときは先頭だけ出して残りは件数', () => {
    const msg = buildMorningDigestLineMessage(digest, 'https://app.example.com/st1/admin');
    expect(msg.type).toBe('flex');
    expect(msg.altText).toBe('今日の予約 3件（11/20 金）');
    const json = JSON.stringify(msg);
    expect(json).toContain('山田 花子');
    expect(json).not.toContain('ジアミン');

    const many = buildMorningDigest({
      date: '2026-11-20',
      storeName: 'A店',
      reservations: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, reservation_date: '2026-11-20', reservation_time: `${String(9 + Math.floor(i / 3)).padStart(2, '0')}:00`, status: 'confirmed', customer_name: `客${i}`, menu_name: 'カット' })),
      customers: [],
      notes: {},
      waitlistCount: 0,
    });
    const manyJson = JSON.stringify(buildMorningDigestLineMessage(many, 'https://app.example.com/x'));
    expect(manyJson).toContain('客0');
    expect(manyJson).not.toContain('客29');
    expect(manyJson).toContain('ほか 15 件');
    expect(manyJson.length).toBeLessThan(30000);
  });

  it('予約が 0 件', () => {
    const empty = buildMorningDigest({ date: '2026-11-20', storeName: 'A店', reservations: [], customers: [], notes: {}, waitlistCount: 0 });
    expect(empty.count).toBe(0);
    expect(renderMorningDigestEmail(empty, 'https://x').body).toContain('本日の予約はありません');
  });
});

describe('月次レポート', () => {
  const menu = (name: string, price: number) => [{ menu_name: name, price }];
  const reservations = [
    // 9 月（前々月）: c1 が初来店
    { id: 'a1', reservation_date: '2026-09-10', status: 'confirmed', customer_id: 'c1', selected_menus: menu('カット', 5000) },
    // 10 月（前月）: c1 再来店、c2 初来店
    { id: 'b1', reservation_date: '2026-10-05', status: 'confirmed', customer_id: 'c1', selected_menus: menu('カット', 5000) },
    { id: 'b2', reservation_date: '2026-10-20', status: 'confirmed', customer_id: 'c2', selected_menus: menu('カラー', 8000) },
    // 11 月: c1・c2 再来店、c3 初来店（2 回）、キャンセル 1 件、LINE だけの人 1 件
    { id: 'c1', reservation_date: '2026-11-02', status: 'confirmed', customer_id: 'c1', selected_menus: menu('カット', 5000) },
    { id: 'c2', reservation_date: '2026-11-03', status: 'completed', customer_id: 'c2', selected_menus: menu('カラー', 8000), selected_options: [{ price: 1000 }] },
    { id: 'c3', reservation_date: '2026-11-10', status: 'confirmed', customer_id: 'c3', selected_menus: menu('カット', 5000) },
    { id: 'c4', reservation_date: '2026-11-25', status: 'confirmed', customer_id: 'c3', selected_menus: menu('カット', 5000) },
    { id: 'c5', reservation_date: '2026-11-12', status: 'cancelled', customer_id: 'c4', selected_menus: menu('パーマ', 12000) },
    { id: 'c6', reservation_date: '2026-11-15', status: 'confirmed', line_user_id: 'U9', selected_menus: menu('パーマ', 12000) },
  ];
  const report = computeMonthlyReport(reservations, '2026-11');

  it('予約数・売上・キャンセル率', () => {
    expect(report).toMatchObject({ month: '2026-11', label: '2026年11月', reservations: 5, cancelled: 1, revenue: 36000, average: 7200 });
    expect(report.cancel_rate).toBeCloseTo(16.7, 1);
  });

  it('新規・リピート（その月より前に予約がある人 = リピート）', () => {
    expect(report).toMatchObject({ customers: 4, new_customers: 2, repeat_customers: 2, repeat_rate: 50 });
  });

  it('前月比', () => {
    expect(report.prev).toMatchObject({ month: '2026-10', reservations: 2, revenue: 13000, new_customers: 1 });
    expect(report.change).toMatchObject({ reservations: 150, revenue: 177 });
  });

  it('人気メニュー（件数順。同数は売上順）', () => {
    expect(report.top_menus.map((m) => [m.name, m.count])).toEqual([
      ['カット', 3],
      ['パーマ', 1],
      ['カラー', 1],
    ]);
  });

  it('前月に予約が無ければ前月比は出さない', () => {
    const first = computeMonthlyReport(reservations, '2026-09');
    expect(first.prev).toMatchObject({ reservations: 0 });
    expect(first.change).toEqual({ reservations: null, revenue: null });
  });

  it('メール・LINE の本文', () => {
    const withBroadcast = { ...report, broadcasts: { count: 2, sent: 120, tapped_reservations: 3, tapped_revenue: 18000, received_reservations: 6, received_revenue: 40000 } };
    const mail = renderMonthlyReportEmail(withBroadcast, 'A店', 'https://app.example.com/st1/admin?tab=dashboard&report=2026-11');
    expect(mail.subject).toBe('【月次レポート】2026年11月 - A店');
    expect(mail.body).toContain('予約数: 5 件（前月比 +150%）');
    expect(mail.body).toContain('売上: ¥36,000（前月比 +177%）');
    expect(mail.body).toContain('新規のお客様: 2 人');
    expect(mail.body).toContain('リピート率: 50%');
    expect(mail.body).toContain('キャンセル率: 16.7%');
    expect(mail.body).toContain('1. カット 3 件');
    expect(mail.body).toContain('配信 2 回（120 通）');
    expect(mail.body).toContain('report=2026-11');

    const msg = buildMonthlyReportLineMessage(withBroadcast, 'A店', 'https://app.example.com/r');
    expect(msg.type).toBe('flex');
    expect(msg.altText).toBe('2026年11月の月次レポート');
    expect(JSON.stringify(msg)).toContain('¥36,000');
  });

  it('見られる月の一覧（最初の予約の月 〜 今月。新しい順）', () => {
    expect(listReportMonths(reservations, NOW)).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(listReportMonths([], NOW)).toEqual(['2026-11']);
  });
});
