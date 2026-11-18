/**
 * 自動配信のきっかけ「予約フォームでキャンセルが出た時」の純粋ロジック（Vitest 対象）
 *
 * お客様が予約をキャンセルして枠が空いたら、キャンセルした本人以外のお客様へ
 * 「この日時に空きが出ました」のカード（Flex）を一斉に送る。ほかのきっかけ（1 日 1 回の判定）と違い、
 * キャンセルが起きたその場で動く（サーバー側は `broadcast-cancel-opening-service.ts`）。
 *
 * 送らない条件（ルールごとに設定）:
 *   - only_if_open        … その日時がいま実際に予約できる状態でなければ送らない
 *   - min_hours_before    … 予約の N 時間前より後のキャンセルは送らない
 *   - quiet_hours         … 夜間のキャンセルは送らない
 *   - max_per_day         … 1 日に送る回数の上限
 *   - include_store_cancel … 店舗が管理画面でキャンセルした時も送るか（既定はお客様の LINE キャンセルだけ）
 * 空き待ち（キャンセル待ち）の人がいる枠は、空き待ちの人を優先して一斉配信しない
 */
import type { AudienceCustomer, AutomationTrigger, BroadcastAudience, CustomerFacts } from '@/types/broadcast';
import { isLineBlocked, matchAudience } from '@/lib/broadcast-audience';

/** 送ってよいか（`broadcast-automation.ts` の isAutomationSendAllowed と同じ規則。循環 import を避けるためここにも持つ） */
function isSendAllowed(marker: string, sends: Array<{ marker: string; sent_at: string }>, resendAfterDays: number | null, now: Date): boolean {
  if (sends.some((s) => s.marker === marker)) return false;
  if (resendAfterDays && sends.length > 0) {
    const last = sends.reduce((m, s) => Math.max(m, Date.parse(s.sent_at) || 0), 0);
    if (last > 0 && now.getTime() - last < resendAfterDays * 24 * 60 * 60 * 1000) return false;
  }
  return true;
}

export type CancelOpeningTrigger = Extract<AutomationTrigger, { type: 'reservation_cancelled' }>;
export type CancelSource = 'customer' | 'store';

export const CANCEL_OPENING_TEXT_MAX = 300;
export const CANCEL_OPENING_TITLE_MAX = 30;
export const CANCEL_OPENING_BUTTON_MAX = 20;

export const CANCEL_OPENING_DEFAULT_CARD = {
  title: '空きが出ました',
  text: 'キャンセルが出たため、下記の日時に空きができました。\nご都合の合う方は、ぜひご予約ください。お待ちしております。',
  button_label: '予約する',
};

export const CANCEL_OPENING_DEFAULT_TRIGGER: CancelOpeningTrigger = {
  type: 'reservation_cancelled',
  only_if_open: true,
  min_hours_before: 3,
  quiet_hours: { enabled: true, start: 22, end: 8 },
  max_per_day: 3,
  include_store_cancel: false,
  card: { ...CANCEL_OPENING_DEFAULT_CARD },
};

/** カードの文章に差し込める変数 */
export const CANCEL_OPENING_VARIABLES = ['日時', '店名'] as const;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const text = (v: unknown, max: number, fallback: string): string => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || fallback;
};

/** 保存データを整える（足りない項目は既定値） */
export function normalizeCancelOpeningTrigger(o: Record<string, unknown>): CancelOpeningTrigger {
  const d = CANCEL_OPENING_DEFAULT_TRIGGER;
  const q = o.quiet_hours && typeof o.quiet_hours === 'object' ? (o.quiet_hours as Record<string, unknown>) : {};
  const c = o.card && typeof o.card === 'object' ? (o.card as Record<string, unknown>) : {};
  return {
    type: 'reservation_cancelled',
    only_if_open: o.only_if_open !== false,
    min_hours_before: clampInt(o.min_hours_before, 0, 72, d.min_hours_before),
    quiet_hours: {
      enabled: q.enabled === undefined ? d.quiet_hours.enabled : q.enabled === true,
      start: clampInt(q.start, 0, 23, d.quiet_hours.start),
      end: clampInt(q.end, 0, 23, d.quiet_hours.end),
    },
    max_per_day: clampInt(o.max_per_day, 0, 50, d.max_per_day),
    include_store_cancel: o.include_store_cancel === true,
    card: {
      title: text(c.title, CANCEL_OPENING_TITLE_MAX, d.card.title),
      text: text(c.text, CANCEL_OPENING_TEXT_MAX, d.card.text),
      button_label: text(c.button_label, CANCEL_OPENING_BUTTON_MAX, d.card.button_label),
    },
  };
}

