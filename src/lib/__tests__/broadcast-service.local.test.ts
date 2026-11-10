/**
 * 配信の業務ロジック（local = JSON）の動作確認
 * 下書き保存 → 見積り → 予約（対象者の確定・上限ガード・2 段階確認）→ 取り消し → 複製 → 削除、選択肢の抽出、配信停止コマンド
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formOptionsFromForms, menuNamesFromForms, surveyChoicesFromForms } from '@/lib/broadcast-options';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/broadcast-service');
let repo: typeof import('@/lib/broadcast-repository');
let optOut: typeof import('@/lib/broadcast-opt-out');

const origin = 'https://app.example.com';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const lineId = (n: number) => `U${String(n).padStart(32, '0')}`;

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broadcast-service-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([
    { id: 'st0001', name: 'A店', line_channel_access_token: 'token-a' },
    { id: 'st0002', name: 'トークンなし' },
    { id: 'st0003', name: '大人数', line_channel_access_token: 'token-c' },
    { id: 'st0005', name: '未確認の店', line_channel_access_token: 'token-e' },
  ]));
  const many = Array.from({ length: 101 }, (_, i) => ({ id: `m${i}`, store_id: 'st0003', name: `客${i}`, line_user_id: lineId(1000 + i), line_friend_flag: true }));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([
    { id: 'c1', store_id: 'st0001', name: '山田 花子', line_user_id: lineId(1), line_friend_flag: true, tags: ['カラー'] },
    { id: 'c2', store_id: 'st0001', name: '未記入', line_display_name: 'さとう', line_user_id: lineId(2), line_friend_flag: true, tags: [] },
    { id: 'c3', store_id: 'st0001', name: 'ブロック', line_user_id: lineId(3), line_friend_flag: false, line_blocked_at: '2026-10-01T00:00:00Z', tags: ['カラー'] },
    { id: 'c5', store_id: 'st0005', name: '友だち未確認', line_user_id: lineId(5), line_friend_flag: false, tags: [] },
    { id: 'c4', store_id: 'st0002', name: '他店', line_user_id: lineId(4), line_friend_flag: true },
    ...many,
  ]));
  fs.writeFileSync(dataFile('line_flex_messages.json'), JSON.stringify([
    {
      id: 'abcdefghij12', store_id: 'st0001', name: 'メニュー案内', template: 'custom', data: {}, flex_override: null, alt_text: 'メニュー', keywords: [],
      attach_confirm: false, attach_reminder: false, attach_follow: false, enabled: true, track_taps: true, items: [{ key: 'main', type: 'main' }],
      payload: { type: 'flex', altText: 'メニュー', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'menu' }] } } },
      payloads: null, links: {}, reply_count: 0, tap_counts: {}, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    },
  ]));
  service = await import('@/lib/broadcast-service');
  repo = await import('@/lib/broadcast-repository');
  optOut = await import('@/lib/broadcast-opt-out');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('下書きの保存', () => {
  it('名前が必須。メッセージ 0 件でも下書きは保存できる', async () => {
    expect(await service.createBroadcast('st0001', { name: ' ' }, origin, null)).toMatchObject({ ok: false, status: 400 });
    const r = await service.createBroadcast('st0001', { name: '空の下書き' }, origin, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ status: 'draft', items: [], payloads: [], recipient_count: 0 });
    expect(service.isBroadcastId(r.value.id)).toBe(true);
  });

  it('保存済み LINE メッセージ + テキスト（{name}）から送信用メッセージを作る。無い参照先は 400', async () => {
    const r = await service.createBroadcast(
      'st0001',
      { name: '案内', audience: { tags: { mode: 'any', values: ['カラー'] } }, items: [{ key: 'a', type: 'text', text: '{name}さんへ' }, { key: 'b', type: 'ref', message_id: 'abcdefghij12' }] },
      origin,
      null
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.payloads?.map((p) => p.type)).toEqual(['text', 'flex']);
    expect(r.value.has_personalization).toBe(true);
    expect(r.value.audience).toEqual({ tags: { mode: 'any', values: ['カラー'] } });

    const bad = await service.createBroadcast('st0001', { name: 'x', items: [{ key: 'a', type: 'ref', message_id: 'zzzzzzzzzzzz' }] }, origin, null);
    expect(bad).toMatchObject({ ok: false, status: 400 });
  });
});

describe('見積り', () => {
  it('条件に合う人数と、除外した人数・今月の通数を返す', async () => {
    const all = await service.estimateAudience('st0001', {});
    expect(all).toMatchObject({ count: 2, excluded_blocked: 1, excluded_opt_out: 0, unfiltered: true });
    expect(all.sample.map((s) => s.name)).toEqual(['山田 花子', 'さとう']);
    expect(all.quota).toMatchObject({ used: 0, limit: null, exceeds: false });
    const tagged = await service.estimateAudience('st0001', { tags: { values: ['カラー'] } });
    expect(tagged).toMatchObject({ count: 1, excluded_blocked: 1, unfiltered: false });
    const list = await service.listAudience('st0001', {}, 1, 10);
    expect(list).toEqual({ total: 2, customers: [{ id: 'c2', name: 'さとう' }] });
  });
});

describe('友だち追加の記録が無い顧客', () => {
  it('配信先に含め、未確認の人数として返す（友だち追加が予約より先だった人などが外れないように）', async () => {
    const est = await service.estimateAudience('st0005', {});
    expect(est).toMatchObject({ count: 1, excluded_blocked: 0, unverified: 1 });
    const created = await service.createBroadcast('st0005', { name: '未確認へ', items: [{ key: 'a', type: 'text', text: 'hi' }] }, origin, null);
    if (!created.ok) throw new Error('setup');
    // local では LINE への確認は行わず、そのまま宛先に入る
    expect(await service.scheduleBroadcast('st0005', created.value.id, {}, origin)).toMatchObject({ ok: true, value: { broadcast: { recipient_count: 1 } } });
  });
});

describe('予約・取り消し・複製・削除', () => {
  it('メッセージが無い / 配信先 0 人 / トークン未設定 / 過去の日時 は予約できない', async () => {
    const empty = await service.createBroadcast('st0001', { name: '空' }, origin, null);
    if (!empty.ok) throw new Error('setup');
    expect(await service.scheduleBroadcast('st0001', empty.value.id, {}, origin)).toMatchObject({ ok: false, status: 400 });

    const nobody = await service.createBroadcast('st0001', { name: '0 人', audience: { tags: { mode: 'any', values: ['いない'] } }, items: [{ key: 'a', type: 'text', text: 'hi' }] }, origin, null);
    if (!nobody.ok) throw new Error('setup');
    expect(await service.scheduleBroadcast('st0001', nobody.value.id, {}, origin)).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('0 人') });

    const noToken = await service.createBroadcast('st0002', { name: 'トークンなし', items: [{ key: 'a', type: 'text', text: 'hi' }] }, origin, null);
    if (!noToken.ok) throw new Error('setup');
    expect(await service.scheduleBroadcast('st0002', noToken.value.id, {}, origin)).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('トークン') });

    const past = await service.createBroadcast('st0001', { name: '過去', items: [{ key: 'a', type: 'text', text: 'hi' }] }, origin, null);
    if (!past.ok) throw new Error('setup');
    expect(await service.scheduleBroadcast('st0001', past.value.id, { scheduled_at: '2020-01-01T00:00:00Z' }, origin)).toMatchObject({ ok: false, status: 400 });
  });

  it('日時指定で予約すると対象者が確定し、編集・削除はできない。取り消すと下書きに戻る', async () => {
    const created = await service.createBroadcast('st0001', { name: '予約', items: [{ key: 'a', type: 'text', text: '{name}さん' }] }, origin, null);
    if (!created.ok) throw new Error('setup');
    const id = created.value.id;
    const at = new Date(Date.now() + 3600 * 1000).toISOString();
    const r = await service.scheduleBroadcast('st0001', id, { scheduled_at: at }, origin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.immediate).toBe(false);
    expect(r.value.broadcast).toMatchObject({ status: 'scheduled', scheduled_at: at, recipient_count: 2, has_personalization: true });
    const recipients = await repo.listBroadcastRecipients(id);
    expect(recipients.recipients.map((x) => [x.customer_id, x.display_name, x.status])).toEqual([['c1', '山田 花子', 'pending'], ['c2', 'さとう', 'pending']]);

    expect(await service.saveBroadcast('st0001', id, { name: '変更' }, origin)).toMatchObject({ ok: false, status: 409 });
    expect(await service.removeBroadcast('st0001', id)).toMatchObject({ ok: false, status: 409 });
    expect(await service.scheduleBroadcast('st0001', id, {}, origin)).toMatchObject({ ok: false, status: 409 });

    const cancelled = await service.cancelBroadcast('st0001', id);
    expect(cancelled).toMatchObject({ ok: true, value: { status: 'draft', scheduled_at: null, recipient_count: 0 } });
    expect((await repo.listBroadcastRecipients(id)).total).toBe(0);
    expect(await service.cancelBroadcast('st0001', id)).toMatchObject({ ok: false, status: 409 });

    // 下書きに戻ったので編集・複製・削除できる
    expect(await service.saveBroadcast('st0001', id, { name: '変更後' }, origin)).toMatchObject({ ok: true, value: { name: '変更後' } });
    const copy = await service.duplicateBroadcast('st0001', id, origin, null);
    expect(copy).toMatchObject({ ok: true, value: { name: '変更後（コピー）', status: 'draft' } });
    expect(await service.removeBroadcast('st0001', id)).toEqual({ ok: true, value: true });
    expect(await service.removeBroadcast('st0002', id)).toMatchObject({ ok: false, status: 404 });
  });

  it('月間上限: block は送れない / confirm は確認が必要', async () => {
    const created = await service.createBroadcast('st0001', { name: '上限', items: [{ key: 'a', type: 'text', text: 'hi' }] }, origin, null);
    if (!created.ok) throw new Error('setup');
    const id = created.value.id;
    const base = await repo.getBroadcastSettings('st0001');
    await repo.updateBroadcastSettings('st0001', { ...base, monthly_limit: 1, over_limit: 'block' });
    expect(await service.scheduleBroadcast('st0001', id, { confirmed: true }, origin)).toMatchObject({ ok: false, status: 409, code: 'over_limit' });
    await repo.updateBroadcastSettings('st0001', { ...base, monthly_limit: 1, over_limit: 'confirm' });
    expect(await service.scheduleBroadcast('st0001', id, {}, origin)).toMatchObject({ ok: false, status: 409, code: 'needs_confirm' });
    const ok = await service.scheduleBroadcast('st0001', id, { confirmed: true }, origin);
    expect(ok).toMatchObject({ ok: true, value: { immediate: true, broadcast: { status: 'scheduled', recipient_count: 2 } } });
    await repo.updateBroadcastSettings('st0001', { ...base, monthly_limit: null, over_limit: 'confirm' });
  });

  it('100 人を超える配信は 2 段階確認が必要', async () => {
    const created = await service.createBroadcast('st0003', { name: '大人数', items: [{ key: 'a', type: 'text', text: 'hi' }] }, origin, null);
    if (!created.ok) throw new Error('setup');
    expect(await service.scheduleBroadcast('st0003', created.value.id, {}, origin)).toMatchObject({ ok: false, status: 409, code: 'needs_double_confirm' });
    expect(await service.scheduleBroadcast('st0003', created.value.id, { double_confirmed: true }, origin)).toMatchObject({ ok: true, value: { broadcast: { recipient_count: 101 } } });
  });

  it('概要: 設定・今月の通数・配信停止数・トークンの有無', async () => {
    expect(await service.getBroadcastOverview('st0001')).toMatchObject({ used: 0, opt_out_count: 0, token_set: true });
    expect(await service.getBroadcastOverview('st0002')).toMatchObject({ token_set: false });
  });
});

describe('配信停止 / 再開コマンド（Webhook）', () => {
  it('キーワードが完全一致したときだけ処理し、返信文を返す', async () => {
    expect(await optOut.handleBroadcastOptCommand('st0001', lineId(1), 'こんにちは')).toBeNull();
    expect(await optOut.handleBroadcastOptCommand('st0001', lineId(1), '【予約フォーム】…')).toBeNull();
    const stop = await optOut.handleBroadcastOptCommand('st0001', lineId(1), ' 配信停止 ');
    expect(stop).toContain('配信を停止しました');
    expect(stop).toContain('配信再開');
    expect(await service.estimateAudience('st0001', {})).toMatchObject({ count: 1, excluded_opt_out: 1 });
    expect((await service.getBroadcastOverview('st0001')).opt_out_count).toBe(1);
    const resume = await optOut.handleBroadcastOptCommand('st0001', lineId(1), '配信再開');
    expect(resume).toContain('配信を再開しました');
    expect(await service.estimateAudience('st0001', {})).toMatchObject({ count: 2, excluded_opt_out: 0 });
  });
});

describe('条件の選択肢（broadcast-options）', () => {
  it('予約フォームからメニュー名（サブメニューは「メニュー > サブ」）とフォーム名', () => {
    const forms = [
      { id: 'f1', config: { basic_info: { form_name: 'カット予約' }, menu_structure: { categories: [{ menus: [{ name: 'カット', sub_menu_items: [{ name: 'ショート' }, { name: '' }] }, { name: 'カラー' }] }] } } },
      { id: 'f2', form_name: '旧形式', config: JSON.stringify({ menu_structure: { categories: [{ menus: [{ name: 'カット' }, { name: 'パーマ' }] }] } }) },
      null,
    ];
    expect(menuNamesFromForms(forms)).toEqual(['カット', 'カット > ショート', 'カラー', 'パーマ']);
    expect(formOptionsFromForms(forms)).toEqual([{ id: 'f1', name: 'カット予約' }, { id: 'f2', name: '旧形式' }]);
  });
  it('アンケートから選択式の質問と選択肢', () => {
    const surveys = [
      { id: 's1', config: { basic_info: { title: '来店アンケート' }, questions: [
        { type: 'radio', title: '満足度', options: [{ label: '満足', value: 'a' }, { label: '不満', value: 'b' }] },
        { type: 'text', title: '感想' },
        { type: 'checkbox', title: '選択肢なし', options: [] },
      ] } },
      { id: 's2', config: { questions: [{ type: 'text', title: '自由記述' }] } },
    ];
    expect(surveyChoicesFromForms(surveys)).toEqual([{ form_id: 's1', form_name: '来店アンケート', questions: [{ title: '満足度', options: ['満足', '不満'] }] }]);
  });
});
