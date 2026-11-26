/**
 * アンケートの分析の純粋ロジック（クライアント / サーバー共用）
 *
 * - 期間は「回答した日」（日本時間）。予約分析と同じ期間チップを使う
 * - フォーム別の回答数は、フォームで絞り込んでいても全フォームぶんを返す（予約分析の by_form と同じ）
 * - 質問ごとの集計は、フォームを 1 つ選んだときだけ（フォームが違えば質問も違うため）
 *   選択式 = 選択肢ごとの回答数 / 自由記述 = 回答数と最近の回答 / 誕生日 = 年代 / 住所 = 都道府県
 * - 回答は静的 HTML が送る形: { [質問の文言]: 値 }。複数選択は ", " 区切り、「その他」は「その他（理由）」
 * - 質問の一覧に無い回答（選択肢の追加質問など）は「そのほかの回答項目」としてまとめる
 */
import type { SurveyQuestion, SurveyQuestionOption } from '@/types/survey';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const PREFECTURE_RE = /(北海道|東京都|(?:京都|大阪)府|(?:神奈川|和歌山|鹿児島)県|[^\s\d〒-]{2}県)/;

export const SURVEY_SAMPLE_MAX = 5;
export const SURVEY_SAMPLE_TEXT_MAX = 200;
export const SURVEY_CHOICE_MAX = 30;

export interface SurveyAnalyticsForm {
  id: string;
  name: string;
  questions: SurveyQuestion[];
}

export interface SurveyAnalyticsResponse {
  id: string;
  survey_form_id: string;
  line_user_id: string | null;
  submitted_at: string;
  answers: Record<string, unknown>;
}

export interface SurveyCountRow {
  label: string;
  count: number;
  /** 分母（その質問に答えた回答数）に対する割合（%。四捨五入） */
  percent: number;
}

export type SurveyQuestionStatKind = 'choice' | 'text' | 'age' | 'prefecture' | 'other';

export interface SurveyQuestionStat {
  title: string;
  type: string;
  kind: SurveyQuestionStatKind;
  /** この質問に答えた回答数 */
  answered: number;
  /** 回答数全体に対する割合（%） */
  answer_rate: number;
  /** choice / age / prefecture: 内訳（多い順。age は年代順） */
  rows?: SurveyCountRow[];
  /** age: 平均年齢 */
  average_age?: number | null;
  /** text: 最近の回答（新しい順） */
  samples?: Array<{ text: string; submitted_at: string }>;
  /** 質問の一覧に無い回答項目（選択肢の追加質問など） */
  extra?: boolean;
}

export interface SurveyAnalyticsResult {
  summary: {
    total: number;
    /** 回答した人数（LINE のユーザーごと。LINE の外からの回答は 1 件 = 1 人として数える） */
    respondents: number;
    /** 2 回以上回答した人数（LINE のユーザー） */
    repeat_respondents: number;
    /** LINE のユーザーが分からない回答の数 */
    anonymous: number;
    /** 回答者のうち、顧客として登録されている人数（顧客の一覧を渡したときだけ） */
    linked_customers: number | null;
    last_submitted_at: string | null;
  };
  by_form: Array<{ form_id: string; name: string; count: number; respondents: number; last_submitted_at: string | null }>;
  monthly: Array<{ month: string; count: number }>;
  daily: Array<{ date: string; count: number }>;
  weekday: Array<{ weekday: number; label: string; count: number }>;
  hourly: Array<{ hour: number; count: number }>;
  /** フォームを 1 つ選んだときだけ */
  questions: SurveyQuestionStat[] | null;
}

function jstParts(iso: string): { date: string; month: string; weekday: number; hour: number } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + JST_OFFSET_MS);
  const date = d.toISOString().slice(0, 10);
  return { date, month: date.slice(0, 7), weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

function percent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function answerText(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (Array.isArray(raw)) return raw.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
  if (typeof raw === 'object') return '';
  return String(raw).trim();
}

function toRows(counts: Map<string, number>, denominator: number, max = SURVEY_CHOICE_MAX): SurveyCountRow[] {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, max);
  const rest = sorted.slice(max).reduce((s, [, n]) => s + n, 0);
  const rows = head.map(([label, count]) => ({ label, count, percent: percent(count, denominator) }));
  if (rest > 0) rows.push({ label: 'そのほか', count: rest, percent: percent(rest, denominator) });
  return rows;
}

