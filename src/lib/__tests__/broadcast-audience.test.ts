import { describe, expect, it } from 'vitest';
import {
  answerIncludes,
  buildCustomerFacts,
  daysBetween,
  describeAudience,
  isAudienceUnfiltered,
  jstDateOf,
  matchAudience,
  menuLabelsOf,
  normalizeAudience,
  segmentOf,
  selectAudience,
  toJstDate,
} from '@/lib/broadcast-audience';
import type { AudienceCustomer } from '@/types/broadcast';

const NOW = new Date('2026-11-10T03:00:00Z'); // JST 2026-11-10 12:00

function customer(patch: Partial<AudienceCustomer> & { id: string }): AudienceCustomer {
  return {
    name: '山田 花子',
    line_user_id: `U${patch.id}`,
    line_display_name: 'はなこ',
    line_friend_flag: true,
    line_opt_out_at: null,
    tags: [],
    gender: null,
    birthday: null,
    total_visits: 0,
    total_spent: 0,
    first_visit_date: null,
    last_visit_date: null,
    ...patch,
  };
}

describe('日付の補助', () => {
  it('JST の暦日で数える', () => {
    expect(jstDateOf(new Date('2026-11-09T15:00:00Z'))).toBe('2026-11-10');
    expect(jstDateOf(new Date('2026-11-09T14:59:59Z'))).toBe('2026-11-09');
    expect(toJstDate('2026-11-01')).toBe('2026-11-01');
    expect(toJstDate('2026-10-31T16:00:00Z')).toBe('2026-11-01');
    expect(toJstDate('')).toBeNull();
    expect(toJstDate(null)).toBeNull();
    expect(daysBetween('2026-11-01', '2026-11-10')).toBe(9);
    expect(daysBetween('2026-11-10', '2026-11-01')).toBe(-9);
  });
});

describe('normalizeAudience', () => {
  it('空・不正は条件なし（すべての友だち）', () => {
    expect(normalizeAudience(null)).toEqual({});
    expect(normalizeAudience({ tags: { values: [] }, segments: ['x'], birth_month: [0, 13], survey: { form_id: 'a', question: 'q', options: [] } })).toEqual({});
    expect(isAudienceUnfiltered(normalizeAudience({ customer_ids: ['a'] }))).toBe(true);
  });
  it('値を整える（重複除去・範囲・既定のモード）', () => {
    const a = normalizeAudience({
      tags: { mode: 'all', values: ['カラー', ' カラー ', 'パーマ'] },
      exclude_tags: ['NG'],
      segments: ['vip', 'dormant', 'bogus'],
      menus: { names: ['カット'], within_days: '90' },
      forms: ['f1'],
      last_visit: { min_days_ago: 60 },
      visits: { min: 2, max: 9 },
      upcoming_reservation: false,
      gender: ['female', 'x'],
      birth_month: [12, 3, 3],
      survey: { form_id: 's1', question: 'Q1', options: ['はい'] },
    });
    expect(a).toEqual({
      tags: { mode: 'all', values: ['カラー', 'パーマ'] },
      exclude_tags: ['NG'],
      segments: ['vip', 'dormant'],
      menus: { names: ['カット'], within_days: 90 },
      forms: ['f1'],
      last_visit: { min_days_ago: 60 },
      visits: { min: 2, max: 9 },
      upcoming_reservation: false,
      gender: ['female'],
      birth_month: [3, 12],
      survey: { form_id: 's1', question: 'Q1', options: ['はい'] },
    });
    expect(normalizeAudience({ tags: { values: ['a'] } }).tags?.mode).toBe('any');
    expect(isAudienceUnfiltered(a)).toBe(false);
  });
});

describe('segmentOf（顧客管理のセグメントと同じ規則）', () => {
  it('休眠 > VIP > 新規 > リピーター', () => {
    expect(segmentOf({ total_visits: 20, total_spent: 0, first_visit_date: '2025-01-01', last_visit_date: '2026-08-01' }, NOW)).toBe('dormant');
    expect(segmentOf({ total_visits: 10, total_spent: 0, first_visit_date: '2025-01-01', last_visit_date: '2026-11-01' }, NOW)).toBe('vip');
    expect(segmentOf({ total_visits: 1, total_spent: 60000, first_visit_date: '2026-11-01', last_visit_date: '2026-11-01' }, NOW)).toBe('vip');
    expect(segmentOf({ total_visits: 3, total_spent: 0, first_visit_date: '2026-11-01', last_visit_date: '2026-11-05' }, NOW)).toBe('new');
    expect(segmentOf({ total_visits: 3, total_spent: 0, first_visit_date: '2026-09-01', last_visit_date: '2026-11-05' }, NOW)).toBe('repeat');
    expect(segmentOf({ total_visits: 0, total_spent: 0, first_visit_date: null, last_visit_date: null }, NOW)).toBe('new');
  });
});

