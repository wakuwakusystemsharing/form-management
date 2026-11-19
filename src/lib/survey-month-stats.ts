/**
 * アンケート回答数の集計（店舗 × 月）。全予約一覧の「集計ダウンロード」用。
 * 月は日本時間で分ける（回答日時は UTC で保存されているため、そのまま切ると
 * 毎月 1 日の 0:00〜8:59 の回答が前の月に入ってしまう）。
 */
import { toJstDate } from '@/lib/broadcast-audience';

export interface SurveyMonthRow {
  store_id?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
}

export interface SurveyMonthStat {
  store_id: string;
  /** YYYY-MM（日本時間） */
  month: string;
  count: number;
}

export function countSurveysByStoreMonth(rows: SurveyMonthRow[]): SurveyMonthStat[] {
  const counts = new Map<string, SurveyMonthStat>();
  for (const r of rows) {
    const sid = r.store_id;
    if (!sid) continue;
    const day = toJstDate(r.submitted_at || r.created_at);
    if (!day) continue;
    const month = day.slice(0, 7);
    const key = `${sid}\t${month}`;
    const entry = counts.get(key) || { store_id: sid, month, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()];
}
