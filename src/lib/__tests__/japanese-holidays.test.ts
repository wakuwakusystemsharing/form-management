import { describe, expect, it } from 'vitest';
import { getEffectiveHolidayType, isHolidayBlocked, isJapaneseHoliday } from '@/lib/japanese-holidays';
import { HOLIDAY_RUNTIME_JS } from '@/lib/multiple-dates-runtime-js';

describe('japanese-holidays（TS 版の祝日判定）', () => {
  it('主な祝日・振替休日・国民の休日', () => {
    expect(getEffectiveHolidayType('2026-01-01')).toBe('new_year');
    expect(getEffectiveHolidayType('2026-01-12')).toBe('coming_of_age');  // 1 月第 2 月曜
    expect(getEffectiveHolidayType('2026-03-20')).toBe('vernal_equinox');
    expect(getEffectiveHolidayType('2026-05-06')).toBe('substitute');     // 5/3 が日曜 → 5/6 振替
    expect(getEffectiveHolidayType('2026-09-22')).toBe('national_day');   // 敬老の日 9/21 と秋分の日 9/23 に挟まれる
    expect(getEffectiveHolidayType('2026-11-03')).toBe('culture');
    expect(getEffectiveHolidayType('2026-11-04')).toBeNull();
    expect(isJapaneseHoliday('2026-08-11')).toBe(true);
    expect(isJapaneseHoliday('not-a-date')).toBe(false);
  });

  it('isHolidayBlocked: holidays_as_closed と excluded_holiday_types', () => {
    expect(isHolidayBlocked(undefined, '2026-11-03')).toBe(false);
    expect(isHolidayBlocked({ holidays_as_closed: true }, '2026-11-03')).toBe(true);
    expect(isHolidayBlocked({ holidays_as_closed: true, excluded_holiday_types: ['culture'] }, '2026-11-03')).toBe(false);
    expect(isHolidayBlocked({ holidays_as_closed: true }, '2026-11-04')).toBe(false);
  });

  it('静的 HTML の HOLIDAY_RUNTIME_JS と 2024〜2030 年の全日で一致する', () => {
    const runtime = new Function(`${HOLIDAY_RUNTIME_JS}; return getEffectiveHolidayType;`)() as (d: Date) => string | null;
    for (let y = 2024; y <= 2030; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 31; d++) {
          const dt = new Date(y, m - 1, d);
          if (dt.getMonth() !== m - 1) continue;
          const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          expect(getEffectiveHolidayType(ymd), ymd).toBe(runtime(dt));
        }
      }
    }
  });
});
