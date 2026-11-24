import { describe, expect, it } from 'vitest';
import { buildCustomerFacts } from '../broadcast-audience';
import type { AudienceCustomer } from '@/types/broadcast';
import {
  RICH_MENU_BULK_MAX,
  chunkUserIds,
  diffRichMenuAssignments,
  isRuleEmpty,
  normalizeRichMenuRule,
  planRichMenuAssignments,
  reorderRuleMenus,
  sortRuleMenus,
  type PublishedRuleMenu,
  type RichMenuLink,
} from '../line-rich-menu-rules';

const NOW = new Date('2026-11-25T03:00:00Z');

function customer(id: string, over: Partial<AudienceCustomer> = {}): AudienceCustomer {
  return {
    id,
    name: id,
    line_user_id: `U-${id}`,
    line_display_name: null,
    line_friend_flag: true,
    line_blocked_at: null,
    line_opt_out_at: null,
    tags: [],
    gender: null,
    birthday: null,
    total_visits: 0,
    total_spent: 0,
    first_visit_date: null,
    last_visit_date: null,
    ...over,
  };
}

const customers = [
  customer('vip-tag', { tags: ['VIP'], total_visits: 12 }),
  customer('repeat', { total_visits: 3 }),
  customer('new', { total_visits: 0 }),
  customer('no-line', { line_user_id: null, tags: ['VIP'] }),
  customer('blocked', { tags: ['VIP'], line_friend_flag: false, line_blocked_at: '2026-11-01T00:00:00Z' }),
  customer('opt-out', { tags: ['VIP'], line_opt_out_at: '2026-11-01T00:00:00Z' }),
];
const facts = buildCustomerFacts({ customers, reservations: [], visits: [], surveys: [], today: '2026-11-25' });

const vipMenu: PublishedRuleMenu = { id: 'm-vip', line_rich_menu_id: 'rm-vip', rule: { audience: { tags: { mode: 'any', values: ['VIP'] } }, order: 0 } };
const repeatMenu: PublishedRuleMenu = { id: 'm-repeat', line_rich_menu_id: 'rm-repeat', rule: { audience: { visits: { min: 2 } }, order: 1 } };

describe('normalizeRichMenuRule', () => {
  it('条件と優先順位を読む。文字列（JSON）でも読める', () => {
    expect(normalizeRichMenuRule({ audience: { tags: { mode: 'any', values: ['VIP'] } }, order: 2 })).toEqual({ audience: { tags: { mode: 'any', values: ['VIP'] } }, order: 2 });
    expect(normalizeRichMenuRule(JSON.stringify({ audience: { visits: { min: 2 } }, order: '1' }))).toEqual({ audience: { visits: { min: 2 } }, order: 1 });
  });

  it('お客様ごとのメニューでなければ null', () => {
    expect(normalizeRichMenuRule(null)).toBeNull();
    expect(normalizeRichMenuRule(undefined)).toBeNull();
    expect(normalizeRichMenuRule('{こわれた')).toBeNull();
    expect(normalizeRichMenuRule([])).toBeNull();
    expect(normalizeRichMenuRule({ enabled: false, audience: { visits: { min: 2 } } })).toBeNull();
  });

  it('条件が 1 つも無いものは「空」（全員に出すなら全員向けのメニューにする）', () => {
    expect(isRuleEmpty({ audience: {}, order: 0 })).toBe(true);
    expect(isRuleEmpty({ audience: { visits: { min: 2 } }, order: 0 })).toBe(false);
    expect(isRuleEmpty({ audience: { customer_ids: ['c1'] }, order: 0 })).toBe(false);
  });
});

