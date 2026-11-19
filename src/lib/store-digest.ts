/**
 * 朝の「今日の予約まとめ」・月次レポート（店舗スタッフへ自動で送る）の純粋ロジック（DB 非依存）
 * 設計: docs/朝のまとめ・月次レポート_実装設計.md
 *
 * - 設定は店舗ごと（既定はすべて OFF）。送り先はメール（複数）と LINE（合言葉で登録したスタッフ）
 * - 朝のまとめ … 今日の予約（時刻・お名前・メニュー・担当）、申し送り、新規 / VIP / 誕生月、空き待ちの件数
 *   アレルギー・既往歴（要配慮個人情報）は中身を載せず「注意あり」とだけ出す（中身は管理画面で見る）
 * - 月次レポート … 予約数・売上・新規・リピート率・キャンセル率・前月比・人気メニュー・配信の成果
 */
import { computeReservationAnalytics, isCancelledReservation, menuDisplayName, type AnalyticsReservation } from './reservation-analytics';

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

export interface DigestSettings {
  /** 朝のまとめ（time = 送る時刻。HH:00。JST） */
  morning: { enabled: boolean; time: string };
  /** 月次レポート（毎月 1 日、朝のまとめと同じ時刻に前月分を送る） */
  monthly: { enabled: boolean };
  channels: { email: boolean; line: boolean };
  emails: string[];
}

/** 送る時刻の選択肢（5 時 〜 12 時） */
export const DIGEST_TIME_OPTIONS = ['05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00'] as const;
export const DIGEST_DEFAULT_TIME = '08:00';
export const DIGEST_EMAIL_MAX = 5;
/** LINE で受け取れるスタッフの人数の上限 */
export const DIGEST_STAFF_MAX = 10;
/** 設定時刻を過ぎてから、この時間以内なら送る（cron が止まった回の取りこぼし用。これより遅ければその日は送らない） */
export const DIGEST_LATE_HOURS = 3;
/** 合言葉を続けて間違えられる回数（超えたら合言葉を無効にする = 総当たり対策） */
export const DIGEST_CODE_MAX_FAILURES = 5;

export const DIGEST_DEFAULT_SETTINGS: DigestSettings = {
  morning: { enabled: false, time: DIGEST_DEFAULT_TIME },
  monthly: { enabled: false },
  channels: { email: false, line: false },
  emails: [],
};

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function emailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, DIGEST_EMAIL_MAX);
}

export function normalizeDigestSettings(raw: unknown): DigestSettings {
  const r = rec(raw);
  const morning = rec(r.morning);
  const time = typeof morning.time === 'string' && (DIGEST_TIME_OPTIONS as readonly string[]).includes(morning.time) ? morning.time : DIGEST_DEFAULT_TIME;
  const channels = rec(r.channels);
  return {
    morning: { enabled: morning.enabled === true, time },
    monthly: { enabled: rec(r.monthly).enabled === true },
    channels: { email: channels.email === true, line: channels.line === true },
    emails: emailList(r.emails),
  };
}

export type DigestValidation = { ok: true; value: DigestSettings } | { ok: false; error: string };

