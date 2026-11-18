/**
 * 空き待ち（キャンセル待ち）を「日付 → 時間ごとの人数」にまとめる純粋ロジック（管理画面の「日時ごとの人数」。Vitest 対象）
 */
import type { WaitlistStatus } from './waitlist';

export interface WaitlistSlotGroupInput {
  reservation_date: string;
  reservation_time: string;
  customer_name: string | null;
  staff_name: string | null;
  status: WaitlistStatus;
}

export interface WaitlistSlotCount {
  time: string;
  /** その時間を待っている人数（受付中の空き待ち） */
  count: number;
  /** そのうち、空きをお知らせ済みの人数 */
  notified: number;
  names: string[];
  /** 指名されているスタッフ（指名なしは含めない。重複なし） */
  staffNames: string[];
}

export interface WaitlistDayCount {
  date: string;
  total: number;
  slots: WaitlistSlotCount[];
}

/** 受付中（waiting / notified）の空き待ちだけを、日付の早い順・時間の早い順にまとめる */
export function groupWaitlistBySlot(entries: WaitlistSlotGroupInput[]): WaitlistDayCount[] {
  const days = new Map<string, Map<string, WaitlistSlotCount>>();
  for (const e of entries) {
    if (e.status !== 'waiting' && e.status !== 'notified') continue;
    const time = String(e.reservation_time || '').slice(0, 5);
    if (!e.reservation_date || !time) continue;
    let slots = days.get(e.reservation_date);
    if (!slots) {
      slots = new Map();
      days.set(e.reservation_date, slots);
    }
    let slot = slots.get(time);
    if (!slot) {
      slot = { time, count: 0, notified: 0, names: [], staffNames: [] };
      slots.set(time, slot);
    }
    slot.count++;
    if (e.status === 'notified') slot.notified++;
    slot.names.push(e.customer_name || '（お名前なし）');
    if (e.staff_name && !slot.staffNames.includes(e.staff_name)) slot.staffNames.push(e.staff_name);
  }
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, slots]) => {
      const list = [...slots.values()].sort((a, b) => a.time.localeCompare(b.time));
      return { date, total: list.reduce((s, x) => s + x.count, 0), slots: list };
    });
}
