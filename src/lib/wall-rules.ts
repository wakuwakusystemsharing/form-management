/**
 * 寄せ書きウォールの投稿ルール — 純粋ロジック（クライアントでも使う定数を含む）
 */
import type { WallReportReason } from '@/types/wall';

export const WALL_BODY_MAX = 140;
/** 1 日の枚数の既定値（店舗設定 wall_boards.daily_max で変更。1〜10） */
export const WALL_DAILY_MAX = 1;
export const WALL_DAILY_MAX_MIN = 1;
export const WALL_DAILY_MAX_MAX = 10;

/** 店舗設定の値を 1〜10 の整数に丸める（不正は既定） */
export function normalizeWallDailyMax(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return WALL_DAILY_MAX;
  return Math.min(WALL_DAILY_MAX_MAX, Math.max(WALL_DAILY_MAX_MIN, Math.round(n)));
}
export const WALL_MIN_INTERVAL_SEC = 30;
export const WALL_REPORT_THRESHOLD = 3;
export const WALL_PAGE_SIZE = 30;
export const WALL_ADMIN_PAGE_SIZE = 50;

/** 規約バージョン。同意文を変えたら上げる（上がると再同意） */
export const WALL_TERMS_VERSION = '2026-10-01';
export const WALL_CONSENT_TEXT =
  '投稿は他のお客さんにもお店にも匿名で表示されます。ただし、規約違反や誹謗中傷があった場合に対応するため、運営が投稿者を内部で記録しています。';

export const WALL_REPORT_REASONS: Array<{ id: WallReportReason; label: string }> = [
  { id: 'abuse', label: '誹謗中傷' },
  { id: 'personal_info', label: '個人情報' },
  { id: 'advertising', label: '宣伝' },
  { id: 'other', label: 'その他' },
];

export function isWallReportReason(v: unknown): v is WallReportReason {
  return WALL_REPORT_REASONS.some((r) => r.id === v);
}

/** 本文の検証: 前後の空白を除いて 1〜140 文字 */
export function validateWallBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: '本文を入力してください' };
  const body = raw.replace(/\r\n?/g, '\n').trim();
  if (!body) return { ok: false, error: '本文を入力してください' };
  if ([...body].length > WALL_BODY_MAX) return { ok: false, error: `本文は ${WALL_BODY_MAX} 文字以内で入力してください` };
  return { ok: true, body };
}

/** JST の今日 0:00 を UTC の Date で返す */
export function jstDayStart(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * 3600000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600000);
}

export type WallRateResult = { ok: true } | { ok: false; reason: 'daily' } | { ok: false; reason: 'interval'; retry_after: number };

/**
 * 1 日 N 件（JST。本人削除も数える）と前回からの間隔を判定する。
 * recentCreatedAt はこの店舗でのこの人の投稿日時（順不同）
 */
export function checkWallRate(recentCreatedAt: string[], now: Date, dailyMax = WALL_DAILY_MAX, minIntervalSec = WALL_MIN_INTERVAL_SEC): WallRateResult {
  const dayStart = jstDayStart(now).getTime();
  const times = recentCreatedAt.map((s) => new Date(s).getTime()).filter((t) => Number.isFinite(t));
  if (times.filter((t) => t >= dayStart).length >= dailyMax) return { ok: false, reason: 'daily' };
  const last = times.length > 0 ? Math.max(...times) : null;
  if (last !== null) {
    const elapsed = (now.getTime() - last) / 1000;
    if (elapsed < minIntervalSec) return { ok: false, reason: 'interval', retry_after: Math.ceil(minIntervalSec - elapsed) };
  }
  return { ok: true };
}

export function wallRateMessage(r: Exclude<WallRateResult, { ok: true }>, dailyMax = WALL_DAILY_MAX): string {
  if (r.reason === 'daily') return dailyMax === 1 ? '付箋は 1 日 1 枚まで貼れます。また明日お願いします' : `付箋は 1 日 ${dailyMax} 枚まで貼れます。また明日お願いします`;
  return `続けて貼るには少し時間をあけてください（あと ${r.retry_after} 秒ほど）`;
}

/** 一覧のカーソル（created_at と id）。base64url */
export function encodeWallCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf-8').toString('base64url');
}
export function decodeWallCursor(cursor: unknown): { created_at: string; id: string } | null {
  if (typeof cursor !== 'string' || !cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf-8');
    const [createdAt, id] = raw.split('|');
    if (!createdAt || !id || Number.isNaN(new Date(createdAt).getTime())) return null;
    return { created_at: createdAt, id };
  } catch {
    return null;
  }
}