/** ルール一覧に出す説明 */
export function describeCancelOpeningTrigger(t: CancelOpeningTrigger): string {
  const parts = [t.include_store_cancel ? 'お客様・店舗のキャンセルで空きが出た時' : 'お客様が LINE で予約をキャンセルした時'];
  const conds: string[] = [];
  if (t.only_if_open) conds.push('実際に空いた時だけ');
  if (t.min_hours_before > 0) conds.push(`予約の ${t.min_hours_before} 時間前まで`);
  if (t.quiet_hours.enabled && t.quiet_hours.start !== t.quiet_hours.end) conds.push(`${t.quiet_hours.start}:00〜${t.quiet_hours.end}:00 は送らない`);
  if (t.max_per_day > 0) conds.push(`1 日 ${t.max_per_day} 回まで`);
  return conds.length > 0 ? `${parts[0]}（${conds.join('・')}）` : parts[0];
}

/** いまが送らない時間帯か（日本時間）。OFF、または開始と終了が同じなら false */
export function isCancelOpeningQuietTime(q: CancelOpeningTrigger['quiet_hours'], now: Date): boolean {
  if (!q.enabled || q.start === q.end) return false;
  const hour = new Date(now.getTime() + 9 * 3600000).getUTCHours();
  return q.start < q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
}

export type CancelOpeningSkip = 'source' | 'past' | 'too_close' | 'quiet' | 'daily_limit';

export const CANCEL_OPENING_SKIP_LABELS: Record<CancelOpeningSkip, string> = {
  source: '店舗によるキャンセルは対象外',
  past: '予約の日時を過ぎている',
  too_close: '予約の直前のキャンセル',
  quiet: '夜間のため送らない時間帯',
  daily_limit: '1 日の回数の上限',
};

/**
 * カレンダーを見る前に分かる条件で、送ってよいか。
 * slotStartMs = キャンセルされた予約の開始時刻 / sentToday = このルールが今日（日本時間）すでに送った回数
 */
export function checkCancelOpeningRule(
  trigger: CancelOpeningTrigger,
  input: { source: CancelSource; slotStartMs: number; now: Date; sentToday: number }
): { ok: true } | { ok: false; reason: CancelOpeningSkip } {
  if (input.source === 'store' && !trigger.include_store_cancel) return { ok: false, reason: 'source' };
  const nowMs = input.now.getTime();
  if (!Number.isFinite(input.slotStartMs) || input.slotStartMs <= nowMs) return { ok: false, reason: 'past' };
  if (trigger.min_hours_before > 0 && input.slotStartMs - nowMs < trigger.min_hours_before * 3600000) return { ok: false, reason: 'too_close' };
  if (isCancelOpeningQuietTime(trigger.quiet_hours, input.now)) return { ok: false, reason: 'quiet' };
  if (trigger.max_per_day > 0 && input.sentToday >= trigger.max_per_day) return { ok: false, reason: 'daily_limit' };
  return { ok: true };
}

/** 文章の `{日時}` `{店名}` を置き換える */
export function renderCancelOpeningText(template: string, vars: { 日時?: string; 店名?: string }): string {
  return template.split('{日時}').join(vars.日時 || '').split('{店名}').join(vars.店名 || '').trim();
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "11/25（水）14:00" */
export function formatOpeningSlot(date: string, time: string | null | undefined): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const t = String(time || '').slice(0, 5);
  return `${m}/${d}（${WEEKDAYS[dow]}）${t}`;
}

const THEME = '#f7a3a3';

/**
 * 「空きが出ました」のカード（Flex のバブル）。
 * 日時は必ず大きく載せる。予約ボタンは予約フォームの URL があるときだけ
 */