/** 保存前の検証。ON にするには送り先（メールアドレス or LINE）が必要 */
export function validateDigestSettings(raw: unknown): DigestValidation {
  const value = normalizeDigestSettings(raw);
  const rawEmails = Array.isArray(rec(raw).emails) ? (rec(raw).emails as unknown[]).filter((v) => typeof v === 'string' && v.trim()) : [];
  if (rawEmails.length > DIGEST_EMAIL_MAX) return { ok: false, error: `メールアドレスは ${DIGEST_EMAIL_MAX} 件までです` };
  const bad = value.emails.find((e) => !EMAIL_RE.test(e));
  if (bad) return { ok: false, error: `メールアドレスの形式が正しくありません: ${bad}` };
  if (value.morning.enabled || value.monthly.enabled) {
    if (!value.channels.email && !value.channels.line) return { ok: false, error: '送り先（メール / LINE）を 1 つ以上選んでください' };
    if (value.channels.email && value.emails.length === 0) return { ok: false, error: '送り先のメールアドレスを入力してください' };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// スタッフ登録の合言葉（公式 LINE に「スタッフ登録 4821」と送る）
// ---------------------------------------------------------------------------

export const STAFF_REGISTER_KEYWORD = 'スタッフ登録';
export const STAFF_UNREGISTER_KEYWORD = 'スタッフ登録解除';

export type StaffCommand = { type: 'register'; code: string | null } | { type: 'unregister' };

function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
}

/** お客様の発言がスタッフ登録の操作かどうか。関係ない発言は null */
export function parseStaffCommand(text: unknown): StaffCommand | null {
  const t = toHalfWidth(typeof text === 'string' ? text : '').trim();
  if (!t.startsWith(STAFF_REGISTER_KEYWORD)) return null;
  if (t === STAFF_UNREGISTER_KEYWORD) return { type: 'unregister' };
  const rest = t.slice(STAFF_REGISTER_KEYWORD.length).trim();
  if (rest === '') return { type: 'register', code: null };
  return /^\d{4}$/.test(rest) ? { type: 'register', code: rest } : null;
}

/** 4 桁の合言葉（1000〜9999） */
export function generateStaffCode(random: () => number = Math.random): string {
  return String(1000 + Math.min(8999, Math.floor(random() * 9000)));
}

// ---------------------------------------------------------------------------
// 日付・時刻（JST）
// ---------------------------------------------------------------------------

const JST_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function jst(now: Date): Date {
  return new Date(now.getTime() + JST_MS);
}

export function digestJstDate(now: Date): string {
  return jst(now).toISOString().slice(0, 10);
}

/** 「11/20（金）」 */
export function formatDigestDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[d.getUTCDay()]}）`;
}

/** 設定時刻（HH:00）を過ぎていて、遅れが DIGEST_LATE_HOURS 時間以内か */
export function isDigestTimeDue(time: string, now: Date): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return false;
  const j = jst(now);
  const minutes = j.getUTCHours() * 60 + j.getUTCMinutes();
  const target = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= target && minutes < target + DIGEST_LATE_HOURS * 60;
}

function shiftMonth(month: string, diff: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + diff, 1));
  return d.toISOString().slice(0, 7);
}

/** 月次レポートを送る日（毎月 1〜3 日。1 日に送れなかったときの取りこぼし用）なら、対象の月（前月。YYYY-MM）。それ以外は null */
export function monthlyReportTargetMonth(now: Date): string | null {
  const j = jst(now);
  if (j.getUTCDate() > 3) return null;
  return shiftMonth(j.toISOString().slice(0, 7), -1);
}

export function isReportMonth(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

// ---------------------------------------------------------------------------
// 朝のまとめ
// ---------------------------------------------------------------------------

export interface DigestReservation extends AnalyticsReservation {
  id: string;
  customer_id?: string | null;
  line_user_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  menu_name?: string | null;
  submenu_name?: string | null;
  staff_name?: string | null;
  checkout_date?: string | null;
  stay_nights?: number | null;
}

export interface DigestCustomer {
  id: string;
  name?: string | null;
  line_user_id?: string | null;
  total_visits?: number | null;
  total_spent?: number | null;
  birthday?: string | null;
  allergies?: string | null;
  medical_history?: string | null;
}

export type DigestMark = 'new' | 'vip' | 'birthday';

export const DIGEST_MARK_LABELS: Record<DigestMark, string> = { new: '新規', vip: 'VIP', birthday: '誕生月' };

export interface MorningDigestRow {
  reservation_id: string;
  /** HH:MM（時刻の無い予約は空文字） */
  time: string;
  name: string;
  menu: string;
  staff: string | null;
  marks: DigestMark[];
  /** アレルギー・既往歴の登録がある（中身は載せない） */
  caution: boolean;
  /** 未確認の申し送り */
  note: string | null;
}

export interface MorningDigest {
  date: string;
  store_name: string;
  count: number;
  rows: MorningDigestRow[];
  /** 今日の日時への空き待ち（受付中）の件数 */
  waitlist_count: number;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function reservationMenuText(r: DigestReservation): string {
  const names = (Array.isArray(r.selected_menus) ? r.selected_menus : [])
    .map((m) => (m && typeof m === 'object' ? menuDisplayName(m as Record<string, unknown>) : ''))
    .filter((s) => !!s && s !== '不明');
  let menu = names.join('、');
  if (!menu) menu = [text(r.menu_name), text(r.submenu_name)].filter(Boolean).join(' > ');
  if (text(r.checkout_date)) {
    const nights = typeof r.stay_nights === 'number' && r.stay_nights > 0 ? `${r.stay_nights}泊` : '';
    menu = [`宿泊${nights ? ` ${nights}` : ''}（〜${formatDigestDate(text(r.checkout_date))}）`, menu].filter(Boolean).join(' / ');
  }
  return menu;
}

export function buildMorningDigest(input: {
  date: string;
  storeName: string;
  reservations: DigestReservation[];
  customers: DigestCustomer[];
  /** 顧客 ID → 未確認の申し送り */
  notes: Record<string, string>;
  waitlistCount: number;
}): MorningDigest {
  const byId = new Map<string, DigestCustomer>();
  const byLine = new Map<string, DigestCustomer>();
  for (const c of input.customers) {
    byId.set(c.id, c);
    if (c.line_user_id) byLine.set(c.line_user_id, c);
  }
  const month = Number(input.date.slice(5, 7));
  const rows = input.reservations
    .filter((r) => text(r.reservation_date).slice(0, 10) === input.date && !isCancelledReservation(r))
    .map((r): MorningDigestRow => {
      const c = (r.customer_id && byId.get(r.customer_id)) || (r.line_user_id && byLine.get(r.line_user_id)) || null;
      const marks: DigestMark[] = [];
      // 来店記録は予約が成立した時点で作られるので、今日が初めての人は来店 1 回
      if (!c || (c.total_visits ?? 0) <= 1) marks.push('new');
      else if ((c.total_spent ?? 0) >= 50000 || (c.total_visits ?? 0) >= 10) marks.push('vip');
      if (c && /^\d{4}-\d{2}-\d{2}/.test(text(c.birthday)) && Number(text(c.birthday).slice(5, 7)) === month) marks.push('birthday');
      return {
        reservation_id: r.id,
        time: text(r.reservation_time).slice(0, 5),
        name: text(r.customer_name) || text(c?.name) || 'お名前なし',
        menu: reservationMenuText(r),
        staff: text(r.staff_name) || null,
        marks,
        caution: !!c && (!!text(c.allergies) || !!text(c.medical_history)),
        note: (c && text(input.notes[c.id])) || null,
      };
    })
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.reservation_id.localeCompare(b.reservation_id));
  return { date: input.date, store_name: input.storeName, count: rows.length, rows, waitlist_count: Math.max(0, input.waitlistCount || 0) };
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function rowBadges(row: MorningDigestRow): string[] {
  return [...row.marks.map((m) => DIGEST_MARK_LABELS[m]), ...(row.caution ? ['注意あり'] : [])];
}

export function renderMorningDigestEmail(d: MorningDigest, adminUrl: string): { subject: string; body: string } {
  const lines: string[] = [`${d.store_name} の今日（${formatDigestDate(d.date)}）の予約は ${d.count} 件です。`, ''];
  if (d.count === 0) lines.push('本日の予約はありません。', '');
  for (const row of d.rows) {
    lines.push(`■ ${row.time || '時刻なし'} ${row.name} 様`);
    if (row.menu) lines.push(`  ${row.menu}`);
    if (row.staff) lines.push(`  担当: ${row.staff}`);
    const badges = rowBadges(row);
    if (badges.length > 0) lines.push(`  ${badges.map((b) => `[${b}]`).join(' ')}`);
    if (row.note) lines.push(`  申し送り: ${row.note}`);
    lines.push('');
  }
  if (d.waitlist_count > 0) lines.push(`空き待ち: ${d.waitlist_count} 件（今日の日時）`, '');
  if (d.rows.some((r) => r.caution)) lines.push('※「注意あり」はアレルギー・既往歴の登録があるお客様です。内容は管理画面の顧客詳細でご確認ください。', '');
  lines.push('予約の詳細（管理画面）', adminUrl, '', '※ このメールは「今日の予約まとめ」の設定により自動で送っています。');
  return { subject: `【今日の予約】${formatDigestDate(d.date)}${d.count}件 - ${d.store_name}`, body: lines.join('\n') };
}

/** LINE のカードに載せる予約の数（これより多い分は「ほか N 件」） */
export const DIGEST_LINE_MAX_ROWS = 15;
const COLOR_MAIN = '#0f766e';
const COLOR_SUB = '#6b7280';
const COLOR_WARN = '#b45309';

type FlexNode = Record<string, unknown>;
export interface DigestLineMessage {
  type: 'flex';
  altText: string;
  contents: FlexNode;
}

const flexText = (t: string, extra: FlexNode = {}): FlexNode => ({ type: 'text', text: t, wrap: true, size: 'sm', ...extra });
const separator = (): FlexNode => ({ type: 'separator', margin: 'md' });

function bubble(title: string, sub: string, body: FlexNode[], buttonLabel: string, url: string): FlexNode {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: COLOR_MAIN,
      paddingAll: '16px',
      contents: [flexText(title, { color: '#ffffff', weight: 'bold', size: 'lg' }), flexText(sub, { color: '#ccfbf1', size: 'xs', margin: 'xs' })],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: body },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [{ type: 'button', style: 'primary', color: COLOR_MAIN, height: 'sm', action: { type: 'uri', label: buttonLabel, uri: url } }],
    },
  };
}

export function buildMorningDigestLineMessage(d: MorningDigest, adminUrl: string): DigestLineMessage {
  const body: FlexNode[] = [];
  if (d.count === 0) body.push(flexText('本日の予約はありません。', { color: COLOR_SUB }));
  d.rows.slice(0, DIGEST_LINE_MAX_ROWS).forEach((row, i) => {
    if (i > 0) body.push(separator());
    const badges = rowBadges(row);
    const contents: FlexNode[] = [
      {
        type: 'box',
        layout: 'baseline',
        spacing: 'md',
        contents: [flexText(row.time || '--:--', { weight: 'bold', color: COLOR_MAIN, flex: 0, wrap: false }), flexText(`${clip(row.name, 20)} 様`, { weight: 'bold', flex: 1 })],
      },
    ];
    const detail = [clip(row.menu, 40), row.staff ? `担当: ${clip(row.staff, 12)}` : ''].filter(Boolean).join(' ／ ');
    if (detail) contents.push(flexText(detail, { size: 'xs', color: COLOR_SUB }));
    if (badges.length > 0) contents.push(flexText(badges.join('・'), { size: 'xs', color: COLOR_WARN, weight: 'bold' }));
    if (row.note) contents.push(flexText(`申し送り: ${clip(row.note, 60)}`, { size: 'xs' }));
    body.push({ type: 'box', layout: 'vertical', spacing: 'xs', margin: i > 0 ? 'md' : 'none', contents });
  });
  if (d.count > DIGEST_LINE_MAX_ROWS) body.push(separator(), flexText(`ほか ${d.count - DIGEST_LINE_MAX_ROWS} 件（管理画面でご確認ください）`, { size: 'xs', color: COLOR_SUB, margin: 'md' }));
  if (d.waitlist_count > 0) body.push(separator(), flexText(`空き待ち: ${d.waitlist_count} 件（今日の日時）`, { size: 'xs', margin: 'md' }));
  const short = formatDigestDate(d.date).replace('（', ' ').replace('）', '');
  return {
    type: 'flex',
    altText: `今日の予約 ${d.count}件（${short}）`,
    contents: bubble(`今日の予約 ${d.count}件`, `${formatDigestDate(d.date)} ${d.store_name}`, body, '管理画面で見る', adminUrl),
  };
}

// ---------------------------------------------------------------------------
// 月次レポート
// ---------------------------------------------------------------------------

export interface ReportReservation extends AnalyticsReservation {
  id: string;
  customer_id?: string | null;
  line_user_id?: string | null;
  customer_phone?: string | null;
}

export interface MonthlyBroadcastSummary {
  /** その月に送った配信の数 */
  count: number;
  /** 送信できた通数 */
  sent: number;
  /** タップした人の予約（配信ごとに送信後 7 日以内。同じ予約が 2 つの配信に入れば両方に数える） */
  tapped_reservations: number;
  tapped_revenue: number;
  received_reservations: number;
  received_revenue: number;
}

export interface MonthlyTotals {
  month: string;
  reservations: number;
  cancelled: number;
  revenue: number;
  new_customers: number;
}

export interface MonthlyReport extends MonthlyTotals {
  label: string;
  /** 予約 1 件あたりの売上 */
  average: number;
  /** キャンセル率（%。小数 1 桁。予約が無ければ null） */
  cancel_rate: number | null;
  /** 予約したお客様の人数 */
  customers: number;
  repeat_customers: number;
  /** リピート率（%。その月に予約した人のうち、その月より前にも予約がある人の割合。0 人なら null） */
  repeat_rate: number | null;
  prev: MonthlyTotals;
  /** 前月比（%。前月が 0 のときは null） */
  change: { reservations: number | null; revenue: number | null };
  top_menus: Array<{ name: string; count: number; revenue: number }>;
  /** 配信の成果（配信機能を使っていない / 取得していないときは null） */
  broadcasts: MonthlyBroadcastSummary | null;
}

function customerKey(r: ReportReservation): string {
  return text(r.customer_id) || text(r.line_user_id) || text(r.customer_phone) || `r:${r.id}`;
}

function inMonth(r: ReportReservation, month: string): boolean {
  return text(r.reservation_date).slice(0, 7) === month;
}

function monthCore(all: ReportReservation[], month: string) {
  const rows = all.filter((r) => inMonth(r, month));
  const analytics = computeReservationAnalytics(rows, [], null);
  const start = `${month}-01`;
  const before = new Set<string>();
  for (const r of all) {
    if (!isCancelledReservation(r) && text(r.reservation_date) && text(r.reservation_date).slice(0, 10) < start) before.add(customerKey(r));
  }
  const keys = new Set(rows.filter((r) => !isCancelledReservation(r)).map(customerKey));
  let repeat = 0;
  for (const k of keys) if (before.has(k)) repeat += 1;
  return { analytics, customers: keys.size, repeat, fresh: keys.size - repeat };
}

function percentChange(current: number, prev: number): number | null {
  return prev > 0 ? Math.round(((current - prev) / prev) * 100) : null;
}

/** 店舗のすべての予約から、その月（予約日が属する月。YYYY-MM）のレポートを作る */
export function computeMonthlyReport(all: ReportReservation[], month: string, broadcasts: MonthlyBroadcastSummary | null = null): MonthlyReport {
  const cur = monthCore(all, month);
  const prevMonth = shiftMonth(month, -1);
  const prev = monthCore(all, prevMonth);
  const s = cur.analytics.summary;
  const totalWithCancel = s.total + s.cancelled;
  return {
    month,
    label: monthLabel(month),
    reservations: s.total,
    cancelled: s.cancelled,
    revenue: s.total_revenue,
    average: s.total > 0 ? Math.round(s.total_revenue / s.total) : 0,
    cancel_rate: totalWithCancel > 0 ? Math.round((s.cancelled / totalWithCancel) * 1000) / 10 : null,
    customers: cur.customers,
    new_customers: cur.fresh,
    repeat_customers: cur.repeat,
    repeat_rate: cur.customers > 0 ? Math.round((cur.repeat / cur.customers) * 100) : null,
    prev: {
      month: prevMonth,
      reservations: prev.analytics.summary.total,
      cancelled: prev.analytics.summary.cancelled,
      revenue: prev.analytics.summary.total_revenue,
      new_customers: prev.fresh,
    },
    change: {
      reservations: percentChange(s.total, prev.analytics.summary.total),
      revenue: percentChange(s.total_revenue, prev.analytics.summary.total_revenue),
    },
    top_menus: cur.analytics.menu_popularity
      .map((m) => ({ name: m.menu_name, count: m.count, revenue: m.revenue }))
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue || a.name.localeCompare(b.name))
      .slice(0, 5),
    broadcasts,
  };
}

/** レポートを見られる月（最初の予約の月 〜 今月。新しい順。最大 36 か月） */
export function listReportMonths(all: Array<{ reservation_date?: string | null }>, now: Date): string[] {
  const current = digestJstDate(now).slice(0, 7);
  let first = current;
  for (const r of all) {
    const m = text(r.reservation_date).slice(0, 7);
    if (isReportMonth(m) && m < first) first = m;
  }
  const out: string[] = [];
  for (let m = current; m >= first && out.length < 36; m = shiftMonth(m, -1)) out.push(m);
  return out;
}

export const yen = (n: number): string => `¥${Math.round(n).toLocaleString('ja-JP')}`;

export function formatChange(v: number | null): string {
  if (v === null) return '';
  return `前月比 ${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}%`;
}

const withChange = (base: string, v: number | null): string => (v === null ? base : `${base}（${formatChange(v)}）`);

export function renderMonthlyReportEmail(r: MonthlyReport, storeName: string, reportUrl: string): { subject: string; body: string } {
  const lines: string[] = [
    `${storeName} の ${r.label} のまとめです。`,
    '',
    withChange(`予約数: ${r.reservations} 件`, r.change.reservations),
    withChange(`売上: ${yen(r.revenue)}`, r.change.revenue),
    `1 件あたり: ${yen(r.average)}`,
    `新規のお客様: ${r.new_customers} 人（前月 ${r.prev.new_customers} 人）`,
    `リピート率: ${r.repeat_rate === null ? '—' : `${r.repeat_rate}%`}（予約した ${r.customers} 人のうち ${r.repeat_customers} 人）`,
    `キャンセル率: ${r.cancel_rate === null ? '—' : `${r.cancel_rate}%`}（${r.cancelled} 件）`,
    '',
  ];
  if (r.top_menus.length > 0) {
    lines.push('人気メニュー');
    r.top_menus.forEach((m, i) => lines.push(`${i + 1}. ${m.name} ${m.count} 件（${yen(m.revenue)}）`));
    lines.push('');
  }
  if (r.broadcasts && r.broadcasts.count > 0) {
    const b = r.broadcasts;
    lines.push('配信の成果（送信後 7 日以内）', `配信 ${b.count} 回（${b.sent} 通）`, `タップした人の予約: ${b.tapped_reservations} 件・${yen(b.tapped_revenue)}`, `受け取った人の予約: ${b.received_reservations} 件・${yen(b.received_revenue)}`, '');
  }
  lines.push('くわしいレポート（管理画面。過去の月も見られます）', reportUrl, '', '※ 売上は予約のメニュー・オプションなどの料金の合計です（予約日がこの月の予約。キャンセルを除く）。', '※ このメールは「月次レポート」の設定により自動で送っています。');
  return { subject: `【月次レポート】${r.label} - ${storeName}`, body: lines.join('\n') };
}

function kv(label: string, value: string, sub = ''): FlexNode {
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'box', layout: 'baseline', contents: [flexText(label, { color: COLOR_SUB, flex: 4, wrap: false }), flexText(value, { weight: 'bold', align: 'end', flex: 6 })] },
      ...(sub ? [flexText(sub, { size: 'xxs', color: COLOR_SUB, align: 'end' })] : []),
    ],
  };
}

export function buildMonthlyReportLineMessage(r: MonthlyReport, storeName: string, reportUrl: string): DigestLineMessage {
  const body: FlexNode[] = [
    kv('予約数', `${r.reservations} 件`, formatChange(r.change.reservations)),
    kv('売上', yen(r.revenue), formatChange(r.change.revenue)),
    kv('新規のお客様', `${r.new_customers} 人`, `前月 ${r.prev.new_customers} 人`),
    kv('リピート率', r.repeat_rate === null ? '—' : `${r.repeat_rate}%`),
    kv('キャンセル率', r.cancel_rate === null ? '—' : `${r.cancel_rate}%`, `${r.cancelled} 件`),
  ];
  if (r.top_menus.length > 0) {
    body.push(separator(), flexText('人気メニュー', { weight: 'bold', margin: 'md' }));
    r.top_menus.slice(0, 3).forEach((m, i) => body.push(flexText(`${i + 1}. ${clip(m.name, 30)}　${m.count} 件`, { size: 'xs' })));
  }
  if (r.broadcasts && r.broadcasts.count > 0) {
    const b = r.broadcasts;
    body.push(separator(), flexText('配信の成果', { weight: 'bold', margin: 'md' }), flexText(`配信 ${b.count} 回（${b.sent} 通）→ タップした人の予約 ${b.tapped_reservations} 件・${yen(b.tapped_revenue)}`, { size: 'xs' }));
  }
  return { type: 'flex', altText: `${r.label}の月次レポート`, contents: bubble(`${r.label}の月次レポート`, storeName, body, 'くわしく見る', reportUrl) };
}
