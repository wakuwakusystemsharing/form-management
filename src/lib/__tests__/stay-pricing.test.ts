import { describe, expect, it } from 'vitest';
import type { StaySettings } from '@/types/form';
import {
  computeStayTotal,
  createDefaultStaySettings,
  formatGuestCountsJa,
  formatStayRangeJa,
  paidGuestCount,
  rateTablePrice,
  resolveLongStayDiscount,
  resolveNightPrice,
  resolveRateTable,
  sanitizeStaySettings,
  validateGuestCounts,
} from '@/lib/stay-pricing';

const noHoliday = () => false;

/** 要望どおりの既定値（6歳以上 1〜4 / 0〜5歳 0〜3、基本 14,000 / 20,000 / 26,000） */
function base(): StaySettings {
  return createDefaultStaySettings();
}

describe('stay-pricing: 既定値と正規化', () => {
  it('createDefaultStaySettings: 15:00 / 10:00、1〜7 泊、1 部屋、区分 2 つ、料金表「基本」', () => {
    const s = base();
    expect(s.check_in_time).toBe('15:00');
    expect(s.check_out_time).toBe('10:00');
    expect(s.min_nights).toBe(1);
    expect(s.max_nights).toBe(7);
    expect(s.room_count).toBe(1);
    expect(s.guest_categories.map((c) => [c.id, c.charge, c.min, c.max])).toEqual([
      ['adult', 'adult', 1, 4],
      ['child', 'free', 0, 3],
    ]);
    expect(s.pricing.rate_tables).toHaveLength(1);
    expect(s.pricing.rate_tables[0].prices).toEqual({ '1': 14000, '2': 20000, '3': 26000 });
    expect(s.pricing.default_rate_table_id).toBe(s.pricing.rate_tables[0].id);
    expect(s.show_price_on_calendar).toBe(true);
  });

  it('sanitizeStaySettings: 空 / 不正は既定で補完。料金表 0 件なら基本を作る。参照先の無い ID は基本に戻す', () => {
    const s = sanitizeStaySettings(undefined);
    expect(s.pricing.rate_tables).toHaveLength(1);
    expect(s.guest_categories).toHaveLength(2);

    const t = sanitizeStaySettings({
      check_in_time: '16:00',
      check_out_time: 'bad',
      min_nights: 0,
      max_nights: -3,
      room_count: 2.7,
      closed_weekdays: [0, 7, 'x', 3, 3],
      closed_dates: ['2026-12-31', 'nope'],
      closed_ranges: [{ start: '2026-12-29', end: '2027-01-03' }, { start: '2026-05-05', end: '2026-05-01' }],
      guest_categories: [{ id: 'a', label: '大人', charge: 'adult', min: 1, max: 2, counts_toward_capacity: true }],
      pricing: {
        rate_tables: [{ id: 'r1', name: '平日', mode: 'by_count', prices: { '1': 10000, '2': '15000', x: 1 } }],
        default_rate_table_id: 'missing',
        weekday_rate_table_ids: { '6': 'missing', '5': 'r1' },
        seasons: [
          { id: 's1', name: 'お盆', start: '2026-08-10', end: '2026-08-20', rate_table_id: 'r1' },
          { id: 's2', name: '重なり', start: '2026-08-15', end: '2026-08-25', rate_table_id: 'r1' },
          { id: 's3', name: '別', start: '2026-12-28', end: '2027-01-03', rate_table_id: 'r1' },
        ],
        long_stay_discounts: [{ min_nights: 3, type: 'percent', value: 150 }, { min_nights: 0, type: 'total', value: 100 }],
      },
      block_calendar_ids: ['cal1', 3],
    });
    expect(t.check_in_time).toBe('16:00');
    expect(t.check_out_time).toBe('10:00');
    expect(t.min_nights).toBe(1);
    expect(t.max_nights).toBe(0);
    expect(t.room_count).toBe(2);
    expect(t.closed_weekdays).toEqual([0, 3]);
    expect(t.closed_dates).toEqual(['2026-12-31']);
    expect(t.closed_ranges).toEqual([{ start: '2026-12-29', end: '2027-01-03' }]);
    expect(t.guest_categories).toHaveLength(1);
    expect(t.pricing.rate_tables[0].prices).toEqual({ '1': 10000, '2': 15000 });
    expect(t.pricing.default_rate_table_id).toBe('r1');
    expect(t.pricing.weekday_rate_table_ids).toEqual({ '5': 'r1' });
    // 重なる季節は後のものを捨てる
    expect(t.pricing.seasons?.map((x) => x.id)).toEqual(['s1', 's3']);
    // % は 100 まで、min_nights は 1 以上。泊数の昇順に並べる
    expect(t.pricing.long_stay_discounts).toEqual([{ min_nights: 1, type: 'total', value: 100 }, { min_nights: 3, type: 'percent', value: 100 }]);
    expect(t.block_calendar_ids).toEqual(['cal1']);
  });

  it('sanitizeStaySettings: adult 区分が無ければ先頭を adult にする / 区分 0 件なら既定の 2 区分', () => {
    const s = sanitizeStaySettings({ guest_categories: [{ id: 'k', label: '子ども', charge: 'free', min: 0, max: 2 }] });
    expect(s.guest_categories[0].charge).toBe('adult');
    expect(s.guest_categories[0].min).toBe(1);
    expect(sanitizeStaySettings({ guest_categories: [] }).guest_categories.map((c) => c.id)).toEqual(['adult', 'child']);
  });
});

