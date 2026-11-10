/**
 * 自動配信と配信設定（local = JSON）の動作確認
 * ルールの保存 → 見積り → 毎時の実行（実行時刻・1 日 1 回・二重送信防止・月間上限・トークン無し）、設定の保存、対象者の抽出
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pickAutomationTargets } from '@/lib/broadcast-automation';
import type { AudienceCustomer } from '@/types/broadcast';

let tmpDir = '';
let originalCwd = '';
let svc: typeof import('@/lib/broadcast-automation-service');
let repo: typeof import('@/lib/broadcast-repository');

const origin = 'https://app.example.com';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const lineId = (n: number) => `U${String(n).padStart(32, '0')}`;
// JST 2026-11-10 12:00
const NOON = new Date('2026-11-10T03:00:00Z');
const FAR = Date.now() + 10 * 60 * 1000;

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broadcast-automation-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([
    { id: 'st0001', name: 'A店', line_channel_access_token: 'token-a' },
    { id: 'st0002', name: 'トークンなし' },
    { id: 'st0003', name: '夕方に実行', line_channel_access_token: 'token-c', broadcast_automation_time: '18:00' },
  ]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([
    { id: 'c1', store_id: 'st0001', name: '休眠 90 日', line_user_id: lineId(1), line_friend_flag: true, last_visit_date: '2026-08-12', total_visits: 3, tags: ['VIP候補'] },
    { id: 'c2', store_id: 'st0001', name: '休眠 95 日', line_user_id: lineId(2), line_friend_flag: true, last_visit_date: '2026-08-07', total_visits: 1, tags: [] },
    { id: 'c3', store_id: 'st0001', name: '最近来た', line_user_id: lineId(3), line_friend_flag: true, last_visit_date: '2026-11-01', tags: [] },
    { id: 'c4', store_id: 'st0001', name: '古い休眠', line_user_id: lineId(4), line_friend_flag: true, last_visit_date: '2025-01-01', tags: [] },
    { id: 'c5', store_id: 'st0001', name: '配信停止', line_user_id: lineId(5), line_friend_flag: true, last_visit_date: '2026-08-12', line_opt_out_at: '2026-11-01T00:00:00Z', tags: [] },
    { id: 'd1', store_id: 'st0002', name: '他店', line_user_id: lineId(6), line_friend_flag: true, last_visit_date: '2026-08-12' },
    { id: 'e1', store_id: 'st0003', name: '夕方店', line_user_id: lineId(7), line_friend_flag: true, last_visit_date: '2026-08-12' },
  ]));
  svc = await import('@/lib/broadcast-automation-service');
  repo = await import('@/lib/broadcast-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const text = (t: string) => [{ key: 'a', type: 'text' as const, text: t }];

describe('ルールの保存', () => {
  it('名前・きっかけが必須。ON にするにはメッセージが必要。OFF なら空でも保存できる', async () => {
    expect(await svc.saveAutomation('st0001', null, { name: ' ', trigger: { type: 'dormant', days: 90 } }, origin)).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveAutomation('st0001', null, { name: 'x', trigger: { type: 'tag_added', tags: [] } }, origin)).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('タグ') });
    expect(await svc.saveAutomation('st0001', null, { name: 'x', enabled: true, trigger: { type: 'dormant', days: 90 } }, origin)).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('メッセージ') });
    const off = await svc.saveAutomation('st0001', null, { name: '下書きルール', trigger: { type: 'birthday', day: 1 } }, origin);
    expect(off).toMatchObject({ ok: true, value: { enabled: false, items: [], trigger: { type: 'birthday', day: 1 }, resend_after_days: null } });
    if (off.ok) expect(await svc.removeAutomation('st0001', off.value.id)).toEqual({ ok: true, value: true });
    expect(await svc.removeAutomation('st0001', 'nope')).toMatchObject({ ok: false, status: 404 });
    expect(await svc.saveAutomation('st0001', '00000000-0000-0000-0000-000000000000', { name: 'x', trigger: { type: 'dormant', days: 90 } }, origin)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('見積りと実行', () => {
  it('休眠ルール: 到達から 14 日以内の人だけ。配信停止・古い休眠は対象外', async () => {
    const p = await svc.previewAutomation('st0001', null, { trigger: { type: 'dormant', days: 90 } }, NOON);
    expect(p).toMatchObject({ ok: true, value: { count: 2, sample: ['休眠 90 日', '休眠 95 日'], trigger: '最終来店から 90 日' } });
    const narrowed = await svc.previewAutomation('st0001', null, { trigger: { type: 'dormant', days: 90 }, audience: { tags: { mode: 'any', values: ['VIP候補'] } } }, NOON);
    expect(narrowed).toMatchObject({ ok: true, value: { count: 1 } });
  });

  it('実行時刻を過ぎたら 1 日 1 回だけ配信を作り、同じ人には二重に送らない', async () => {
    const saved = await svc.saveAutomation('st0001', null, { name: '休眠のお客様へ', enabled: true, trigger: { type: 'dormant', days: 90 }, items: text('{name}さん、お久しぶりです'), resend_after_days: 180 }, origin);
    if (!saved.ok) throw new Error('setup');
    const ruleId = saved.value.id;

    // 実行時刻（既定 10:00 JST）より前は何もしない
    const early = await svc.runDueAutomations(new Date('2026-11-10T00:30:00Z'), origin, FAR);
    expect(early).toMatchObject({ checked: 0, created: 0 });

    const run = await svc.runDueAutomations(NOON, origin, FAR);
    expect(run).toMatchObject({ checked: 1, created: 1, recipients: 2, deferred: 0 });
    const list = await repo.listBroadcasts('st0001');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: '【自動】休眠のお客様へ', status: 'scheduled', automation_id: ruleId, recipient_count: 2, has_personalization: true });
    const rec = await repo.listBroadcastRecipients(list[0].id);
    expect(rec.recipients.map((r) => [r.customer_id, r.display_name])).toEqual([['c1', '休眠 90 日'], ['c2', '休眠 95 日']]);
    expect((await repo.listAutomationSends(ruleId)).map((s) => s.marker).sort()).toEqual(['dormant:2026-08-07', 'dormant:2026-08-12']);

    // 同じ日にもう一度呼ばれても何もしない
    expect(await svc.runDueAutomations(new Date('2026-11-10T05:00:00Z'), origin, FAR)).toMatchObject({ checked: 0, created: 0 });
    // 翌日: 判定はするが、同じ人には送らない（新しい配信は作らない）
    const next = await svc.runDueAutomations(new Date('2026-11-11T03:00:00Z'), origin, FAR);
    expect(next).toMatchObject({ checked: 1, created: 0 });
    expect(await repo.listBroadcasts('st0001')).toHaveLength(1);
    // 編集画面の見積りも、送信済みの人を除く
    expect(await svc.previewAutomation('st0001', ruleId, { trigger: { type: 'dormant', days: 90 } }, new Date('2026-11-11T03:00:00Z'))).toMatchObject({ ok: true, value: { count: 0 } });
    expect((await repo.countRecentAutomationSends([ruleId], NOON))[ruleId]).toBe(2);
    await svc.removeAutomation('st0001', ruleId);
  });

  it('月間上限を超えるときは送らず、見送りの記録だけ残す（送信記録を残さないので後日送られる）', async () => {
    const base = await repo.getBroadcastSettings('st0001');
    await repo.updateBroadcastSettings('st0001', { ...base, monthly_limit: 1 });
    const saved = await svc.saveAutomation('st0001', null, { name: '上限テスト', enabled: true, trigger: { type: 'dormant', days: 90 }, items: text('hi') }, origin);
    if (!saved.ok) throw new Error('setup');
    const run = await svc.runDueAutomations(new Date('2026-11-12T03:00:00Z'), origin, FAR);
    expect(run).toMatchObject({ checked: 1, created: 0 });
    expect(run.skipped).toEqual([{ automation_id: saved.value.id, reason: '月間上限' }]);
    const skipped = (await repo.listBroadcasts('st0001')).find((b) => b.automation_id === saved.value.id);
    expect(skipped).toMatchObject({ status: 'cancelled', recipient_count: 2 });
    expect(skipped?.error).toContain('上限');
    expect(await repo.listAutomationSends(saved.value.id)).toEqual([]);
    await repo.updateBroadcastSettings('st0001', { ...base, monthly_limit: null });
    await svc.removeAutomation('st0001', saved.value.id);
  });

  it('トークン未設定の店舗は見送り、実行時刻が後の店舗はその時刻まで待つ。時間切れは次の回へ', async () => {
    const noToken = await svc.saveAutomation('st0002', null, { name: 'トークンなし', enabled: true, trigger: { type: 'dormant', days: 90 }, items: text('hi') }, origin);
    const evening = await svc.saveAutomation('st0003', null, { name: '夕方', enabled: true, trigger: { type: 'dormant', days: 90 }, items: text('hi') }, origin);
    if (!noToken.ok || !evening.ok) throw new Error('setup');

    // 時間切れ（deadline が過去）: どれも処理せず次の回に回す
    const timeout = await svc.runDueAutomations(new Date('2026-11-13T03:00:00Z'), origin, Date.now() - 1);
    expect(timeout).toMatchObject({ checked: 0, created: 0, deferred: 2 });

    const noon = await svc.runDueAutomations(new Date('2026-11-13T03:00:00Z'), origin, FAR); // JST 12:00
    expect(noon).toMatchObject({ checked: 1, created: 0 });
    expect(noon.skipped).toEqual([{ automation_id: noToken.value.id, reason: expect.stringContaining('トークン') }]);
    expect(await repo.listBroadcasts('st0003')).toEqual([]);

    const night = await svc.runDueAutomations(new Date('2026-11-13T09:30:00Z'), origin, FAR); // JST 18:30
    expect(night).toMatchObject({ checked: 1, created: 1, recipients: 1 });
    expect(await repo.listBroadcasts('st0003')).toHaveLength(1);
  });
});

describe('配信設定の保存', () => {
  it('検証して保存する', async () => {
    const ok = await svc.saveBroadcastSettings('st0001', { monthly_limit: '300', over_limit: 'block', opt_out_keyword: '停止', opt_in_keyword: '再開', automation_time: '09:00' });
    expect(ok).toEqual({ ok: true, value: { monthly_limit: 300, over_limit: 'block', opt_out_keyword: '停止', opt_in_keyword: '再開', automation_time: '09:00' } });
    expect(await repo.getBroadcastSettings('st0001')).toMatchObject({ monthly_limit: 300, automation_time: '09:00' });
    const cleared = await svc.saveBroadcastSettings('st0001', { monthly_limit: '', over_limit: 'confirm', opt_out_keyword: '配信停止', opt_in_keyword: '配信再開', automation_time: '10:00' });
    expect(cleared).toMatchObject({ ok: true, value: { monthly_limit: null } });
  });
  it('同じキーワード・予約語・不正な時刻・負の上限は 400', async () => {
    const base = { monthly_limit: null, over_limit: 'confirm', opt_out_keyword: '配信停止', opt_in_keyword: '配信再開', automation_time: '10:00' };
    expect(await svc.saveBroadcastSettings('st0001', { ...base, opt_in_keyword: '配信停止' })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveBroadcastSettings('st0001', { ...base, opt_out_keyword: '予約確認' })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveBroadcastSettings('st0001', { ...base, opt_out_keyword: '' })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveBroadcastSettings('st0001', { ...base, automation_time: '10:30' })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveBroadcastSettings('st0001', { ...base, monthly_limit: -5 })).toMatchObject({ ok: false, status: 400 });
  });
  it('LINE の通数: トークンが無ければ null、あれば quota と consumption を合わせる', async () => {
    expect(await svc.fetchLineQuota('st0002')).toBeNull();
    const fake = (async (url: string) => ({ ok: true, json: async () => (String(url).endsWith('consumption') ? { totalUsage: 120 } : { type: 'limited', value: 200 }) })) as unknown as typeof fetch;
    expect(await svc.fetchLineQuota('st0001', fake)).toEqual({ type: 'limited', limit: 200, usage: 120 });
    const failing = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await svc.fetchLineQuota('st0001', failing)).toBeNull();
  });
});

describe('pickAutomationTargets', () => {
  const c = (patch: Partial<AudienceCustomer> & { id: string }): AudienceCustomer => ({
    name: patch.id, line_user_id: `U${patch.id}`, line_display_name: null, line_friend_flag: true, line_opt_out_at: null, tags: [], gender: null, birthday: null,
    total_visits: 0, total_spent: 0, first_visit_date: null, last_visit_date: null, ...patch,
  });
  it('送れない人・送信済み・再送間隔内を除き、同じ LINE ユーザーは 1 人', () => {
    const customers = [
      c({ id: 'a', tags: ['x'] }),
      c({ id: 'b', tags: ['x'], line_user_id: null }),
      c({ id: 'c', tags: ['x'], line_friend_flag: false, line_blocked_at: '2026-10-01T00:00:00Z' }),
      c({ id: 'd', tags: ['x'], line_user_id: 'Ua' }),
      c({ id: 'e', tags: ['x'] }),
      c({ id: 'f', tags: ['y'] }),
      c({ id: 'g', tags: ['x', 'z'] }),
    ];
    const targets = pickAutomationTargets({
      trigger: { type: 'tag_added', tags: ['x'] },
      audience: { exclude_tags: ['z'] },
      resend_after_days: null,
      customers,
      facts: new Map(),
      sends: [{ customer_id: 'e', marker: 'tag:x', sent_at: '2026-11-01T00:00:00Z' }],
      now: NOON,
    });
    expect(targets.map((t) => [t.customer.id, t.marker])).toEqual([['a', 'tag:x']]);
  });
});

describe('今日の判定を今すぐ実行（店舗を指定・実行時刻を待たない）', () => {
  it('その店舗の ON のルールだけを、実行時刻より前でも処理する。1 日 1 回の制限はそのまま', async () => {
    const saved = await svc.saveAutomation('st0003', null, { name: '今すぐ', enabled: true, trigger: { type: 'tag_added', tags: ['新規'] }, items: text('hi') }, origin);
    if (!saved.ok) throw new Error('setup');
    const customers = JSON.parse(fs.readFileSync(dataFile('customers.json'), 'utf-8'));
    customers.push({ id: 'e2', store_id: 'st0003', name: 'タグ付き', line_user_id: lineId(8), line_friend_flag: true, tags: ['新規'] });
    fs.writeFileSync(dataFile('customers.json'), JSON.stringify(customers));

    const morning = new Date('2026-11-20T00:00:00Z'); // JST 9:00（st0003 の実行時刻 18:00 より前）
    expect(await svc.runDueAutomations(morning, origin, FAR, { storeId: 'st0003' })).toMatchObject({ checked: 0, created: 0 });
    const before = (await repo.listBroadcasts('st0001')).length;
    const run = await svc.runDueAutomations(morning, origin, FAR, { storeId: 'st0003', ignoreTime: true });
    expect(run.created).toBe(1);
    expect(run.recipients).toBe(1);
    // 他店舗のルールは動かない
    expect((await repo.listBroadcasts('st0001')).length).toBe(before);
    // 同じ日にもう一度押しても何も起きない
    expect(await svc.runDueAutomations(morning, origin, FAR, { storeId: 'st0003', ignoreTime: true })).toMatchObject({ checked: 0, created: 0 });
  });
});

describe('API ルート（local。認証はスキップ）', () => {
  const ctx = (storeId: string, id?: string) => ({ params: Promise.resolve(id ? { storeId, id } : { storeId }) }) as never;
  const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('自動配信: 見積り → 作成 → 一覧 → 更新 → 今すぐ実行 → 削除', async () => {
    const list = await import('@/app/api/stores/[storeId]/broadcast-automations/route');
    const item = await import('@/app/api/stores/[storeId]/broadcast-automations/[id]/route');
    const run = await import('@/app/api/stores/[storeId]/broadcast-automations/run/route');
    const url = 'http://localhost/api/stores/st0001/broadcast-automations';

    const preview = await list.POST(new Request(url, json({ name: 'p', preview: true, trigger: { type: 'tag_added', tags: ['VIP候補'] } })), ctx('st0001'));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ count: 1, sample: ['休眠 90 日'] });

    const created = await list.POST(new Request(url, json({ name: 'ルート経由', enabled: false, trigger: { type: 'birthday', day: 1 } })), ctx('st0001'));
    expect(created.status).toBe(201);
    const id = (await created.json()).automation.id as string;

    const got = await list.GET(new Request(url), ctx('st0001'));
    const body = await got.json();
    expect(body.automations.map((a: { id: string }) => a.id)).toContain(id);
    expect(body.recent_sends).toBeTypeOf('object');

    const bad = await item.PUT(new Request(`${url}/${id}`, { ...json({ name: 'x', enabled: true, trigger: { type: 'birthday', day: 1 } }), method: 'PUT' }), ctx('st0001', id));
    expect(bad.status).toBe(400);
    const updated = await item.PUT(new Request(`${url}/${id}`, { ...json({ name: '改名', enabled: false, trigger: { type: 'birthday', day: 5 } }), method: 'PUT' }), ctx('st0001', id));
    expect((await updated.json()).automation).toMatchObject({ name: '改名', trigger: { type: 'birthday', day: 5 } });
    expect((await item.PUT(new Request(`${url}/not-a-uuid`, { ...json({ name: 'x', trigger: { type: 'birthday', day: 1 } }), method: 'PUT' }), ctx('st0001', 'not-a-uuid'))).status).toBe(404);

    const ran = await run.POST(new Request(`${url}/run`, { method: 'POST' }), ctx('st0001'));
    expect(ran.status).toBe(200);
    expect(await ran.json()).toMatchObject({ created: 0, deferred: 0 });

    expect((await item.DELETE(new Request(`${url}/${id}`, { method: 'DELETE' }), ctx('st0001', id))).status).toBe(200);
    expect((await item.DELETE(new Request(`${url}/${id}`, { method: 'DELETE' }), ctx('st0001', id))).status).toBe(404);
  });

  it('設定: 取得（LINE の通数は取得できなければ null）→ 保存 → 不正値は 400', async () => {
    const route = await import('@/app/api/stores/[storeId]/broadcast-settings/route');
    const url = 'http://localhost/api/stores/st0002/broadcast-settings';
    const got = await route.GET(new Request(url), ctx('st0002'));
    expect(await got.json()).toMatchObject({ settings: { opt_out_keyword: '配信停止', automation_time: '10:00' }, line_quota: null });
    const put = (body: unknown) => route.PUT(new Request(url, { ...json(body), method: 'PUT' }), ctx('st0002'));
    const ok = await put({ monthly_limit: 50, over_limit: 'block', opt_out_keyword: '配信停止', opt_in_keyword: '配信再開', automation_time: '08:00' });
    expect((await ok.json()).settings).toMatchObject({ monthly_limit: 50, over_limit: 'block', automation_time: '08:00' });
    expect((await put({ monthly_limit: null, over_limit: 'confirm', opt_out_keyword: 'キャンセル', opt_in_keyword: '配信再開', automation_time: '08:00' })).status).toBe(400);
  });

  it('cron: local は認証なしで実行でき、結果の集計を返す', async () => {
    const route = await import('@/app/api/cron/broadcast-automations/route');
    const res = await route.POST(new Request('http://localhost/api/cron/broadcast-automations', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ checked: expect.any(Number), created: expect.any(Number), skipped: expect.any(Array) });
  });
});
