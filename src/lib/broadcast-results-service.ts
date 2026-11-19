/**
 * 配信の成果（配信 → 予約数・売上）のサーバー側（fs / Supabase に依存。クライアントから import しない）
 * 設計: docs/配信の成果_実装設計.md
 *
 * 集計は保存せず、開いたときに「送信済みの宛先」と「送信後に受け付けた予約」から計算する（純粋ロジック = broadcast-results.ts）
 */
import type { Broadcast } from '@/types/broadcast';
import { payloadsHaveRecipientLinks } from '@/lib/broadcast-items';
import { computeBroadcastResult, normalizeResultWindow, summarizeBroadcastResult, type BroadcastResult, type BroadcastResultSummary } from '@/lib/broadcast-results';
import { getBroadcast, listBroadcasts, listResultRecipients, listResultReservations, type ResultRecipientRow } from '@/lib/broadcast-repository';

/** 一覧で成果を出す配信の数（新しい順） */
export const RESULT_BROADCAST_LIMIT = 30;

/** 送信が始まった配信だけが対象（下書き・予約済み・見送りは対象外） */
function isResultTarget(b: Broadcast): boolean {
  return b.status === 'sent' || b.status === 'sending' || b.status === 'failed';
}

function sentTime(b: Broadcast): string {
  return b.started_at ?? b.scheduled_at ?? b.finished_at ?? b.created_at;
}

function compute(b: Broadcast, recipients: ResultRecipientRow[], reservations: Awaited<ReturnType<typeof listResultReservations>>, days: number, now: Date): BroadcastResult {
  return computeBroadcastResult(recipients, reservations, { days, tracked: b.track_taps && payloadsHaveRecipientLinks(b.payloads), now });
}

/** 配信一覧に出す要約（配信 ID → 要約）。送信できた人が 0 人の配信は含めない */
export async function getBroadcastResultSummaries(storeId: string, rawDays: unknown, now: Date = new Date()): Promise<{ days: number; results: Record<string, BroadcastResultSummary> }> {
  const days = normalizeResultWindow(rawDays);
  const targets = (await listBroadcasts(storeId))
    .filter(isResultTarget)
    .sort((a, b) => sentTime(b).localeCompare(sentTime(a)))
    .slice(0, RESULT_BROADCAST_LIMIT);
  if (targets.length === 0) return { days, results: {} };

  const since = targets.map(sentTime).sort()[0];
  const [recipients, reservations] = await Promise.all([listResultRecipients(targets.map((b) => b.id)), listResultReservations(storeId, since)]);
  const byBroadcast = new Map<string, ResultRecipientRow[]>();
  for (const r of recipients) {
    const list = byBroadcast.get(r.broadcast_id);
    if (list) list.push(r);
    else byBroadcast.set(r.broadcast_id, [r]);
  }
  const results: Record<string, BroadcastResultSummary> = {};
  for (const b of targets) {
    const result = compute(b, byBroadcast.get(b.id) ?? [], reservations, days, now);
    if (result.sent > 0) results[b.id] = summarizeBroadcastResult(result);
  }
  return { days, results };
}

/** 配信 1 件の成果（予約した人の一覧つき）。対象外・他店舗の配信は null */
export async function getBroadcastResultDetail(storeId: string, id: string, rawDays: unknown, now: Date = new Date()): Promise<BroadcastResult | null> {
  const b = await getBroadcast(storeId, id);
  if (!b || !isResultTarget(b)) return null;
  const [recipients, reservations] = await Promise.all([listResultRecipients([b.id]), listResultReservations(storeId, sentTime(b))]);
  return compute(b, recipients, reservations, normalizeResultWindow(rawDays), now);
}
