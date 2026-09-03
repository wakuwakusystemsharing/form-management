/**
 * ローカル JSON モードのリポジトリ結合テスト
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LotteryConfig } from '@/types/lottery';

let tmpDir = '';
let originalCwd = '';
let repo: typeof import('@/lib/lottery-repository');

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lottery-repo-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'data', 'stores.json'), JSON.stringify([{ id: 'st1', name: '店' }]));
  repo = await import('@/lib/lottery-repository');
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const config = (): LotteryConfig => ({
  lottery_type: 'instant',
  redeem_method: 'code',
  basic_info: { title: 'くじ', liff_id: '', theme_color: '#000000' },
  prizes: [{ id: 'a', name: 'A', probability: 10, stock: 1 }],
  entry_rules: { limit: 'once', require_friend: false, when_sold_out: 'lose', pre_questions: [] },
  presentation: { animation: 'scratch', scratch_style: 'silver', show_probability: false, show_stock: false, confetti: true, win_title: 'w', lose_title: 'l' },
  messages: { win_text: 'w', lose_text: 'l', entry_text: 'e', push_flex_enabled: false },
  ui_settings: { submit_button_text: '抽選する', theme_color: '#000000' },
});

function newEntry(over: Record<string, unknown> = {}) {
  return {
    lottery_form_id: 'f1',
    store_id: 'st1',
    line_user_id: 'U1',
    line_display_name: '太郎',
    line_friend_flag: null,
    customer_id: null,
    prize_id: null,
    prize_name: null,
    is_win: false,
    is_consolation: false,
    redeem_code: null,
    qr_token: null,
    expires_at: null,
    status: 'lost' as const,
    redeemed_at: null,
    redeemed_by: null,
    redeemed_note: null,
    answers: null,
    user_agent: null,
    entered_at: new Date().toISOString(),
    ...over,
  };
}

describe('lottery-repository (local JSON)', () => {
  it('フォームの CRUD', async () => {
    const created = await repo.createLotteryForm({ id: 'f1', store_id: 'st1', config: config(), status: 'active' });
    expect(created.id).toBe('f1');
    expect(created.deferred_draw_status).toBe('accepting');
    expect(await repo.lotteryFormIdExists('f1')).toBe(true);
    expect(await repo.lotteryFormIdExists('nope')).toBe(false);

    const list = await repo.listLotteryForms('st1');
    expect(list.map((f) => f.id)).toEqual(['f1']);
    expect(await repo.listLotteryForms('other')).toEqual([]);

    const updated = await repo.updateLotteryForm('f1', { status: 'paused', config: { ...config(), basic_info: { title: '改', liff_id: '', theme_color: '#000000' } } });
    expect(updated?.status).toBe('paused');
    expect(updated?.config.basic_info.title).toBe('改');
    expect(await repo.updateLotteryForm('nope', { status: 'active' })).toBeNull();
  });

  it('insertLotteryEntryChecked: 回数上限と在庫を守る', async () => {
    const first = await repo.insertLotteryEntryChecked({
      form_id: 'f1', line_user_id: 'U1', prize_id: 'a', prize_stock: 1, window_start: null, max_entries: 1,
      entry: newEntry({ prize_id: 'a', prize_name: 'A', is_win: true, redeem_code: 'ABC234', status: 'drawn' }),
    });
    expect(first.ok).toBe(true);

    // 同じユーザーの 2 回目 → limit
    const second = await repo.insertLotteryEntryChecked({
      form_id: 'f1', line_user_id: 'U1', prize_id: null, prize_stock: null, window_start: null, max_entries: 1, entry: newEntry(),
    });
    expect(second).toEqual({ ok: false, reason: 'limit' });

    // 別ユーザーが在庫 1 の賞品に当たる → sold_out
    const third = await repo.insertLotteryEntryChecked({
      form_id: 'f1', line_user_id: 'U2', prize_id: 'a', prize_stock: 1, window_start: null, max_entries: 1,
      entry: newEntry({ line_user_id: 'U2', prize_id: 'a', status: 'drawn' }),
    });
    expect(third).toEqual({ ok: false, reason: 'sold_out' });

    // 存在しないフォーム → not_found
    const missing = await repo.insertLotteryEntryChecked({
      form_id: 'nope', line_user_id: 'U9', prize_id: null, prize_stock: null, window_start: null, max_entries: null, entry: newEntry({ lottery_form_id: 'nope' }),
    });
    expect(missing).toEqual({ ok: false, reason: 'not_found' });

    // window_start より前の参加はカウントしない
    const old = await repo.insertLotteryEntryChecked({
      form_id: 'f1', line_user_id: 'U3', prize_id: null, prize_stock: null, window_start: null, max_entries: null,
      entry: newEntry({ line_user_id: 'U3', entered_at: '2020-01-01T00:00:00Z' }),
    });
    expect(old.ok).toBe(true);
    const todayAgain = await repo.insertLotteryEntryChecked({
      form_id: 'f1', line_user_id: 'U3', prize_id: null, prize_stock: null, window_start: new Date('2026-01-01T00:00:00Z'), max_entries: 1,
      entry: newEntry({ line_user_id: 'U3' }),
    });
    expect(todayAgain.ok).toBe(true);
  });

  it('在庫カウント・ユーザー履歴・引換コード検索', async () => {
    expect(await repo.countPrizeEntries('f1')).toEqual({ a: 1 });
    const latest = await repo.findLatestUserEntry('f1', 'U1');
    expect(latest?.redeem_code).toBe('ABC234');
    expect(await repo.redeemCodeExists('st1', 'abc234')).toBe(true); // 大文字小文字を吸収
    expect(await repo.redeemCodeExists('st1', 'ZZZZZZ')).toBe(false);
    expect(await repo.getLotteryEntryByRedeemCode('other', 'ABC234')).toBeNull(); // 店舗境界
  });

  it('取り消しは在庫・回数から外れ、集計にも含まれない', async () => {
    const latest = await repo.findLatestUserEntry('f1', 'U1');
    const cancelled = await repo.updateLotteryEntry(latest!.id, { status: 'cancelled' });
    expect(cancelled?.status).toBe('cancelled');
    expect(await repo.countPrizeEntries('f1')).toEqual({});
    expect(await repo.findLatestUserEntry('f1', 'U1')).toBeNull();

    const retry = await repo.insertLotteryEntryChecked({
      form_id: 'f1', line_user_id: 'U1', prize_id: 'a', prize_stock: 1, window_start: null, max_entries: 1,
      entry: newEntry({ prize_id: 'a', prize_name: 'A', is_win: true, redeem_code: 'DEF567', status: 'drawn', expires_at: '2000-01-01T00:00:00Z' }),
    });
    expect(retry.ok).toBe(true);

    const stats = await repo.getLotteryFormStatsByStore('st1');
    expect(stats.f1.entries).toBe(3); // U1(再), U3 x2（cancelled は除外）
    expect(stats.f1.wins).toBe(1);
    expect(stats.f1.prize_counts).toEqual({ a: 1 });
  });

  it('一覧のフィルタ（status=expired / search / ページング）', async () => {
    const expired = await repo.listLotteryEntries({ storeId: 'st1', status: 'expired' });
    expect(expired.total).toBe(1);
    expect(expired.entries[0].effective_status).toBe('expired');
    expect(expired.entries[0].redeem_code).toBe('DEF567');

    const drawn = await repo.listLotteryEntries({ storeId: 'st1', status: 'drawn' });
    expect(drawn.total).toBe(0); // 唯一の当選は期限切れ

    const search = await repo.listLotteryEntries({ storeId: 'st1', search: 'def' });
    expect(search.total).toBe(1);

    const all = await repo.listLotteryEntries({ storeId: 'st1', status: 'all', limit: 2, offset: 0 });
    expect(all.total).toBe(4); // cancelled 含む
    expect(all.entries).toHaveLength(2);
    const page2 = await repo.listLotteryEntries({ storeId: 'st1', status: 'all', limit: 2, offset: 2 });
    expect(page2.entries).toHaveLength(2);
    expect(new Set([...all.entries, ...page2.entries].map((e) => e.id)).size).toBe(4);

    const byForm = await repo.listLotteryEntries({ storeId: 'st1', formId: 'nope' });
    expect(byForm.total).toBe(0);
  });

  it('フォーム削除で履歴もカスケード削除', async () => {
    const deleted = await repo.deleteLotteryForm('f1');
    expect(deleted?.id).toBe('f1');
    expect(await repo.getLotteryForm('f1')).toBeNull();
    expect(await repo.listEntriesForForm('f1')).toEqual([]);
    expect(await repo.deleteLotteryForm('f1')).toBeNull();
  });
});
