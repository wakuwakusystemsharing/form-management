/**
 * リッチメニューの「お客様ごとの切り替え」（③-3）の純粋ロジック
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 7 章
 *
 * - メニューに「条件」（配信の「配信先の条件」と同じ形）を付けると、条件に合うお客様にだけそのメニューを出す
 * - 条件が重なる人は、優先順位（order の小さいほう = 画面で上にあるほう）のメニューになる
 * - 条件に合わなくなった人は、設定を外して全員向けのメニューに戻す
 * - LINE への設定は「メニューごとに 500 人ずつ」まとめて送る（人数ぶんのメニューは作らない）
 *
 * DB にも LINE にも触らない（Vitest の対象）
 */
import { isAudienceUnfiltered, isLineBlocked, matchAudience, normalizeAudience } from '@/lib/broadcast-audience';
import type { AudienceCustomer, BroadcastAudience, CustomerFacts } from '@/types/broadcast';

/** LINE の「まとめて設定する」API が 1 回に受け取れる人数 */
export const RICH_MENU_BULK_MAX = 500;
/** お客様ごとのメニューの数（1 店舗）。条件ごとに 1 個で、人数ぶんは作らない */
export const RICH_MENU_RULES_MAX = 5;

export interface RichMenuRule {
  /** だれに出すか（配信の「配信先の条件」と同じ形） */
  audience: BroadcastAudience;
  /** 優先順位（小さいほうが先。条件が重なる人は、先のメニューになる） */
  order: number;
}

/** 保存値 → 条件。お客様ごとのメニューでなければ null */
export function normalizeRichMenuRule(raw: unknown): RichMenuRule | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.enabled === false) return null;
  const order = Number(rec.order);
  return { audience: normalizeAudience(rec.audience), order: Number.isFinite(order) ? Math.max(0, Math.floor(order)) : 0 };
}

/** 条件が 1 つも無い（= 全員に当てはまる）か。全員に出すなら全員向けのメニューにするので、お客様ごとのメニューでは保存できない */
export function isRuleEmpty(rule: RichMenuRule): boolean {
  const a = rule.audience;
  return isAudienceUnfiltered(a) && !(a.customer_ids && a.customer_ids.length > 0);
}

interface RuleMenuLike {
  id: string;
  rule: RichMenuRule | null;
  created_at?: string;
}

/** お客様ごとのメニューを、優先順位の順（order → 作った順）に並べる */
export function sortRuleMenus<M extends RuleMenuLike>(menus: M[]): M[] {
  return menus
    .filter((m) => m.rule)
    .sort((a, b) => (a.rule as RichMenuRule).order - (b.rule as RichMenuRule).order || String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id));
}

/** 並べ替えたあとの order（0 から順に振り直す）。ids に無いメニューは、元の順のまま後ろに付ける */
export function reorderRuleMenus<M extends RuleMenuLike>(menus: M[], ids: string[]): Array<{ id: string; order: number }> {
  const sorted = sortRuleMenus(menus);
  const known = new Set(sorted.map((m) => m.id));
  const head = ids.filter((id, i) => known.has(id) && ids.indexOf(id) === i);
  const tail = sorted.map((m) => m.id).filter((id) => !head.includes(id));
  return [...head, ...tail].map((id, order) => ({ id, order }));
}

/** 公式 LINE に出ている、お客様ごとのメニュー（LINE 側の ID つき） */
export interface PublishedRuleMenu {
  id: string;
  line_rich_menu_id: string;
  rule: RichMenuRule;
}

/** だれに、どのメニューを出すか */
export interface RichMenuAssignment {
  menu_id: string;
  line_rich_menu_id: string;
}

/**
 * お客様ごとに出すメニューを決める（LINE ユーザー ID → メニュー）。
 * - menus は優先順位の順に渡す。最初に条件が合ったメニューになる
 * - LINE と連携していない人・ブロックされている人は対象外
 * - どの条件にも合わない人は入らない（= 全員向けのメニューを見る）
 */
export function planRichMenuAssignments(input: { menus: PublishedRuleMenu[]; customers: AudienceCustomer[]; facts: Map<string, CustomerFacts>; now: Date }): Map<string, RichMenuAssignment> {
  const plan = new Map<string, RichMenuAssignment>();
  if (input.menus.length === 0) return plan;
  for (const c of input.customers) {
    if (!c.line_user_id || plan.has(c.line_user_id) || isLineBlocked(c)) continue;
    const facts = input.facts.get(c.id);
    for (const menu of input.menus) {
      if (matchAudience(c, facts, menu.rule.audience, input.now)) {
        plan.set(c.line_user_id, { menu_id: menu.id, line_rich_menu_id: menu.line_rich_menu_id });
        break;
      }
    }
  }
  return plan;
}

/** いまの設定（このシステムが LINE に設定した記録） */
export interface RichMenuLink {
  line_user_id: string;
  menu_id: string;
  line_rich_menu_id: string;
}

export interface AssignmentDiff {
  /** メニューを設定する人（LINE 側のメニュー ID ごと）。新しく条件に合った人・別のメニューに変わる人 */
  link: Array<{ menu_id: string; line_rich_menu_id: string; user_ids: string[] }>;
  /** 設定を外す人（どの条件にも合わなくなった人 → 全員向けのメニューに戻る） */
  unlink: string[];
  /** 変わらない人の数 */
  unchanged: number;
}

/** いまの設定と、あるべき設定の差 */
export function diffRichMenuAssignments(current: RichMenuLink[], desired: Map<string, RichMenuAssignment>): AssignmentDiff {
  const byUser = new Map(current.map((l) => [l.line_user_id, l]));
  const groups = new Map<string, { menu_id: string; line_rich_menu_id: string; user_ids: string[] }>();
  let unchanged = 0;
  for (const [userId, want] of desired) {
    const now = byUser.get(userId);
    if (now && now.line_rich_menu_id === want.line_rich_menu_id) {
      unchanged++;
      continue;
    }
    const g = groups.get(want.line_rich_menu_id) ?? { menu_id: want.menu_id, line_rich_menu_id: want.line_rich_menu_id, user_ids: [] };
    g.user_ids.push(userId);
    groups.set(want.line_rich_menu_id, g);
  }
  const unlink = current.filter((l) => !desired.has(l.line_user_id)).map((l) => l.line_user_id);
  return { link: [...groups.values()], unlink, unchanged };
}

/** まとめて送る単位に分ける */
export function chunkUserIds(ids: string[], size: number = RICH_MENU_BULK_MAX): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
