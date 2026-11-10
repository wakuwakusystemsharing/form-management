import { describe, expect, it } from 'vitest';
import { buildSendSummary, canSendBroadcast, evaluateQuota, jstMonthRange, matchOptKeyword, normalizeBroadcastSettings } from '@/lib/broadcast-quota';
import {
  AUTOMATION_TEMPLATES,
  describeAutomationTrigger,
  evaluateAutomationTrigger,
  isAutomationSendAllowed,
  isAutomationTimeReached,
  normalizeAutomationTrigger,
  normalizeResendAfterDays,
} from '@/lib/broadcast-automation';
import type { AudienceCustomer } from '@/types/broadcast';

const NOW = new Date('2026-11-10T03:00:00Z'); // JST 2026-11-10 12:00

describe('jstMonthRange', () => {
  it('JST の月初〜翌月初', () => {
    expect(jstMonthRange(NOW)).toEqual({ key: '2026-11', start: '2026-10-31T15:00:00.000Z', end: '2026-11-30T15:00:00.000Z' });
    // UTC では 10 月末でも JST では 11 月
    expect(jstMonthRange(new Date('2026-10-31T16:00:00Z')).key).toBe('2026-11');
    expect(jstMonthRange(new Date('2026-12-31T15:00:00Z')).key).toBe('2027-01');
  });
});

describe('evaluateQuota / canSendBroadcast / buildSendSummary', () => {
  it('上限なし', () => {
    const q = evaluateQuota({ limit: null, used: 120, recipients: 84, over_limit: 'confirm' });
    expect(q).toMatchObject({ remaining: null, after: null, exceeds: false, blocked: false, needs_confirm: false, double_confirm: false });
    expect(canSendBroadcast(q, {})).toEqual({ ok: true });
    expect(buildSendSummary({ recipients: 84, messages: 3, quota: q })).toEqual(['84 人に 3 通ずつ送ります（無料通数の消費: 84 通）。', '今月の配信: 120 通（上限なし）']);
  });
  it('上限内', () => {
    const q = evaluateQuota({ limit: 500, used: 120, recipients: 84, over_limit: 'block' });
    expect(q).toMatchObject({ remaining: 380, after: 296, exceeds: false });
    expect(buildSendSummary({ recipients: 84, messages: 1, quota: q })[1]).toBe('今月の残り: 380 通 → 送信後 296 通');
  });
  it('上限超過: block は送れない / confirm は確認が必要', () => {
    const block = evaluateQuota({ limit: 200, used: 150, recipients: 84, over_limit: 'block' });
    expect(block).toMatchObject({ after: -34, exceeds: true, blocked: true, needs_confirm: false });
    expect(canSendBroadcast(block, { confirmed: true })).toMatchObject({ ok: false, code: 'over_limit' });
    const confirm = evaluateQuota({ limit: 200, used: 150, recipients: 84, over_limit: 'confirm' });
    expect(canSendBroadcast(confirm, {})).toMatchObject({ ok: false, code: 'needs_confirm' });
    expect(canSendBroadcast(confirm, { confirmed: true })).toEqual({ ok: true });
    expect(buildSendSummary({ recipients: 84, messages: 1, quota: confirm })[1]).toMatch(/34 通超えます/);
  });
  it('100 人を超えると 2 段階確認', () => {
    expect(evaluateQuota({ limit: null, used: 0, recipients: 100, over_limit: 'confirm' }).double_confirm).toBe(false);
    const q = evaluateQuota({ limit: null, used: 0, recipients: 101, over_limit: 'confirm' });
    expect(q.double_confirm).toBe(true);
    expect(canSendBroadcast(q, {})).toMatchObject({ ok: false, code: 'needs_double_confirm' });
    expect(canSendBroadcast(q, { double_confirmed: true })).toEqual({ ok: true });
  });
});

