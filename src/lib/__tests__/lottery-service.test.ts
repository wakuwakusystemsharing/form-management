import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LotteryEntry, LotteryForm } from '@/types/lottery';

// ---- 依存モジュールをモック（DB / LINE / 顧客連携に触れない） ----
const repo = vi.hoisted(() => ({
  countPrizeEntries: vi.fn(),
  findLatestUserEntry: vi.fn(),
  insertLotteryEntryChecked: vi.fn(),
  redeemCodeExists: vi.fn(),
  updateLotteryEntry: vi.fn(),
}));
const customers = vi.hoisted(() => ({
  findCustomerByLineOrPhone: vi.fn(),
  createCustomer: vi.fn(),
}));
const push = vi.hoisted(() => ({ pushLineMessages: vi.fn() }));

vi.mock('@/lib/lottery-repository', () => repo);
vi.mock('@/lib/customer-utils', () => customers);
vi.mock('@/lib/line-push', () => push);

import { normalizeLotteryConfig, normalizeLotteryForm } from '@/lib/lottery-normalizer';
import {
  executeLotteryDraw,
  findMissingRequiredAnswers,
  validateLotteryConfigForSave,
  type LotteryStoreInfo,
} from '@/lib/lottery-service';

const store: LotteryStoreInfo = { id: 'st1', name: 'テスト店', line_channel_id: null, line_channel_access_token: null };
const user = { userId: 'U123', displayName: '太郎' };
const now = new Date('2026-09-10T03:00:00Z'); // 12:00 JST

function makeForm(overrides: Record<string, unknown> = {}, configOverrides: Record<string, unknown> = {}): LotteryForm {
  return normalizeLotteryForm({
    id: 'form1',
    store_id: 'st1',
    status: 'active',
    config: {
      basic_info: { title: 'くじ', liff_id: 'liff', theme_color: '#123456' },
      prizes: [
        { id: 'a', name: 'A賞', description: '30% OFF', probability: 10, stock: 1, expires_in_days: 30 },
        { id: 'b', name: 'B賞', probability: 20, stock: null },
      ],
      entry_rules: { limit: 'once', require_friend: false, when_sold_out: 'lose', pre_questions: [] },
      ...configOverrides,
    },
    ...overrides,
  });
}

/** insertLotteryEntryChecked のデフォルト: 渡された entry をそのまま保存成功として返す */
function acceptInsert() {
  repo.insertLotteryEntryChecked.mockImplementation(async (params: { entry: Record<string, unknown> }) => ({
    ok: true,
    entry: { ...params.entry, id: 'e1', message_sent: false, push_sent: false, created_at: 'x', updated_at: 'x' } as LotteryEntry,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.countPrizeEntries.mockResolvedValue({});
  repo.findLatestUserEntry.mockResolvedValue(null);
  repo.redeemCodeExists.mockResolvedValue(false);
  repo.updateLotteryEntry.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ id: 'e1', ...patch }));
  customers.findCustomerByLineOrPhone.mockResolvedValue({ id: 'cust1' });
  push.pushLineMessages.mockResolvedValue({ ok: true, status: 200, body: '' });
  acceptInsert();
});

describe('validateLotteryConfigForSave', () => {
  it('正常な設定はエラーなし', () => {
    expect(validateLotteryConfigForSave(makeForm().config)).toEqual([]);
  });
  it('タイトル必須・後日抽選は締切必須・期間の前後関係', () => {
    const c = normalizeLotteryConfig({
      lottery_type: 'deferred',
      basic_info: { title: '', period: { start_at: '2026-09-30T00:00:00+09:00', end_at: '2026-09-01T00:00:00+09:00' } },
      prizes: [{ id: 'a', name: 'A', probability: 0, stock: 1 }],
    });
    const errors = validateLotteryConfigForSave(c);
    expect(errors).toContain('タイトルを入力してください');
    expect(errors).toContain('受付期間の開始日時が終了日時より後になっています');
    expect(errors.some((e) => e.includes('応募締切'))).toBe(false); // end_at はある
    const noEnd = validateLotteryConfigForSave(normalizeLotteryConfig({ lottery_type: 'deferred', basic_info: { title: 'T' }, prizes: [{ id: 'a', name: 'A', stock: 1 }] }));
    expect(noEnd).toContain('後日抽選では応募締切（受付期間の終了日時）が必須です');
  });
  it('事前質問の ID 重複・タイトル未入力', () => {
    const c = normalizeLotteryConfig({
      basic_info: { title: 'T' },
      prizes: [{ id: 'a', name: 'A', probability: 1, stock: null }],
      entry_rules: { pre_questions: [{ id: 'q1', type: 'text', title: '', required: true }, { id: 'q1', type: 'text', title: 'x', required: false }] },
    });
    const errors = validateLotteryConfigForSave(c);
    expect(errors).toContain('事前質問のタイトルを入力してください');
    expect(errors).toContain('事前質問の ID が重複しています（q1）');
  });
});