describe('buildCustomerFacts', () => {
  it('メニュー名のラベル', () => {
    expect(menuLabelsOf({ menu_name: 'カット', submenu_name: 'ショート', category_name: 'ヘア' })).toEqual(['カット', 'カット > ショート', 'ヘア > カット']);
    expect(menuLabelsOf({ name: 'カラー' })).toEqual(['カラー']);
    expect(menuLabelsOf('パーマ')).toEqual(['パーマ']);
    expect(menuLabelsOf({})).toEqual([]);
  });
  it('予約は customer_id → line_user_id の順で紐付け、キャンセルは除く。アンケートは line_user_id', () => {
    const customers = [customer({ id: 'c1' }), customer({ id: 'c2' })];
    const facts = buildCustomerFacts({
      customers,
      today: '2026-11-10',
      reservations: [
        { customer_id: 'c1', form_id: 'f1', reservation_date: '2026-10-01', status: 'confirmed', selected_menus: [{ menu_name: 'カット' }] },
        { customer_id: null, line_user_id: 'Uc2', form_id: 'f2', reservation_date: '2026-11-20', status: 'pending', selected_menus: JSON.stringify([{ menu_name: 'カラー', submenu_name: 'ブリーチ' }]) },
        { customer_id: 'c1', form_id: 'f9', reservation_date: '2026-12-01', status: 'cancelled', selected_menus: [{ menu_name: 'パーマ' }] },
        { customer_id: 'zzz', line_user_id: 'Unobody', form_id: 'f3', reservation_date: '2026-10-01', selected_menus: [] },
      ],
      visits: [{ customer_id: 'c1', visit_date: '2026-09-01T03:00:00Z', treatment_menus: [{ menu_name: 'トリートメント' }] }],
      surveys: [{ line_user_id: 'Uc1', survey_form_id: 's1', responses: { Q1: 'はい' } }],
    });
    const f1 = facts.get('c1')!;
    expect(f1.formIds).toEqual(['f1']);
    expect(f1.hasUpcomingReservation).toBe(false);
    expect(f1.menus.map((m) => m.labels[0])).toEqual(['カット', 'トリートメント']);
    expect(f1.menus[1].date).toBe('2026-09-01');
    expect(f1.surveyAnswers).toEqual([{ form_id: 's1', responses: { Q1: 'はい' } }]);
    const f2 = facts.get('c2')!;
    expect(f2.formIds).toEqual(['f2']);
    expect(f2.hasUpcomingReservation).toBe(true);
    expect(f2.menus[0].labels).toContain('カラー > ブリーチ');
  });
});