describe('優先順位', () => {
  const menus = [
    { id: 'b', rule: { audience: {}, order: 1 }, created_at: '2026-11-02' },
    { id: 'n', rule: null, created_at: '2026-11-01' },
    { id: 'a', rule: { audience: {}, order: 0 }, created_at: '2026-11-03' },
    { id: 'c', rule: { audience: {}, order: 1 }, created_at: '2026-11-01' },
  ];

  it('order の小さい順、同じなら作った順。全員向けのメニューは入らない', () => {
    expect(sortRuleMenus(menus).map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('並べ替えると、0 から順に振り直す。知らない ID・重なった ID は無視し、渡されなかったメニューは後ろに付ける', () => {
    expect(reorderRuleMenus(menus, ['b', 'a', 'c'])).toEqual([{ id: 'b', order: 0 }, { id: 'a', order: 1 }, { id: 'c', order: 2 }]);
    expect(reorderRuleMenus(menus, ['b', 'nope', 'b', 'n'])).toEqual([{ id: 'b', order: 0 }, { id: 'a', order: 1 }, { id: 'c', order: 2 }]);
  });
});

describe('planRichMenuAssignments（だれに、どのメニューを出すか）', () => {
  it('条件に合う人だけにメニューを出す。どの条件にも合わない人は入らない（= 全員向けを見る）', () => {
    const plan = planRichMenuAssignments({ menus: [vipMenu, repeatMenu], customers, facts, now: NOW });
    expect(Object.fromEntries([...plan].map(([u, a]) => [u, a.menu_id]))).toEqual({ 'U-vip-tag': 'm-vip', 'U-repeat': 'm-repeat', 'U-opt-out': 'm-vip' });
    expect(plan.has('U-new')).toBe(false);
  });

  it('条件が重なる人は、上にあるメニューになる', () => {
    // VIP タグの人は来店 12 回なので、どちらの条件にも合う
    const vipFirst = planRichMenuAssignments({ menus: [vipMenu, repeatMenu], customers, facts, now: NOW });
    expect(vipFirst.get('U-vip-tag')?.menu_id).toBe('m-vip');
    const repeatFirst = planRichMenuAssignments({ menus: [repeatMenu, vipMenu], customers, facts, now: NOW });
    expect(repeatFirst.get('U-vip-tag')?.menu_id).toBe('m-repeat');
  });

  it('LINE と連携していない人・ブロックされている人は対象外。配信停止の人には出す（メニューは配信ではない）', () => {
    const plan = planRichMenuAssignments({ menus: [vipMenu], customers, facts, now: NOW });
    expect(plan.has('U-blocked')).toBe(false);
    expect([...plan.keys()].sort()).toEqual(['U-opt-out', 'U-vip-tag']);
  });

  it('お客様ごとのメニューが無ければ、だれにも出さない', () => {
    expect(planRichMenuAssignments({ menus: [], customers, facts, now: NOW }).size).toBe(0);
  });
});

describe('diffRichMenuAssignments（いまの設定との差）', () => {
  const link = (user: string, menu: string, rm: string): RichMenuLink => ({ line_user_id: user, menu_id: menu, line_rich_menu_id: rm });
  const desired = new Map([
    ['U-a', { menu_id: 'm-vip', line_rich_menu_id: 'rm-vip' }],
    ['U-b', { menu_id: 'm-vip', line_rich_menu_id: 'rm-vip' }],
    ['U-c', { menu_id: 'm-repeat', line_rich_menu_id: 'rm-repeat' }],
  ]);

  it('新しく条件に合った人は設定し、合わなくなった人は外し、変わらない人には何もしない', () => {
    const diff = diffRichMenuAssignments([link('U-a', 'm-vip', 'rm-vip'), link('U-gone', 'm-vip', 'rm-vip')], desired);
    expect(diff.unchanged).toBe(1);
    expect(diff.unlink).toEqual(['U-gone']);
    expect(diff.link).toEqual([
      { menu_id: 'm-vip', line_rich_menu_id: 'rm-vip', user_ids: ['U-b'] },
      { menu_id: 'm-repeat', line_rich_menu_id: 'rm-repeat', user_ids: ['U-c'] },
    ]);
  });

  it('別のメニューに変わる人は、設定し直す（外してから付ける必要はない）', () => {
    const diff = diffRichMenuAssignments([link('U-c', 'm-vip', 'rm-vip')], desired);
    expect(diff.link.find((g) => g.line_rich_menu_id === 'rm-repeat')?.user_ids).toEqual(['U-c']);
    expect(diff.unlink).toEqual([]);
  });

  it('メニューを作り直して LINE 側の ID が変わったら、全員を設定し直す', () => {
    const diff = diffRichMenuAssignments([link('U-a', 'm-vip', 'rm-vip-old'), link('U-b', 'm-vip', 'rm-vip-old')], desired);
    expect(diff.link.find((g) => g.line_rich_menu_id === 'rm-vip')?.user_ids).toEqual(['U-a', 'U-b']);
    expect(diff.unchanged).toBe(0);
  });

  it('あるべき設定が空なら、全員を外す', () => {
    expect(diffRichMenuAssignments([link('U-a', 'm-vip', 'rm-vip')], new Map())).toEqual({ link: [], unlink: ['U-a'], unchanged: 0 });
  });
});

describe('chunkUserIds', () => {
  it('500 人ずつに分ける', () => {
    const ids = Array.from({ length: 1201 }, (_, i) => `U${i}`);
    const chunks = chunkUserIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([RICH_MENU_BULK_MAX, RICH_MENU_BULK_MAX, 201]);
    expect(chunks.flat()).toEqual(ids);
    expect(chunkUserIds([])).toEqual([]);
  });
});
