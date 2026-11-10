/**
 * LINE メッセージの分岐（local = JSON）の通し確認
 * 保存（postback への置き換え・対応表・ノードの送信用メッセージ）→ ボタンが押された（記録・タグ付け・次のメッセージ）→ 集計
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextLink, summarizeBranchAnswers } from '@/lib/line-flex-branch';
import type { ScenarioData } from '@/types/line-flex';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/line-flex-service');
let answers: typeof import('@/lib/line-flex-answers');

const origin = 'https://app.example.com';
const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const readJson = (name: string) => JSON.parse(fs.readFileSync(dataFile(name), 'utf-8'));

const scenario: ScenarioData = {
  color: '#06C755',
  root: {
    key: 'q0',
    title: '気になるメニューは？',
    choices: [
      { key: 'c1', label: 'カット', tags: ['興味:カット'], then: { type: 'question', question: { key: 'q1', title: '長さは？', choices: [{ key: 'c3', label: 'ロング', tags: ['ロング'], then: { type: 'result', result: { key: 'r1', title: 'おすすめはこちら', text: '説明', button: { key: 'b', label: '予約する', url: 'https://liff.line.me/1-a' } } } }] } } },
      { key: 'c2', label: 'クーポン', then: { type: 'message', message_id: 'couponcoupon' } },
    ],
  },
};

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-flex-branch-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: 'st0001', name: 'A店' }]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([{ id: 'cu1', store_id: 'st0001', name: '山田', line_user_id: 'U1', tags: ['既存'] }]));
  service = await import('@/lib/line-flex-service');
  answers = await import('@/lib/line-flex-answers');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('分岐アンケート（かんたんモード）', () => {
  it('保存すると、選択肢が postback になり、2 問目・結果の送信用メッセージができる', async () => {
    const coupon = await service.createLineFlexMessage('st0001', { id: 'couponcoupon', name: 'クーポン', template: 'coupon_card', alt_text: 'クーポン', data: { title: 'クーポン', highlight: '10% OFF', button: null } as never }, origin);
    expect(coupon.ok).toBe(true);
    const r = await service.createLineFlexMessage('st0001', { id: 'scenario0001', name: 'アンケート', template: 'scenario', alt_text: 'アンケート', keywords: ['診断'], data: scenario }, origin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.value;
    const rootButtons = ((m.payload as { contents: { footer: { contents: Array<{ action: Record<string, unknown> }> } } }).contents.footer.contents).map((b) => b.action);
    expect(rootButtons).toEqual([
      { type: 'postback', label: 'カット', data: 'lf:scenario0001:c1', displayText: 'カット' },
      { type: 'postback', label: 'クーポン', data: 'lf:scenario0001:c2', displayText: 'クーポン' },
    ]);
    expect(Object.keys(m.branches).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(m.branches.c1.next).toEqual({ type: 'node', key: 'q1' });
    expect(Object.keys(m.branch_payloads).sort()).toEqual(['q1', 'r1']);
    // 結果のカードの予約ボタンは計測リンクになる
    const resultButton = (m.branch_payloads.r1 as { contents: { footer: { contents: Array<{ action: { uri: string } }> } } }).contents.footer.contents[0].action;
    expect(resultButton.uri).toBe(`${origin}/go/scenario0001/1`);
    expect(m.links).toEqual({ '1': 'https://liff.line.me/1-a' });
  });

  it('ボタンが押されると、記録・タグ付けをして次のカードを返す', async () => {
    const q1 = await service.handleLineFlexPostback('st0001', 'U1', 'lf:scenario0001:c1');
    expect(q1).toHaveLength(1);
    expect((q1![0] as { altText: string }).altText).toBe('長さは？');
    const r1 = await service.handleLineFlexPostback('st0001', 'U1', 'lf:scenario0001:c3');
    expect((r1![0] as { altText: string }).altText).toBe('おすすめはこちら');
    // 保存済みの LINE メッセージを返す選択肢
    const coupon = await service.handleLineFlexPostback('st0001', 'U2', 'lf:scenario0001:c2');
    expect((coupon![0] as { altText: string }).altText).toBe('クーポン');

    const customers = readJson('customers.json') as Array<{ id: string; tags: string[] }>;
    expect(customers.find((c) => c.id === 'cu1')?.tags).toEqual(['既存', '興味:カット', 'ロング']);
    const rows = await answers.listLineFlexAnswers('st0001', 'scenario0001');
    expect(rows.map((x) => [x.button_key, x.question, x.label, x.line_user_id])).toEqual([
      ['c1', '気になるメニューは？', 'カット', 'U1'],
      ['c3', '長さは？', 'ロング', 'U1'],
      ['c2', '気になるメニューは？', 'クーポン', 'U2'],
    ]);
    const mine = await answers.listLineFlexAnswersByUser('st0001', 'U1');
    expect(mine.map((x) => x.label)).toEqual(expect.arrayContaining(['カット', 'ロング']));
    expect(await answers.listLineFlexAnswersByUser('st0002', 'U1')).toEqual([]);
  });

  it('集計: 質問ごとの回数と人数', async () => {
    const rows = await answers.listLineFlexAnswers('st0001', 'scenario0001');
    const saved = (readJson('line_flex_messages.json') as Array<{ id: string; branches: never }>).find((x) => x.id === 'scenario0001')!;
    const s = summarizeBranchAnswers(saved.branches, rows);
    expect(s.respondents).toBe(2);
    expect(s.groups.map((g) => [g.question, g.choices.map((c) => `${c.label}:${c.users}`)])).toEqual([
      ['気になるメニューは？', ['カット:1', 'クーポン:1']],
      ['長さは？', ['ロング:1']],
    ]);
  });

  it('対象外の data・他店舗・無効なメッセージ・無い選択肢は何も返さない', async () => {
    expect(await service.handleLineFlexPostback('st0001', 'U1', 'action=cancel')).toBeNull();
    expect(await service.handleLineFlexPostback('st0002', 'U1', 'lf:scenario0001:c1')).toBeNull();
    expect(await service.handleLineFlexPostback('st0001', 'U1', 'lf:scenario0001:nope')).toBeNull();
    const before = (await answers.listLineFlexAnswers('st0001', 'scenario0001')).length;
    expect(before).toBe(3);
  });
});

describe('くわしくモード（ボタンのリンク先 = 次のメッセージ）', () => {
  it('テンプレートのボタンに next: を入れると postback になり、押すと次のメッセージを返す', async () => {
    const r = await service.createLineFlexMessage(
      'st0001',
      { id: 'bookingbook1', name: '案内', template: 'booking_card', alt_text: '案内', show_choice_text: false, data: { title: '見出し', text: '本文', buttons: [{ key: '1', label: 'クーポンを見る', url: nextLink('couponcoupon', ['クーポン希望']) }, { key: '2', label: '予約', url: 'https://liff.line.me/1-a' }] } as never },
      origin
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const buttons = ((r.value.payload as { contents: { footer: { contents: Array<{ action: Record<string, unknown> }> } } }).contents.footer.contents).map((b) => b.action);
    expect(buttons[0]).toEqual({ type: 'postback', label: 'クーポンを見る', data: 'lf:bookingbook1:b1' });
    expect(buttons[1].uri).toBe(`${origin}/go/bookingbook1/1`);
    expect(r.value.branches).toEqual({ b1: { label: 'クーポンを見る', question: '', tags: ['クーポン希望'], next: { type: 'message', id: 'couponcoupon' } } });
    expect(r.value.show_choice_text).toBe(false);

    const reply = await service.handleLineFlexPostback('st0001', 'U1', 'lf:bookingbook1:b1');
    expect((reply![0] as { altText: string }).altText).toBe('クーポン');
    const customers = readJson('customers.json') as Array<{ id: string; tags: string[] }>;
    expect(customers.find((c) => c.id === 'cu1')?.tags).toContain('クーポン希望');
  });

  it('次に送るメッセージが無いと保存できない', async () => {
    const r = await service.createLineFlexMessage(
      'st0001',
      { name: '案内 2', template: 'booking_card', alt_text: '案内', data: { title: '見出し', text: '本文', buttons: [{ key: '1', label: '次へ', url: nextLink('nothere00000') }] } as never },
      origin
    );
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});
