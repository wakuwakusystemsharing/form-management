/**
 * 宿泊モードの埋め込み JS（STAY_RUNTIME_JS）が TS 版の純粋ロジックと同じ結果になることを検証する
 */
import { describe, expect, it } from 'vitest';
import { HOLIDAY_RUNTIME_JS } from '@/lib/multiple-dates-runtime-js';
import { STAY_RUNTIME_JS } from '@/lib/stay-runtime-js';
import {
  computeStayTotal,
  createDefaultStaySettings,
  formatStayRangeJa,
  resolveLongStayDiscount,
  resolveNightPrice,
  resolveRateTable,
} from '@/lib/stay-pricing';
import { isRangeBookable, nightsBetween, selectableCheckoutDates, type NightStatusMap } from '@/lib/stay-availability';
import { isJapaneseHoliday } from '@/lib/japanese-holidays';

type Runtime = {
  stayNightsBetween: (a: string, b: string) => string[];
  stayResolveRateTable: (pricing: unknown, date: string) => { id: string };
  stayResolveNightPrice: (settings: unknown, date: string, counts: Record<string, number>) => number | null;
  stayResolveDiscount: (d: unknown, nights: number, subtotal: number) => { amount: number } | null;
  stayFormatRangeJa: (a: string, b: string, n: number) => string;
  staySelectableCheckouts: (status: NightStatusMap, ci: string, s: unknown) => string[];
  stayRangeBookable: (status: NightStatusMap, ci: string, co: string, s: unknown) => { ok: boolean };
  stayIsHoliday: (d: string) => boolean;
};

const rt = new Function(`${HOLIDAY_RUNTIME_JS}\n${STAY_RUNTIME_JS}\nreturn { stayNightsBetween, stayResolveRateTable, stayResolveNightPrice, stayResolveDiscount, stayFormatRangeJa, staySelectableCheckouts, stayRangeBookable, stayIsHoliday };`)() as Runtime;

function settingsWithTables() {
  const s = createDefaultStaySettings();
  s.pricing.rate_tables.push(
    { id: 'sat', name: '土曜', mode: 'by_count', prices: { '1': 18000, '2': 26000, '3': 32000 }, extra_person_price: 5000 },
    { id: 'obon', name: 'お盆', mode: 'per_person', prices: {}, per_person_price: 15000 },
    { id: 'hol', name: '祝日', mode: 'by_count', prices: { '1': 20000, '2': 28000, '3': 34000 } },
  );
  s.pricing.weekday_rate_table_ids = { '6': 'sat', '5': 'sat' };
  s.pricing.holiday_eve_rate_table_id = 'sat';
  s.pricing.holiday_rate_table_id = 'hol';
  s.pricing.seasons = [{ id: 's', name: 'お盆', start: '2026-08-10', end: '2026-08-16', rate_table_id: 'obon' }];
  s.pricing.date_rate_table_ids = [{ date: '2026-12-31', rate_table_id: 'hol' }];
  s.pricing.long_stay_discounts = [{ min_nights: 3, type: 'percent', value: 10 }, { min_nights: 7, type: 'per_night', value: 3000 }];
  s.guest_categories.push({ id: 'kid', label: '小学生', charge: 'fixed_per_night', price: 3000, min: 0, max: 3, counts_toward_capacity: true });
  return s;
}

describe('STAY_RUNTIME_JS と TS 版の一致', () => {
  it('祝日判定', () => {
    for (const d of ['2026-01-01', '2026-05-06', '2026-09-22', '2026-11-03', '2026-11-04', '2026-08-11']) {
      expect(rt.stayIsHoliday(d), d).toBe(isJapaneseHoliday(d));
    }
  });

  it('料金表の選択と 1 泊の料金（2026 年 8 月・11 月・12 月の全日 × 人数パターン）', () => {
    const s = settingsWithTables();
    const patterns: Array<Record<string, number>> = [{ adult: 1 }, { adult: 2, child: 1 }, { adult: 3 }, { adult: 4 }, { adult: 2, kid: 2 }];
    for (const month of ['2026-08', '2026-11', '2026-12']) {
      for (let d = 1; d <= 31; d++) {
        const date = `${month}-${String(d).padStart(2, '0')}`;
        if (new Date(`${date}T00:00:00Z`).getUTCDate() !== d) continue;
        expect(rt.stayResolveRateTable(s.pricing, date).id, date).toBe(resolveRateTable(s.pricing, date, isJapaneseHoliday).id);
        for (const counts of patterns) {
          expect(rt.stayResolveNightPrice(s, date, counts), `${date} ${JSON.stringify(counts)}`).toBe(resolveNightPrice(s, date, counts, isJapaneseHoliday));
        }
      }
    }
  });

  it('連泊割引と合計', () => {
    const s = settingsWithTables();
    for (const [ci, co] of [['2026-11-05', '2026-11-08'], ['2026-11-01', '2026-11-02'], ['2026-08-09', '2026-08-17'], ['2026-12-28', '2027-01-04']]) {
      const ts = computeStayTotal(s, ci, co, { adult: 2 }, isJapaneseHoliday);
      if ('error' in ts) throw new Error(ts.error);
      const nights = rt.stayNightsBetween(ci, co);
      expect(nights).toEqual(nightsBetween(ci, co));
      const subtotal = nights.reduce((sum, n) => sum + (rt.stayResolveNightPrice(s, n, { adult: 2 }) || 0), 0);
      expect(subtotal).toBe(ts.subtotal);
      const d = rt.stayResolveDiscount(s.pricing.long_stay_discounts, nights.length, subtotal);
      expect(d?.amount ?? 0).toBe(resolveLongStayDiscount(s.pricing.long_stay_discounts, nights.length, subtotal)?.amount ?? 0);
      expect(rt.stayFormatRangeJa(ci, co, nights.length)).toBe(formatStayRangeJa(ci, co, nights.length));
    }
  });

  it('チェックアウト日の選択と範囲の可否', () => {
    const s = createDefaultStaySettings();
    s.max_nights = 3;
    const status: NightStatusMap = {};
    for (let d = 1; d <= 12; d++) {
      const date = `2026-11-${String(d).padStart(2, '0')}`;
      const full = d === 4 || d === 8;
      status[date] = full ? { available: false, remaining: 0, price: 20000, reason: 'full' } : { available: true, remaining: 1, price: 20000 };
    }
    for (const ci of ['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-09']) {
      expect(rt.staySelectableCheckouts(status, ci, s), ci).toEqual(selectableCheckoutDates(status, ci, s));
    }
    for (const [ci, co] of [['2026-11-02', '2026-11-04'], ['2026-11-02', '2026-11-05'], ['2026-11-05', '2026-11-09'], ['2026-11-05', '2026-11-05']]) {
      expect(rt.stayRangeBookable(status, ci, co, s).ok, `${ci}-${co}`).toBe(isRangeBookable(status, ci, co, s).ok);
    }
  });
});
