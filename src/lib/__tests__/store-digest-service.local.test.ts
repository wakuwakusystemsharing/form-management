/**
 * 朝のまとめ・月次レポート（local = JSON）: 設定 → スタッフ登録 → 送信 → 二重に送らない
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let svc: typeof import('@/lib/store-digest-service');

const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const origin = 'https://app.example.com';
// JST 2026-11-20 08:30
const MORNING = new Date('2026-11-19T23:30:00Z');
// JST 2026-12-01 08:30
const FIRST = new Date('2026-11-30T23:30:00Z');
const FAR = Date.now() + 10 * 60 * 1000;

const emails: Array<{ to: string; subject: string; body: string }> = [];
const pushes: Array<{ to: string; messages: Array<Record<string, unknown>> }> = [];
const deps = {
  sendEmail: async (p: { to: string; subject: string; body: string }) => {
    emails.push(p);
    return { ok: true };
  },
  pushLine: async (_token: string, to: string, messages: Array<Record<string, unknown>>) => {
    pushes.push({ to, messages });
    return { ok: to !== 'Ubroken', status: 200, body: '' };
  },
};
const reset = () => {
  emails.length = 0;
  pushes.length = 0;
};

const on = {
  morning: { enabled: true, time: '08:00' },
  monthly: { enabled: true },
  channels: { email: true, line: true },
  emails: ['owner@example.com', 'staff@example.com'],
};

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-digest-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([
    { id: 'st0001', name: 'A店', line_channel_access_token: 'token-a' },
    { id: 'st0002', name: 'B店', line_channel_access_token: 'token-b' },
  ]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([
    { id: 'c1', store_id: 'st0001', name: '山田 花子', line_user_id: 'U1', total_visits: 3, total_spent: 15000, allergies: 'ジアミン' },
  ]));
  fs.writeFileSync(dataFile('customer_visits.json'), JSON.stringify([
    { id: 'v1', customer_id: 'c1', store_id: 'st0001', visit_date: '2026-10-20', next_visit_note: '次回は短めに', next_visit_note_acknowledged_at: null },
  ]));
  fs.writeFileSync(dataFile('reservations.json'), JSON.stringify([
    { id: 'r1', store_id: 'st0001', customer_id: 'c1', customer_name: '山田 花子', reservation_date: '2026-11-20', reservation_time: '10:00', status: 'confirmed', selected_menus: [{ menu_name: 'カット', price: 5000 }] },
    { id: 'r2', store_id: 'st0001', customer_id: 'c1', customer_name: '山田 花子', reservation_date: '2026-10-20', reservation_time: '10:00', status: 'confirmed', selected_menus: [{ menu_name: 'カット', price: 5000 }] },
  ]));
  svc = await import('@/lib/store-digest-service');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('朝のまとめ・月次レポート（local）', () => {
  it('はじめはすべて OFF。合言葉は自動で作られる', async () => {
    const state = await svc.getDigestState('st0001');
    expect(state.settings.morning.enabled).toBe(false);
    expect(state.staff_code).toMatch(/^\d{4}$/);
    expect(state.staff).toEqual([]);
    // 開き直しても同じ合言葉
    expect((await svc.getDigestState('st0001')).staff_code).toBe(state.staff_code);
  });

  it('OFF のあいだは何も送らない', async () => {
    reset();
    const summary = await svc.runDueDigests(MORNING, origin, FAR, {}, deps);
    expect(summary).toMatchObject({ checked: 0, morning: 0, monthly: 0 });
    expect(emails).toHaveLength(0);
  });

  it('設定の保存（送り先が無いと ON にできない）', async () => {
    expect(await svc.saveDigestSettings('st0001', { ...on, channels: { email: false, line: false } })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveDigestSettings('st0001', on)).toMatchObject({ ok: true, value: { morning: { enabled: true, time: '08:00' } } });
  });

  it('スタッフ登録: 合言葉が合えば登録、違えば登録しない。関係ない発言は素通し', async () => {
    const { staff_code: code } = await svc.getDigestState('st0001');
    const wrong = code === '1111' ? '2222' : '1111';
    expect(await svc.handleStaffLineCommand('st0001', 'Ustaff', '予約確認', async () => 'たなか')).toBeNull();
    expect(await svc.handleStaffLineCommand('st0001', 'Ustaff', 'スタッフ登録', async () => 'たなか')).toContain('合言葉');
    expect(await svc.handleStaffLineCommand('st0001', 'Ustaff', `スタッフ登録 ${wrong}`, async () => 'たなか')).toContain('合言葉が違います');
    expect((await svc.getDigestState('st0001')).staff).toHaveLength(0);

    expect(await svc.handleStaffLineCommand('st0001', 'Ustaff', `スタッフ登録 ${code}`, async () => 'たなか')).toContain('登録しました');
    // 2 回送っても 1 人
    expect(await svc.handleStaffLineCommand('st0001', 'Ustaff', `スタッフ登録 ${code}`, async () => 'たなか')).toContain('登録しました');
    const staff = (await svc.getDigestState('st0001')).staff;
    expect(staff).toHaveLength(1);
    expect(staff[0]).toMatchObject({ display_name: 'たなか' });
    // LINE ユーザー ID は画面に返さない
    expect(JSON.stringify(staff)).not.toContain('Ustaff');
    // 他の店舗の合言葉では登録できない
    expect(await svc.handleStaffLineCommand('st0002', 'Ustaff', `スタッフ登録 ${code}`, async () => 'たなか')).not.toContain('登録しました');
  });

  it('合言葉を 5 回間違えると無効になり、出し直すまで登録できない', async () => {
    const { staff_code: code } = await svc.getDigestState('st0002');
    const wrong = code === '1111' ? '2222' : '1111';
    for (let i = 0; i < 5; i += 1) await svc.handleStaffLineCommand('st0002', 'Ux', `スタッフ登録 ${wrong}`, async () => 'x');
    expect(await svc.handleStaffLineCommand('st0002', 'Ux', `スタッフ登録 ${code}`, async () => 'x')).toContain('受け付けていません');
    const next = await svc.reissueStaffCode('st0002');
    expect(next).toMatch(/^\d{4}$/);
    expect(await svc.handleStaffLineCommand('st0002', 'Ux', `スタッフ登録 ${next}`, async () => 'x')).toContain('登録しました');
  });

  it('時刻を過ぎたら朝のまとめをメールと LINE に送り、同じ日は 2 回送らない', async () => {
    reset();
    const early = await svc.runDueDigests(new Date('2026-11-19T22:30:00Z'), origin, FAR, {}, deps); // JST 07:30
    expect(early).toMatchObject({ morning: 0 });
    expect(emails).toHaveLength(0);

    const first = await svc.runDueDigests(MORNING, origin, FAR, {}, deps);
    expect(first).toMatchObject({ checked: 1, morning: 1, failed: 0 });
    expect(emails.map((e) => e.to)).toEqual(['owner@example.com', 'staff@example.com']);
    expect(emails[0].subject).toBe('【今日の予約】11/20（金）1件 - A店');
    expect(emails[0].body).toContain('申し送り: 次回は短めに');
    expect(emails[0].body).toContain('注意あり');
    expect(emails[0].body).not.toContain('ジアミン');
    expect(emails[0].body).toContain('https://app.example.com/st0001/admin?tab=reservations');
    expect(pushes.map((p) => p.to)).toEqual(['Ustaff']);
    expect(pushes[0].messages[0]).toMatchObject({ type: 'flex', altText: '今日の予約 1件（11/20 金）' });

    reset();
    const again = await svc.runDueDigests(new Date(MORNING.getTime() + 60 * 60 * 1000), origin, FAR, {}, deps);
    expect(again).toMatchObject({ morning: 0 });
    expect(emails).toHaveLength(0);
    expect(pushes).toHaveLength(0);

    const logs = (await svc.getDigestState('st0001')).logs;
    expect(logs[0]).toMatchObject({ kind: 'morning', target_key: '2026-11-20', status: 'sent', email_sent: 2, line_sent: 1 });
  });

  it('予約が 0 件の日は送らない（記録は「見送り」）', async () => {
    reset();
    const summary = await svc.runDueDigests(new Date('2026-11-20T23:30:00Z'), origin, FAR, {}, deps); // JST 11/21
    expect(summary).toMatchObject({ morning: 0, skipped: 1 });
    expect(emails).toHaveLength(0);
    expect((await svc.getDigestState('st0001')).logs[0]).toMatchObject({ target_key: '2026-11-21', status: 'skipped' });
  });

  it('毎月 1 日に前月の月次レポートを 1 回だけ送る', async () => {
    reset();
    const summary = await svc.runDueDigests(FIRST, origin, FAR, {}, deps);
    expect(summary).toMatchObject({ monthly: 1 });
    const mail = emails.find((e) => e.subject.startsWith('【月次レポート】'));
    expect(mail?.subject).toBe('【月次レポート】2026年11月 - A店');
    expect(mail?.body).toContain('予約数: 1 件');
    expect(mail?.body).toContain('https://app.example.com/st0001/admin?tab=dashboard&report=2026-11');
    expect(pushes.some((p) => (p.messages[0] as { altText?: string }).altText === '2026年11月の月次レポート')).toBe(true);

    reset();
    const nextDay = await svc.runDueDigests(new Date(FIRST.getTime() + 24 * 60 * 60 * 1000), origin, FAR, {}, deps);
    expect(nextDay).toMatchObject({ monthly: 0 });
    expect(emails.filter((e) => e.subject.startsWith('【月次レポート】'))).toHaveLength(0);
  });

  it('テスト送信は記録に関係なく送れる（予約 0 件でも）', async () => {
    reset();
    const r = await svc.sendDigestTest('st0001', 'morning', origin, new Date('2026-11-20T23:30:00Z'), deps);
    expect(r).toMatchObject({ ok: true, value: { email_sent: 2, line_sent: 1 } });
    expect(emails[0].body).toContain('本日の予約はありません');
  });

  it('レポートページ: 月の一覧とその月の数字', async () => {
    const page = await svc.getMonthlyReportPage('st0001', '2026-10', MORNING);
    expect(page.months).toEqual(['2026-11', '2026-10']);
    expect(page.report).toMatchObject({ month: '2026-10', reservations: 1, revenue: 5000, new_customers: 1 });
    // 月の指定が無ければ先月
    expect((await svc.getMonthlyReportPage('st0001', null, MORNING)).report.month).toBe('2026-10');
  });

  it('スタッフの登録解除（LINE / 管理画面）', async () => {
    expect(await svc.handleStaffLineCommand('st0001', 'Ustaff', 'スタッフ登録解除', async () => '')).toContain('解除しました');
    expect((await svc.getDigestState('st0001')).staff).toHaveLength(0);
    const { staff_code: code } = await svc.getDigestState('st0001');
    await svc.handleStaffLineCommand('st0001', 'Ustaff', `スタッフ登録 ${code}`, async () => 'たなか');
    const id = (await svc.getDigestState('st0001')).staff[0].id;
    expect(await svc.removeDigestStaff('st0001', id)).toBe(true);
    expect((await svc.getDigestState('st0001')).staff).toHaveLength(0);
  });
});
