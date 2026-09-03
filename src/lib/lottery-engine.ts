/**
 * 抽選エンジン（純粋ロジック）
 *
 * DB や HTTP に依存しない関数だけを置く。API ルート（即時抽選 / 後日抽選）と
 * ローカル JSON 実装の両方がこのモジュールを使うことで、環境による挙動差をなくす。
 * すべて Vitest でテストする（src/lib/__tests__/lottery-engine.test.ts）。
 */
import type {
  LotteryConfig,
  LotteryEntry,
  LotteryEntryEffectiveStatus,
  LotteryPrize,
} from '@/types/lottery';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 0 と 1 を間違えにくい文字だけで引換コードを作る（I / O / 0 / 1 を除外） */
export const REDEEM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REDEEM_CODE_LENGTH = 6;
export const QR_TOKEN_LENGTH = 32;

/** 暗号学的乱数で 0 以上 1 未満の値を返す（Web Crypto。ブラウザと Node 19+ の両方で動く） */
export function secureRandomUnit(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 4294967296; // 2^32
}

export function generateRedeemCode(rng: () => number = secureRandomUnit): string {
  let code = '';
  for (let i = 0; i < REDEEM_CODE_LENGTH; i++) {
    const idx = Math.min(REDEEM_CODE_ALPHABET.length - 1, Math.floor(rng() * REDEEM_CODE_ALPHABET.length));
    code += REDEEM_CODE_ALPHABET[idx];
  }
  return code;
}

export function generateQrToken(rng: () => number = secureRandomUnit): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < QR_TOKEN_LENGTH; i++) {
    token += alphabet[Math.min(alphabet.length - 1, Math.floor(rng() * alphabet.length))];
  }
  return token;
}

export function generateEntryId(): string {
  return globalThis.crypto.randomUUID();
}

/** 12 文字のフォーム ID / 賞品 ID */
export function generateLotteryId(rng: () => number = secureRandomUnit): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.min(chars.length - 1, Math.floor(rng() * chars.length))];
  }
  return result;
}

// ---------------------------------------------------------------------------
// 賞品設定の検証
// ---------------------------------------------------------------------------