export function buildCancelOpeningFlex(
  card: CancelOpeningTrigger['card'],
  input: { storeName?: string | null; date: string; time: string; bookingUrl?: string | null }
): { alt_text: string; contents: Record<string, unknown> } {
  const slot = formatOpeningSlot(input.date, input.time);
  const vars = { 日時: slot, 店名: input.storeName || '' };
  const title = renderCancelOpeningText(card.title, vars) || CANCEL_OPENING_DEFAULT_CARD.title;
  const body = renderCancelOpeningText(card.text, vars);
  const header: Record<string, unknown>[] = [];
  if (input.storeName) header.push({ type: 'text', text: input.storeName, color: '#ffffffcc', size: 'xs' });
  header.push({ type: 'text', text: title, color: '#ffffff', size: 'lg', weight: 'bold', wrap: true });
  const contents: Record<string, unknown>[] = [
    {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#fff7ed',
      cornerRadius: '8px',
      paddingAll: '12px',
      contents: [
        { type: 'text', text: '📅 空きが出た日時', size: 'xs', color: '#9a3412' },
        { type: 'text', text: slot, size: 'xl', weight: 'bold', color: '#111827', margin: 'sm', wrap: true },
      ],
    },
  ];
  if (body) contents.push({ type: 'text', text: body, size: 'sm', wrap: true, margin: 'lg' });
  contents.push({ type: 'text', text: '※ ご予約は先着順です。すでに埋まっている場合があります。', size: 'xs', color: '#6b7280', wrap: true, margin: 'md' });
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'mega',
    header: { type: 'box', layout: 'vertical', contents: header, spacing: 'xs', paddingAll: '20px', paddingTop: '15px', paddingBottom: '15px', backgroundColor: THEME },
    body: { type: 'box', layout: 'vertical', contents, paddingAll: '20px' },
  };
  if (input.bookingUrl) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [{ type: 'button', style: 'primary', color: THEME, height: 'sm', action: { type: 'uri', label: card.button_label || CANCEL_OPENING_DEFAULT_CARD.button_label, uri: input.bookingUrl } }],
    };
  }
  return { alt_text: `【${title}】${slot}`, contents: bubble };
}

/**
 * 送る相手: LINE 連携済み・配信停止でない・ブロックされていない・追加の絞り込みに合う人から、
 * キャンセルした本人（excludeLineUserId）を除く。同じ LINE ユーザーは 1 人にまとめる。
 * marker（`cancel:{予約ID}`）を送り済みの人、再送間隔の中の人にも送らない
 */
export function pickCancelOpeningTargets(input: {
  customers: AudienceCustomer[];
  facts: Map<string, CustomerFacts>;
  audience: BroadcastAudience;
  excludeLineUserId: string | null;
  marker: string;
  resend_after_days: number | null;
  sends: Array<{ customer_id: string; marker: string; sent_at: string }>;
  now: Date;
}): AudienceCustomer[] {
  const byCustomer = new Map<string, Array<{ marker: string; sent_at: string }>>();
  for (const s of input.sends) {
    const list = byCustomer.get(s.customer_id) ?? [];
    list.push({ marker: s.marker, sent_at: s.sent_at });
    byCustomer.set(s.customer_id, list);
  }
  const out: AudienceCustomer[] = [];
  // すでに送った（または再送間隔の中の）LINE ユーザー。同じ LINE ユーザーが顧客台帳に 2 件あっても、もう 1 件のほうへ送らない
  const seen = new Set<string>();
  for (const c of input.customers) {
    if (c.line_user_id && !isSendAllowed(input.marker, byCustomer.get(c.id) ?? [], input.resend_after_days, input.now)) seen.add(c.line_user_id);
  }
  for (const c of input.customers) {
    if (!c.line_user_id || c.line_opt_out_at || isLineBlocked(c)) continue;
    if (input.excludeLineUserId && c.line_user_id === input.excludeLineUserId) continue;
    if (!matchAudience(c, input.facts.get(c.id), input.audience, input.now)) continue;
    if (seen.has(c.line_user_id)) continue;
    seen.add(c.line_user_id);
    out.push(c);
  }
  return out;
}
