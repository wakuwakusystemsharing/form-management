/**
 * 配信先（セグメント）の判定（純粋ロジック。DB / LINE API 非依存）
 * 仕様: docs/LINE配信機能_仕様書.md §4
 *
 * - normalizeAudience … 保存データを条件の形に整える
 * - buildCustomerFacts … 予約・来店・アンケートから顧客ごとの事実を集める
 * - matchAudience / selectAudience … 条件に合う顧客を選ぶ（LINE 未連携・配信停止・ブロック中は除外して数える）
 *
 * 日付はすべて JST の暦日で数える。
 */
import type { AudienceCustomer, BroadcastAudience, BroadcastGender, BroadcastSegment, CustomerFacts } from '@/types/broadcast';

export const BROADCAST_SEGMENTS: Array<{ id: BroadcastSegment; label: string }> = [
  { id: 'new', label: '新規' },
  { id: 'repeat', label: 'リピーター' },
  { id: 'vip', label: 'VIP' },
  { id: 'dormant', label: '休眠' },
];
export const BROADCAST_GENDERS: Array<{ id: BroadcastGender; label: string }> = [
  { id: 'female', label: '女性' },
  { id: 'male', label: '男性' },
  { id: 'other', label: 'その他' },
];
const AUDIENCE_LIST_MAX = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

/** JST の暦日（YYYY-MM-DD） */
export function jstDateOf(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" または ISO 日時 → JST の暦日。読めなければ null */
export function toJstDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  return jstDateOf(new Date(t));
}

/** from から to までの日数（暦日。to が後なら正） */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

function strList(raw: unknown, max = AUDIENCE_LIST_MAX): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
function posInt(v: unknown, max = 100000): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(Math.floor(n), max);
}

