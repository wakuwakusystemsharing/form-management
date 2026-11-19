/**
 * 配信の成果（配信 → 予約数・売上）の集計（純粋ロジック。DB 非依存）
 * 設計: docs/配信の成果_実装設計.md
 *
 * 配信を受け取った人が、送信のあと N 日以内（3 / 7 / 14）に入れた予約を数える。
 * - 受け取った人の予約 … 送信済みの宛先の、送信時刻以降に受け付けた予約すべて（参考値。配信と関係ない予約も含まれる）
 * - タップした人の予約 … そのうち、配信のボタンをタップした人が、タップより後に受け付けた予約
 * 予約は顧客 ID → LINE ユーザー ID の順で宛先に紐付ける。キャンセルは数えない。
 * 売上は予約分析と同じ（メニュー + オプション + 宿泊料金 + 指名料 = reservationAmount）
 */
import { menuDisplayName, reservationAmount, type AnalyticsReservation } from './reservation-analytics';

export const RESULT_WINDOW_OPTIONS = [3, 7, 14] as const;
export const RESULT_WINDOW_DEFAULT = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 期間（日数）。3 / 7 / 14 以外は 7 */
export function normalizeResultWindow(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return (RESULT_WINDOW_OPTIONS as readonly number[]).includes(n) ? n : RESULT_WINDOW_DEFAULT;
}

export interface ResultRecipient {
  id: string;
  customer_id: string;
  line_user_id: string;
  display_name: string | null;
  status: string;
  sent_at: string | null;
  /** 配信のボタンを最初にタップした日時（タップしていない / 記録していない配信は null） */
  tapped_at: string | null;
}

export interface ResultReservation extends AnalyticsReservation {
  id: string;
  customer_id?: string | null;
  line_user_id?: string | null;
  /** 予約を受け付けた日時 */
  created_at?: string | null;
  menu_name?: string | null;
}

export interface ResultTotals {
  people: number;
  reservations: number;
  revenue: number;
}

export interface ResultRowReservation {
  id: string;
  created_at: string;
  reservation_date: string | null;
  reservation_time: string | null;
  menu: string;
  amount: number;
  /** タップより後に受け付けた予約 */
  via_tap: boolean;
}

export interface BroadcastResultRow {
  recipient_id: string;
  customer_id: string;
  name: string;
  tapped: boolean;
  reservations: ResultRowReservation[];
}

export interface BroadcastResultSummary {
  days: number;
  /** 誰がタップしたかを記録している配信か（古い配信・ボタンの無い配信は false） */
  tracked: boolean;
  /** 送信できた人数 */
  sent: number;
  /** ボタンをタップした人数 */
  tapped_people: number;
  tapped: ResultTotals;
  received: ResultTotals;
  /** まだ期間の途中（これから増えることがある） */
  counting: boolean;
}

export interface BroadcastResult extends BroadcastResultSummary {
  /** 予約した人（タップ経由 → 予約の新しい順） */
  rows: BroadcastResultRow[];
}

function time(v: unknown): number {
  if (typeof v !== 'string' || !v) return NaN;
  return Date.parse(v);
}

function menuLabel(r: ResultReservation): string {
  const names = (Array.isArray(r.selected_menus) ? r.selected_menus : [])
    .map((m) => (m && typeof m === 'object' ? menuDisplayName(m as Record<string, unknown>) : ''))
    .filter((s) => !!s);
  if (names.length > 0) return names.join('、');
  return typeof r.menu_name === 'string' ? r.menu_name : '';
}

export function computeBroadcastResult(recipients: ResultRecipient[], reservations: ResultReservation[], opts: { days: number; tracked: boolean; now?: Date }): BroadcastResult {
  const days = normalizeResultWindow(opts.days);
  const windowMs = days * DAY_MS;
  const now = (opts.now ?? new Date()).getTime();

  const byCustomer = new Map<string, ResultReservation[]>();
  const byLine = new Map<string, ResultReservation[]>();
  const push = (map: Map<string, ResultReservation[]>, key: unknown, r: ResultReservation) => {
    if (typeof key !== 'string' || !key) return;
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  };
  for (const r of reservations) {
    if (r.status === 'cancelled') continue;
    if (Number.isNaN(time(r.created_at))) continue;
    push(byCustomer, r.customer_id, r);
    push(byLine, r.line_user_id, r);
  }

  const tapped: ResultTotals = { people: 0, reservations: 0, revenue: 0 };
  const received: ResultTotals = { people: 0, reservations: 0, revenue: 0 };
  const rows: BroadcastResultRow[] = [];
  const used = new Set<string>(); // 同じ予約を 2 人の宛先に数えない
  let sent = 0;
  let tappedPeople = 0;
  let lastSent = 0;

  for (const rc of recipients) {
    const sentT = time(rc.sent_at);
    if (rc.status !== 'sent' || Number.isNaN(sentT)) continue;
    sent += 1;
    if (sentT > lastSent) lastSent = sentT;
    const tapT = opts.tracked ? time(rc.tapped_at) : NaN;
    const didTap = !Number.isNaN(tapT);
    if (didTap) tappedPeople += 1;

    const list: ResultRowReservation[] = [];
    for (const r of [...(byCustomer.get(rc.customer_id) ?? []), ...(byLine.get(rc.line_user_id) ?? [])]) {
      if (used.has(r.id)) continue;
      const t = time(r.created_at);
      if (t < sentT || t >= sentT + windowMs) continue;
      used.add(r.id);
      list.push({
        id: r.id,
        created_at: r.created_at as string,
        reservation_date: typeof r.reservation_date === 'string' ? r.reservation_date : null,
        reservation_time: typeof r.reservation_time === 'string' ? r.reservation_time : null,
        menu: menuLabel(r),
        amount: reservationAmount(r),
        via_tap: didTap && t >= tapT,
      });
    }
    if (list.length === 0) continue;
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const amount = list.reduce((a, x) => a + x.amount, 0);
    received.people += 1;
    received.reservations += list.length;
    received.revenue += amount;
    const viaTap = list.filter((x) => x.via_tap);
    if (viaTap.length > 0) {
      tapped.people += 1;
      tapped.reservations += viaTap.length;
      tapped.revenue += viaTap.reduce((a, x) => a + x.amount, 0);
    }
    rows.push({ recipient_id: rc.id, customer_id: rc.customer_id, name: (rc.display_name ?? '').trim() || 'お客様', tapped: didTap, reservations: list });
  }

  const latest = (row: BroadcastResultRow) => row.reservations[row.reservations.length - 1].created_at;
  const viaTapRow = (row: BroadcastResultRow) => (row.reservations.some((x) => x.via_tap) ? 0 : 1);
  rows.sort((a, b) => viaTapRow(a) - viaTapRow(b) || latest(b).localeCompare(latest(a)));

  return { days, tracked: opts.tracked, sent, tapped_people: tappedPeople, tapped, received, counting: sent > 0 && now < lastSent + windowMs, rows };
}

/** 一覧用（人ごとの行を除く） */
export function summarizeBroadcastResult(result: BroadcastResult): BroadcastResultSummary {
  const { rows: _rows, ...summary } = result;
  void _rows;
  return summary;
}
