/**
 * 条件付き予約受付開始時間設定（営業時間・ルール → 予約ルール設定 → 予約受付開始時間の下）
 *
 * 「現在時刻が◯時以降なら N 日後の◯時から」のようなルールを複数登録し、
 * 予約受付開始日（min_advance_days）と合わせて「いちばん先になる」ものを採用する。
 * - 例1: 常に 2 日後の 09:30 から → { min_days: 2, start_time: '09:30' }
 * - 例2: 15:00 を過ぎたら翌日は不可（2 日後から） → { from_time: '15:00', min_days: 2 }
 *   （15:00 より前は予約受付開始日の設定どおり = 翌日 OK）
 * 判定は静的 HTML の埋め込み JS（`ADVANCE_RULES_RUNTIME_JS` の `resolveEarliestBookable`）と同じ規則。
 * スタッフごとの希望日時設定でも上書きできる（`StaffScheduleSettings.conditional_advance_rules`）
 */
import type { ConditionalAdvanceRule } from '@/types/form';

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function normalizeHHMM(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const m = TIME_RE.exec(t.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** 保存前 / 読み取り時の正規化。不正な行は除去 */
export function sanitizeConditionalAdvanceRules(raw: unknown): ConditionalAdvanceRule[] {
  if (!Array.isArray(raw)) return [];
  const out: ConditionalAdvanceRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const days = typeof o.min_days === 'number' ? o.min_days : typeof o.min_days === 'string' ? Number(o.min_days) : NaN;
    if (!Number.isFinite(days) || days < 0) continue;
    const rule: ConditionalAdvanceRule = {
      id: typeof o.id === 'string' && o.id ? o.id : `car_${Math.random().toString(36).slice(2, 10)}`,
      min_days: Math.min(Math.floor(days), 365),
    };
    const from = normalizeHHMM(o.from_time);
    if (from) rule.from_time = from;
    const until = normalizeHHMM(o.until_time);
    if (until) rule.until_time = until;
    const start = normalizeHHMM(o.start_time);
    if (start) rule.start_time = start;
    out.push(rule);
  }
  return out;
}

export interface EarliestBookable {
  /** 何日後から（0 = 当日） */
  days: number;
  /** その日の何時から（null = 営業開始から） */
  start_time: string | null;
}

/** 現在時刻にルールが当てはまるか（from_time 以降 かつ until_time より前。未設定の条件は無視） */
export function isAdvanceRuleActive(rule: ConditionalAdvanceRule, now: Date): boolean {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (rule.from_time && nowMin < hhmmToMinutes(rule.from_time)) return false;
  if (rule.until_time && nowMin >= hhmmToMinutes(rule.until_time)) return false;
  return true;
}

/**
 * 予約受付開始日 + 条件付きルールから、現在時刻で「いちばん早く予約できる日時」を求める
 * 日数が大きいものを優先し、同じ日数なら開始時刻が遅いものを採用する
 */
export function resolveEarliestBookable(
  cs: { min_advance_days?: number; conditional_advance_rules?: ConditionalAdvanceRule[] } | null | undefined,
  now: Date = new Date()
): EarliestBookable {
  const base = cs?.min_advance_days;
  let days = typeof base === 'number' && Number.isFinite(base) && base > 0 ? Math.floor(base) : 0;
  let start: string | null = null;
  for (const rule of cs?.conditional_advance_rules || []) {
    if (!isAdvanceRuleActive(rule, now)) continue;
    const d = Math.max(0, Math.floor(rule.min_days || 0));
    const st = rule.start_time || null;
    if (d > days) {
      days = d;
      start = st;
    } else if (d === days && st && (!start || hhmmToMinutes(st) > hhmmToMinutes(start))) {
      start = st;
    }
  }
  return { days, start_time: start };
}

/** 編集画面の説明文（例: 「15:00 以降は 2日後の 09:30 から」） */
export function describeAdvanceRule(rule: ConditionalAdvanceRule): string {
  const cond = rule.from_time && rule.until_time
    ? `現在時刻が ${rule.from_time}〜${rule.until_time} のとき`
    : rule.from_time
      ? `現在時刻が ${rule.from_time} 以降のとき`
      : rule.until_time
        ? `現在時刻が ${rule.until_time} より前のとき`
        : '常に';
  const when = rule.min_days === 0 ? '当日' : `${rule.min_days}日後`;
  return `${cond}、${when}${rule.start_time ? `の ${rule.start_time}` : ''}から予約可能`;
}

/** 静的 HTML に埋め込む共通ロジック（バッククォート不使用） */
export const ADVANCE_RULES_RUNTIME_JS = `
// ========== 条件付き予約受付開始時間（共通ロジック）==========
function arHHMMToMin(t) {
    var m = /^([0-9]{1,2}):([0-9]{2})/.exec(t || '');
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
// 現在時刻にルールが当てはまるか（from_time 以降 かつ until_time より前）
function arRuleActive(rule, now) {
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var from = arHHMMToMin(rule.from_time);
    if (from !== null && nowMin < from) return false;
    var until = arHHMMToMin(rule.until_time);
    if (until !== null && nowMin >= until) return false;
    return true;
}
// 予約受付開始日 + 条件付きルールから、いちばん早く予約できる { days, start_time } を求める
function resolveEarliestBookable(cs, now) {
    var base = cs && cs.min_advance_days;
    var days = (typeof base === 'number' && isFinite(base) && base > 0) ? Math.floor(base) : 0;
    var start = null;
    var rules = (cs && Array.isArray(cs.conditional_advance_rules)) ? cs.conditional_advance_rules : [];
    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (!rule || !arRuleActive(rule, now)) continue;
        var d = Math.max(0, Math.floor(rule.min_days || 0));
        var st = rule.start_time || null;
        if (d > days) { days = d; start = st; }
        else if (d === days && st && (start === null || arHHMMToMin(st) > arHHMMToMin(start))) { start = st; }
    }
    return { days: days, start_time: start };
}
`;
