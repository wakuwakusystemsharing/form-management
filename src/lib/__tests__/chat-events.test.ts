/**
 * 1 対 1 トーク（④-5）: 自動で送ったメッセージの 1 行・利用量 の純粋ロジック
 */
import { describe, expect, it } from 'vitest';
import {
  autoReplyEventText,
  broadcastEventText,
  chatUsageCsv,
  chatUsageMonth,
  followEventText,
  formatBytes,
  isUsageMonth,
  normalizeChatSystemEvent,
  previousUsageMonth,
  reminderEventText,
  sortChatUsageRows,
  waitlistEventText,
  type ChatUsageRow,
} from '@/lib/chat-events';

describe('会話に出す 1 行', () => {
  it('リマインダー・フォロー・配信・空き待ち', () => {
    expect(reminderEventText('11月25日（水） 14:00')).toBe('リマインダーを送信しました（11月25日（水） 14:00 のご予約）');
    expect(reminderEventText('')).toBe('リマインダーを送信しました');
    expect(followEventText()).toBe('フォローメッセージを送信しました');
    expect(broadcastEventText('秋のキャンペーン')).toBe('配信「秋のキャンペーン」を送信しました');
    expect(broadcastEventText('')).toBe('配信を送信しました');
    expect(broadcastEventText('あ'.repeat(80))).toBe(`配信「${'あ'.repeat(60)}…」を送信しました`);
    expect(waitlistEventText('slot_opened')).toContain('空きが出ました');
    expect(waitlistEventText('slot_filled')).toContain('埋まりました');
  });

  it('自動の返信: カードは代わりの文、文字は 1 行目を見出しにする。本文は載せない', () => {
    expect(autoReplyEventText([{ type: 'flex', altText: 'ご予約確認', contents: { secret: '山田 花子 090-1111-2222' } }])).toBe('「ご予約確認」を自動で返信しました');
    expect(autoReplyEventText([{ type: 'text', text: '配信を停止しました。\n再開するには「配信再開」と送ってください。' }])).toBe('「配信を停止しました。」を自動で返信しました');
    expect(autoReplyEventText([{ type: 'flex', altText: 'メニュー' }, { type: 'text', text: 'a' }, { type: 'image' }])).toBe('「メニュー」を自動で返信しました（ほか 2 通）');
    expect(autoReplyEventText([{ type: 'image' }])).toBe('自動で返信しました');
    expect(autoReplyEventText([{ type: 'text', text: 'あ'.repeat(60) }])).toBe(`「${'あ'.repeat(40)}…」を自動で返信しました`);
    expect(autoReplyEventText([])).toBeNull();
    // カードの中身（お客様の名前など）は、1 行に入らない
    expect(autoReplyEventText([{ type: 'flex', altText: 'ご予約確認', contents: { secret: '山田 花子' } }])).not.toContain('山田');
  });

  it('記録する形にそろえる。宛先・文・鍵が欠けているもの、鍵の形がおかしいものは記録しない', () => {
    const e = normalizeChatSystemEvent({ line_user_id: ' U1 ', kind: 'reminder', text: ' リマインダーを\n送信しました ', source_key: 'reminder:abc-123', at: '2026-11-25T03:00:00Z' });
    expect(e).toEqual({ line_user_id: 'U1', kind: 'reminder', text: 'リマインダーを 送信しました', source_key: 'reminder:abc-123', at: '2026-11-25T03:00:00.000Z' });
    expect(normalizeChatSystemEvent({ line_user_id: '', kind: 'follow', text: 'x', source_key: 'k' })).toBeNull();
    expect(normalizeChatSystemEvent({ line_user_id: 'U1', kind: 'follow', text: ' ', source_key: 'k' })).toBeNull();
    expect(normalizeChatSystemEvent({ line_user_id: 'U1', kind: 'follow', text: 'x', source_key: '' })).toBeNull();
    expect(normalizeChatSystemEvent({ line_user_id: 'U1', kind: 'follow', text: 'x', source_key: "a'; drop table" })).toBeNull();
    expect(normalizeChatSystemEvent({ line_user_id: 'U1', kind: 'broadcast', text: 'あ'.repeat(300), source_key: 'k' })?.text).toHaveLength(201);
  });
});

describe('利用量', () => {
  it('月は日本時間で数える（月末の夜・月初の朝）', () => {
    expect(chatUsageMonth(new Date('2026-11-30T14:59:59Z'))).toBe('2026-11'); // 日本時間 11/30 23:59
    expect(chatUsageMonth(new Date('2026-11-30T15:00:00Z'))).toBe('2026-12'); // 日本時間 12/1 0:00
    expect(chatUsageMonth('2026-12-31T15:00:00Z')).toBe('2027-01');
    expect(previousUsageMonth('2026-11')).toBe('2026-10');
    expect(previousUsageMonth('2027-01')).toBe('2026-12');
    expect(isUsageMonth('2026-11')).toBe(true);
    expect(isUsageMonth('2026-13')).toBe(false);
    expect(isUsageMonth('2026-1')).toBe(false);
    expect(isUsageMonth(null)).toBe(false);
  });

  const row = (id: string, name: string, enabled: boolean, inbound: number, outbound: number): ChatUsageRow => ({
    store_id: id,
    store_name: name,
    enabled,
    enabled_at: enabled ? '2026-11-01T00:00:00.000Z' : null,
    current: { inbound, outbound, image_bytes: 1024 * 1024 * 3 },
    previous: { inbound: 1, outbound: 2, image_bytes: 0 },
  });

  it('一覧は ON の店舗が上、その中は合計の多い順', () => {
    const sorted = sortChatUsageRows([row('a', 'A 店', false, 100, 100), row('b', 'B 店', true, 1, 1), row('c', 'C 店', true, 10, 5)]);
    expect(sorted.map((r) => r.store_id)).toEqual(['c', 'b', 'a']);
  });

  it('容量の表示', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(1024 * 1024 * 1.25)).toBe('1.3 MB');
    expect(formatBytes(1024 * 1024 * 250)).toBe('250 MB');
  });

  it('CSV: 先頭に BOM。式として実行されそうな値には印を付け、カンマや引用符を含む値は囲む', () => {
    const csv = chatUsageCsv('2026-11', [row('abc123', '=HYPERLINK("http://evil")', true, 12, 7), row('def456', 'カット, カラーの店', false, 0, 0)]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('店舗ID,店舗名,トーク機能,ON にした日時,2026-11 受信,2026-11 返信,2026-11 画像(MB),2026-10 受信,2026-10 返信,2026-10 画像(MB)');
    expect(lines[1]).toBe(`abc123,"'=HYPERLINK(""http://evil"")",ON,2026-11-01T00:00:00.000Z,12,7,3.0,1,2,0.0`);
    expect(lines[2]).toBe('def456,"カット, カラーの店",OFF,,0,0,3.0,1,2,0.0');
  });
});
