/**
 * 配信の通数見積り・月間上限・店舗設定（純粋ロジック）
 * 仕様: docs/LINE配信機能_仕様書.md §3-6 / §7-4
 *
 * LINE の無料通数は「宛先 × 送信回数」で数える（1 人に 5 通まとめて送っても 1 通）。
 */
import type { BroadcastSettings } from '@/types/broadcast';

export const BROADCAST_DOUBLE_CONFIRM_THRESHOLD = 100; // これを超える人数は 2 段階確認
export const DEFAULT_OPT_OUT_KEYWORD = '配信停止';
export const DEFAULT_OPT_IN_KEYWORD = '配信再開';
export const DEFAULT_AUTOMATION_TIME = '10:00';
export const BROADCAST_KEYWORD_MAX = 20;
export const BROADCAST_MONTHLY_LIMIT_MAX = 1_000_000;

/** JST の月の範囲（[start, end) の ISO 文字列）とキー（YYYY-MM） */
export function jstMonthRange(now: Date): { key: string; start: string; end: string } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const startUtc = Date.UTC(y, m, 1) - 9 * 60 * 60 * 1000;
  const endUtc = Date.UTC(y, m + 1, 1) - 9 * 60 * 60 * 1000;
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start: new Date(startUtc).toISOString(), end: new Date(endUtc).toISOString() };
}

export interface QuotaEvaluation {
  /** 今月すでに配信した通数 */
  used: number;
  limit: number | null;
  /** 送信前の残り（上限なしは null） */
  remaining: number | null;
  /** 送信後の残り（上限なしは null。超える場合は負） */
  after: number | null;
  exceeds: boolean;
  /** 上限超過で送れない（over_limit = block） */
  blocked: boolean;
  /** 上限超過だが確認して送れる（over_limit = confirm） */
  needs_confirm: boolean;
  /** 人数が多いので 2 段階確認が必要 */
  double_confirm: boolean;
}

export function evaluateQuota(input: { limit: number | null; used: number; recipients: number; over_limit: 'confirm' | 'block' }): QuotaEvaluation {
  const used = Math.max(0, Math.floor(input.used));
  const recipients = Math.max(0, Math.floor(input.recipients));
  const limit = input.limit !== null && input.limit >= 0 ? Math.floor(input.limit) : null;
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const after = limit === null ? null : limit - used - recipients;
  const exceeds = after !== null && after < 0;
  return {
    used,
    limit,
    remaining,
    after,
    exceeds,
    blocked: exceeds && input.over_limit === 'block',
    needs_confirm: exceeds && input.over_limit === 'confirm',
    double_confirm: recipients > BROADCAST_DOUBLE_CONFIRM_THRESHOLD,
  };
}

/** 送信前の確認ダイアログに出す文（例: 84 人に 3 通ずつ送ります（無料通数の消費: 84 通）。） */
export function buildSendSummary(input: { recipients: number; messages: number; quota: QuotaEvaluation }): string[] {
  const { recipients, messages, quota } = input;
  const lines = [`${recipients} 人に ${messages} 通${messages > 1 ? 'ずつ' : ''}送ります（無料通数の消費: ${recipients} 通）。`];
  if (quota.limit === null) {
    lines.push(`今月の配信: ${quota.used} 通（上限なし）`);
  } else if (quota.exceeds) {
    lines.push(`今月の上限 ${quota.limit} 通を ${Math.abs(quota.after ?? 0)} 通超えます（配信済み ${quota.used} 通）。`);
    lines.push(quota.blocked ? '上限を超える配信はできない設定です。配信先を減らすか、設定で上限を変更してください。' : '上限を超えて送る場合は確認にチェックを入れてください。');
  } else {
    lines.push(`今月の残り: ${quota.remaining} 通 → 送信後 ${quota.after} 通`);
  }
  if (quota.double_confirm) lines.push(`${BROADCAST_DOUBLE_CONFIRM_THRESHOLD} 人を超える配信です。内容と配信先をもう一度確認してください。`);
  return lines;
}

/** サーバー側の最終判定: 送ってよいか。confirmed = 上限超過の確認済み、double_confirmed = 2 段階確認済み */
export function canSendBroadcast(quota: QuotaEvaluation, flags: { confirmed?: boolean; double_confirmed?: boolean }): { ok: true } | { ok: false; code: 'over_limit' | 'needs_confirm' | 'needs_double_confirm'; error: string } {
  if (quota.blocked) return { ok: false, code: 'over_limit', error: `今月の配信上限（${quota.limit} 通）を超えるため送れません` };
  if (quota.needs_confirm && !flags.confirmed) return { ok: false, code: 'needs_confirm', error: `今月の配信上限（${quota.limit} 通）を超えます。確認のうえ送信してください` };
  if (quota.double_confirm && !flags.double_confirmed) return { ok: false, code: 'needs_double_confirm', error: `${BROADCAST_DOUBLE_CONFIRM_THRESHOLD} 人を超える配信です。もう一度確認してください` };
  return { ok: true };
}

function keyword(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, BROADCAST_KEYWORD_MAX) : '';
  return s || fallback;
}

/** 店舗の配信設定（stores の列。未設定は既定値） */
export function normalizeBroadcastSettings(raw: unknown): BroadcastSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const limitRaw = o.monthly_limit ?? o.broadcast_monthly_limit;
  const limitNum = typeof limitRaw === 'number' ? limitRaw : typeof limitRaw === 'string' && limitRaw.trim() !== '' ? Number(limitRaw) : NaN;
  const time = o.automation_time ?? o.broadcast_automation_time;
  const optOut = keyword(o.opt_out_keyword ?? o.broadcast_opt_out_keyword, DEFAULT_OPT_OUT_KEYWORD);
  let optIn = keyword(o.opt_in_keyword ?? o.broadcast_opt_in_keyword, DEFAULT_OPT_IN_KEYWORD);
  if (optIn === optOut) optIn = optOut === DEFAULT_OPT_IN_KEYWORD ? DEFAULT_OPT_OUT_KEYWORD : DEFAULT_OPT_IN_KEYWORD;
  return {
    monthly_limit: Number.isFinite(limitNum) && limitNum >= 0 ? Math.min(Math.floor(limitNum), BROADCAST_MONTHLY_LIMIT_MAX) : null,
    over_limit: (o.over_limit ?? o.broadcast_over_limit) === 'block' ? 'block' : 'confirm',
    opt_out_keyword: optOut,
    opt_in_keyword: optIn,
    automation_time: typeof time === 'string' && /^([01]\d|2[0-3]):00$/.test(time.slice(0, 5)) ? time.slice(0, 5) : DEFAULT_AUTOMATION_TIME,
  };
}

/** お客様の発言が配信停止 / 再開のキーワードか（前後の空白を除いて完全一致） */
export function matchOptKeyword(text: string, settings: Pick<BroadcastSettings, 'opt_out_keyword' | 'opt_in_keyword'>): 'opt_out' | 'opt_in' | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (t === settings.opt_out_keyword) return 'opt_out';
  if (t === settings.opt_in_keyword) return 'opt_in';
  return null;
}