describe('stay-pricing: 人数', () => {
  it('paidGuestCount は adult 区分の合計。validateGuestCounts は範囲と定員を見る', () => {
    const s = base();
    expect(paidGuestCount(s.guest_categories, { adult: 2, child: 1 })).toBe(2);
    expect(validateGuestCounts(s, { adult: 2, child: 1 })).toEqual({ ok: true });
    expect(validateGuestCounts(s, { adult: 0, child: 1 }).ok).toBe(false);   // adult は 1 以上
    expect(validateGuestCounts(s, { adult: 5 }).ok).toBe(false);             // max 4
    expect(validateGuestCounts(s, { child: 4, adult: 1 }).ok).toBe(false);   // child max 3
    expect(validateGuestCounts({ ...s, total_capacity: 3 }, { adult: 2, child: 2 }).ok).toBe(false); // 定員 3
    expect(validateGuestCounts({ ...s, total_capacity: 3 }, { adult: 2, child: 1 }).ok).toBe(true);
  });

  it('counts_toward_capacity = false の区分は定員に数えない', () => {
    const s = base();
    s.guest_categories[1].counts_toward_capacity = false;
    s.total_capacity = 2;
    expect(validateGuestCounts(s, { adult: 2, child: 3 }).ok).toBe(true);
  });

  it('formatGuestCountsJa: 0 名の区分は省く', () => {
    const s = base();
    expect(formatGuestCountsJa(s.guest_categories, { adult: 2, child: 1 })).toBe('6歳以上 2名 / 0〜5歳 1名');
    expect(formatGuestCountsJa(s.guest_categories, { adult: 1, child: 0 })).toBe('6歳以上 1名');
  });
});