describe('findMissingRequiredAnswers', () => {
  const questions = [
    { id: 'q1', type: 'text' as const, title: 'お名前', required: true },
    { id: 'q2', type: 'checkbox' as const, title: '希望', required: true },
    { id: 'q3', type: 'text' as const, title: '任意', required: false },
  ];
  it('ID でもタイトルでも回答を認識する', () => {
    expect(findMissingRequiredAnswers(questions, { q1: '太郎', 希望: ['a'] })).toEqual([]);
    expect(findMissingRequiredAnswers(questions, { お名前: '太郎', q2: ['a'] })).toEqual([]);
  });
  it('空文字・空配列・未回答は不足扱い', () => {
    expect(findMissingRequiredAnswers(questions, { q1: '  ', q2: [] })).toEqual(['お名前', '希望']);
    expect(findMissingRequiredAnswers(questions, null)).toEqual(['お名前', '希望']);
  });
});

describe('executeLotteryDraw（即時抽選）', () => {
  it('当選: 引換コード・有効期限・顧客紐付けが行われ、結果テキストが返る', async () => {
    const form = makeForm();
    const outcome = await executeLotteryDraw({ form, store, user, lineFriendFlag: true, answers: null, userAgent: 'ua', now, rng: () => 0.05 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe(201);
    expect(outcome.response.entry.prize_id).toBe('a');
    expect(outcome.response.entry.is_win).toBe(true);
    expect(outcome.response.entry.redeem_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(outcome.response.entry.qr_token).toBeNull();
    expect(outcome.response.entry.expires_at).toBe('2026-10-10T14:59:59.999Z');
    expect(outcome.response.message_text).toContain('結果：A賞「30% OFF」');
    expect(outcome.response.is_existing).toBe(false);
    // 在庫 1 の賞品なので insert に stock=1 が渡る
    expect(repo.insertLotteryEntryChecked).toHaveBeenCalledWith(expect.objectContaining({ prize_id: 'a', prize_stock: 1, max_entries: 1, window_start: null }));
    expect(repo.updateLotteryEntry).toHaveBeenCalledWith('e1', { customer_id: 'cust1' });
    expect(push.pushLineMessages).not.toHaveBeenCalled(); // push 無効
  });

  it('はずれ: 賞品なし・status=lost・lose_text', async () => {
    const outcome = await executeLotteryDraw({ form: makeForm(), store, user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.95 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.entry.status).toBe('lost');
    expect(outcome.response.entry.prize_id).toBeNull();
    expect(outcome.response.message_text).toContain('結果：はずれ');
  });

  it('はずれ + 残念賞: 残念賞として引換コードを発行', async () => {
    const form = makeForm({}, { consolation_prize: { id: 'zan', name: '残念賞', probability: 0, stock: null } });
    const outcome = await executeLotteryDraw({ form, store, user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.95 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.entry.status).toBe('drawn');
    expect(outcome.response.entry.is_win).toBe(false);
    expect(outcome.response.entry.is_consolation).toBe(true);
    expect(outcome.response.entry.prize_id).toBe('zan');
    expect(outcome.response.entry.redeem_code).toHaveLength(6);
  });

  it('QR 方式なら qr_token を発行し、push 有効 + トークンありなら Flex を送って push_sent を立てる', async () => {
    const form = makeForm({}, { redeem_method: 'qr', messages: { push_flex_enabled: true } });
    const outcome = await executeLotteryDraw({
      form,
      store: { ...store, line_channel_access_token: 'tok' },
      user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.05,
      qrImageUrlBuilder: (t) => `https://x/qr/${t}.png`,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.entry.qr_token).toMatch(/^[a-z0-9]{32}$/);
    expect(push.pushLineMessages).toHaveBeenCalledTimes(1);
    const [token, to, messages] = push.pushLineMessages.mock.calls[0];
    expect(token).toBe('tok');
    expect(to).toBe('U123');
    expect(messages[0].type).toBe('flex');
    expect(JSON.stringify(messages[0])).toContain('https://x/qr/');
    expect(repo.updateLotteryEntry).toHaveBeenCalledWith('e1', { push_sent: true });
  });

  it('はずれには push しない', async () => {
    const form = makeForm({}, { messages: { push_flex_enabled: true } });
    await executeLotteryDraw({ form, store: { ...store, line_channel_access_token: 'tok' }, user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.95 });
    expect(push.pushLineMessages).not.toHaveBeenCalled();
  });

  it('参加済み（once）は 409 と前回結果を返し、insert を呼ばない', async () => {
    const previous = { id: 'prev', lottery_form_id: 'form1', store_id: 'st1', line_user_id: 'U123', status: 'lost', is_win: false, is_consolation: false, prize_id: null, prize_name: null, redeem_code: null, qr_token: null, expires_at: null, entered_at: '2026-09-01T00:00:00Z', line_display_name: '太郎' } as unknown as LotteryEntry;
    repo.findLatestUserEntry.mockResolvedValue(previous);
    const outcome = await executeLotteryDraw({ form: makeForm(), store, user, lineFriendFlag: null, answers: null, userAgent: null, now });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(409);
    expect(outcome.error).toBe('この抽選にはすでに参加済みです');
    expect(outcome.existing?.entry.id).toBe('prev');
    expect(outcome.existing?.is_existing).toBe(true);
    expect(repo.insertLotteryEntryChecked).not.toHaveBeenCalled();
  });

  it('daily: 前日の参加は今日の参加を妨げない', async () => {
    const previous = { id: 'prev', status: 'lost', entered_at: '2026-09-09T05:00:00Z', line_display_name: null } as unknown as LotteryEntry;
    repo.findLatestUserEntry.mockResolvedValue(previous);
    const form = makeForm({}, { entry_rules: { limit: 'daily' } });
    const outcome = await executeLotteryDraw({ form, store, user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.95 });
    expect(outcome.ok).toBe(true);
    expect(repo.insertLotteryEntryChecked).toHaveBeenCalledWith(expect.objectContaining({ window_start: new Date('2026-09-09T15:00:00.000Z'), max_entries: 1 }));
  });

  it('DB 側で回数上限に達していたら 409', async () => {
    repo.insertLotteryEntryChecked.mockResolvedValue({ ok: false, reason: 'limit' });
    const form = makeForm({}, { entry_rules: { limit: 'period_n', period_max: 3 } });
    const outcome = await executeLotteryDraw({ form, store, user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.95 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(409);
    expect(outcome.error).toBe('参加回数の上限に達しました');
  });

  it('同時アクセスで在庫切れになったら「はずれ」として記録し直す', async () => {
    repo.insertLotteryEntryChecked
      .mockResolvedValueOnce({ ok: false, reason: 'sold_out' })
      .mockImplementationOnce(async (params: { entry: Record<string, unknown> }) => ({ ok: true, entry: { ...params.entry, id: 'e2' } }));
    const outcome = await executeLotteryDraw({ form: makeForm(), store, user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.05 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.entry.status).toBe('lost');
    expect(repo.insertLotteryEntryChecked).toHaveBeenCalledTimes(2);
    expect(repo.insertLotteryEntryChecked.mock.calls[1][0].prize_id).toBeNull();
  });

  it('在庫切れの賞品に当たったら（事前カウント）はずれ扱い', async () => {
    repo.countPrizeEntries.mockResolvedValue({ a: 1 });
    const outcome = await executeLotteryDraw({ form: makeForm(), store, user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.05 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.entry.status).toBe('lost');
  });

  it('when_sold_out=close で全賞品在庫切れなら 410', async () => {
    const form = makeForm({}, {
      prizes: [{ id: 'a', name: 'A', probability: 10, stock: 1 }],
      entry_rules: { when_sold_out: 'close' },
    });
    repo.countPrizeEntries.mockResolvedValue({ a: 1 });
    const outcome = await executeLotteryDraw({ form, store, user, lineFriendFlag: null, answers: null, userAgent: null, now });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(410);
  });

  it('非公開・期間外・友だち必須・必須質問未回答は拒否', async () => {
    const base = { store, user, lineFriendFlag: null as boolean | null, answers: null, userAgent: null, now };
    const inactive = await executeLotteryDraw({ ...base, form: makeForm({ status: 'inactive' }) });
    expect(inactive).toMatchObject({ ok: false, status: 403, error: 'この抽選は現在受け付けていません' });

    const before = await executeLotteryDraw({ ...base, form: makeForm({}, { basic_info: { title: 'T', period: { start_at: '2026-10-01T00:00:00+09:00' } } }) });
    expect(before).toMatchObject({ ok: false, status: 403, error: '受付開始前です' });

    const after = await executeLotteryDraw({ ...base, form: makeForm({}, { basic_info: { title: 'T', period: { end_at: '2026-09-01T00:00:00+09:00' } } }) });
    expect(after).toMatchObject({ ok: false, status: 403, error: '受付期間外です' });

    const friend = await executeLotteryDraw({ ...base, lineFriendFlag: false, form: makeForm({}, { entry_rules: { require_friend: true } }) });
    expect(friend).toMatchObject({ ok: false, status: 403 });
    // 友だち状態が不明（null）なら通す
    const unknownFriend = await executeLotteryDraw({ ...base, lineFriendFlag: null, form: makeForm({}, { entry_rules: { require_friend: true } }), rng: () => 0.95 });
    expect(unknownFriend.ok).toBe(true);

    const missing = await executeLotteryDraw({
      ...base,
      form: makeForm({}, { entry_rules: { pre_questions: [{ id: 'q1', type: 'text', title: 'お名前', required: true }] } }),
    });
    expect(missing).toMatchObject({ ok: false, status: 400, error: '必須項目が未入力です: お名前' });
    // 拒否されたケースでは insert が呼ばれない（通ったのは unknownFriend の 1 回だけ）
    expect(repo.insertLotteryEntryChecked).toHaveBeenCalledTimes(1);
  });

  it('顧客連携に失敗しても抽選結果は返る', async () => {
    customers.findCustomerByLineOrPhone.mockRejectedValue(new Error('db down'));
    const outcome = await executeLotteryDraw({ form: makeForm(), store, user, lineFriendFlag: null, answers: null, userAgent: null, now, rng: () => 0.95 });
    expect(outcome.ok).toBe(true);
    expect(repo.updateLotteryEntry).not.toHaveBeenCalled();
  });

  it('顧客が存在しなければ作成して紐付ける', async () => {
    customers.findCustomerByLineOrPhone.mockResolvedValue(null);
    customers.createCustomer.mockResolvedValue({ id: 'newcust' });
    await executeLotteryDraw({ form: makeForm(), store, user, lineFriendFlag: true, answers: null, userAgent: null, now, rng: () => 0.95 });
    expect(customers.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'st1', line_user_id: 'U123', name: '太郎', line_friend_flag: true }));
    expect(repo.updateLotteryEntry).toHaveBeenCalledWith('e1', { customer_id: 'newcust' });
  });
});

describe('executeLotteryDraw（後日抽選）', () => {
  const deferredForm = () => makeForm({}, {
    lottery_type: 'deferred',
    basic_info: { title: 'キャンペーン', period: { end_at: '2026-09-30T23:59:59+09:00' } },
    deferred: { draw_scheduled_at: '2026-10-01T00:00:00+09:00' },
    prizes: [{ id: 'a', name: 'A賞', probability: 0, stock: 3 }],
  });

  it('応募として記録し、entry_text を返す（抽選はしない）', async () => {
    const outcome = await executeLotteryDraw({ form: deferredForm(), store, user, lineFriendFlag: null, answers: { q1: 'x' }, userAgent: null, now });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.entry.status).toBe('entered');
    expect(outcome.response.entry.prize_id).toBeNull();
    expect(outcome.response.message_text).toBe('🎯 キャンペーン に応募しました\n抽選日：2026/10/01\n\n結果は LINE でお知らせします');
    expect(repo.insertLotteryEntryChecked).toHaveBeenCalledWith(expect.objectContaining({ prize_id: null, prize_stock: null, max_entries: 1 }));
    expect(repo.countPrizeEntries).not.toHaveBeenCalled();
  });

  it('締切後（deferred_draw_status が accepting 以外）は 403', async () => {
    const outcome = await executeLotteryDraw({ form: deferredForm(), store, user, lineFriendFlag: null, answers: null, userAgent: null, now });
    expect(outcome.ok).toBe(true);
    const closed = await executeLotteryDraw({ form: { ...deferredForm(), deferred_draw_status: 'closed' }, store, user, lineFriendFlag: null, answers: null, userAgent: null, now });
    expect(closed).toMatchObject({ ok: false, status: 403, error: 'この抽選の応募は締め切りました' });
  });

  it('二重応募は 409（応募済み）', async () => {
    repo.findLatestUserEntry.mockResolvedValue({ id: 'prev', status: 'entered', entered_at: '2026-09-05T00:00:00Z', line_display_name: null } as unknown as LotteryEntry);
    const outcome = await executeLotteryDraw({ form: deferredForm(), store, user, lineFriendFlag: null, answers: null, userAgent: null, now });
    expect(outcome).toMatchObject({ ok: false, status: 409, error: 'この抽選にはすでに応募済みです' });
  });
});
