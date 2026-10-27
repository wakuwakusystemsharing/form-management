/**
 * キャンセルルール（予約フォーム編集 → 営業時間・ルール → キャンセルルール設定）の純粋ロジック
 *
 * - deadline_hours: 予約日時の何時間前までお客様自身（LINE の「予約をキャンセル」）でキャンセルできるか（0 = いつでも）
 * - policy_text / show_policy_on_form: キャンセル規定の文言をフォームの送信ボタンの上に表示
 * - notify_store_on_cancel: お客様が LINE でキャンセルしたとき店舗へメールで知らせる
 *
 * 店舗管理画面からのキャンセル（管理者操作）には期限を適用しない。
 */
import type { CancelFeeTier, Form } from '@/types/form';

export interface CancelRules {
  deadline_hours: number;
  policy_text: string;
  show_policy_on_form: boolean;
  notify_store_on_cancel: boolean;
  /** 段階式キャンセル料（days_before の大きい順。空 = キャンセル料なし） */
  fee_tiers: CancelFeeTier[];
  /** キャンセル料の基準（宿泊料金のみ / オプション込みの合計） */
  fee_base: 'stay' | 'total';
  /** キャンセル料がかかる期間の LINE キャンセル: 金額を確認して取り消す / 受け付けず店舗へ誘導 */
  self_cancel_with_fee: 'confirm' | 'deny';
}

/** 締切の選択肢（時間）。0 = いつでもキャンセル可 */
export const CANCEL_DEADLINE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'いつでもキャンセル可（制限なし）' },
  { value: 1, label: '1 時間前まで' },
  { value: 2, label: '2 時間前まで' },
  { value: 3, label: '3 時間前まで' },
  { value: 6, label: '6 時間前まで' },
  { value: 12, label: '12 時間前まで' },
  { value: 24, label: '24 時間前まで（前日）' },
  { value: 48, label: '48 時間前まで（2 日前）' },
  { value: 72, label: '72 時間前まで（3 日前）' },
  { value: 168, label: '1 週間前まで' },
];

export const DEFAULT_CANCEL_RULES: CancelRules = {
  deadline_hours: 0,
  policy_text: '',
  show_policy_on_form: false,
  notify_store_on_cancel: false,
  fee_tiers: [],
  fee_base: 'stay',
  self_cancel_with_fee: 'confirm',
};

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