/** 選択式の回答 1 件を、選ばれた選択肢の名前に分ける */
export function splitChoiceAnswer(type: string, raw: unknown, options: SurveyQuestionOption[] | undefined): string[] {
  const known = new Map<string, string>();
  for (const o of options ?? []) {
    if (!o) continue;
    known.set(o.label, o.label);
    if (o.value) known.set(o.value, o.label);
  }
  const normalize = (part: string) => known.get(part) ?? (/^その他(（|\(|$)/.test(part) ? 'その他' : part);
  if (Array.isArray(raw)) return [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean).map(normalize))];
  const text = answerText(raw);
  if (!text) return [];
  if (type !== 'checkbox' || known.has(text)) return [normalize(text)];
  return [...new Set(text.split(', ').map((s) => s.trim()).filter(Boolean).map(normalize))];
}

function ageOf(birthday: string, today: string): number | null {
  const m = birthday.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (!m) return null;
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty - Number(m[1]);
  if (tm < Number(m[2]) || (tm === Number(m[2]) && td < Number(m[3]))) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

const AGE_GROUPS = ['10代以下', '20代', '30代', '40代', '50代', '60代', '70代以上'];
function ageGroup(age: number): string {
  if (age < 20) return AGE_GROUPS[0];
  if (age >= 70) return AGE_GROUPS[6];
  return AGE_GROUPS[Math.floor(age / 10) - 1];
}

function buildQuestionStat(q: Pick<SurveyQuestion, 'title' | 'type' | 'options'>, responses: SurveyAnalyticsResponse[], total: number, today: string, extra = false): SurveyQuestionStat {
  const answered = responses.filter((r) => answerText(r.answers[q.title]) !== '');
  const base = { title: q.title, type: q.type, answered: answered.length, answer_rate: percent(answered.length, total), ...(extra ? { extra: true } : {}) };

  if (q.type === 'radio' || q.type === 'checkbox' || q.type === 'select') {
    const counts = new Map<string, number>();
    // 選択肢は 0 件でも出す（選ばれなかったことが分かるように）
    for (const o of q.options ?? []) if (o?.label) counts.set(o.label, 0);
    for (const r of answered) for (const label of splitChoiceAnswer(q.type, r.answers[q.title], q.options)) counts.set(label, (counts.get(label) ?? 0) + 1);
    return { ...base, kind: 'choice', rows: toRows(counts, answered.length) };
  }

  if (q.type === 'birthday') {
    const counts = new Map<string, number>(AGE_GROUPS.map((g) => [g, 0]));
    let sum = 0;
    let n = 0;
    for (const r of answered) {
      const age = ageOf(answerText(r.answers[q.title]), today);
      if (age === null) continue;
      counts.set(ageGroup(age), (counts.get(ageGroup(age)) ?? 0) + 1);
      sum += age;
      n += 1;
    }
    return { ...base, kind: 'age', rows: AGE_GROUPS.map((g) => ({ label: g, count: counts.get(g) ?? 0, percent: percent(counts.get(g) ?? 0, n) })), average_age: n > 0 ? Math.round((sum / n) * 10) / 10 : null };
  }

  if (q.type === 'address') {
    const counts = new Map<string, number>();
    for (const r of answered) {
      const pref = answerText(r.answers[q.title]).replace(/^〒?\s*\d{3}-?\d{4}\s*/, '').match(PREFECTURE_RE)?.[1] ?? '不明';
      counts.set(pref, (counts.get(pref) ?? 0) + 1);
    }
    return { ...base, kind: 'prefecture', rows: toRows(counts, answered.length, 10) };
  }

  if (q.type === 'text' || q.type === 'textarea') {
    const samples = [...answered]
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
      .slice(0, SURVEY_SAMPLE_MAX)
      .map((r) => ({ text: answerText(r.answers[q.title]).slice(0, SURVEY_SAMPLE_TEXT_MAX), submitted_at: r.submitted_at }));
    return { ...base, kind: 'text', samples };
  }

  return { ...base, kind: 'other' };
}

/** 質問の一覧に無い回答項目（選択肢の追加質問など）。同じ答えが重なるなら内訳、ばらばらなら最近の回答 */
function buildExtraStats(form: SurveyAnalyticsForm, responses: SurveyAnalyticsResponse[], total: number, today: string): SurveyQuestionStat[] {
  const titles = new Set(form.questions.map((q) => q.title));
  const keys: string[] = [];
  for (const r of responses) for (const k of Object.keys(r.answers)) if (!titles.has(k) && !keys.includes(k)) keys.push(k);
  return keys.slice(0, 40).map((key) => {
    const values = responses.map((r) => answerText(r.answers[key])).filter(Boolean);
    const distinct = new Set(values);
    const repeated = distinct.size < values.length || distinct.size <= 3;
    if (repeated && distinct.size <= SURVEY_CHOICE_MAX) {
      const counts = new Map<string, number>();
      for (const r of responses) for (const label of splitChoiceAnswer('checkbox', r.answers[key], undefined)) counts.set(label, (counts.get(label) ?? 0) + 1);
      return { title: key, type: 'extra', kind: 'choice' as const, answered: values.length, answer_rate: percent(values.length, total), rows: toRows(counts, values.length), extra: true };
    }
    return buildQuestionStat({ title: key, type: 'text' }, responses, total, today, true);
  });
}

export function computeSurveyAnalytics(
  allResponses: SurveyAnalyticsResponse[],
  forms: SurveyAnalyticsForm[],
  opts: { dateFrom?: string | null; dateTo?: string | null; formId?: string | null; customerLineIds?: Iterable<string> | null; now?: Date } = {}
): SurveyAnalyticsResult {
  const now = opts.now ?? new Date();
  const today = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

  // 期間で絞る（回答した日。日本時間）
  const inPeriod: Array<SurveyAnalyticsResponse & { _p: NonNullable<ReturnType<typeof jstParts>> }> = [];
  for (const r of allResponses) {
    if (!r || typeof r.submitted_at !== 'string') continue;
    const p = jstParts(r.submitted_at);
    if (!p) continue;
    if (opts.dateFrom && p.date < opts.dateFrom) continue;
    if (opts.dateTo && p.date > opts.dateTo) continue;
    inPeriod.push({ ...r, answers: r.answers && typeof r.answers === 'object' ? r.answers : {}, _p: p });
  }

  // フォーム別（絞り込みに関係なく全フォーム）
  const formNames = new Map(forms.map((f) => [f.id, f.name]));
  const byFormMap = new Map<string, { count: number; users: Set<string>; anonymous: number; last: string | null }>();
  for (const f of forms) byFormMap.set(f.id, { count: 0, users: new Set(), anonymous: 0, last: null });
  for (const r of inPeriod) {
    const row = byFormMap.get(r.survey_form_id) ?? { count: 0, users: new Set<string>(), anonymous: 0, last: null };
    row.count += 1;
    if (r.line_user_id) row.users.add(r.line_user_id);
    else row.anonymous += 1;
    if (!row.last || r.submitted_at > row.last) row.last = r.submitted_at;
    byFormMap.set(r.survey_form_id, row);
  }
  const by_form = [...byFormMap.entries()]
    .map(([form_id, v]) => ({ form_id, name: formNames.get(form_id) ?? '削除されたアンケート', count: v.count, respondents: v.users.size + v.anonymous, last_submitted_at: v.last }))
    .filter((row) => formNames.has(row.form_id) || row.count > 0)
    .sort((a, b) => b.count - a.count);

  const responses = opts.formId ? inPeriod.filter((r) => r.survey_form_id === opts.formId) : inPeriod;

  const perUser = new Map<string, number>();
  let anonymous = 0;
  let last: string | null = null;
  const monthly = new Map<string, number>();
  const daily = new Map<string, number>();
  const weekday = Array.from({ length: 7 }, () => 0);
  const hourly = Array.from({ length: 24 }, () => 0);
  for (const r of responses) {
    if (r.line_user_id) perUser.set(r.line_user_id, (perUser.get(r.line_user_id) ?? 0) + 1);
    else anonymous += 1;
    if (!last || r.submitted_at > last) last = r.submitted_at;
    monthly.set(r._p.month, (monthly.get(r._p.month) ?? 0) + 1);
    daily.set(r._p.date, (daily.get(r._p.date) ?? 0) + 1);
    weekday[r._p.weekday] += 1;
    hourly[r._p.hour] += 1;
  }

  let linked: number | null = null;
  if (opts.customerLineIds) {
    const ids = new Set(opts.customerLineIds);
    linked = [...perUser.keys()].filter((id) => ids.has(id)).length;
  }

  let questions: SurveyQuestionStat[] | null = null;
  const form = opts.formId ? forms.find((f) => f.id === opts.formId) : null;
  if (form) {
    const valid = form.questions.filter((q) => q && typeof q.title === 'string' && q.title.trim() !== '');
    questions = [...valid.map((q) => buildQuestionStat(q, responses, responses.length, today)), ...buildExtraStats({ ...form, questions: valid }, responses, responses.length, today)];
  }

  return {
    summary: {
      total: responses.length,
      respondents: perUser.size + anonymous,
      repeat_respondents: [...perUser.values()].filter((n) => n >= 2).length,
      anonymous,
      linked_customers: linked,
      last_submitted_at: last,
    },
    by_form,
    monthly: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
    daily: [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count })),
    weekday: weekday.map((count, i) => ({ weekday: i, label: WEEKDAY_LABELS[i], count })),
    hourly: hourly.map((count, hour) => ({ hour, count })),
    questions,
  };
}