describe('stay-pricing: 料金表の選択', () => {
  function withTables(): StaySettings {
    const s = base();
    s.pricing.rate_tables.push(
      { id: 'sat', name: '土曜', mode: 'by_count', prices: { '1': 18000, '2': 26000, '3': 32000 } },
      { id: 'obon', name: 'お盆', mode: 'by_count', prices: { '1': 30000, '2': 40000, '3': 50000 } },
      { id: 'nye', name: '大晦日', mode: 'by_count', prices: { '1': 60000, '2': 60000, '3': 60000 } },
      { id: 'hol', name: '祝日', mode: 'by_count', prices: { '1': 20000, '2': 28000, '3': 34000 } },
    );
    s.pricing.weekday_rate_table_ids = { '6': 'sat' };
    s.pricing.holiday_eve_rate_table_id = 'sat';
    s.pricing.holiday_rate_table_id = 'hol';
    s.pricing.seasons = [{ id: 's', name: 'お盆', start: '2026-08-10', end: '2026-08-16', rate_table_id: 'obon' }];
    s.pricing.date_rate_table_ids = [{ date: '2026-12-31', rate_table_id: 'nye' }];
    return s;
  }

  it('優先順位: 特定日 > 季節 > 祝日 > 祝前日 > 曜日 > 基本', () => {
    const s = withTables();
    const isHoliday = (d: string) => d === '2026-11-03' || d === '2026-08-11';
    expect(resolveRateTable(s.pricing, '2026-11-04', isHoliday).id).toBe('base');     // 水曜
    expect(resolveRateTable(s.pricing, '2026-11-07', isHoliday).id).toBe('sat');      // 土曜
    expect(resolveRateTable(s.pricing, '2026-11-02', isHoliday).id).toBe('sat');      // 祝前日（11/3 文化の日）
    expect(resolveRateTable(s.pricing, '2026-11-03', isHoliday).id).toBe('hol');      // 祝日当日
    expect(resolveRateTable(s.pricing, '2026-08-11', isHoliday).id).toBe('obon');     // 季節 > 祝日（山の日）
    expect(resolveRateTable(s.pricing, '2026-08-16', isHoliday).id).toBe('obon');     // 季節の終端（含む）
    expect(resolveRateTable(s.pricing, '2026-08-17', isHoliday).id).toBe('base');
    expect(resolveRateTable(s.pricing, '2026-12-31', isHoliday).id).toBe('nye');      // 特定日
  });

  it('祝前日・祝日の料金表が未設定なら曜日 / 基本に落ちる', () => {
    const s = withTables();
    s.pricing.holiday_rate_table_id = undefined;
    s.pricing.holiday_eve_rate_table_id = undefined;
    const isHoliday = (d: string) => d === '2026-11-03';
    expect(resolveRateTable(s.pricing, '2026-11-02', isHoliday).id).toBe('base');
    expect(resolveRateTable(s.pricing, '2026-11-03', isHoliday).id).toBe('base');
  });
});

describe('stay-pricing: 1 泊の料金', () => {
  it('by_count: 表どおり / 最大超えは加算 / 加算なしは null / 表に無い少人数は null', () => {
    const t = { id: 'r', name: 'r', mode: 'by_count' as const, prices: { '2': 20000, '3': 26000 } };
    expect(rateTablePrice(t, 2)).toBe(20000);
    expect(rateTablePrice(t, 3)).toBe(26000);
    expect(rateTablePrice(t, 4)).toBeNull();
    expect(rateTablePrice({ ...t, extra_person_price: 5000 }, 5)).toBe(36000);
    expect(rateTablePrice(t, 1)).toBeNull();
    expect(rateTablePrice(t, 0)).toBeNull();
  });

  it('per_person: 単価 × 有料人数', () => {
    const t = { id: 'r', name: 'r', mode: 'per_person' as const, prices: {}, per_person_price: 8000 };
    expect(rateTablePrice(t, 3)).toBe(24000);
    expect(rateTablePrice({ ...t, per_person_price: undefined }, 3)).toBeNull();
  });

  it('resolveNightPrice: adult 合算 + fixed_per_night の加算。free は 0', () => {
    const s = base();
    s.guest_categories.push({ id: 'kid', label: '小学生', charge: 'fixed_per_night', price: 3000, min: 0, max: 3, counts_toward_capacity: true });
    expect(resolveNightPrice(s, '2026-11-04', { adult: 2, child: 1 }, noHoliday)).toBe(20000);
    expect(resolveNightPrice(s, '2026-11-04', { adult: 2, kid: 2 }, noHoliday)).toBe(26000);
    expect(resolveNightPrice(s, '2026-11-04', { adult: 4 }, noHoliday)).toBeNull(); // 表は 3 名まで
  });
});