function normalizeHHMM(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const m = HHMM_RE.exec(t.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function hhmmToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 段階式キャンセル料の正規化: 不正値を除き days_before の大きい順（同じ日数なら時刻付きが先）に並べる。
 * 同じ日数 + 同じ時刻は後勝ち。% は 0〜100 の整数。いちばん小さい段階の until_time は意味を持たないので外す
 */
export function sanitizeFeeTiers(raw: unknown): CancelFeeTier[] {
  if (!Array.isArray(raw)) return [];
  const map = new Map<string, CancelFeeTier>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const t = r as { days_before?: unknown; until_time?: unknown; percent?: unknown };
    const days = typeof t.days_before === 'number' && Number.isFinite(t.days_before) && t.days_before >= 0 ? Math.floor(t.days_before) : null;
    if (days === null || days > 365) continue;
    const p = typeof t.percent === 'number' && Number.isFinite(t.percent) ? Math.min(100, Math.max(0, Math.floor(t.percent))) : null;
    if (p === null) continue;
    const until = normalizeHHMM(t.until_time);
    const tier: CancelFeeTier = until ? { days_before: days, until_time: until, percent: p } : { days_before: days, percent: p };
    map.set(`${days}|${until || ''}`, tier);
  }
  const out = [...map.values()].sort((a, b) => {
    if (a.days_before !== b.days_before) return b.days_before - a.days_before;
    // 同じ日数: 時刻付き（その時刻まで）が先、その後に時刻なし
    if (a.until_time && !b.until_time) return -1;
    if (!a.until_time && b.until_time) return 1;
    if (a.until_time && b.until_time) return hhmmToMin(a.until_time) - hhmmToMin(b.until_time);
    return 0;
  });
  if (out.length > 0 && out[out.length - 1].until_time) {
    const last = out[out.length - 1];
    out[out.length - 1] = { days_before: last.days_before, percent: last.percent };
  }
  return out;
}

/** 保存データを既定値で補完する（normalizeForm と Webhook の両方で使う） */
export function resolveCancelRules(config: Partial<Pick<Form['config'], 'cancel_rules'>> | null | undefined): CancelRules {
  const raw = (config?.cancel_rules ?? {}) as Partial<Record<keyof CancelRules, unknown>>;
  const hours = typeof raw.deadline_hours === 'number' && Number.isFinite(raw.deadline_hours) && raw.deadline_hours > 0
    ? Math.floor(raw.deadline_hours)
    : 0;
  return {
    deadline_hours: hours,
    policy_text: typeof raw.policy_text === 'string' ? raw.policy_text : '',
    show_policy_on_form: raw.show_policy_on_form === true,
    notify_store_on_cancel: raw.notify_store_on_cancel === true,
    fee_tiers: sanitizeFeeTiers(raw.fee_tiers),
    fee_base: raw.fee_base === 'total' ? 'total' : 'stay',
    self_cancel_with_fee: raw.self_cancel_with_fee === 'deny' ? 'deny' : 'confirm',
  };
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 今の JST 日付 "YYYY-MM-DD" と 0:00 からの分 */
function jstNow(now: Date): { date: string; minutes: number } {
  const d = new Date(now.getTime() + JST_OFFSET_MS);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { date, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function dateDiffDays(from: string, to: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(to) - p(from)) / 86400000);
}

export interface CancelFeeResult {
  percent: number;
  amount: number;
  /** チェックイン日 − 操作日（JST の日付差。当日 0、前日 1、過ぎていればマイナス） */
  daysBefore: number;
  tier: CancelFeeTier | null;
}

/**
 * 段階式キャンセル料: days_before の大きい順に見て最初に当てはまる段階。
 * 当てはまる = daysBefore > days_before、または 同じ日で（until_time 無し or 現在時刻 < until_time）。
 * 無ければ最後（いちばん小さい）の段階。fee_tiers が空なら 0%。金額は 10 円未満切り捨て
 */
export function resolveCancelFee(
  rules: Pick<Partial<CancelRules>, 'fee_tiers' | 'fee_base'>,
  checkinDate: string,
  now: Date,
  baseAmount: number
): CancelFeeResult {
  const tiers = sanitizeFeeTiers(rules.fee_tiers);
  const { date: today, minutes } = jstNow(now);
  const daysBefore = /^\d{4}-\d{2}-\d{2}$/.test(checkinDate) ? dateDiffDays(today, checkinDate) : 0;
  if (tiers.length === 0) return { percent: 0, amount: 0, daysBefore, tier: null };
  let tier: CancelFeeTier | null = null;
  for (const t of tiers) {
    if (daysBefore > t.days_before) { tier = t; break; }
    if (daysBefore === t.days_before && (!t.until_time || minutes < hhmmToMin(t.until_time))) { tier = t; break; }
  }
  if (!tier) tier = tiers[tiers.length - 1];
  const base = Number.isFinite(baseAmount) && baseAmount > 0 ? baseAmount : 0;
  const amount = Math.floor((base * tier.percent) / 100 / 10) * 10;
  return { percent: tier.percent, amount, daysBefore, tier };
}

function dayLabel(n: number): string {
  return n === 0 ? '当日' : n === 1 ? '前日' : `${n}日前`;
}

function rangeText(lo: number, hi: number): string {
  if (lo === hi) return dayLabel(lo);
  if (lo === 0 && hi === 1) return '前日・当日';
  if (lo === 0) return `${dayLabel(hi)}〜当日`;
  if (lo === 1) return `${hi}日前〜前日`;
  return `${lo}〜${hi}日前`;
}

/** 段階表から規定文を自動生成（policy_text が空のときフォームの「キャンセルについて」に使う）。例: 7日前まで: 無料 / 2〜6日前: 50% / 前日・当日: 100% */
export function buildCancelPolicyText(rules: Pick<Partial<CancelRules>, 'fee_tiers'>): string {
  const tiers = sanitizeFeeTiers(rules.fee_tiers);
  if (tiers.length === 0) return '';
  const lines: string[] = [];
  tiers.forEach((tier, i) => {
    const prev = i > 0 ? tiers[i - 1] : null;
    const last = i === tiers.length - 1;
    const segs: string[] = [];
    let hi: number;
    if (!prev) hi = Number.POSITIVE_INFINITY;
    else if (prev.until_time) {
      segs.push(`${dayLabel(prev.days_before)}${prev.until_time}以降`);
      hi = prev.days_before - 1;
    } else hi = prev.days_before - 1;
    if (tier.until_time) {
      const fullLo = tier.days_before + 1;
      if (hi === Number.POSITIVE_INFINITY) segs.push(`${dayLabel(fullLo)}まで`);
      else if (fullLo <= hi) segs.push(rangeText(fullLo, hi));
      segs.push(`${dayLabel(tier.days_before)}${tier.until_time}まで`);
    } else {
      const lo = last ? 0 : tier.days_before;
      if (hi === Number.POSITIVE_INFINITY) segs.push(lo === 0 ? '全期間' : `${dayLabel(lo)}まで`);
      else if (lo <= hi) segs.push(rangeText(lo, hi));
    }
    const fee = tier.percent === 0 ? '無料' : `${tier.percent}%`;
    lines.push(`${segs.join('・')}: ${fee}`);
  });
  return lines.join('\n');
}

/** 予約日時（JST）を Date にする。時刻が無い / 不正なら null */
export function reservationDateTimeJst(reservationDate: string, reservationTime: string | null | undefined): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(reservationDate || ''));
  if (!d) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(String(reservationTime || '00:00'));
  const hh = t ? t[1].padStart(2, '0') : '00';
  const mm = t ? t[2] : '00';
  const dt = new Date(`${d[1]}-${d[2]}-${d[3]}T${hh}:${mm}:00+09:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** お客様がキャンセルできる期限（Date）。制限なし / 判定不能は null */
export function getCancelDeadline(rules: Pick<CancelRules, 'deadline_hours'>, reservationDate: string, reservationTime: string | null | undefined): Date | null {
  if (!rules.deadline_hours || rules.deadline_hours <= 0) return null;
  const at = reservationDateTimeJst(reservationDate, reservationTime);
  if (!at) return null;
  return new Date(at.getTime() - rules.deadline_hours * 3600000);
}

/** 今キャンセルできるか。期限を過ぎていれば allowed: false と期限を返す */
export function isCancelAllowed(
  rules: Pick<CancelRules, 'deadline_hours'>,
  reservationDate: string,
  reservationTime: string | null | undefined,
  now: Date = new Date()
): { allowed: boolean; deadline: Date | null } {
  const deadline = getCancelDeadline(rules, reservationDate, reservationTime);
  if (!deadline) return { allowed: true, deadline: null };
  return { allowed: now.getTime() <= deadline.getTime(), deadline };
}

/** "9/19（土）19:00" 形式（JST） */
export function formatDeadlineJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()];
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${dow}）${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}

/** 期限を過ぎているときに LINE で返す案内文 */
export function buildCancelDeadlineMessage(rules: Pick<CancelRules, 'deadline_hours'>, deadline: Date | null, storePhone?: string | null): string {
  const lines = [
    `このご予約は、ご予約日時の ${rules.deadline_hours} 時間前までキャンセルを受け付けております。`,
  ];
  if (deadline) lines.push(`（キャンセル期限: ${formatDeadlineJst(deadline)}）`);
  lines.push('');
  lines.push('期限を過ぎているため、LINE からはキャンセルできません。');
  lines.push(storePhone ? `お手数ですが店舗（TEL: ${storePhone}）まで直接ご連絡ください。` : 'お手数ですが店舗まで直接ご連絡ください。');
  return lines.join('\n');
}

/** お客様が LINE でキャンセルしたときに店舗へ送るメール */
export function buildCancelNotificationEmail(args: {
  storeName: string;
  reservation: {
    customer_name: string;
    customer_phone?: string | null;
    reservation_date: string;
    reservation_time?: string | null;
    menu_name?: string | null;
    submenu_name?: string | null;
    staff_name?: string | null;
    // 宿泊予約
    checkout_date?: string | null;
    stay_nights?: number | null;
    stay_price_total?: number | null;
  };
  cancelledAt?: Date;
  /** 段階式キャンセル料（かかるときだけ） */
  cancelFee?: { percent: number; amount: number } | null;
}): { subject: string; body: string } {
  const r = args.reservation;
  const time = r.reservation_time ? String(r.reservation_time).slice(0, 5) : '';
  const menu = r.submenu_name ? `${r.menu_name || ''} > ${r.submenu_name}` : r.menu_name || '';
  const when = args.cancelledAt ? formatDeadlineJst(args.cancelledAt) : '';
  const isStay = !!r.checkout_date;
  const lines = [
    '管理者各位',
    '',
    `「${args.storeName}」のご予約がお客様によりキャンセルされました（LINE から操作）。`,
    '',
    '──────────────────────',
    isStay
      ? `■ ご宿泊　：${r.reservation_date} 〜 ${r.checkout_date}${r.stay_nights ? `（${r.stay_nights}泊）` : ''}`
      : `■ 日時　　：${r.reservation_date}${time ? ' ' + time : ''}`,
    `■ お名前　：${r.customer_name}`,
    `■ 電話　　：${r.customer_phone || '-'}`,
  ];
  if (menu && menu !== '未選択') lines.push(`■ メニュー：${menu}`);
  if (r.staff_name) lines.push(`■ 担当　　：${r.staff_name}`);
  if (isStay && typeof r.stay_price_total === 'number') lines.push(`■ 宿泊料金：¥${r.stay_price_total.toLocaleString()}`);
  if (args.cancelFee && args.cancelFee.percent > 0) lines.push(`■ キャンセル料：${args.cancelFee.percent}%（¥${args.cancelFee.amount.toLocaleString()}）`);
  if (when) lines.push(`■ 操作日時：${when}`);
  lines.push('──────────────────────');
  return {
    subject: `【予約キャンセル】${r.customer_name}様｜${r.reservation_date}${time ? ' ' + time : ''}`,
    body: lines.join('\n'),
  };
}