export interface PrizeValidationError {
  prize_id?: string;
  message: string;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * 保存前の賞品設定チェック。エラーが 1 件でもあれば保存不可。
 * - 即時: 確率は 0〜100、合計 ≤ 100
 * - 後日: 在庫（= 当選数）は 1 以上の整数が必須
 */
export function validatePrizes(config: Pick<LotteryConfig, 'lottery_type' | 'prizes' | 'consolation_prize'>): PrizeValidationError[] {
  const errors: PrizeValidationError[] = [];
  const prizes = Array.isArray(config.prizes) ? config.prizes : [];

  if (prizes.length === 0) {
    errors.push({ message: '賞品を 1 つ以上登録してください' });
  }

  const seen = new Set<string>();
  let total = 0;
  for (const prize of prizes) {
    if (!prize.id) {
      errors.push({ message: '賞品 ID が不正です' });
      continue;
    }
    if (seen.has(prize.id)) {
      errors.push({ prize_id: prize.id, message: '賞品 ID が重複しています' });
    }
    seen.add(prize.id);

    if (!prize.name || !prize.name.trim()) {
      errors.push({ prize_id: prize.id, message: '賞品名を入力してください' });
    }

    if (config.lottery_type === 'instant') {
      const p = prize.probability;
      if (typeof p !== 'number' || Number.isNaN(p) || p < 0 || p > 100) {
        errors.push({ prize_id: prize.id, message: '当選確率は 0〜100 の数値で入力してください' });
      } else {
        total += p;
      }
    }

    if (prize.stock !== null && prize.stock !== undefined) {
      if (!isNonNegativeInteger(prize.stock)) {
        errors.push({ prize_id: prize.id, message: '在庫数は 0 以上の整数で入力してください' });
      }
    }
    if (config.lottery_type === 'deferred') {
      if (prize.stock === null || prize.stock === undefined || !isNonNegativeInteger(prize.stock) || prize.stock < 1) {
        errors.push({ prize_id: prize.id, message: '後日抽選では当選数（在庫数）を 1 以上で入力してください' });
      }
    }

    if (prize.expires_in_days !== undefined && prize.expires_in_days !== null && !isNonNegativeInteger(prize.expires_in_days)) {
      errors.push({ prize_id: prize.id, message: '有効期限（日数）は 0 以上の整数で入力してください' });
    }
    if (prize.expires_at && !/^\d{4}-\d{2}-\d{2}$/.test(prize.expires_at)) {
      errors.push({ prize_id: prize.id, message: '有効期限（日付）は YYYY-MM-DD 形式で入力してください' });
    }
  }

  if (config.lottery_type === 'instant' && total > 100 + 1e-9) {
    errors.push({ message: `当選確率の合計が 100% を超えています（現在 ${roundPercent(total)}%）` });
  }

  const consolation = config.consolation_prize;
  if (consolation) {
    if (!consolation.id) {
      errors.push({ message: '残念賞の ID が不正です' });
    } else if (seen.has(consolation.id)) {
      errors.push({ prize_id: consolation.id, message: '残念賞の ID が他の賞品と重複しています' });
    }
    if (!consolation.name || !consolation.name.trim()) {
      errors.push({ prize_id: consolation.id, message: '残念賞の名前を入力してください' });
    }
  }

  return errors;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 「はずれ」になる確率（%）。確率合計が 100 を超える不正設定では 0 */
export function getLoseProbability(prizes: LotteryPrize[]): number {
  const total = prizes.reduce((sum, p) => sum + (typeof p.probability === 'number' ? p.probability : 0), 0);
  return Math.max(0, roundPercent(100 - total));
}

// ---------------------------------------------------------------------------
// 即時抽選の当選判定
// ---------------------------------------------------------------------------

export interface PrizeSelection {
  /** 当選した賞品。はずれ / 在庫切れなら null */
  prize: LotteryPrize | null;
  /** 確率上は当たっていたが在庫切れで「はずれ」に落ちた場合 true */
  sold_out: boolean;
}

export function isPrizeSoldOut(prize: LotteryPrize, issuedCount: number): boolean {
  if (prize.stock === null || prize.stock === undefined) return false;
  return issuedCount >= prize.stock;
}

/**
 * random（0 ≤ r < 1）を賞品の累積確率に当てて 1 つ選ぶ。
 * 在庫切れの賞品に当たった場合は「はずれ」扱い（他の賞品へ再配分しない = 設定した確率を守る）。
 */
export function selectPrize(
  prizes: LotteryPrize[],
  random: number,
  issuedCounts: Record<string, number>
): PrizeSelection {
  const r = Math.min(Math.max(random, 0), 0.999999999) * 100;
  let cumulative = 0;
  for (const prize of prizes) {
    const p = typeof prize.probability === 'number' && prize.probability > 0 ? prize.probability : 0;
    if (p === 0) continue;
    cumulative += p;
    if (r < cumulative) {
      if (isPrizeSoldOut(prize, issuedCounts[prize.id] ?? 0)) {
        return { prize: null, sold_out: true };
      }
      return { prize, sold_out: false };
    }
  }
  return { prize: null, sold_out: false };
}

/** すべての賞品が在庫切れ（無制限の賞品が 1 つでもあれば false） */
export function isAllSoldOut(prizes: LotteryPrize[], issuedCounts: Record<string, number>): boolean {
  const candidates = prizes.filter((p) => typeof p.probability === 'number' && p.probability > 0);
  if (candidates.length === 0) return false;
  return candidates.every((p) => isPrizeSoldOut(p, issuedCounts[p.id] ?? 0));
}

// ---------------------------------------------------------------------------
// 受付期間 / 参加回数
// ---------------------------------------------------------------------------

export type PeriodState = 'before' | 'open' | 'after';

export function getPeriodState(config: Pick<LotteryConfig, 'basic_info'>, now: Date): PeriodState {
  const period = config.basic_info?.period;
  const start = period?.start_at ? new Date(period.start_at) : null;
  const end = period?.end_at ? new Date(period.end_at) : null;
  if (start && !Number.isNaN(start.getTime()) && now < start) return 'before';
  if (end && !Number.isNaN(end.getTime()) && now > end) return 'after';
  return 'open';
}

/** JST でその日の 00:00 を UTC の Date で返す */
export function startOfDayJst(now: Date): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const utcMidnightOfJstDate = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  return new Date(utcMidnightOfJstDate - JST_OFFSET_MS);
}

/** JST でその日の 23:59:59.999 を UTC の Date で返す */
export function endOfDayJst(now: Date): Date {
  return new Date(startOfDayJst(now).getTime() + 24 * 60 * 60 * 1000 - 1);
}

export interface EntryLimitWindow {
  /** この時刻以降の参加をカウントする。null = 全期間 */
  window_start: Date | null;
  /** 参加できる最大回数。null = 制限なし */
  max_entries: number | null;
}

export function getEntryLimitWindow(
  config: Pick<LotteryConfig, 'lottery_type' | 'entry_rules'>,
  now: Date
): EntryLimitWindow {
  // 後日抽選は 1 人 1 口固定
  if (config.lottery_type === 'deferred') {
    return { window_start: null, max_entries: 1 };
  }
  const rules = config.entry_rules;
  switch (rules?.limit) {
    case 'daily':
      return { window_start: startOfDayJst(now), max_entries: 1 };
    case 'period_n': {
      const max = typeof rules.period_max === 'number' && Number.isInteger(rules.period_max) && rules.period_max >= 1
        ? rules.period_max
        : 1;
      return { window_start: null, max_entries: max };
    }
    case 'once':
    default:
      return { window_start: null, max_entries: 1 };
  }
}

export function getEntryLimitMessage(limit: LotteryConfig['entry_rules']['limit'], lotteryType: LotteryConfig['lottery_type']): string {
  if (lotteryType === 'deferred') return 'この抽選にはすでに応募済みです';
  switch (limit) {
    case 'daily':
      return '本日はすでに参加済みです';
    case 'period_n':
      return '参加回数の上限に達しました';
    case 'once':
    default:
      return 'この抽選にはすでに参加済みです';
  }
}

// ---------------------------------------------------------------------------
// 有効期限 / 表示ステータス
// ---------------------------------------------------------------------------

/**
 * 賞品の有効期限を ISO 文字列で返す。
 * - expires_at（YYYY-MM-DD）があればその日の 23:59:59.999 JST
 * - expires_in_days があれば当選日 + N 日の 23:59:59.999 JST（0 = 当日中）
 * - どちらも無ければ null（無期限）
 */
export function computeExpiresAt(prize: Pick<LotteryPrize, 'expires_at' | 'expires_in_days'>, wonAt: Date): string | null {
  if (prize.expires_at && /^\d{4}-\d{2}-\d{2}$/.test(prize.expires_at)) {
    const [y, m, d] = prize.expires_at.split('-').map(Number);
    const jstMidnight = Date.UTC(y, m - 1, d) - JST_OFFSET_MS;
    return new Date(jstMidnight + 24 * 60 * 60 * 1000 - 1).toISOString();
  }
  if (typeof prize.expires_in_days === 'number' && Number.isInteger(prize.expires_in_days) && prize.expires_in_days >= 0) {
    const base = endOfDayJst(wonAt);
    return new Date(base.getTime() + prize.expires_in_days * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

export function isEntryExpired(entry: Pick<LotteryEntry, 'expires_at'>, now: Date): boolean {
  if (!entry.expires_at) return false;
  const t = new Date(entry.expires_at).getTime();
  return !Number.isNaN(t) && t < now.getTime();
}

/** 引換前の当選で有効期限を過ぎていれば expired、それ以外は DB のステータスそのまま */
export function getEffectiveStatus(entry: Pick<LotteryEntry, 'status' | 'expires_at'>, now: Date): LotteryEntryEffectiveStatus {
  if (entry.status === 'drawn' && isEntryExpired(entry, now)) return 'expired';
  return entry.status;
}

/** 'YYYY/MM/DD' 形式（JST）。null は空文字 */
export function formatDateJst(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const jst = new Date(t.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// ---------------------------------------------------------------------------
// 後日抽選の自動抽選
// ---------------------------------------------------------------------------

export interface DeferredWinner {
  entry_id: string;
  prize_id: string;
}

/**
 * 応募者の中から賞品ごとに stock 名をランダムに選ぶ（同じ人が複数賞品に当たらない）。
 * 賞品は配列順（上位の賞品から）に割り当てる。
 */
export function drawDeferredWinners(
  prizes: LotteryPrize[],
  entryIds: string[],
  rng: () => number = secureRandomUnit
): DeferredWinner[] {
  const pool = [...new Set(entryIds)];
  // Fisher–Yates でシャッフルしてから先頭から順に割り当てる
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const winners: DeferredWinner[] = [];
  let cursor = 0;
  for (const prize of prizes) {
    const count = prize.stock ?? 0;
    for (let i = 0; i < count && cursor < pool.length; i++) {
      winners.push({ entry_id: pool[cursor++], prize_id: prize.id });
    }
  }
  return winners;
}
