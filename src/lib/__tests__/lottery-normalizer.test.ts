import { describe, expect, it } from 'vitest';
import {
  createDefaultLotteryConfig,
  LOTTERY_DEFAULT_ENTRY_COMPLETE_TEXT,
  LOTTERY_DEFAULT_LOSE_TEXT,
  LOTTERY_DEFAULT_THEME_COLOR,
  LOTTERY_DEFAULT_WIN_TEXT,
  normalizeLotteryConfig,
  normalizeLotteryForm,
  normalizeLotteryPrize,
} from '@/lib/lottery-normalizer';

describe('normalizeLotteryConfig', () => {
  it('空の入力でも完全な既定値を返す', () => {
    const c = normalizeLotteryConfig({});
    expect(c.lottery_type).toBe('instant');
    expect(c.redeem_method).toBe('code');
    expect(c.basic_info).toEqual({ title: '', liff_id: '', theme_color: LOTTERY_DEFAULT_THEME_COLOR });
    expect(c.prizes).toEqual([]);
    expect(c.entry_rules).toEqual({ limit: 'once', require_friend: false, when_sold_out: 'lose', pre_questions: [] });
    expect(c.presentation).toEqual({
      animation: 'scratch',
      scratch_style: 'silver',
      show_probability: false,
      show_stock: false,
      confetti: true,
      win_title: 'おめでとうございます！',
      lose_title: '残念、今回ははずれでした',
    });
    expect(c.messages.win_text).toBe(LOTTERY_DEFAULT_WIN_TEXT);
    expect(c.messages.lose_text).toBe(LOTTERY_DEFAULT_LOSE_TEXT);
    expect(c.messages.push_flex_enabled).toBe(false);
    expect(c.ui_settings).toEqual({ submit_button_text: '抽選する', theme_color: LOTTERY_DEFAULT_THEME_COLOR });
    expect(c.deferred).toBeUndefined();
    expect(c.consolation_prize).toBeUndefined();
  });

  it('null / undefined / 不正 JSON 文字列も既定値になる', () => {
    expect(normalizeLotteryConfig(null).lottery_type).toBe('instant');
    expect(normalizeLotteryConfig(undefined).prizes).toEqual([]);
    expect(normalizeLotteryConfig('{not json').prizes).toEqual([]);
  });

  it('JSON 文字列（Supabase JSONB）をパースする', () => {
    const c = normalizeLotteryConfig(JSON.stringify({ lottery_type: 'deferred', basic_info: { title: 'T' } }));
    expect(c.lottery_type).toBe('deferred');
    expect(c.basic_info.title).toBe('T');
  });

  it('不正な列挙値は既定値に落とす', () => {
    const c = normalizeLotteryConfig({
      lottery_type: 'weird',
      redeem_method: 'nfc',
      entry_rules: { limit: 'weekly', when_sold_out: 'explode' },
      presentation: { animation: 'fireworks', scratch_style: 'diamond' },
    });
    expect(c.lottery_type).toBe('instant');
    expect(c.redeem_method).toBe('code');
    expect(c.entry_rules.limit).toBe('once');
    expect(c.entry_rules.when_sold_out).toBe('lose');
    expect(c.presentation.animation).toBe('scratch');
    expect(c.presentation.scratch_style).toBe('silver');
  });

  it('後日抽選は limit を once に固定し deferred ブロックを補完する', () => {
    const c = normalizeLotteryConfig({ lottery_type: 'deferred', entry_rules: { limit: 'daily' } });
    expect(c.entry_rules.limit).toBe('once');
    expect(c.deferred).toEqual({ entry_complete_text: LOTTERY_DEFAULT_ENTRY_COMPLETE_TEXT });
  });

  it('period_n は period_max を 1 以上の整数に丸める', () => {
    expect(normalizeLotteryConfig({ entry_rules: { limit: 'period_n', period_max: 3 } }).entry_rules.period_max).toBe(3);
    expect(normalizeLotteryConfig({ entry_rules: { limit: 'period_n', period_max: 0 } }).entry_rules.period_max).toBe(1);
    expect(normalizeLotteryConfig({ entry_rules: { limit: 'period_n', period_max: '4' } }).entry_rules.period_max).toBe(4);
    expect(normalizeLotteryConfig({ entry_rules: { limit: 'once', period_max: 3 } }).entry_rules.period_max).toBeUndefined();
  });

  it('任意フィールドは値があるときだけ載せる', () => {
    const c = normalizeLotteryConfig({
      basic_info: { title: 'T', store_name: '', logo_url: 'https://x/logo.png', period: { start_at: '', end_at: '2026-09-30T23:59:59+09:00' } },
      messages: { flex_footer_button: { label: '地図', url: '' } },
    });
    expect('store_name' in c.basic_info).toBe(false);
    expect(c.basic_info.logo_url).toBe('https://x/logo.png');
    expect(c.basic_info.period).toEqual({ end_at: '2026-09-30T23:59:59+09:00' });
    expect(c.messages.flex_footer_button).toBeUndefined();
  });

  it('theme_color は basic_info > ui_settings > 既定 の順', () => {
    expect(normalizeLotteryConfig({ ui_settings: { theme_color: '#123456' } }).basic_info.theme_color).toBe('#123456');
    expect(normalizeLotteryConfig({ basic_info: { theme_color: '#abcdef' }, ui_settings: { theme_color: '#123456' } }).ui_settings.theme_color).toBe('#abcdef');
  });

  it('正規化は冪等', () => {
    const raw = {
      lottery_type: 'deferred',
      basic_info: { title: 'T', liff_id: 'L', period: { end_at: '2026-09-30T23:59:59+09:00' } },
      prizes: [{ id: 'p1', name: 'A', probability: '5', stock: '3', expires_in_days: '30' }],
      consolation_prize: { id: 'c1', name: '残念賞', probability: 0, stock: null },
      entry_rules: { limit: 'period_n', period_max: 2, pre_questions: [{ id: 'q1', type: 'text', title: 'お名前', required: true }] },
    };
    const once = normalizeLotteryConfig(raw);
    const twice = normalizeLotteryConfig(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

describe('normalizeLotteryPrize', () => {
  it('文字列の数値を数値に、空文字の在庫を null に変換する', () => {
    const p = normalizeLotteryPrize({ id: 'p1', name: 'A', probability: '12.5', stock: '', expires_in_days: '7' }, 0);
    expect(p).toEqual({ id: 'p1', name: 'A', probability: 12.5, stock: null, expires_in_days: 7 });
  });
  it('ID が無ければ連番で補う', () => {
    expect(normalizeLotteryPrize({ name: 'A' }, 2).id).toBe('prize_3');
  });
  it('不正な在庫は null', () => {
    expect(normalizeLotteryPrize({ id: 'p', name: 'A', stock: 'abc' }, 0).stock).toBeNull();
  });
});

describe('normalizeLotteryForm', () => {
  it('行の欠落フィールドを補完する', () => {
    const f = normalizeLotteryForm({ id: 'f1', store_id: 's1', config: '{"basic_info":{"title":"T"}}' });
    expect(f.id).toBe('f1');
    expect(f.config.basic_info.title).toBe('T');
    expect(f.draft_config).toBeNull();
    expect(f.status).toBe('inactive');
    expect(f.draft_status).toBe('none');
    expect(f.deferred_draw_status).toBe('accepting');
    expect(f.static_deploy).toBeNull();
    expect(typeof f.created_at).toBe('string');
  });

  it('draft_config と static_deploy を保持する', () => {
    const f = normalizeLotteryForm({
      id: 'f1',
      store_id: 's1',
      config: {},
      draft_config: { basic_info: { title: 'Draft' } },
      status: 'active',
      draft_status: 'draft',
      deferred_draw_status: 'drawn',
      static_deploy: { deployed_at: '2026-09-01T00:00:00Z', deploy_url: 'https://x', status: 'deployed' },
    });
    expect(f.draft_config?.basic_info.title).toBe('Draft');
    expect(f.status).toBe('active');
    expect(f.deferred_draw_status).toBe('drawn');
    expect(f.static_deploy?.deploy_url).toBe('https://x');
  });
});

describe('createDefaultLotteryConfig', () => {
  it('即時抽選: 3 賞品で確率合計 ≤ 100', () => {
    let n = 0;
    const c = createDefaultLotteryConfig({ title: 'T', liff_id: 'L', generateId: () => `id${++n}` });
    expect(c.prizes).toHaveLength(3);
    expect(c.prizes.map((p) => p.id)).toEqual(['id1', 'id2', 'id3']);
    expect(c.prizes.reduce((s, p) => s + p.probability, 0)).toBeLessThanOrEqual(100);
    expect(c.basic_info.liff_id).toBe('L');
  });
  it('後日抽選: 確率 0 / 在庫必須', () => {
    const c = createDefaultLotteryConfig({ title: 'T', lottery_type: 'deferred', generateId: () => 'x' });
    expect(c.lottery_type).toBe('deferred');
    expect(c.prizes.every((p) => p.probability === 0 && (p.stock ?? 0) >= 1)).toBe(true);
    expect(c.deferred?.entry_complete_text).toBe(LOTTERY_DEFAULT_ENTRY_COMPLETE_TEXT);
  });
});