describe('matchAudience', () => {
  const c = customer({ id: 'c1', tags: ['カラー', 'VIP候補'], gender: 'female', birthday: '1990-12-24', total_visits: 4, last_visit_date: '2026-09-01', first_visit_date: '2026-01-10' });
  const facts = {
    menus: [{ labels: ['カット', 'カット > ショート'], date: '2026-09-01' }, { labels: ['カラー'], date: '2026-03-01' }],
    formIds: ['f1'],
    hasUpcomingReservation: false,
    surveyAnswers: [{ form_id: 's1', responses: { 興味: 'カラー, 縮毛矯正' } }],
  };
  const match = (a: unknown) => matchAudience(c, facts, normalizeAudience(a), NOW);

  it('条件なしは全員', () => expect(match({})).toBe(true));
  it('タグ: いずれか / すべて / 除外', () => {
    expect(match({ tags: { mode: 'any', values: ['カラー', 'パーマ'] } })).toBe(true);
    expect(match({ tags: { mode: 'all', values: ['カラー', 'パーマ'] } })).toBe(false);
    expect(match({ tags: { mode: 'all', values: ['カラー', 'VIP候補'] } })).toBe(true);
    expect(match({ exclude_tags: ['VIP候補'] })).toBe(false);
  });
  it('セグメント', () => {
    expect(match({ segments: ['repeat'] })).toBe(true);
    expect(match({ segments: ['vip', 'dormant'] })).toBe(false);
  });
  it('メニュー（表示名のどれかに一致。期間指定あり）', () => {
    expect(match({ menus: { names: ['カット > ショート'] } })).toBe(true);
    expect(match({ menus: { names: ['パーマ'] } })).toBe(false);
    expect(match({ menus: { names: ['カラー'], within_days: 90 } })).toBe(false);
    expect(match({ menus: { names: ['カット'], within_days: 90 } })).toBe(true);
  });
  it('フォーム / 最終来店 / 来店回数 / 今後の予約', () => {
    expect(match({ forms: ['f1', 'f2'] })).toBe(true);
    expect(match({ forms: ['f2'] })).toBe(false);
    expect(match({ last_visit: { min_days_ago: 60 } })).toBe(true); // 70 日前
    expect(match({ last_visit: { min_days_ago: 71 } })).toBe(false);
    expect(match({ last_visit: { max_days_ago: 30 } })).toBe(false);
    expect(match({ visits: { min: 4, max: 4 } })).toBe(true);
    expect(match({ visits: { min: 5 } })).toBe(false);
    expect(match({ upcoming_reservation: false })).toBe(true);
    expect(match({ upcoming_reservation: true })).toBe(false);
  });
  it('性別 / 誕生月 / アンケート（複数選択は ", " 区切り）', () => {
    expect(match({ gender: ['female'] })).toBe(true);
    expect(match({ gender: ['male'] })).toBe(false);
    expect(match({ birth_month: [12] })).toBe(true);
    expect(match({ birth_month: [1] })).toBe(false);
    expect(match({ survey: { form_id: 's1', question: '興味', options: ['縮毛矯正'] } })).toBe(true);
    expect(match({ survey: { form_id: 's1', question: '興味', options: ['パーマ'] } })).toBe(false);
    expect(match({ survey: { form_id: 's2', question: '興味', options: ['カラー'] } })).toBe(false);
    expect(answerIncludes(['a', 'b'], 'b')).toBe(true);
    expect(answerIncludes(undefined, 'b')).toBe(false);
  });
  it('種類の違う条件は AND', () => {
    expect(match({ tags: { values: ['カラー'] }, last_visit: { min_days_ago: 60 } })).toBe(true);
    expect(match({ tags: { values: ['カラー'] }, last_visit: { min_days_ago: 90 } })).toBe(false);
  });
  it('個別の追加・除外。個別指定だけなら指定した人だけ', () => {
    expect(match({ segments: ['vip'], customer_ids: ['c1'] })).toBe(true);
    expect(match({ exclude_customer_ids: ['c1'] })).toBe(false);
    expect(match({ customer_ids: ['c1'], exclude_customer_ids: ['c1'] })).toBe(false);
    expect(match({ customer_ids: ['other'] })).toBe(false);
    expect(match({ customer_ids: ['c1'] })).toBe(true);
  });
  it('最終来店・誕生日が無い顧客はその条件に合わない', () => {
    const blank = customer({ id: 'c9' });
    expect(matchAudience(blank, undefined, normalizeAudience({ last_visit: { min_days_ago: 1 } }), NOW)).toBe(false);
    expect(matchAudience(blank, undefined, normalizeAudience({ birth_month: [1] }), NOW)).toBe(false);
    expect(matchAudience(blank, undefined, normalizeAudience({ upcoming_reservation: false }), NOW)).toBe(true);
  });
});

describe('selectAudience', () => {
  it('LINE 未連携・配信停止・ブロック中を除外して数える。同じ LINE ユーザーは 1 人', () => {
    const customers = [
      customer({ id: 'a' }),
      customer({ id: 'b', line_user_id: null }),
      customer({ id: 'c', line_opt_out_at: '2026-11-01T00:00:00Z' }),
      customer({ id: 'd', line_friend_flag: false }),
      customer({ id: 'e', line_user_id: 'Ua' }),
      customer({ id: 'f', line_friend_flag: null }),
      customer({ id: 'g', tags: ['x'] }),
    ];
    const all = selectAudience(customers, new Map(), {}, NOW);
    expect(all.recipients.map((c) => c.id)).toEqual(['a', 'f', 'g']);
    expect(all).toMatchObject({ excluded_no_line: 1, excluded_opt_out: 1, excluded_blocked: 1 });
    const tagged = selectAudience(customers, new Map(), normalizeAudience({ tags: { values: ['x'] } }), NOW);
    expect(tagged.recipients.map((c) => c.id)).toEqual(['g']);
    expect(tagged).toMatchObject({ excluded_no_line: 0, excluded_opt_out: 0, excluded_blocked: 0 });
  });
});

describe('describeAudience', () => {
  it('条件の要約', () => {
    expect(describeAudience({})).toBe('すべての友だち');
    expect(
      describeAudience(
        normalizeAudience({ tags: { mode: 'all', values: ['カラー', 'パーマ'] }, last_visit: { min_days_ago: 60 }, forms: ['f1'], upcoming_reservation: false, birth_month: [12] }),
        { formName: () => 'カット予約' }
      )
    ).toBe('タグ 「カラー」 かつ 「パーマ」 / フォーム 「カット予約」 から予約 / 最終来店 60 日以上前 / 今後の予約なし / 12 月生まれ');
  });
});