describe('stay-pricing: 連泊割引と合計', () => {
  it('resolveLongStayDiscount: min_nights を満たす最大の段階を 1 つ。3 方式。0 円未満にしない', () => {
    const d = [
      { min_nights: 3, type: 'percent' as const, value: 10 },
      { min_nights: 7, type: 'percent' as const, value: 20 },
    ];
    expect(resolveLongStayDiscount(d, 2, 40000)).toBeNull();
    expect(resolveLongStayDiscount(d, 3, 60000)).toEqual({ min_nights: 3, type: 'percent', value: 10, amount: 6000 });
    expect(resolveLongStayDiscount(d, 8, 160000)?.amount).toBe(32000);
    expect(resolveLongStayDiscount([{ min_nights: 2, type: 'per_night', value: 2000 }], 3, 60000)?.amount).toBe(6000);
    expect(resolveLongStayDiscount([{ min_nights: 2, type: 'total', value: 5000 }], 3, 60000)?.amount).toBe(5000);
    expect(resolveLongStayDiscount([{ min_nights: 1, type: 'total', value: 99999 }], 1, 20000)?.amount).toBe(20000);
  });

  it('computeStayTotal: 夜ごとの内訳・小計・割引・合計（土曜を含む 3 泊）', () => {
    const s = base();
    s.pricing.rate_tables.push({ id: 'sat', name: '土曜', mode: 'by_count', prices: { '1': 18000, '2': 26000, '3': 32000 } });
    s.pricing.weekday_rate_table_ids = { '6': 'sat' };
    s.pricing.long_stay_discounts = [{ min_nights: 3, type: 'percent', value: 10 }];
    // 2026-11-05（木）〜 11-08（日）= 11/5, 11/6, 11/7（土）の 3 泊
    const r = computeStayTotal(s, '2026-11-05', '2026-11-08', { adult: 2 }, noHoliday);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.nights).toBe(3);
    expect(r.per_night).toEqual([
      { date: '2026-11-05', rate_table_id: 'base', rate_table_name: '基本', price: 20000 },
      { date: '2026-11-06', rate_table_id: 'base', rate_table_name: '基本', price: 20000 },
      { date: '2026-11-07', rate_table_id: 'sat', rate_table_name: '土曜', price: 26000 },
    ]);
    expect(r.subtotal).toBe(66000);
    expect(r.discount).toEqual({ min_nights: 3, type: 'percent', value: 10, amount: 6600 });
    expect(r.total).toBe(59400);
  });

  it('computeStayTotal: 月またぎ・割引なし・料金が引けない夜はエラー', () => {
    const s = base();
    const r = computeStayTotal(s, '2026-10-31', '2026-11-02', { adult: 1, child: 2 }, noHoliday);
    if ('error' in r) throw new Error(r.error);
    expect(r.nights).toBe(2);
    expect(r.per_night.map((n) => n.date)).toEqual(['2026-10-31', '2026-11-01']);
    expect(r.subtotal).toBe(28000);
    expect(r.discount).toBeNull();
    expect(r.total).toBe(28000);

    expect(computeStayTotal(s, '2026-11-02', '2026-11-01', { adult: 1 }, noHoliday)).toHaveProperty('error');
    expect(computeStayTotal(s, '2026-11-01', '2026-11-02', { adult: 4 }, noHoliday)).toHaveProperty('error');
  });

  it('formatStayRangeJa', () => {
    expect(formatStayRangeJa('2026-11-01', '2026-11-02', 1)).toBe('2026年11月01日（日）〜11月02日（月） 1泊');
    expect(formatStayRangeJa('2026-12-30', '2027-01-02', 3)).toBe('2026年12月30日（水）〜2027年01月02日（土） 3泊');
  });
});

describe('stay-pricing: normalizeForm との接続', () => {
  it('booking_mode = stay なら stay_settings を既定値で作る。他モードでも保存があれば保持。無ければ undefined', async () => {
    const { normalizeForm } = await import('@/lib/form-normalizer');
    const stay = normalizeForm({ id: 'f', store_id: 's', config: { calendar_settings: { booking_mode: 'stay' } } });
    expect(stay.config.calendar_settings.booking_mode).toBe('stay');
    expect(stay.config.calendar_settings.stay_settings?.pricing.rate_tables).toHaveLength(1);
    const kept = normalizeForm({ id: 'f', store_id: 's', config: { calendar_settings: { booking_mode: 'calendar', stay_settings: { max_nights: 5 } } } });
    expect(kept.config.calendar_settings.stay_settings?.max_nights).toBe(5);
    expect(normalizeForm({ id: 'f', store_id: 's', config: {} }).config.calendar_settings.stay_settings).toBeUndefined();
  });
});