describe('normalizeBroadcastSettings / matchOptKeyword', () => {
  it('既定値', () => {
    expect(normalizeBroadcastSettings(null)).toEqual({ monthly_limit: null, over_limit: 'confirm', opt_out_keyword: '配信停止', opt_in_keyword: '配信再開', automation_time: '10:00' });
  });
  it('stores の列名でも読める。不正な時刻・同じキーワードは直す', () => {
    const s = normalizeBroadcastSettings({ broadcast_monthly_limit: '500', broadcast_over_limit: 'block', broadcast_opt_out_keyword: ' 停止 ', broadcast_opt_in_keyword: '停止', broadcast_automation_time: '09:00:00' });
    expect(s).toEqual({ monthly_limit: 500, over_limit: 'block', opt_out_keyword: '停止', opt_in_keyword: '配信再開', automation_time: '09:00' });
    expect(normalizeBroadcastSettings({ automation_time: '9:30', monthly_limit: -1 })).toMatchObject({ automation_time: '10:00', monthly_limit: null });
  });
  it('キーワードは前後の空白を除いて完全一致', () => {
    const s = normalizeBroadcastSettings(null);
    expect(matchOptKeyword(' 配信停止 ', s)).toBe('opt_out');
    expect(matchOptKeyword('配信再開', s)).toBe('opt_in');
    expect(matchOptKeyword('配信停止して', s)).toBeNull();
    expect(matchOptKeyword('', s)).toBeNull();
  });
});

function customer(patch: Partial<AudienceCustomer>): AudienceCustomer {
  return { id: 'c1', name: 'n', line_user_id: 'U1', line_display_name: null, line_friend_flag: true, line_opt_out_at: null, tags: [], gender: null, birthday: null, total_visits: 0, total_spent: 0, first_visit_date: null, last_visit_date: null, ...patch };
}

describe('normalizeAutomationTrigger', () => {
  it('種類ごとに値を整える。不正は null', () => {
    expect(normalizeAutomationTrigger({ type: 'dormant', days: '120' })).toEqual({ type: 'dormant', days: 120 });
    expect(normalizeAutomationTrigger({ type: 'dormant' })).toEqual({ type: 'dormant', days: 90 });
    expect(normalizeAutomationTrigger({ type: 'birthday', day: 31 })).toEqual({ type: 'birthday', day: 28 });
    expect(normalizeAutomationTrigger({ type: 'visits_reached', counts: [10, 5, 5, 0] })).toEqual({ type: 'visits_reached', counts: [5, 10] });
    expect(normalizeAutomationTrigger({ type: 'visits_reached', counts: [] })).toBeNull();
    expect(normalizeAutomationTrigger({ type: 'tag_added', tags: [' a ', 'a', ''] })).toEqual({ type: 'tag_added', tags: ['a'] });
    expect(normalizeAutomationTrigger({ type: 'tag_added', tags: [] })).toBeNull();
    expect(normalizeAutomationTrigger({ type: 'x' })).toBeNull();
    expect(normalizeResendAfterDays('')).toBeNull();
    expect(normalizeResendAfterDays(0)).toBeNull();
    expect(normalizeResendAfterDays('180')).toBe(180);
  });
  it('テンプレートのきっかけは（タグ以外）そのまま有効', () => {
    for (const t of AUTOMATION_TEMPLATES) {
      if (t.id === 'tag_added') continue;
      expect(normalizeAutomationTrigger(t.trigger)).toEqual(t.trigger);
    }
  });
});

