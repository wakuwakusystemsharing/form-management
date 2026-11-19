/**
 * 自動配信のきっかけ「いつもの来店間隔に合わせてお誘い」（visit_cycle）
 */
import { describe, expect, it } from 'vitest';
import { AUTOMATION_TEMPLATES, describeAutomationTrigger, evaluateAutomationTrigger, normalizeAutomationTrigger, pickAutomationTargets } from '@/lib/broadcast-automation';
import { VISIT_CYCLE_DEFAULT_TRIGGER, VISIT_CYCLE_MAX_DAYS, VISIT_CYCLE_MIN_DAYS, customerVisitCycleDays, normalizeVisitCycleTrigger, visitCycleDueDays } from '@/lib/broadcast-visit-cycle';
import type { AudienceCustomer, AutomationTrigger, CustomerFacts } from '@/types/broadcast';

const NOW = new Date('2026-11-10T03:00:00Z'); // JST 2026-11-10 12:00
const daysAgo = (n: number) => new Date(Date.parse('2026-11-10T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);

function customer(patch: Partial<AudienceCustomer> = {}): AudienceCustomer {
  return {
    id: 'c1', name: '山田', line_user_id: 'U1', line_display_name: null, line_friend_flag: true, line_blocked_at: null, line_opt_out_at: null,
    tags: [], gender: null, birthday: null, total_visits: 0, total_spent: 0, first_visit_date: null, last_visit_date: null, ...patch,
  };
}
/** 来店 n 回・平均 interval 日おき・最終来店が lastAgo 日前 */
const regular = (n: number, interval: number, lastAgo: number, patch: Partial<AudienceCustomer> = {}) =>
  customer({ total_visits: n, first_visit_date: daysAgo(lastAgo + interval * (n - 1)), last_visit_date: daysAgo(lastAgo), ...patch });

const trigger = (patch: Partial<Extract<AutomationTrigger, { type: 'visit_cycle' }>> = {}): Extract<AutomationTrigger, { type: 'visit_cycle' }> => ({ ...VISIT_CYCLE_DEFAULT_TRIGGER, ...patch });

describe('normalizeVisitCycleTrigger', () => {
  it('値を範囲に収める。来店 1 回の人の日数は空なら null', () => {
    expect(normalizeVisitCycleTrigger({ type: 'visit_cycle' })).toEqual({ type: 'visit_cycle', offset_days: 0, first_visit_days: null });
    expect(normalizeVisitCycleTrigger({ type: 'visit_cycle', offset_days: -100, first_visit_days: 3 })).toEqual({ type: 'visit_cycle', offset_days: -30, first_visit_days: VISIT_CYCLE_MIN_DAYS });
    expect(normalizeVisitCycleTrigger({ type: 'visit_cycle', offset_days: '5', first_visit_days: '45' })).toEqual({ type: 'visit_cycle', offset_days: 5, first_visit_days: 45 });
    expect(normalizeVisitCycleTrigger({ type: 'visit_cycle', offset_days: 1.7, first_visit_days: '' }).first_visit_days).toBeNull();
  });
  it('normalizeAutomationTrigger から使える。テンプレートに入っていて、これからの予約がある人を除く説明つき', () => {
    expect(normalizeAutomationTrigger({ type: 'visit_cycle', offset_days: -3 })).toEqual({ type: 'visit_cycle', offset_days: -3, first_visit_days: null });
    const tpl = AUTOMATION_TEMPLATES.find((t) => t.id === 'visit_cycle');
    expect(tpl?.trigger).toEqual(VISIT_CYCLE_DEFAULT_TRIGGER);
    expect(normalizeAutomationTrigger(tpl?.trigger)).toEqual(tpl?.trigger);
  });
});

describe('customerVisitCycleDays（その人のいつもの来店間隔）', () => {
  it('2 回以上: （最終来店 − 初回来店）÷（回数 − 1）を四捨五入', () => {
    expect(customerVisitCycleDays(regular(4, 30, 10), trigger())).toBe(30);
    expect(customerVisitCycleDays(customer({ total_visits: 3, first_visit_date: '2026-08-01', last_visit_date: '2026-10-05' }), trigger())).toBe(33); // 65 日 ÷ 2 = 32.5
  });
  it('短すぎる間隔は 7 日として扱い、1 年を超える間隔の人は対象外', () => {
    expect(customerVisitCycleDays(customer({ total_visits: 2, first_visit_date: '2026-10-01', last_visit_date: '2026-10-02' }), trigger())).toBe(VISIT_CYCLE_MIN_DAYS);
    expect(customerVisitCycleDays(customer({ total_visits: 2, first_visit_date: '2025-01-01', last_visit_date: '2026-10-01' }), trigger())).toBeNull();
    expect(VISIT_CYCLE_MAX_DAYS).toBe(365);
  });
  it('来店 1 回: ルールの目安の日数。未設定なら対象外', () => {
    const once = customer({ total_visits: 1, first_visit_date: daysAgo(40), last_visit_date: daysAgo(40) });
    expect(customerVisitCycleDays(once, trigger())).toBeNull();
    expect(customerVisitCycleDays(once, trigger({ first_visit_days: 45 }))).toBe(45);
  });
  it('来店の記録が無い人は対象外', () => {
    expect(customerVisitCycleDays(customer(), trigger({ first_visit_days: 45 }))).toBeNull();
  });
});

describe('visitCycleDueDays / evaluateAutomationTrigger', () => {
  it('ちょうど: 最終来店 + いつもの間隔の日から 14 日の間だけ。marker は最終来店日', () => {
    expect(evaluateAutomationTrigger(trigger(), regular(4, 30, 29), NOW)).toBeNull();
    expect(evaluateAutomationTrigger(trigger(), regular(4, 30, 30), NOW)).toBe(`cycle:${daysAgo(30)}`);
    expect(evaluateAutomationTrigger(trigger(), regular(4, 30, 43), NOW)).toBe(`cycle:${daysAgo(43)}`);
    expect(evaluateAutomationTrigger(trigger(), regular(4, 30, 44), NOW)).toBeNull();
  });
  it('◯ 日前 / ◯ 日後にずらせる', () => {
    expect(visitCycleDueDays(trigger({ offset_days: -5 }), regular(4, 30, 0))).toBe(25);
    expect(evaluateAutomationTrigger(trigger({ offset_days: -5 }), regular(4, 30, 25), NOW)).toBe(`cycle:${daysAgo(25)}`);
    expect(evaluateAutomationTrigger(trigger({ offset_days: 7 }), regular(4, 30, 30), NOW)).toBeNull();
    expect(evaluateAutomationTrigger(trigger({ offset_days: 7 }), regular(4, 30, 37), NOW)).toBe(`cycle:${daysAgo(37)}`);
  });
  it('前にずらしても、来店の当日には送らない（最短で翌日）', () => {
    expect(visitCycleDueDays(trigger({ offset_days: -30 }), regular(3, 7, 0))).toBe(1);
  });
  it('来店 1 回の人は目安の日数で判定', () => {
    const once = (ago: number) => customer({ total_visits: 1, first_visit_date: daysAgo(ago), last_visit_date: daysAgo(ago) });
    expect(evaluateAutomationTrigger(trigger(), once(45), NOW)).toBeNull();
    expect(evaluateAutomationTrigger(trigger({ first_visit_days: 45 }), once(44), NOW)).toBeNull();
    expect(evaluateAutomationTrigger(trigger({ first_visit_days: 45 }), once(45), NOW)).toBe(`cycle:${daysAgo(45)}`);
  });
  it('最終来店日が先の日付（これからの予約の来店記録）の人には送らない', () => {
    expect(evaluateAutomationTrigger(trigger(), customer({ total_visits: 4, first_visit_date: daysAgo(90), last_visit_date: daysAgo(-5) }), NOW)).toBeNull();
  });
  it('説明文', () => {
    expect(describeAutomationTrigger(trigger())).toBe('いつもの来店間隔がたった日');
    expect(describeAutomationTrigger(trigger({ offset_days: -3 }))).toBe('いつもの来店間隔の 3 日前');
    expect(describeAutomationTrigger(trigger({ offset_days: 7, first_visit_days: 45 }))).toBe('いつもの来店間隔の 7 日後（来店 1 回の人は 45 日後を目安）');
  });
});

describe('pickAutomationTargets（visit_cycle）', () => {
  const facts = (upcoming: boolean): CustomerFacts => ({ menus: [], formIds: [], hasUpcomingReservation: upcoming, surveyAnswers: [] });
  const base = { trigger: trigger(), audience: {}, resend_after_days: null, now: NOW };

  it('これからの予約がある人には送らない（絞り込みの設定に関係なく）', () => {
    const a = regular(4, 30, 30, { id: 'a', line_user_id: 'UA' });
    const b = regular(4, 30, 30, { id: 'b', line_user_id: 'UB' });
    const targets = pickAutomationTargets({ ...base, customers: [a, b], facts: new Map([['a', facts(true)], ['b', facts(false)]]), sends: [] });
    expect(targets.map((t) => t.customer.id)).toEqual(['b']);
  });

  it('同じ最終来店日には 1 回だけ。次に来店すると、また対象になる', () => {
    const c = regular(4, 30, 30);
    const sent = [{ customer_id: 'c1', marker: `cycle:${daysAgo(30)}`, sent_at: '2026-11-09T01:00:00Z' }];
    expect(pickAutomationTargets({ ...base, customers: [c], facts: new Map(), sends: sent })).toEqual([]);
    const old = [{ customer_id: 'c1', marker: `cycle:${daysAgo(60)}`, sent_at: '2026-10-10T01:00:00Z' }];
    expect(pickAutomationTargets({ ...base, customers: [c], facts: new Map(), sends: old }).map((t) => t.marker)).toEqual([`cycle:${daysAgo(30)}`]);
  });
});