// ---------------------------------------------------------------------------
// 顧客分析の「アンケート」
// ---------------------------------------------------------------------------

export interface SurveyStatCustomer {
  id: string;
  line_user_id?: string | null;
  total_visits?: number | null;
  total_spent?: number | null;
  first_visit_date?: string | null;
  last_visit_date?: string | null;
}

export type SurveyStatSegment = 'new' | 'repeat' | 'vip' | 'dormant';
const SEGMENT_LABELS: Record<SurveyStatSegment, string> = { new: '新規', repeat: 'リピーター', vip: 'VIP', dormant: '休眠' };

export interface CustomerSurveyStats {
  total_customers: number;
  /** LINE と連携している顧客（アンケートの回答と結び付けられる人） */
  line_linked: number;
  /** そのうち、アンケートに 1 回でも答えた人 */
  responded: number;
  /** responded ÷ line_linked（%）。LINE 連携の顧客が居なければ null */
  response_rate: number | null;
  /** 回答した人のうち、顧客として登録されていない LINE ユーザーの数 */
  unregistered_respondents: number;
  by_form: Array<{ form_id: string; name: string; customers: number; rate: number }>;
  by_segment: Array<{ segment: SurveyStatSegment; label: string; customers: number; responded: number; rate: number }>;
  compare: {
    responded: { customers: number; avg_visits: number; avg_spent: number };
    not_responded: { customers: number; avg_visits: number; avg_spent: number };
  };
}