describe('evaluateAutomationTrigger', () => {
  it('休眠: N 日たってから 14 日の間だけ。marker は最終来店日', () => {
    const t = { type: 'dormant' as const, days: 90 };
    expect(evaluateAutomationTrigger(t, customer({ last_visit_date: '2026-08-12' }), NOW)).toBe('dormant:2026-08-12'); // 90 日前
    expect(evaluateAutomationTrigger(t, customer({ last_visit_date: '2026-08-13' }), NOW)).toBeNull(); // 89 日前
    expect(evaluateAutomationTrigger(t, customer({ last_visit_date: '2026-07-30' }), NOW)).toBe('dormant:2026-07-30'); // 103 日前
    expect(evaluateAutomationTrigger(t, customer({ last_visit_date: '2026-07-29' }), NOW)).toBeNull(); // 104 日前（古い休眠には送らない）
    expect(evaluateAutomationTrigger(t, customer({}), NOW)).toBeNull();
  });
  it('誕生月: その月の指定日以降。marker は年', () => {
    const t = { type: 'birthday' as const, day: 1 };
    expect(evaluateAutomationTrigger(t, customer({ birthday: '1990-11-30' }), NOW)).toBe('birthday:2026');
    expect(evaluateAutomationTrigger(t, customer({ birthday: '1990-12-01' }), NOW)).toBeNull();
    expect(evaluateAutomationTrigger({ type: 'birthday', day: 15 }, customer({ birthday: '1990-11-30' }), NOW)).toBeNull();
    expect(evaluateAutomationTrigger(t, customer({ birthday: null }), NOW)).toBeNull();
  });
  it('初回来店の N 日後', () => {
    const t = { type: 'first_visit_after' as const, days: 7 };
    expect(evaluateAutomationTrigger(t, customer({ first_visit_date: '2026-11-03' }), NOW)).toBe('first_visit');
    expect(evaluateAutomationTrigger(t, customer({ first_visit_date: '2026-11-04' }), NOW)).toBeNull();
    expect(evaluateAutomationTrigger(t, customer({ first_visit_date: '2026-01-01' }), NOW)).toBeNull();
  });
  it('来店 N 回目: 来店の翌日以降・直近だけ。marker は回数', () => {
    const t = { type: 'visits_reached' as const, counts: [5, 10] };
    expect(evaluateAutomationTrigger(t, customer({ total_visits: 5, last_visit_date: '2026-11-09' }), NOW)).toBe('visits:5');
    expect(evaluateAutomationTrigger(t, customer({ total_visits: 5, last_visit_date: '2026-11-10' }), NOW)).toBeNull(); // 当日
    expect(evaluateAutomationTrigger(t, customer({ total_visits: 6, last_visit_date: '2026-11-09' }), NOW)).toBeNull();
    expect(evaluateAutomationTrigger(t, customer({ total_visits: 10, last_visit_date: '2026-06-01' }), NOW)).toBeNull();
  });
  it('タグ: 最初に一致したタグが marker', () => {
    const t = { type: 'tag_added' as const, tags: ['縮毛矯正', 'カラー'] };
    expect(evaluateAutomationTrigger(t, customer({ tags: ['カラー', '縮毛矯正'] }), NOW)).toBe('tag:縮毛矯正');
    expect(evaluateAutomationTrigger(t, customer({ tags: ['パーマ'] }), NOW)).toBeNull();
  });
});

describe('isAutomationSendAllowed / isAutomationTimeReached / describeAutomationTrigger', () => {
  it('同じ marker は送らない。再送間隔の間は別の marker でも送らない', () => {
    const sends = [{ marker: 'dormant:2026-01-01', sent_at: '2026-04-05T01:00:00Z' }];
    expect(isAutomationSendAllowed('dormant:2026-01-01', sends, null, NOW)).toBe(false);
    expect(isAutomationSendAllowed('dormant:2026-08-12', sends, null, NOW)).toBe(true);
    expect(isAutomationSendAllowed('dormant:2026-08-12', sends, 180, NOW)).toBe(true); // 219 日前
    expect(isAutomationSendAllowed('dormant:2026-08-12', sends, 365, NOW)).toBe(false);
    expect(isAutomationSendAllowed('first_visit', [], 30, NOW)).toBe(true);
  });
  it('実行時刻（JST）', () => {
    expect(isAutomationTimeReached('10:00', new Date('2026-11-10T00:59:00Z'))).toBe(false); // JST 9:59
    expect(isAutomationTimeReached('10:00', new Date('2026-11-10T01:00:00Z'))).toBe(true);
    expect(isAutomationTimeReached('bad', new Date('2026-11-10T01:00:00Z'))).toBe(true);
  });
  it('説明文', () => {
    expect(describeAutomationTrigger({ type: 'dormant', days: 90 })).toBe('最終来店から 90 日');
    expect(describeAutomationTrigger({ type: 'visits_reached', counts: [5, 10] })).toBe('来店 5・10 回目の翌日');
    expect(describeAutomationTrigger({ type: 'tag_added', tags: ['a'] })).toBe('タグ 「a」 が付いたとき');
  });
});
