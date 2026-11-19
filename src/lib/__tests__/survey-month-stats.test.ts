import { describe, it, expect } from 'vitest';
import { countSurveysByStoreMonth } from '../survey-month-stats';
import { resolveStoreScope } from '../admin-store-scope';

describe('countSurveysByStoreMonth', () => {
  it('店舗 × 月で数える', () => {
    const stats = countSurveysByStoreMonth([
      { store_id: 'a', submitted_at: '2026-10-10T03:00:00Z' },
      { store_id: 'a', submitted_at: '2026-10-20T03:00:00Z' },
      { store_id: 'a', submitted_at: '2026-11-02T03:00:00Z' },
      { store_id: 'b', submitted_at: '2026-10-10T03:00:00Z' },
    ]);
    expect(stats).toEqual(expect.arrayContaining([
      { store_id: 'a', month: '2026-10', count: 2 },
      { store_id: 'a', month: '2026-11', count: 1 },
      { store_id: 'b', month: '2026-10', count: 1 },
    ]));
    expect(stats).toHaveLength(3);
  });

  it('月は日本時間で分ける（1 日の 0:00〜8:59 は当月）', () => {
    // 2026-10-31 15:00 UTC = 2026-11-01 00:00 JST
    expect(countSurveysByStoreMonth([{ store_id: 'a', submitted_at: '2026-10-31T15:00:00Z' }]))
      .toEqual([{ store_id: 'a', month: '2026-11', count: 1 }]);
    // 2026-10-31 14:59 UTC = 2026-10-31 23:59 JST
    expect(countSurveysByStoreMonth([{ store_id: 'a', submitted_at: '2026-10-31T14:59:59Z' }]))
      .toEqual([{ store_id: 'a', month: '2026-10', count: 1 }]);
  });

  it('回答日時が無ければ作成日時、どちらも無い / 店舗が無い行は数えない', () => {
    expect(countSurveysByStoreMonth([
      { store_id: 'a', created_at: '2026-09-05T03:00:00Z' },
      { store_id: 'a' },
      { store_id: null, submitted_at: '2026-09-05T03:00:00Z' },
      { store_id: 'a', submitted_at: 'abc' },
    ])).toEqual([{ store_id: 'a', month: '2026-09', count: 1 }]);
  });
});

describe('resolveStoreScope', () => {
  it('全店舗を見られる人（allowed = null）は指定どおり', () => {
    expect(resolveStoreScope(null, null)).toEqual({ ok: true, storeIds: null });
    expect(resolveStoreScope(null, 's1')).toEqual({ ok: true, storeIds: ['s1'] });
  });
  it('見られる店舗が決まっている人は、その中だけ', () => {
    expect(resolveStoreScope(['s1', 's2'], null)).toEqual({ ok: true, storeIds: ['s1', 's2'] });
    expect(resolveStoreScope(['s1', 's2'], 's2')).toEqual({ ok: true, storeIds: ['s2'] });
  });
  it('見られない店舗を指定したら拒否', () => {
    expect(resolveStoreScope(['s1'], 'zzz')).toEqual({ ok: false });
  });
});
