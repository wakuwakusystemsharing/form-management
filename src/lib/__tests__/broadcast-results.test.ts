/**
 * 配信の成果（配信 → 予約数・売上）の集計
 */
import { describe, expect, it } from 'vitest';
import { computeBroadcastResult, normalizeResultWindow, summarizeBroadcastResult, type ResultRecipient, type ResultReservation } from '@/lib/broadcast-results';

const SENT = '2026-11-01T01:00:00.000Z'; // 11/1 10:00 JST
const at = (days: number, hours = 0) => new Date(Date.parse(SENT) + (days * 24 + hours) * 60 * 60 * 1000).toISOString();

function rcp(id: string, patch: Partial<ResultRecipient> = {}): ResultRecipient {
  return { id, customer_id: `c-${id}`, line_user_id: `U-${id}`, display_name: `客${id}`, status: 'sent', sent_at: SENT, tapped_at: null, ...patch };
}
function rsv(id: string, who: string, createdAt: string, patch: Partial<ResultReservation> = {}): ResultReservation {
  return {
    id, customer_id: `c-${who}`, line_user_id: `U-${who}`, created_at: createdAt, status: 'confirmed', reservation_date: '2026-11-10', reservation_time: '10:00',
    selected_menus: [{ menu_name: 'カット', price: 5000 }], selected_options: [], ...patch,
  };
}
const opts = (days = 7, tracked = true) => ({ days, tracked, now: new Date(at(30)) });

describe('normalizeResultWindow', () => {
  it('3 / 7 / 14 だけを受け付け、それ以外は 7', () => {
    expect(normalizeResultWindow('3')).toBe(3);
    expect(normalizeResultWindow(14)).toBe(14);
    expect(normalizeResultWindow('10')).toBe(7);
    expect(normalizeResultWindow(null)).toBe(7);
  });
});

describe('computeBroadcastResult', () => {
  it('受け取った人の予約: 送信後〜期間内に受け付けた予約だけを数える', () => {
    const r = computeBroadcastResult(
      [rcp('1'), rcp('2'), rcp('3')],
      [
        rsv('a', '1', at(1)), // 期間内
        rsv('b', '2', at(-1)), // 送信より前
        rsv('c', '3', at(7, 1)), // 7 日を過ぎている
        rsv('d', '9', at(1)), // 宛先ではない人
      ],
      opts()
    );
    expect(r.sent).toBe(3);
    expect(r.received).toEqual({ people: 1, reservations: 1, revenue: 5000 });
    expect(r.rows.map((x) => x.recipient_id)).toEqual(['1']);
  });

  it('期間を変えると数え直す', () => {
    const recipients = [rcp('1')];
    const reservations = [rsv('a', '1', at(2)), rsv('b', '1', at(5)), rsv('c', '1', at(10))];
    expect(computeBroadcastResult(recipients, reservations, opts(3)).received.reservations).toBe(1);
    expect(computeBroadcastResult(recipients, reservations, opts(7)).received.reservations).toBe(2);
    expect(computeBroadcastResult(recipients, reservations, opts(14)).received).toEqual({ people: 1, reservations: 3, revenue: 15000 });
  });

  it('タップした人の予約: タップより後に受け付けた予約だけ', () => {
    const r = computeBroadcastResult(
      [rcp('1', { tapped_at: at(0, 2) }), rcp('2', { tapped_at: at(3) }), rcp('3')],
      [
        rsv('a', '1', at(0, 3)), // タップの後 → タップ経由
        rsv('b', '2', at(1)), // タップより前の予約 → 受け取った人の予約にだけ数える
        rsv('c', '3', at(1)), // タップしていない
      ],
      opts()
    );
    expect(r.tapped_people).toBe(2);
    expect(r.tapped).toEqual({ people: 1, reservations: 1, revenue: 5000 });
    expect(r.received).toEqual({ people: 3, reservations: 3, revenue: 15000 });
    expect(r.rows.find((x) => x.recipient_id === '1')?.reservations[0].via_tap).toBe(true);
    expect(r.rows.find((x) => x.recipient_id === '2')?.reservations[0].via_tap).toBe(false);
  });

  it('キャンセルした予約は数えない。売上はメニュー + オプション + 指名料', () => {
    const r = computeBroadcastResult(
      [rcp('1', { tapped_at: at(0, 1) })],
      [
        rsv('a', '1', at(1), { status: 'cancelled' }),
        rsv('b', '1', at(2), { selected_menus: [{ menu_name: 'カラー', price: 8000 }], selected_options: [{ name: 'トリートメント', price: 2000 }], customer_info: { nomination_fee: 500 } }),
      ],
      opts()
    );
    expect(r.received).toEqual({ people: 1, reservations: 1, revenue: 10500 });
    expect(r.tapped.revenue).toBe(10500);
    expect(r.rows[0].reservations[0]).toMatchObject({ id: 'b', menu: 'カラー', amount: 10500 });
  });

  it('顧客 ID が無い予約は LINE ユーザー ID で紐付ける。同じ予約を二重に数えない', () => {
    const r = computeBroadcastResult([rcp('1')], [rsv('a', '1', at(1), { customer_id: null }), rsv('b', '1', at(2), { line_user_id: null })], opts());
    expect(r.received.reservations).toBe(2);
    expect(r.rows[0].reservations.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('送信できなかった宛先は対象外', () => {
    const r = computeBroadcastResult([rcp('1', { status: 'failed', sent_at: null }), rcp('2', { status: 'pending', sent_at: null })], [rsv('a', '1', at(1)), rsv('b', '2', at(1))], opts());
    expect(r.sent).toBe(0);
    expect(r.received.reservations).toBe(0);
  });

  it('タップした人を記録していない配信（tracked = false）はタップ経由を数えない', () => {
    const r = computeBroadcastResult([rcp('1', { tapped_at: at(0, 1) })], [rsv('a', '1', at(1))], opts(7, false));
    expect(r.tracked).toBe(false);
    expect(r.tapped_people).toBe(0);
    expect(r.tapped).toEqual({ people: 0, reservations: 0, revenue: 0 });
    expect(r.received.reservations).toBe(1);
  });

  it('期間がまだ終わっていない配信は counting = true', () => {
    expect(computeBroadcastResult([rcp('1')], [], { days: 7, tracked: true, now: new Date(at(3)) }).counting).toBe(true);
    expect(computeBroadcastResult([rcp('1')], [], { days: 7, tracked: true, now: new Date(at(8)) }).counting).toBe(false);
    expect(computeBroadcastResult([rcp('1')], [], { days: 3, tracked: true, now: new Date(at(4)) }).counting).toBe(false);
  });

  it('一覧用の要約には人ごとの行を含めない', () => {
    const full = computeBroadcastResult([rcp('1')], [rsv('a', '1', at(1))], opts());
    const s = summarizeBroadcastResult(full);
    expect(s).not.toHaveProperty('rows');
    expect(s.received.reservations).toBe(1);
  });

  it('予約した人は、タップ経由 → 予約の新しい順に並ぶ', () => {
    const r = computeBroadcastResult(
      [rcp('1'), rcp('2', { tapped_at: at(0, 1) }), rcp('3')],
      [rsv('a', '1', at(1)), rsv('b', '2', at(2)), rsv('c', '3', at(3))],
      opts()
    );
    expect(r.rows.map((x) => x.recipient_id)).toEqual(['2', '3', '1']);
  });
});
