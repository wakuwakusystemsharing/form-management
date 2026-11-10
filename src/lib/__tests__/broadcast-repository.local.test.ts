/**
 * 配信機能のデータアクセス（local = JSON）の動作確認
 * 配信の保存 → 宛先の確定 → 月間通数、店舗設定、スタンプ、判定用データの読み込み、配信停止
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCustomerFacts, normalizeAudience, selectAudience } from '@/lib/broadcast-audience';
import type { Broadcast } from '@/types/broadcast';

let tmpDir = '';
let originalCwd = '';
let repo: typeof import('@/lib/broadcast-repository');

const dataFile = (name: string) => path.join(tmpDir, 'data', name);

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broadcast-repo-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: 'st0001', name: 'A店' }, { id: 'st0002', name: 'B店', broadcast_monthly_limit: 300 }]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([
    { id: 'c1', store_id: 'st0001', name: '山田', line_user_id: 'U1', line_friend_flag: true, tags: ['カラー'], total_visits: 3 },
    { id: 'c2', store_id: 'st0001', name: '佐藤', line_user_id: 'U2', line_friend_flag: true, tags: [] },
    { id: 'c3', store_id: 'st0001', name: '電話のみ', line_user_id: null },
    { id: 'x1', store_id: 'st0002', name: '他店', line_user_id: 'U9' },
  ]));
  fs.writeFileSync(dataFile('reservations.json'), JSON.stringify([
    { id: 'r1', store_id: 'st0001', customer_id: 'c2', form_id: 'f1', reservation_date: '2026-10-01', status: 'confirmed', selected_menus: [{ menu_name: 'カット' }] },
    { id: 'r2', store_id: 'st0002', customer_id: 'x1', form_id: 'f9', reservation_date: '2026-10-01', status: 'confirmed', selected_menus: [{ menu_name: 'カット' }] },
  ]));
  fs.writeFileSync(dataFile('customer_visits.json'), JSON.stringify([{ id: 'v1', customer_id: 'c1', visit_date: '2026-09-01', treatment_menus: [{ menu_name: 'カラー' }] }, { id: 'v2', customer_id: 'x1', visit_date: '2026-09-01', treatment_menus: [] }]));
  fs.writeFileSync(dataFile('survey_responses.json'), JSON.stringify([{ id: 's1', store_id: 'st0001', survey_form_id: 'sv1', line_user_id: 'U1', responses: { Q: 'はい' } }]));
  repo = await import('@/lib/broadcast-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function draft(id: string, storeId = 'st0001'): Broadcast {
  const now = new Date().toISOString();
  return {
    id, store_id: storeId, name: 'テスト配信', status: 'draft', audience: {}, items: [{ key: 'a', type: 'text', text: 'こんにちは' }], payloads: [{ type: 'text', text: 'こんにちは' }],
    has_personalization: false, track_taps: true, links: {}, tap_counts: {}, scheduled_at: null, claimed_at: null, started_at: null, finished_at: null,
    recipient_count: 0, sent_count: 0, failed_count: 0, error: null, automation_id: null, created_by: null, created_at: now, updated_at: now,
  };
}

describe('配信の保存・更新・削除（local）', () => {
  it('店舗ごとに分かれ、更新・削除できる', async () => {
    const id = repo.newBroadcastId();
    await repo.insertBroadcast(draft(id));
    await repo.insertBroadcast(draft(repo.newBroadcastId(), 'st0002'));
    expect((await repo.listBroadcasts('st0001')).map((b) => b.id)).toEqual([id]);
    expect(await repo.getBroadcast('st0002', id)).toBeNull();

    const updated = await repo.updateBroadcast('st0001', id, { name: '改名', status: 'scheduled', scheduled_at: '2026-11-20T10:00:00.000Z' });
    expect(updated).toMatchObject({ name: '改名', status: 'scheduled' });
    expect(await repo.updateBroadcast('st0002', id, { name: 'x' })).toBeNull();

    expect(await repo.deleteBroadcast('st0002', id)).toBe(false);
    expect(await repo.deleteBroadcast('st0001', id)).toBe(true);
    expect(await repo.listBroadcasts('st0001')).toEqual([]);
  });

  it('宛先を確定し、送信済みの行だけを月間通数に数える', async () => {
    const id = repo.newBroadcastId();
    await repo.insertBroadcast(draft(id));
    expect(await repo.replaceBroadcastRecipients('st0001', id, [{ customer_id: 'c1', line_user_id: 'U1', display_name: '山田' }, { customer_id: 'c2', line_user_id: 'U2', display_name: null }])).toBe(2);
    // 入れ替え（同じ配信の宛先は置き換わる）
    await repo.replaceBroadcastRecipients('st0001', id, [{ customer_id: 'c1', line_user_id: 'U1', display_name: '山田' }, { customer_id: 'c2', line_user_id: 'U2', display_name: null }]);
    const list = await repo.listBroadcastRecipients(id);
    expect(list.total).toBe(2);
    expect(list.recipients.every((r) => r.status === 'pending')).toBe(true);
    expect(await repo.countMonthlySent('st0001')).toBe(0);

    // 1 件を送信済みにする（Edge Function の代わりにファイルを書き換える）
    const file = dataFile('broadcast_data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    data.recipients[0].status = 'sent';
    data.recipients[0].sent_at = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(data));
    expect(await repo.countMonthlySent('st0001')).toBe(1);
    expect(await repo.countMonthlySent('st0002')).toBe(0);
    expect((await repo.listBroadcastRecipients(id, { status: 'sent' })).total).toBe(1);
    // 先月として数えると 0
    expect(await repo.countMonthlySent('st0001', new Date(Date.now() + 40 * 24 * 60 * 60 * 1000))).toBe(0);
  });
});

describe('店舗設定・スタンプ・自動配信（local）', () => {
  it('設定は既定値で読め、保存すると stores.json に入る', async () => {
    expect(await repo.getBroadcastSettings('st0001')).toEqual({ monthly_limit: null, over_limit: 'confirm', opt_out_keyword: '配信停止', opt_in_keyword: '配信再開', automation_time: '10:00' });
    expect((await repo.getBroadcastSettings('st0002')).monthly_limit).toBe(300);
    await repo.updateBroadcastSettings('st0001', { monthly_limit: 200, over_limit: 'block', opt_out_keyword: '停止', opt_in_keyword: '再開', automation_time: '09:00' });
    expect(await repo.getBroadcastSettings('st0001')).toEqual({ monthly_limit: 200, over_limit: 'block', opt_out_keyword: '停止', opt_in_keyword: '再開', automation_time: '09:00' });
    await expect(repo.updateBroadcastSettings('nope', await repo.getBroadcastSettings('st0001'))).rejects.toThrow();
  });

  it('スタンプは自店舗の分だけ削除できる', async () => {
    const s = await repo.insertBroadcastSticker({ store_id: 'st0001', label: 'ありがとう', url: 'https://cdn/a.png' });
    expect(s.preview_url).toBe('https://cdn/a.png');
    expect((await repo.listBroadcastStickers('st0001')).map((x) => x.id)).toEqual([s.id]);
    expect(await repo.listBroadcastStickers('st0002')).toEqual([]);
    expect(await repo.deleteBroadcastSticker('st0002', s.id)).toBe(false);
    expect(await repo.deleteBroadcastSticker('st0001', s.id)).toBe(true);
  });

  it('自動配信ルールの保存・更新・削除', async () => {
    const now = new Date().toISOString();
    const id = repo.newBroadcastId();
    const row = { id, store_id: 'st0001', name: '休眠', enabled: false, trigger: { type: 'dormant' as const, days: 90 }, audience: {}, items: [], payloads: null, has_personalization: false, resend_after_days: 180, created_at: now, updated_at: now };
    await repo.upsertBroadcastAutomation(row);
    await repo.upsertBroadcastAutomation({ ...row, enabled: true });
    const list = await repo.listBroadcastAutomations('st0001');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ enabled: true, trigger: { type: 'dormant', days: 90 }, resend_after_days: 180 });
    expect(await repo.getBroadcastAutomation('st0002', id)).toBeNull();
    expect(await repo.deleteBroadcastAutomation('st0001', id)).toBe(true);
  });
});

describe('判定用データと配信停止（local）', () => {
  it('自店舗の顧客・予約・来店・アンケートだけを読み、条件で選べる', async () => {
    const src = await repo.loadAudienceSource('st0001');
    expect(src.customers.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(src.reservations).toHaveLength(1);
    expect(src.visits).toHaveLength(1);
    expect(src.surveys).toHaveLength(1);
    const now = new Date('2026-11-10T03:00:00Z');
    const facts = buildCustomerFacts({ ...src, today: '2026-11-10' });
    expect(selectAudience(src.customers, facts, normalizeAudience({ menus: { names: ['カット'] } }), now).recipients.map((c) => c.id)).toEqual(['c2']);
    expect(selectAudience(src.customers, facts, normalizeAudience({ survey: { form_id: 'sv1', question: 'Q', options: ['はい'] } }), now).recipients.map((c) => c.id)).toEqual(['c1']);
    const all = selectAudience(src.customers, facts, {}, now);
    expect(all.recipients).toHaveLength(2);
    expect(all.excluded_no_line).toBe(1);
    // 不要なデータは読まない
    const light = await repo.loadAudienceSource('st0001', {});
    expect(light.reservations).toEqual([]);
    expect(light.customers).toHaveLength(3);
  });

  it('配信停止すると対象から外れ、再開で戻る', async () => {
    expect(await repo.setLineOptOut('st0001', 'U1', true)).toBe(1);
    expect(await repo.setLineOptOut('st0001', 'Unobody', true)).toBe(0);
    let src = await repo.loadAudienceSource('st0001', {});
    let sel = selectAudience(src.customers, new Map(), {}, new Date());
    expect(sel.recipients.map((c) => c.id)).toEqual(['c2']);
    expect(sel.excluded_opt_out).toBe(1);
    expect(await repo.setLineOptOut('st0001', 'U1', false)).toBe(1);
    src = await repo.loadAudienceSource('st0001', {});
    sel = selectAudience(src.customers, new Map(), {}, new Date());
    expect(sel.recipients.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
