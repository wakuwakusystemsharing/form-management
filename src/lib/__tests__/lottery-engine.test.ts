import { describe, expect, it } from 'vitest';
import {
  computeExpiresAt,
  drawDeferredWinners,
  endOfDayJst,
  formatDateJst,
  generateLotteryId,
  generateQrToken,
  generateRedeemCode,
  getEffectiveStatus,
  getEntryLimitMessage,
  getEntryLimitWindow,
  getLoseProbability,
  getPeriodState,
  isAllSoldOut,
  REDEEM_CODE_ALPHABET,
  secureRandomUnit,
  selectPrize,
  startOfDayJst,
  validatePrizes,
} from '@/lib/lottery-engine';
import type { LotteryConfig, LotteryPrize } from '@/types/lottery';

const prizes: LotteryPrize[] = [
  { id: 'a', name: 'A賞', probability: 10, stock: 1 },
  { id: 'b', name: 'B賞', probability: 20, stock: null },
  { id: 'c', name: 'C賞', probability: 0, stock: 5 },
];

function makeRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('乱数・ID 生成', () => {
  it('secureRandomUnit は 0 以上 1 未満', () => {
    for (let i = 0; i < 1000; i++) {
      const v = secureRandomUnit();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('引換コードは 6 文字で紛らわしい文字を含まない', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRedeemCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      for (const ch of code) expect(REDEEM_CODE_ALPHABET).toContain(ch);
    }
  });

  it('rng が 1 に極めて近い値を返しても配列外にならない', () => {
    const code = generateRedeemCode(() => 0.9999999999);
    expect(code).toBe('999999');
    expect(generateQrToken(() => 0.9999999999)).toHaveLength(32);
    expect(generateLotteryId(() => 0.9999999999)).toHaveLength(12);
  });

  it('QR トークンは 32 文字の英小文字数字', () => {
    expect(generateQrToken()).toMatch(/^[a-z0-9]{32}$/);
  });
});

describe('validatePrizes', () => {
  it('正常な即時抽選の設定はエラーなし', () => {
    expect(validatePrizes({ lottery_type: 'instant', prizes })).toEqual([]);
  });

  it('賞品がなければエラー', () => {
    expect(validatePrizes({ lottery_type: 'instant', prizes: [] })).toEqual([{ message: '賞品を 1 つ以上登録してください' }]);
  });

  it('確率合計 100 超はエラー、ちょうど 100 は OK', () => {
    const over = validatePrizes({
      lottery_type: 'instant',
      prizes: [
        { id: 'x', name: 'X', probability: 60, stock: null },
        { id: 'y', name: 'Y', probability: 40.5, stock: null },
      ],
    });
    expect(over.some((e) => e.message.includes('100% を超えています'))).toBe(true);

    const exact = validatePrizes({
      lottery_type: 'instant',
      prizes: [
        { id: 'x', name: 'X', probability: 60, stock: null },
        { id: 'y', name: 'Y', probability: 40, stock: null },
      ],
    });
    expect(exact).toEqual([]);
  });

  it('確率が範囲外・在庫が負・ID 重複・名前なしはエラー', () => {
    const errors = validatePrizes({
      lottery_type: 'instant',
      prizes: [
        { id: 'x', name: '', probability: -1, stock: -3 },
        { id: 'x', name: 'Y', probability: 101, stock: 1.5 },
      ],
    });
    const messages = errors.map((e) => e.message);
    expect(messages).toContain('賞品名を入力してください');
    expect(messages).toContain('賞品 ID が重複しています');
    expect(messages.filter((m) => m.includes('当選確率は 0〜100'))).toHaveLength(2);
    expect(messages.filter((m) => m.includes('在庫数は 0 以上の整数'))).toHaveLength(2);
  });

  it('後日抽選では在庫（当選数）が必須で 1 以上', () => {
    const errors = validatePrizes({
      lottery_type: 'deferred',
      prizes: [
        { id: 'x', name: 'X', probability: 0, stock: null },
        { id: 'y', name: 'Y', probability: 0, stock: 0 },
        { id: 'z', name: 'Z', probability: 0, stock: 3 },
      ],
    });
    expect(errors.map((e) => e.prize_id)).toEqual(['x', 'y']);
  });

  it('後日抽選では確率合計を検証しない', () => {
    const errors = validatePrizes({
      lottery_type: 'deferred',
      prizes: [
        { id: 'x', name: 'X', probability: 500, stock: 1 },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('残念賞の ID が賞品と重複していればエラー', () => {
    const errors = validatePrizes({
      lottery_type: 'instant',
      prizes,
      consolation_prize: { id: 'a', name: '残念賞', probability: 0, stock: null },
    });
    expect(errors.map((e) => e.message)).toContain('残念賞の ID が他の賞品と重複しています');
  });

  it('有効期限の形式チェック', () => {
    const errors = validatePrizes({
      lottery_type: 'instant',
      prizes: [{ id: 'x', name: 'X', probability: 1, stock: null, expires_at: '2026/10/31', expires_in_days: -1 }],
    });
    expect(errors).toHaveLength(2);
  });
});

describe('getLoseProbability', () => {
  it('残りをはずれ確率として返す', () => {
    expect(getLoseProbability(prizes)).toBe(70);
  });
  it('合計が 100 を超える不正設定では 0', () => {
    expect(getLoseProbability([{ id: 'x', name: 'X', probability: 120, stock: null }])).toBe(0);
  });
  it('浮動小数の誤差を丸める', () => {
    expect(getLoseProbability([
      { id: 'x', name: 'X', probability: 0.1, stock: null },
      { id: 'y', name: 'Y', probability: 0.2, stock: null },
    ])).toBe(99.7);
  });
});

describe('selectPrize', () => {
  it('累積確率で賞品を選ぶ（A: 0〜10%, B: 10〜30%, それ以外はずれ）', () => {
    expect(selectPrize(prizes, 0, {}).prize?.id).toBe('a');
    expect(selectPrize(prizes, 0.0999, {}).prize?.id).toBe('a');
    expect(selectPrize(prizes, 0.1, {}).prize?.id).toBe('b');
    expect(selectPrize(prizes, 0.2999, {}).prize?.id).toBe('b');
    expect(selectPrize(prizes, 0.3, {}).prize).toBeNull();
    expect(selectPrize(prizes, 0.9999, {}).prize).toBeNull();
  });

  it('確率 0 の賞品は選ばれない', () => {
    for (let r = 0; r < 1; r += 0.01) {
      expect(selectPrize(prizes, r, {}).prize?.id).not.toBe('c');
    }
  });

  it('在庫切れの賞品に当たったら「はずれ」として sold_out=true（他の賞品へ再配分しない）', () => {
    const result = selectPrize(prizes, 0.05, { a: 1 });
    expect(result.prize).toBeNull();
    expect(result.sold_out).toBe(true);
    // B は無制限なので在庫カウントに関係なく当たる
    expect(selectPrize(prizes, 0.2, { a: 1, b: 9999 }).prize?.id).toBe('b');
  });

  it('random が範囲外でも例外にならない', () => {
    expect(selectPrize(prizes, -1, {}).prize?.id).toBe('a');
    expect(selectPrize(prizes, 1, {}).prize).toBeNull();
    expect(selectPrize(prizes, 2, {}).prize).toBeNull();
  });

  it('確率合計 100 なら必ずどれかに当たる', () => {
    const full: LotteryPrize[] = [
      { id: 'x', name: 'X', probability: 50, stock: null },
      { id: 'y', name: 'Y', probability: 50, stock: null },
    ];
    expect(selectPrize(full, 0.999999, {}).prize?.id).toBe('y');
    expect(selectPrize(full, 0.5, {}).prize?.id).toBe('y');
    expect(selectPrize(full, 0.4999, {}).prize?.id).toBe('x');
  });

  it('統計的に設定確率に近い分布になる', () => {
    const counts: Record<string, number> = { a: 0, b: 0, lose: 0 };
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const p = selectPrize(prizes, secureRandomUnit(), {}).prize;
      counts[p ? p.id : 'lose']++;
    }
    expect(counts.a / n).toBeCloseTo(0.1, 1);
    expect(counts.b / n).toBeCloseTo(0.2, 1);
    expect(counts.lose / n).toBeCloseTo(0.7, 1);
  });
});

describe('isAllSoldOut', () => {
  it('無制限の賞品があれば false', () => {
    expect(isAllSoldOut(prizes, { a: 1 })).toBe(false);
  });
  it('確率 > 0 の賞品がすべて在庫切れなら true（確率 0 の賞品は無視）', () => {
    const limited: LotteryPrize[] = [
      { id: 'a', name: 'A', probability: 10, stock: 1 },
      { id: 'c', name: 'C', probability: 0, stock: 5 },
    ];
    expect(isAllSoldOut(limited, { a: 1 })).toBe(true);
    expect(isAllSoldOut(limited, { a: 0 })).toBe(false);
  });
  it('賞品が 1 つも無ければ false', () => {
    expect(isAllSoldOut([], {})).toBe(false);
  });
});

describe('受付期間', () => {
  const cfg = (start?: string, end?: string): Pick<LotteryConfig, 'basic_info'> => ({
    basic_info: { title: 't', liff_id: '', theme_color: '#000', period: { start_at: start, end_at: end } },
  });
  it('期間未設定は常に open', () => {
    expect(getPeriodState({ basic_info: { title: 't', liff_id: '', theme_color: '#000' } }, new Date())).toBe('open');
  });
  it('開始前 / 期間中 / 終了後', () => {
    const c = cfg('2026-09-01T00:00:00+09:00', '2026-09-30T23:59:59+09:00');
    expect(getPeriodState(c, new Date('2026-08-31T23:59:59+09:00'))).toBe('before');
    expect(getPeriodState(c, new Date('2026-09-01T00:00:00+09:00'))).toBe('open');
    expect(getPeriodState(c, new Date('2026-09-30T23:59:59+09:00'))).toBe('open');
    expect(getPeriodState(c, new Date('2026-10-01T00:00:00+09:00'))).toBe('after');
  });
  it('不正な日付文字列は無視して open', () => {
    expect(getPeriodState(cfg('not-a-date', 'xxx'), new Date())).toBe('open');
  });
});

describe('JST 日付ユーティリティ', () => {
  it('startOfDayJst / endOfDayJst は JST 基準', () => {
    // 2026-09-03 01:30 JST = 2026-09-02 16:30 UTC
    const now = new Date('2026-09-02T16:30:00Z');
    expect(startOfDayJst(now).toISOString()).toBe('2026-09-02T15:00:00.000Z');
    expect(endOfDayJst(now).toISOString()).toBe('2026-09-03T14:59:59.999Z');
  });
  it('formatDateJst', () => {
    expect(formatDateJst('2026-09-02T16:30:00Z')).toBe('2026/09/03');
    expect(formatDateJst(null)).toBe('');
    expect(formatDateJst('invalid')).toBe('');
  });
});

describe('getEntryLimitWindow', () => {
  const now = new Date('2026-09-02T16:30:00Z');
  const rules = (limit: LotteryConfig['entry_rules']['limit'], period_max?: number): Pick<LotteryConfig, 'lottery_type' | 'entry_rules'> => ({
    lottery_type: 'instant',
    entry_rules: { limit, period_max, require_friend: false, when_sold_out: 'lose', pre_questions: [] },
  });
  it('once: 全期間で 1 回', () => {
    expect(getEntryLimitWindow(rules('once'), now)).toEqual({ window_start: null, max_entries: 1 });
  });
  it('daily: JST の当日 0 時から 1 回', () => {
    const w = getEntryLimitWindow(rules('daily'), now);
    expect(w.window_start?.toISOString()).toBe('2026-09-02T15:00:00.000Z');
    expect(w.max_entries).toBe(1);
  });
  it('period_n: 全期間で N 回。不正値は 1', () => {
    expect(getEntryLimitWindow(rules('period_n', 3), now)).toEqual({ window_start: null, max_entries: 3 });
    expect(getEntryLimitWindow(rules('period_n', 0), now).max_entries).toBe(1);
    expect(getEntryLimitWindow(rules('period_n', undefined), now).max_entries).toBe(1);
    expect(getEntryLimitWindow(rules('period_n', 2.5), now).max_entries).toBe(1);
  });
  it('後日抽選は設定に関わらず 1 人 1 口', () => {
    expect(getEntryLimitWindow({ ...rules('period_n', 5), lottery_type: 'deferred' }, now)).toEqual({ window_start: null, max_entries: 1 });
  });
  it('メッセージ', () => {
    expect(getEntryLimitMessage('daily', 'instant')).toBe('本日はすでに参加済みです');
    expect(getEntryLimitMessage('once', 'deferred')).toBe('この抽選にはすでに応募済みです');
  });
});

describe('computeExpiresAt / getEffectiveStatus', () => {
  const wonAt = new Date('2026-09-02T16:30:00Z'); // 09-03 01:30 JST
  it('固定日付はその日の 23:59:59.999 JST', () => {
    expect(computeExpiresAt({ expires_at: '2026-10-31' }, wonAt)).toBe('2026-10-31T14:59:59.999Z');
  });
  it('日数指定は当選日（JST）+ N 日の終わり。0 = 当日中', () => {
    expect(computeExpiresAt({ expires_in_days: 0 }, wonAt)).toBe('2026-09-03T14:59:59.999Z');
    expect(computeExpiresAt({ expires_in_days: 30 }, wonAt)).toBe('2026-10-03T14:59:59.999Z');
  });
  it('固定日付と日数の両方があれば固定日付を優先', () => {
    expect(computeExpiresAt({ expires_at: '2026-10-31', expires_in_days: 1 }, wonAt)).toBe('2026-10-31T14:59:59.999Z');
  });
  it('どちらも無ければ無期限', () => {
    expect(computeExpiresAt({}, wonAt)).toBeNull();
    expect(computeExpiresAt({ expires_at: 'bad' }, wonAt)).toBeNull();
  });
  it('drawn かつ期限切れは expired、それ以外はそのまま', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(getEffectiveStatus({ status: 'drawn', expires_at: '2026-10-31T14:59:59.999Z' }, now)).toBe('expired');
    expect(getEffectiveStatus({ status: 'drawn', expires_at: '2026-12-31T14:59:59.999Z' }, now)).toBe('drawn');
    expect(getEffectiveStatus({ status: 'drawn', expires_at: null }, now)).toBe('drawn');
    expect(getEffectiveStatus({ status: 'redeemed', expires_at: '2026-10-31T14:59:59.999Z' }, now)).toBe('redeemed');
    expect(getEffectiveStatus({ status: 'lost', expires_at: null }, now)).toBe('lost');
  });
});

describe('drawDeferredWinners', () => {
  const deferredPrizes: LotteryPrize[] = [
    { id: 'gold', name: '金', probability: 0, stock: 1 },
    { id: 'silver', name: '銀', probability: 0, stock: 2 },
  ];
  it('賞品ごとの当選数だけ選び、同じ応募者は重複しない', () => {
    const winners = drawDeferredWinners(deferredPrizes, ['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(winners).toHaveLength(3);
    expect(winners.filter((w) => w.prize_id === 'gold')).toHaveLength(1);
    expect(winners.filter((w) => w.prize_id === 'silver')).toHaveLength(2);
    expect(new Set(winners.map((w) => w.entry_id)).size).toBe(3);
  });
  it('応募者が当選数より少なければ応募者数まで', () => {
    const winners = drawDeferredWinners(deferredPrizes, ['e1', 'e2']);
    expect(winners).toHaveLength(2);
    expect(winners[0].prize_id).toBe('gold');
    expect(winners[1].prize_id).toBe('silver');
  });
  it('重複した応募 ID は 1 つに丸める', () => {
    expect(drawDeferredWinners(deferredPrizes, ['e1', 'e1', 'e1'])).toHaveLength(1);
  });
  it('rng に従って決定的に選ぶ', () => {
    const a = drawDeferredWinners(deferredPrizes, ['e1', 'e2', 'e3'], makeRng([0, 0, 0]));
    const b = drawDeferredWinners(deferredPrizes, ['e1', 'e2', 'e3'], makeRng([0, 0, 0]));
    expect(a).toEqual(b);
  });
});
