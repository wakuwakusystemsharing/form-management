/**
 * 流入経路の集計（純粋ロジック。DB 非依存）。設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 5 章
 *
 * - 予約数・売上はキャンセル済みを除く（予約分析と同じ）。キャンセル数は別に数える
 * - 期間は**予約日**（分析のほかのタブと同じ基準）、フォームは予約の form_id で絞り込む
 * - 売上は `reservationAmount`（メニュー + オプション + 宿泊料金 + 指名料）
 * - 経路は削除されない（停止のみ）ので、停止した経路も集計に残す
 * - 経路の無い予約・一覧に無い合言葉は「経路なし」にまとめる
 * - 予約率 = これまでの予約（キャンセルを含む。期間・フォームに依らない）÷ 読まれた数。
 *   読まれた数は累計しか持っていないので、予約の側も累計で割る。目安（100% を超えない）
 */
import { isCancelledReservation, reservationAmount, type AnalyticsReservation } from '@/lib/reservation-analytics';
import type { ReservationSource } from '@/lib/reservation-sources';

export interface SourceStatsReservation extends AnalyticsReservation {
  source_code?: string | null;
}

export interface SourceStatsRow {
  source_id: string;
  code: string;
  name: string;
  active: boolean;
  form_id: string;
  /** 読まれた数（累計） */
  click_count: number;
  /** 期間内の予約数（キャンセル以外） */
  count: number;
  /** 期間内のキャンセル数 */
  cancelled: number;
  /** 期間内の売上（キャンセル以外） */
  revenue: number;
  /** これまでの予約（キャンセルを含む。期間・フォームに依らない） */
  total_bookings: number;
  /** total_bookings ÷ click_count（0〜1）。読まれた数が 0 なら null */
  booking_rate: number | null;
}

export interface SourceStatsTotals {
  count: number;
  cancelled: number;
  revenue: number;
}

export interface SourceStats {
  rows: SourceStatsRow[];
  /** 経路の無い予約 */
  none: SourceStatsTotals;
  /** 期間内の合計（with_source = 経路のある予約数。キャンセル以外） */
  summary: SourceStatsTotals & { with_source: number };
}

export interface SourceStatsOptions {
  dateFrom?: string | null;
  dateTo?: string | null;
  formId?: string | null;
}

function inScope(r: SourceStatsReservation, opts: SourceStatsOptions): boolean {
  if (opts.formId && r.form_id !== opts.formId) return false;
  if (opts.dateFrom || opts.dateTo) {
    const date = typeof r.reservation_date === 'string' ? r.reservation_date.slice(0, 10) : '';
    if (!date) return false;
    if (opts.dateFrom && date < opts.dateFrom) return false;
    if (opts.dateTo && date > opts.dateTo) return false;
  }
  return true;
}

export function computeSourceStats(reservations: SourceStatsReservation[], sources: ReservationSource[], opts: SourceStatsOptions = {}): SourceStats {
  const rowByCode = new Map<string, SourceStatsRow>();
  const touched = new Set<string>();
  for (const s of sources) {
    rowByCode.set(s.code, {
      source_id: s.id,
      code: s.code,
      name: s.name,
      active: s.active,
      form_id: s.form_id,
      click_count: Number(s.click_count) || 0,
      count: 0,
      cancelled: 0,
      revenue: 0,
      total_bookings: 0,
      booking_rate: null,
    });
  }

  const none: SourceStatsTotals = { count: 0, cancelled: 0, revenue: 0 };
  let withSource = 0;

  for (const r of reservations) {
    const row = typeof r.source_code === 'string' && r.source_code ? rowByCode.get(r.source_code) : undefined;
    if (row) row.total_bookings++;
    if (!inScope(r, opts)) continue;
    const target: SourceStatsTotals = row ?? none;
    if (row) touched.add(row.code);
    if (isCancelledReservation(r)) {
      target.cancelled++;
      continue;
    }
    target.count++;
    target.revenue += reservationAmount(r);
    if (row) withSource++;
  }

  const order = new Map(sources.map((s, i) => [s.code, i]));
  const rows = [...rowByCode.values()]
    // フォームで絞り込んだときは、そのフォームを開く経路と、そのフォームで予約が入った経路だけ
    .filter((row) => !opts.formId || row.form_id === opts.formId || touched.has(row.code))
    .map((row) => ({ ...row, booking_rate: row.click_count > 0 ? Math.min(1, row.total_bookings / row.click_count) : null }))
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue || (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));

  const sum = (pick: (t: SourceStatsTotals) => number) => rows.reduce((n, row) => n + pick(row), 0) + pick(none);
  return {
    rows,
    none,
    summary: { count: sum((t) => t.count), with_source: withSource, cancelled: sum((t) => t.cancelled), revenue: sum((t) => t.revenue) },
  };
}
