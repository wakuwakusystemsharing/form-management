/**
 * 自動配信のきっかけ「いつもの来店間隔に合わせてお誘い」（visit_cycle。純粋ロジック）
 * 設計: docs/来店周期の自動配信_実装設計.md
 *
 * 固定の「◯ 日後」ではなく、お客様ごとのいつもの来店間隔がたった頃に「そろそろいかがですか」を送る。
 * - いつもの来店間隔 = （最終来店日 − 初回来店日）÷（来店回数 − 1）。連続する来店の間隔の平均と同じ値になる
 *   （customers.average_visit_interval_days と同じ考え方。配信先の判定で読み込んでいる項目だけで計算できる）
 * - 来店 1 回の人は間隔がまだ分からないので、ルールの「目安の日数」（first_visit_days）を使う。未設定なら送らない
 * - 送る日 = 最終来店日 + いつもの来店間隔 + offset_days（マイナス = 前 / プラス = 後）
 * - これからの予約がある人には送らない（pickAutomationTargets で除外）
 * - 同じ最終来店日には 1 回だけ（marker = `cycle:{最終来店日}`）。次に来店すると、また対象になる
 */
import type { AudienceCustomer, AutomationTrigger } from '@/types/broadcast';
import { daysBetween, toJstDate } from '@/lib/broadcast-audience';

export type VisitCycleTrigger = Extract<AutomationTrigger, { type: 'visit_cycle' }>;

/** これより短い間隔は、この日数として扱う（同じ週に 2 回来店しただけの人に翌日送らないため） */
export const VISIT_CYCLE_MIN_DAYS = 7;
/** これより長い間隔の人は対象外（「休眠のお客様へ」の役割） */
export const VISIT_CYCLE_MAX_DAYS = 365;
/** 送る日を前後にずらせる幅 */
export const VISIT_CYCLE_OFFSET_MAX = 30;

export const VISIT_CYCLE_DEFAULT_TRIGGER: VisitCycleTrigger = { type: 'visit_cycle', offset_days: 0, first_visit_days: null };

function toInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function normalizeVisitCycleTrigger(o: Record<string, unknown>): VisitCycleTrigger {
  const offset = toInt(o.offset_days) ?? 0;
  const first = toInt(o.first_visit_days);
  return {
    type: 'visit_cycle',
    offset_days: Math.min(VISIT_CYCLE_OFFSET_MAX, Math.max(-VISIT_CYCLE_OFFSET_MAX, offset)),
    first_visit_days: first === null || first <= 0 ? null : Math.min(VISIT_CYCLE_MAX_DAYS, Math.max(VISIT_CYCLE_MIN_DAYS, first)),
  };
}

/** その人のいつもの来店間隔（日）。分からない / 対象外なら null */
export function customerVisitCycleDays(c: AudienceCustomer, trigger: VisitCycleTrigger): number | null {
  const first = toJstDate(c.first_visit_date);
  const last = toJstDate(c.last_visit_date);
  if (!last) return null;
  const visits = c.total_visits ?? 0;
  if (visits >= 2 && first && first < last) {
    const avg = Math.round(daysBetween(first, last) / (visits - 1));
    if (avg > VISIT_CYCLE_MAX_DAYS) return null;
    return Math.max(VISIT_CYCLE_MIN_DAYS, avg);
  }
  // 来店 1 回（または同じ日の来店だけ）: 間隔がまだ分からない
  return trigger.first_visit_days;
}

/** 最終来店日から何日たったら送るか（最短で翌日）。対象外なら null */
export function visitCycleDueDays(trigger: VisitCycleTrigger, c: AudienceCustomer): number | null {
  const cycle = customerVisitCycleDays(c, trigger);
  return cycle === null ? null : Math.max(1, cycle + trigger.offset_days);
}

export function describeVisitCycleTrigger(t: VisitCycleTrigger): string {
  const when = t.offset_days === 0 ? 'いつもの来店間隔がたった日' : `いつもの来店間隔の ${Math.abs(t.offset_days)} 日${t.offset_days < 0 ? '前' : '後'}`;
  return t.first_visit_days ? `${when}（来店 1 回の人は ${t.first_visit_days} 日後を目安）` : when;
}
