/**
 * 全店舗ランキング（全予約一覧 → ランキングタブ）の純粋ロジック（クライアント / サーバー共用。Vitest 対象）
 * - 予約数（キャンセル除く）/ 売上（メニュー + オプション + 宿泊料金）/ アンケート回答数 / LINE 友だち追加率 / キャンセル率
 * - 期間は予約 = 予約日（YYYY-MM-DD）、アンケート = 回答日時を JST の日付にして判定。友だち追加率は現在の状態（期間に依らない）
 */
import { isCancelledReservation, reservationAmount, type AnalyticsReservation } from '@/lib/reservation-analytics';

export interface RankingStoreInput {
  id: string;
  name: string;
}

export interface RankingReservationInput extends AnalyticsReservation {
  store_id: string;
}

export interface RankingSurveyInput {
  store_id: string;
  submitted_at?: string | null;
  created_at?: string | null;
}

export interface RankingCustomerInput {
  store_id: string;
  line_user_id?: string | null;
  line_friend_flag?: boolean | null;
}

export interface RankingPeriod {
  date_from: string; // YYYY-MM-DD（含む）
  date_to: string;   // YYYY-MM-DD（含む）
}

export interface StoreRankingRow {
  store_id: string;
  store_name: string;
  reservations: number;        // キャンセルを除く予約数
  cancelled: number;           // キャンセル数
  cancel_rate: number | null;  // % （予約 + キャンセルが 0 なら null）
  sales: number;               // 売上（円）
  survey_responses: number;    // アンケート回答数
  line_linked_customers: number;   // LINE 連携済み顧客数（分母）
  line_friend_connected: number;   // うち友だち追加済み
  line_friend_rate: number | null; // %（連携顧客が 0 なら null）
}

export type RankingMetricKey = 'reservations' | 'sales' | 'survey_responses' | 'line_friend_rate' | 'cancel_rate';

export interface RankingMetric {
  key: RankingMetricKey;
  label: string;
  description: string;
  /** true = 大きいほど上位、false = 小さいほど上位 */
  higherIsBetter: boolean;
  /** 期間の影響を受けるか（false なら「現在の状態」と表示） */
  periodic: boolean;
}

export const RANKING_METRICS: RankingMetric[] = [
  { key: 'reservations', label: '予約数', description: 'キャンセルを除いた予約件数（予約日が期間内）', higherIsBetter: true, periodic: true },
  { key: 'sales', label: '売上金額', description: 'メニュー + オプション + 宿泊料金の合計（キャンセル除く）', higherIsBetter: true, periodic: true },
  { key: 'survey_responses', label: 'アンケート回答数', description: '回答日時が期間内のアンケート回答件数', higherIsBetter: true, periodic: true },
  { key: 'line_friend_rate', label: 'LINE 友だち追加率', description: 'LINE 連携済み顧客のうち友だち追加済みの割合（現在の状態）', higherIsBetter: true, periodic: false },
  { key: 'cancel_rate', label: 'キャンセル率（低い順）', description: 'キャンセル ÷（予約 + キャンセル）。予約が 1 件も無い店舗は対象外', higherIsBetter: false, periodic: true },
];

function inPeriod(ymd: string | null | undefined, period: RankingPeriod | null): boolean {
  if (!period) return true;
  if (!ymd) return false;
  return ymd >= period.date_from && ymd <= period.date_to;
}

/** ISO 日時 → JST の YYYY-MM-DD（解釈できなければ null） */
export function toJstYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeStoreRankings(
  stores: RankingStoreInput[],
  reservations: RankingReservationInput[],
  surveys: RankingSurveyInput[],
  customers: RankingCustomerInput[],
  period: RankingPeriod | null
): StoreRankingRow[] {
  const rows = new Map<string, StoreRankingRow>();
  for (const s of stores) {
    if (!s || !s.id) continue;
    rows.set(s.id, {
      store_id: s.id,
      store_name: s.name || s.id,
      reservations: 0,
      cancelled: 0,
      cancel_rate: null,
      sales: 0,
      survey_responses: 0,
      line_linked_customers: 0,
      line_friend_connected: 0,
      line_friend_rate: null,
    });
  }

  for (const r of reservations) {
    const row = rows.get(r?.store_id);
    if (!row) continue;
    const date = typeof r.reservation_date === 'string' ? r.reservation_date.slice(0, 10) : null;
    if (!inPeriod(date, period)) continue;
    if (isCancelledReservation(r)) {
      row.cancelled += 1;
      continue;
    }
    row.reservations += 1;
    row.sales += reservationAmount(r);
  }

  for (const s of surveys) {
    const row = rows.get(s?.store_id);
    if (!row) continue;
    if (!inPeriod(toJstYmd(s.submitted_at || s.created_at), period)) continue;
    row.survey_responses += 1;
  }

  for (const c of customers) {
    const row = rows.get(c?.store_id);
    if (!row || !c.line_user_id) continue;
    row.line_linked_customers += 1;
    if (c.line_friend_flag === true) row.line_friend_connected += 1;
  }

  for (const row of rows.values()) {
    const total = row.reservations + row.cancelled;
    row.cancel_rate = total > 0 ? round1((row.cancelled / total) * 100) : null;
    row.line_friend_rate = row.line_linked_customers > 0 ? round1((row.line_friend_connected / row.line_linked_customers) * 100) : null;
  }
  return [...rows.values()];
}

export interface RankedRow {
  rank: number;
  row: StoreRankingRow;
  value: number;
}

/** 指標で並べ替えて順位を付ける（同値は同順位、次は飛ぶ。値が null の店舗は除外） */
export function rankRows(rows: StoreRankingRow[], metric: RankingMetricKey): RankedRow[] {
  const def = RANKING_METRICS.find((m) => m.key === metric);
  const higher = def ? def.higherIsBetter : true;
  const list = rows
    .map((row) => ({ row, value: row[metric] }))
    .filter((x): x is { row: StoreRankingRow; value: number } => typeof x.value === 'number' && Number.isFinite(x.value))
    .sort((a, b) => (higher ? b.value - a.value : a.value - b.value) || a.row.store_name.localeCompare(b.row.store_name, 'ja'));
  const out: RankedRow[] = [];
  list.forEach((x, i) => {
    const rank = i > 0 && out[i - 1].value === x.value ? out[i - 1].rank : i + 1;
    out.push({ rank, row: x.row, value: x.value });
  });
  return out;
}

export function formatRankingValue(metric: RankingMetricKey, value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  switch (metric) {
    case 'sales':
      return `¥${Math.round(value).toLocaleString('ja-JP')}`;
    case 'line_friend_rate':
    case 'cancel_rate':
      return `${value}%`;
    default:
      return `${value.toLocaleString('ja-JP')}件`;
  }
}
