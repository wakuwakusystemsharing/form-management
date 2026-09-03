import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LotteryEntry, LotteryForm } from '@/types/lottery';

const repo = vi.hoisted(() => ({
  listEntriesForForm: vi.fn(),
  redeemCodeExists: vi.fn(),
  updateLotteryEntry: vi.fn(),
  updateLotteryForm: vi.fn(),
}));
const push = vi.hoisted(() => ({ pushLineMessages: vi.fn() }));
vi.mock('@/lib/lottery-repository', () => repo);
vi.mock('@/lib/line-push', () => push);

import { normalizeLotteryForm } from '@/lib/lottery-normalizer';
import {
  confirmDeferredWinners,
  getDeferredSummary,
  resendDeferredNotifications,
  runDeferredDraw,
  updateDeferredWinners,
} from '@/lib/lottery-deferred-service';
import type { LotteryStoreInfo } from '@/lib/lottery-service';

const store: LotteryStoreInfo = { id: 'st1', name: '店', line_channel_id: null, line_channel_access_token: 'tok' };
const now = new Date('2026-10-01T03:00:00Z');

function makeForm(over: Record<string, unknown> = {}): LotteryForm {
  return normalizeLotteryForm({
    id: 'f1',
    store_id: 'st1',
    status: 'active',
    deferred_draw_status: 'accepting',
    config: {
      lottery_type: 'deferred',
      redeem_method: 'qr',
      basic_info: { title: 'キャンペーン', liff_id: 'liff', period: { end_at: '2026-09-30T23:59:59+09:00' } },
      prizes: [
        { id: 'gold', name: '金賞', probability: 0, stock: 1, expires_in_days: 30 },
        { id: 'silver', name: '銀賞', probability: 0, stock: 2 },
      ],
    },
    ...over,
  });
}

function entry(id: string, status: LotteryEntry['status'], over: Partial<LotteryEntry> = {}): LotteryEntry {
  return {
    id, lottery_form_id: 'f1', store_id: 'st1', line_user_id: `U${id}`, line_display_name: id, line_friend_flag: null, customer_id: null,
    prize_id: null, prize_name: null, is_win: false, is_consolation: false, redeem_code: null, qr_token: null, expires_at: null,
    status, redeemed_at: null, redeemed_by: null, redeemed_note: null, answers: null, message_sent: false, push_sent: false,
    user_agent: null, entered_at: '2026-09-10T00:00:00Z', created_at: 'x', updated_at: 'x', ...over,
  };
}

/** メモリ上の履歴を updateLotteryEntry で追従させる簡易ストア */
function useStore(initial: LotteryEntry[]) {
  const rows = new Map(initial.map((e) => [e.id, { ...e }]));
  repo.listEntriesForForm.mockImplementation(async () => [...rows.values()].map((e) => ({ ...e })));
  repo.updateLotteryEntry.mockImplementation(async (id: string, patch: Partial<LotteryEntry>) => {
    const cur = rows.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    rows.set(id, next);
    return { ...next };
  });
  return rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.redeemCodeExists.mockResolvedValue(false);
  repo.updateLotteryForm.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ ...makeForm(), ...patch }));
  push.pushLineMessages.mockResolvedValue({ ok: true, status: 200, body: '' });
});

