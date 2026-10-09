import { describe, expect, it } from 'vitest';
import { buildWallInsights, extractWallWords, jstWeekStart } from '@/lib/wall-insights';

describe('wall-insights（見どころまとめ）', () => {
  it('カタカナ・漢字・英数字の語だけを取り出し、ひらがな・一般語・NG ワードは数えない', () => {
    const words = extractWallWords('パンケーキが美味しかったです！店長の田中さんも丁寧でした。iPhoneで予約しました', ['田中']);
    expect(words).toEqual(expect.arrayContaining(['パンケーキ', '美味', 'iPhone']));
    expect(words).not.toContain('田中');
    expect(words).not.toContain('丁寧');
    expect(words).not.toContain('予約');
    expect(words.some((w) => /^[ぁ-ん]+$/.test(w))).toBe(false);
    // 全角英数も NFKC で揃える
    expect(extractWallWords('ＷｉＦｉが速い')).toContain('WiFi');
  });

  it('週の始まりは JST の月曜 0:00', () => {
    // 2026-10-09（金）12:00 JST → その週の月曜は 2026-10-05
    expect(jstWeekStart(new Date('2026-10-09T03:00:00Z')).toISOString()).toBe('2026-10-04T15:00:00.000Z');
    // 日曜 23:30 JST はまだ同じ週
    expect(jstWeekStart(new Date('2026-10-11T14:30:00Z')).toISOString()).toBe('2026-10-04T15:00:00.000Z');
  });

  it('週ごとの件数（削除は除く）と、直近 30 日の公開中からよく出る言葉の上位', () => {
    const now = new Date('2026-10-09T03:00:00Z');
    const rows = [
      { body: 'パンケーキ最高', created_at: '2026-10-08T01:00:00Z', status: 'published' },
      { body: 'パンケーキとコーヒー', created_at: '2026-10-01T01:00:00Z', status: 'published' },
      { body: 'コーヒーが美味しい', created_at: '2026-09-29T01:00:00Z', status: 'published' },
      { body: 'パンケーキ（承認待ち）', created_at: '2026-10-08T02:00:00Z', status: 'pending' },
      { body: 'パンケーキ（削除）', created_at: '2026-10-08T03:00:00Z', status: 'deleted' },
      { body: 'パンケーキ（古い）', created_at: '2026-08-01T00:00:00Z', status: 'published' },
    ];
    const r = buildWallInsights(rows, now, { weeks: 3 });
    expect(r.weeks.map((w) => w.week_start)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(r.weeks.map((w) => w.count)).toEqual([0, 2, 2]); // 削除は数えない。承認待ちは数える
    expect(r.total_30d).toBe(3);
    expect(r.words.slice(0, 2)).toEqual([{ word: 'パンケーキ', count: 2 }, { word: 'コーヒー', count: 2 }]);
    expect(r.words.find((w) => w.word === '美味')).toEqual({ word: '美味', count: 1 });
  });
});