function average(sum: number, n: number, digits = 0): number {
  if (n === 0) return 0;
  const f = 10 ** digits;
  return Math.round((sum / n) * f) / f;
}

/**
 * 顧客のうち、アンケートに答えた人の数と、答えた人 / 答えていない人の来店の違い。
 * 回答と顧客は LINE のユーザー ID で結び付けるので、分母は LINE と連携している顧客
 */
export function computeCustomerSurveyStats(
  customers: SurveyStatCustomer[],
  responses: Array<Pick<SurveyAnalyticsResponse, 'survey_form_id' | 'line_user_id'>>,
  forms: Array<Pick<SurveyAnalyticsForm, 'id' | 'name'>>,
  segmentOf: (c: SurveyStatCustomer) => SurveyStatSegment
): CustomerSurveyStats {
  const formsByUser = new Map<string, Set<string>>();
  for (const r of responses) {
    if (!r?.line_user_id) continue;
    const set = formsByUser.get(r.line_user_id) ?? new Set<string>();
    set.add(r.survey_form_id);
    formsByUser.set(r.line_user_id, set);
  }

  const linked = customers.filter((c) => !!c.line_user_id);
  const customerLineIds = new Set(linked.map((c) => c.line_user_id as string));
  const respondedCustomers = linked.filter((c) => formsByUser.has(c.line_user_id as string));
  const notResponded = linked.filter((c) => !formsByUser.has(c.line_user_id as string));

  const group = (list: SurveyStatCustomer[]) => ({
    customers: list.length,
    avg_visits: average(list.reduce((s, c) => s + (c.total_visits ?? 0), 0), list.length, 1),
    avg_spent: average(list.reduce((s, c) => s + (c.total_spent ?? 0), 0), list.length),
  });

  const formNames = new Map(forms.map((f) => [f.id, f.name]));
  const perForm = new Map<string, number>();
  for (const c of respondedCustomers) for (const formId of formsByUser.get(c.line_user_id as string) ?? []) perForm.set(formId, (perForm.get(formId) ?? 0) + 1);

  const segments: SurveyStatSegment[] = ['new', 'repeat', 'vip', 'dormant'];
  const bySegment = new Map<SurveyStatSegment, { customers: number; responded: number }>(segments.map((s) => [s, { customers: 0, responded: 0 }]));
  for (const c of linked) {
    const row = bySegment.get(segmentOf(c));
    if (!row) continue;
    row.customers += 1;
    if (formsByUser.has(c.line_user_id as string)) row.responded += 1;
  }

  return {
    total_customers: customers.length,
    line_linked: linked.length,
    responded: respondedCustomers.length,
    response_rate: linked.length > 0 ? percent(respondedCustomers.length, linked.length) : null,
    unregistered_respondents: [...formsByUser.keys()].filter((id) => !customerLineIds.has(id)).length,
    by_form: [...perForm.entries()]
      .map(([form_id, n]) => ({ form_id, name: formNames.get(form_id) ?? '削除されたアンケート', customers: n, rate: percent(n, linked.length) }))
      .sort((a, b) => b.customers - a.customers),
    by_segment: segments.map((s) => {
      const row = bySegment.get(s)!;
      return { segment: s, label: SEGMENT_LABELS[s], customers: row.customers, responded: row.responded, rate: percent(row.responded, row.customers) };
    }),
    compare: { responded: group(respondedCustomers), not_responded: group(notResponded) },
  };
}