describe('runDeferredDraw', () => {
  it('締切前は force なしで拒否', async () => {
    useStore([entry('a', 'entered')]);
    const r = await runDeferredDraw(makeForm(), { now: new Date('2026-09-15T00:00:00Z') });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(repo.updateLotteryEntry).not.toHaveBeenCalled();
  });

  it('締切後に賞品ごとの当選数だけ仮当選にする（cancelled は対象外）', async () => {
    const rows = useStore([entry('a', 'entered'), entry('b', 'entered'), entry('c', 'entered'), entry('d', 'entered'), entry('x', 'cancelled')]);
    const r = await runDeferredDraw(makeForm(), { now, rng: () => 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.deferred_draw_status).toBe('drawn');
    expect(r.data.provisional).toHaveLength(3);
    expect([...rows.values()].filter((e) => e.status === 'provisional').map((e) => e.prize_id).sort()).toEqual(['gold', 'silver', 'silver']);
    expect(rows.get('x')!.status).toBe('cancelled');
    expect(r.data.prize_capacity).toEqual({ gold: { stock: 1, assigned: 1 }, silver: { stock: 2, assigned: 2 } });
    expect(repo.updateLotteryForm).toHaveBeenCalledWith('f1', expect.objectContaining({ deferred_draw_status: 'drawn' }));
  });

  it('force なら締切前でも実行できる。再実行で前回の仮当選を引き直す', async () => {
    const rows = useStore([entry('a', 'provisional', { prize_id: 'gold', prize_name: '金賞' }), entry('b', 'entered')]);
    const r = await runDeferredDraw(makeForm({ deferred_draw_status: 'drawn' }), { now: new Date('2026-09-15T00:00:00Z'), force: true, rng: () => 0.99 });
    expect(r.ok).toBe(true);
    const statuses = [...rows.values()].map((e) => e.status);
    expect(statuses.filter((s) => s === 'provisional')).toHaveLength(2); // 応募 2 名・当選枠 3 → 2 名とも当選
  });

  it('通知済みなら拒否、即時抽選なら拒否', async () => {
    useStore([]);
    expect(await runDeferredDraw(makeForm({ deferred_draw_status: 'notified' }), { now })).toMatchObject({ ok: false, status: 409 });
    expect(await runDeferredDraw(makeForm({ config: { lottery_type: 'instant', basic_info: { title: 't' }, prizes: [] } }), { now })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('updateDeferredWinners', () => {
  it('外す → entered、追加 → provisional。当選数超過は拒否', async () => {
    const rows = useStore([
      entry('a', 'provisional', { prize_id: 'gold', prize_name: '金賞' }),
      entry('b', 'provisional', { prize_id: 'silver', prize_name: '銀賞' }),
      entry('c', 'entered'),
      entry('d', 'entered'),
    ]);
    const form = makeForm({ deferred_draw_status: 'drawn' });
    const r1 = await updateDeferredWinners(form, { remove: ['a'], add: [{ entry_id: 'c', prize_id: 'gold' }] });
    expect(r1.ok).toBe(true);
    expect(rows.get('a')!.status).toBe('entered');
    expect(rows.get('a')!.prize_id).toBeNull();
    expect(rows.get('c')).toMatchObject({ status: 'provisional', prize_id: 'gold', prize_name: '金賞' });

    const r2 = await updateDeferredWinners(form, { add: [{ entry_id: 'd', prize_id: 'gold' }] });
    expect(r2).toMatchObject({ ok: false, status: 400 });
    expect(r2.ok ? '' : r2.error).toContain('金賞');

    const r3 = await updateDeferredWinners(form, { add: [{ entry_id: 'd', prize_id: 'silver' }] });
    expect(r3.ok).toBe(true);
    expect(r3.ok ? r3.data.prize_capacity.silver.assigned : 0).toBe(2);
  });

  it('確定前以外は拒否', async () => {
    useStore([]);
    expect(await updateDeferredWinners(makeForm(), { remove: ['a'] })).toMatchObject({ ok: false, status: 409 });
    expect(await updateDeferredWinners(makeForm({ deferred_draw_status: 'notified' }), { remove: ['a'] })).toMatchObject({ ok: false, status: 409 });
  });
});

describe('confirmDeferredWinners', () => {
  it('仮当選を drawn にしてコード・QR・期限を発行し push、残りは lost', async () => {
    const rows = useStore([
      entry('a', 'provisional', { prize_id: 'gold', prize_name: '金賞' }),
      entry('b', 'provisional', { prize_id: 'silver', prize_name: '銀賞' }),
      entry('c', 'entered'),
    ]);
    push.pushLineMessages.mockResolvedValueOnce({ ok: true, status: 200, body: '' }).mockResolvedValueOnce({ ok: false, status: 429, body: 'rate' });
    const r = await confirmDeferredWinners(makeForm({ deferred_draw_status: 'drawn' }), store, { baseUrl: 'https://app', now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ notified: 1, failed: 1, lost: 1, deferred_draw_status: 'notified' });
    const a = rows.get('a')!;
    expect(a.status).toBe('drawn');
    expect(a.is_win).toBe(true);
    expect(a.redeem_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(a.qr_token).toMatch(/^[a-z0-9]{32}$/);
    expect(a.expires_at).toBe('2026-10-31T14:59:59.999Z');
    expect(a.push_sent).toBe(true);
    expect(rows.get('b')!.push_sent).toBe(false);
    expect(rows.get('c')).toMatchObject({ status: 'lost', prize_id: null });
    expect(push.pushLineMessages).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(push.pushLineMessages.mock.calls[0][2])).toContain('https://app/api/lotteries/qr/');
    expect(r.data.unnotified).toBe(1);
  });

  it('トークンが無い店舗・未抽選は拒否', async () => {
    useStore([]);
    expect(await confirmDeferredWinners(makeForm({ deferred_draw_status: 'drawn' }), { ...store, line_channel_access_token: null }, { baseUrl: 'x' })).toMatchObject({ ok: false, status: 400 });
    expect(await confirmDeferredWinners(makeForm(), store, { baseUrl: 'x' })).toMatchObject({ ok: false, status: 409 });
  });
});

describe('resendDeferredNotifications / getDeferredSummary', () => {
  it('未通知の当選者だけ再送する', async () => {
    const rows = useStore([
      entry('a', 'drawn', { prize_id: 'gold', prize_name: '金賞', push_sent: true, redeem_code: 'AAAAAA' }),
      entry('b', 'drawn', { prize_id: 'silver', prize_name: '銀賞', push_sent: false, redeem_code: 'BBBBBB' }),
      entry('c', 'lost'),
    ]);
    const r = await resendDeferredNotifications(makeForm({ deferred_draw_status: 'notified' }), store, { baseUrl: 'https://app' });
    expect(r).toMatchObject({ ok: true, data: { notified: 1, failed: 0 } });
    expect(push.pushLineMessages).toHaveBeenCalledTimes(1);
    expect(rows.get('b')!.push_sent).toBe(true);
  });

  it('summary: 応募数・仮当選・確定当選・未通知・締切判定', async () => {
    useStore([entry('a', 'entered'), entry('b', 'drawn', { prize_id: 'gold', push_sent: false }), entry('x', 'cancelled')]);
    const s = await getDeferredSummary(makeForm(), now);
    expect(s.applicants).toBe(2);
    expect(s.winners).toHaveLength(1);
    expect(s.unnotified).toBe(1);
    expect(s.is_closed).toBe(true);
    const open = await getDeferredSummary(makeForm(), new Date('2026-09-01T00:00:00Z'));
    expect(open.is_closed).toBe(false);
  });
});