/** 保存データ（未知の形も含む）を条件に整える。空の条件はキーごと落とす */
export function normalizeAudience(raw: unknown): BroadcastAudience {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: BroadcastAudience = {};

  const tags = o.tags && typeof o.tags === 'object' ? (o.tags as Record<string, unknown>) : null;
  const tagValues = strList(tags?.values);
  if (tagValues.length > 0) out.tags = { mode: tags?.mode === 'all' ? 'all' : 'any', values: tagValues };

  const excludeTags = strList(o.exclude_tags);
  if (excludeTags.length > 0) out.exclude_tags = excludeTags;

  const segments = strList(o.segments).filter((s): s is BroadcastSegment => BROADCAST_SEGMENTS.some((x) => x.id === s));
  if (segments.length > 0) out.segments = segments;

  const menus = o.menus && typeof o.menus === 'object' ? (o.menus as Record<string, unknown>) : null;
  const menuNames = strList(menus?.names);
  if (menuNames.length > 0) {
    const within = posInt(menus?.within_days, 3650);
    out.menus = within && within > 0 ? { names: menuNames, within_days: within } : { names: menuNames };
  }

  const forms = strList(o.forms);
  if (forms.length > 0) out.forms = forms;

  const lv = o.last_visit && typeof o.last_visit === 'object' ? (o.last_visit as Record<string, unknown>) : null;
  const minDays = posInt(lv?.min_days_ago, 3650);
  const maxDays = posInt(lv?.max_days_ago, 3650);
  if (minDays !== undefined || maxDays !== undefined) {
    out.last_visit = {};
    if (minDays !== undefined) out.last_visit.min_days_ago = minDays;
    if (maxDays !== undefined) out.last_visit.max_days_ago = maxDays;
  }

  const visits = o.visits && typeof o.visits === 'object' ? (o.visits as Record<string, unknown>) : null;
  const vMin = posInt(visits?.min);
  const vMax = posInt(visits?.max);
  if (vMin !== undefined || vMax !== undefined) {
    out.visits = {};
    if (vMin !== undefined) out.visits.min = vMin;
    if (vMax !== undefined) out.visits.max = vMax;
  }

  if (typeof o.upcoming_reservation === 'boolean') out.upcoming_reservation = o.upcoming_reservation;

  const gender = strList(o.gender).filter((g): g is BroadcastGender => BROADCAST_GENDERS.some((x) => x.id === g));
  if (gender.length > 0) out.gender = gender;

  if (Array.isArray(o.birth_month)) {
    const months = [...new Set(o.birth_month.map((m) => Number(m)).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
    if (months.length > 0) out.birth_month = months;
  }

  const survey = o.survey && typeof o.survey === 'object' ? (o.survey as Record<string, unknown>) : null;
  if (survey && typeof survey.form_id === 'string' && survey.form_id && typeof survey.question === 'string' && survey.question) {
    const options = strList(survey.options);
    if (options.length > 0) out.survey = { form_id: survey.form_id, question: survey.question, options };
  }

  const ids = strList(o.customer_ids, 1000);
  if (ids.length > 0) out.customer_ids = ids;
  const exIds = strList(o.exclude_customer_ids, 1000);
  if (exIds.length > 0) out.exclude_customer_ids = exIds;

  return out;
}

/** 絞り込みが 1 つも無い（= すべての友だち）か。追加 / 除外の個別指定は絞り込みに数えない */
export function isAudienceUnfiltered(a: BroadcastAudience): boolean {
  return !a.tags && !a.segments && !a.menus && !a.forms && !a.last_visit && !a.visits && a.upcoming_reservation === undefined && !a.gender && !a.birth_month && !a.survey && !a.exclude_tags;
}

// ---------------------------------------------------------------------------
// セグメント（customer-utils の determineCustomerSegment と同じ規則。now を渡せる純粋版）
// ---------------------------------------------------------------------------

export function segmentOf(c: Pick<AudienceCustomer, 'total_visits' | 'total_spent' | 'first_visit_date' | 'last_visit_date'>, now: Date): BroadcastSegment {
  const last = c.last_visit_date ? Date.parse(c.last_visit_date) : NaN;
  if (!Number.isNaN(last) && (now.getTime() - last) / DAY_MS >= 90) return 'dormant';
  if ((c.total_spent ?? 0) >= 50000 || (c.total_visits ?? 0) >= 10) return 'vip';
  const first = c.first_visit_date ? Date.parse(c.first_visit_date) : NaN;
  if (!Number.isNaN(first) && (now.getTime() - first) / DAY_MS <= 30) return 'new';
  if ((c.total_visits ?? 0) >= 2) return 'repeat';
  return 'new';
}

// ---------------------------------------------------------------------------
// 顧客ごとの事実
// ---------------------------------------------------------------------------

export interface FactReservation {
  customer_id?: string | null;
  line_user_id?: string | null;
  form_id?: string | null;
  reservation_date?: string | null;
  status?: string | null;
  selected_menus?: unknown;
}
export interface FactVisit {
  customer_id?: string | null;
  visit_date?: string | null;
  treatment_menus?: unknown;
}
export interface FactSurvey {
  line_user_id?: string | null;
  survey_form_id?: string | null;
  responses?: unknown;
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** メニュー 1 件の照合用ラベル（「メニュー」「メニュー > サブメニュー」「カテゴリー > メニュー」） */
export function menuLabelsOf(menu: unknown): string[] {
  if (typeof menu === 'string') return menu.trim() ? [menu.trim()] : [];
  if (!menu || typeof menu !== 'object') return [];
  const m = menu as Record<string, unknown>;
  const pick = (k: string) => (typeof m[k] === 'string' && (m[k] as string).trim() ? (m[k] as string).trim() : '');
  const name = pick('menu_name') || pick('name');
  if (!name) return [];
  const labels = [name];
  const sub = pick('submenu_name');
  if (sub) labels.push(`${name} > ${sub}`);
  const cat = pick('category_name');
  if (cat) labels.push(`${cat} > ${name}`);
  return labels;
}

function emptyFacts(): CustomerFacts {
  return { menus: [], formIds: [], hasUpcomingReservation: false, surveyAnswers: [] };
}

/**
 * 予約（キャンセル除く）・来店・アンケートを顧客 ID ごとにまとめる。
 * 予約は customer_id、無ければ line_user_id で顧客に紐付ける。アンケートは line_user_id で紐付ける
 */
export function buildCustomerFacts(input: {
  customers: Array<Pick<AudienceCustomer, 'id' | 'line_user_id'>>;
  reservations: FactReservation[];
  visits: FactVisit[];
  surveys: FactSurvey[];
  today: string; // JST の暦日
}): Map<string, CustomerFacts> {
  const map = new Map<string, CustomerFacts>();
  const byLine = new Map<string, string>();
  for (const c of input.customers) {
    map.set(c.id, emptyFacts());
    if (c.line_user_id) byLine.set(c.line_user_id, c.id);
  }
  const factsFor = (customerId?: string | null, lineUserId?: string | null): CustomerFacts | null => {
    const id = customerId && map.has(customerId) ? customerId : lineUserId ? byLine.get(lineUserId) : undefined;
    return id ? map.get(id) ?? null : null;
  };

  for (const r of input.reservations) {
    if (r.status === 'cancelled') continue;
    const f = factsFor(r.customer_id, r.line_user_id);
    if (!f) continue;
    const date = toJstDate(r.reservation_date) ?? '';
    if (r.form_id && !f.formIds.includes(r.form_id)) f.formIds.push(r.form_id);
    if (date && date >= input.today) f.hasUpcomingReservation = true;
    const menus = parseJson(r.selected_menus);
    if (Array.isArray(menus)) {
      for (const m of menus) {
        const labels = menuLabelsOf(m);
        if (labels.length > 0) f.menus.push({ labels, date });
      }
    }
  }

  for (const v of input.visits) {
    const f = factsFor(v.customer_id, null);
    if (!f) continue;
    const date = toJstDate(v.visit_date) ?? '';
    const menus = parseJson(v.treatment_menus);
    if (Array.isArray(menus)) {
      for (const m of menus) {
        const labels = menuLabelsOf(m);
        if (labels.length > 0) f.menus.push({ labels, date });
      }
    }
  }

  for (const s of input.surveys) {
    const f = factsFor(null, s.line_user_id);
    if (!f || !s.survey_form_id) continue;
    const responses = parseJson(s.responses);
    if (responses && typeof responses === 'object' && !Array.isArray(responses)) {
      f.surveyAnswers.push({ form_id: s.survey_form_id, responses: responses as Record<string, unknown> });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** アンケートの回答値に選択肢が含まれるか（単一 = 完全一致、複数選択 = ", " 区切り、配列も可） */
export function answerIncludes(value: unknown, option: string): boolean {
  if (Array.isArray(value)) return value.some((v) => answerIncludes(v, option));
  if (typeof value !== 'string') return false;
  if (value === option) return true;
  return value.split(', ').some((v) => v.trim() === option);
}

/** 条件に合うか（LINE 連携・配信停止・ブロックは見ない。それは selectAudience が数える） */
export function matchAudience(c: AudienceCustomer, facts: CustomerFacts | undefined, a: BroadcastAudience, now: Date): boolean {
  if (a.exclude_customer_ids?.includes(c.id)) return false;
  if (a.customer_ids?.includes(c.id)) return true;
  // 個別指定だけで絞り込み条件が無いときは、指定した人だけ
  if (a.customer_ids && a.customer_ids.length > 0 && isAudienceUnfiltered(a)) return false;

  const f = facts ?? emptyFacts();
  const today = jstDateOf(now);
  const tags = c.tags ?? [];

  if (a.tags) {
    const hit = a.tags.mode === 'all' ? a.tags.values.every((t) => tags.includes(t)) : a.tags.values.some((t) => tags.includes(t));
    if (!hit) return false;
  }
  if (a.exclude_tags && a.exclude_tags.some((t) => tags.includes(t))) return false;
  if (a.segments && !a.segments.includes(segmentOf(c, now))) return false;

  if (a.menus) {
    const within = a.menus.within_days;
    const hit = f.menus.some((m) => {
      if (!m.labels.some((l) => a.menus!.names.includes(l))) return false;
      if (!within) return true;
      if (!m.date) return false;
      const ago = daysBetween(m.date, today);
      return ago <= within; // 未来の予約（負の値）も含む
    });
    if (!hit) return false;
  }
  if (a.forms && !a.forms.some((id) => f.formIds.includes(id))) return false;

  if (a.last_visit) {
    const last = toJstDate(c.last_visit_date);
    if (!last) return false;
    const ago = daysBetween(last, today);
    if (a.last_visit.min_days_ago !== undefined && ago < a.last_visit.min_days_ago) return false;
    if (a.last_visit.max_days_ago !== undefined && ago > a.last_visit.max_days_ago) return false;
  }
  if (a.visits) {
    const n = c.total_visits ?? 0;
    if (a.visits.min !== undefined && n < a.visits.min) return false;
    if (a.visits.max !== undefined && n > a.visits.max) return false;
  }
  if (a.upcoming_reservation !== undefined && f.hasUpcomingReservation !== a.upcoming_reservation) return false;

  if (a.gender && !(c.gender && (a.gender as string[]).includes(c.gender))) return false;
  if (a.birth_month) {
    const m = c.birthday && /^\d{4}-\d{2}/.test(c.birthday) ? Number(c.birthday.slice(5, 7)) : NaN;
    if (!a.birth_month.includes(m)) return false;
  }
  if (a.survey) {
    const s = a.survey;
    const hit = f.surveyAnswers.some((ans) => ans.form_id === s.form_id && s.options.some((opt) => answerIncludes(ans.responses[s.question], opt)));
    if (!hit) return false;
  }
  return true;
}

export interface AudienceSelection {
  /** 送る相手（LINE 連携済み・配信停止でない・ブロックしていない・条件に合う） */
  recipients: AudienceCustomer[];
  /** 条件には合うが除外した人数 */
  excluded_opt_out: number;
  excluded_blocked: number;
  excluded_no_line: number;
}

/** 条件に合う顧客から、送れない人（LINE 未連携 / 配信停止 / ブロック中）を除いて返す。同じ LINE ユーザーは 1 人にまとめる */
export function selectAudience(customers: AudienceCustomer[], facts: Map<string, CustomerFacts>, audience: BroadcastAudience, now: Date): AudienceSelection {
  const out: AudienceSelection = { recipients: [], excluded_opt_out: 0, excluded_blocked: 0, excluded_no_line: 0 };
  const seen = new Set<string>();
  for (const c of customers) {
    if (!matchAudience(c, facts.get(c.id), audience, now)) continue;
    if (!c.line_user_id) {
      out.excluded_no_line += 1;
      continue;
    }
    if (c.line_opt_out_at) {
      out.excluded_opt_out += 1;
      continue;
    }
    if (c.line_friend_flag === false) {
      out.excluded_blocked += 1;
      continue;
    }
    if (seen.has(c.line_user_id)) continue;
    seen.add(c.line_user_id);
    out.recipients.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

/** 一覧・確認ダイアログに出す条件の要約（例: タグ「カラー」/ 最終来店 60 日以上前） */
export function describeAudience(a: BroadcastAudience, opts: { formName?: (id: string) => string } = {}): string {
  const parts: string[] = [];
  if (a.tags) parts.push(`タグ ${a.tags.values.map((t) => `「${t}」`).join(a.tags.mode === 'all' ? ' かつ ' : ' または ')}`);
  if (a.exclude_tags) parts.push(`タグ ${a.exclude_tags.map((t) => `「${t}」`).join('・')} を除く`);
  if (a.segments) parts.push(a.segments.map((s) => BROADCAST_SEGMENTS.find((x) => x.id === s)?.label ?? s).join('・'));
  if (a.menus) parts.push(`${a.menus.within_days ? `直近 ${a.menus.within_days} 日に ` : ''}メニュー ${a.menus.names.map((n) => `「${n}」`).join('・')} を予約`);
  if (a.forms) parts.push(`フォーム ${a.forms.map((id) => `「${opts.formName?.(id) ?? id}」`).join('・')} から予約`);
  if (a.last_visit) {
    const { min_days_ago: min, max_days_ago: max } = a.last_visit;
    if (min !== undefined && max !== undefined) parts.push(`最終来店 ${min}〜${max} 日前`);
    else if (min !== undefined) parts.push(`最終来店 ${min} 日以上前`);
    else if (max !== undefined) parts.push(`最終来店 ${max} 日以内`);
  }
  if (a.visits) {
    const { min, max } = a.visits;
    if (min !== undefined && max !== undefined) parts.push(`来店 ${min}〜${max} 回`);
    else if (min !== undefined) parts.push(`来店 ${min} 回以上`);
    else if (max !== undefined) parts.push(`来店 ${max} 回以下`);
  }
  if (a.upcoming_reservation !== undefined) parts.push(a.upcoming_reservation ? '今後の予約あり' : '今後の予約なし');
  if (a.gender) parts.push(a.gender.map((g) => BROADCAST_GENDERS.find((x) => x.id === g)?.label ?? g).join('・'));
  if (a.birth_month) parts.push(`${a.birth_month.join('・')} 月生まれ`);
  if (a.survey) parts.push(`アンケート「${a.survey.question}」で ${a.survey.options.map((o) => `「${o}」`).join('・')}`);
  if (a.customer_ids) parts.push(`個別に追加 ${a.customer_ids.length} 人`);
  if (a.exclude_customer_ids) parts.push(`個別に除外 ${a.exclude_customer_ids.length} 人`);
  return parts.length > 0 ? parts.join(' / ') : 'すべての友だち';
}
