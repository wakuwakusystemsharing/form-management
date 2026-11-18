/**
 * 自動配信のきっかけ「特定の曜日に 1 週間の空き状況」の純粋ロジック（Vitest 対象）
 *
 * 選んだ曜日の実行時刻に、選んだ予約フォームの「これから N 日間の空き状況」を
 * 日付 × 時間帯（午前 / 午後 / 夕方）の 〇△✕ の表にしたカード（Flex）で一斉に送る。
 * 空きの判定は予約フォームのカレンダーの〇✕と同じ規則（サーバー側は `broadcast-automation-service.ts` の
 * `computeWeeklyAvailability`。「予約を変更」と同じ `evaluateDaySlots` を使う）。
 *
 * ルールごとの設定:
 *   weekdays         … 送る曜日（0 = 日 〜 6 = 土。1 つ以上）
 *   form_id          … 空き状況を載せる予約フォーム（カレンダー表示モード）
 *   days / include_today … 載せる日数（3 / 5 / 7 / 10 / 14）と、当日を含めるか
 *   duration_minutes … 「◯ 分の予約が入る空き」として数える所要時間（0 = フォームの時間間隔）
 *   min_open_slots   … 空きが合計この枠数以上ある時だけ送る
 *   staff_id         … スタッフ選択のフォームで、そのスタッフの空きだけを載せる（null = 誰か 1 人でも空いていれば空き）
 *   few_threshold    … 時間帯の空きがこの枠数以下なら △（残りわずか）
 */
import type { AutomationTrigger } from '@/types/broadcast';

export type WeeklyAvailabilityTrigger = Extract<AutomationTrigger, { type: 'weekly_availability' }>;

export const WEEKLY_DAYS_OPTIONS = [3, 5, 7, 10, 14] as const;
export const WEEKLY_TITLE_MAX = 30;
export const WEEKLY_TEXT_MAX = 300;
export const WEEKLY_BUTTON_MAX = 20;
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export const WEEKLY_DEFAULT_CARD = {
  title: '今週の空き状況',
  text: 'ご予約の空き状況をお知らせします。\nご都合の合う日時がありましたら、ぜひご予約ください。',
  button_label: '予約する',
};

export const WEEKLY_DEFAULT_TRIGGER: WeeklyAvailabilityTrigger = {
  type: 'weekly_availability',
  weekdays: [1],
  form_id: '',
  days: 7,
  include_today: false,
  duration_minutes: 0,
  min_open_slots: 1,
  staff_id: null,
  few_threshold: 2,
  card: { ...WEEKLY_DEFAULT_CARD },
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const str = (v: unknown, max: number, fallback: string): string => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || fallback;
};

/** 保存データを整える。曜日が 1 つも無ければ null（保存できない） */
export function normalizeWeeklyAvailabilityTrigger(o: Record<string, unknown>): WeeklyAvailabilityTrigger | null {
  const d = WEEKLY_DEFAULT_TRIGGER;
  const weekdays = Array.isArray(o.weekdays)
    ? [...new Set(o.weekdays.map((w) => Number(w)).filter((w) => Number.isInteger(w) && w >= 0 && w <= 6))].sort((a, b) => a - b)
    : [];
  if (weekdays.length === 0) return null;
  const days = clampInt(o.days, 1, 14, d.days);
  const c = o.card && typeof o.card === 'object' ? (o.card as Record<string, unknown>) : {};
  const staff = typeof o.staff_id === 'string' && o.staff_id.trim() ? o.staff_id.trim().slice(0, 64) : null;
  return {
    type: 'weekly_availability',
    weekdays,
    form_id: typeof o.form_id === 'string' ? o.form_id.trim().slice(0, 64) : '',
    days: (WEEKLY_DAYS_OPTIONS as readonly number[]).includes(days) ? days : d.days,
    include_today: o.include_today === true,
    duration_minutes: clampInt(o.duration_minutes, 0, 600, d.duration_minutes),
    min_open_slots: clampInt(o.min_open_slots, 1, 500, d.min_open_slots),
    staff_id: staff,
    few_threshold: clampInt(o.few_threshold, 0, 20, d.few_threshold),
    card: {
      title: str(c.title, WEEKLY_TITLE_MAX, d.card.title),
      text: str(c.text, WEEKLY_TEXT_MAX, d.card.text),
      button_label: str(c.button_label, WEEKLY_BUTTON_MAX, d.card.button_label),
    },
  };
}

/** ルール一覧に出す説明 */
export function describeWeeklyAvailabilityTrigger(t: WeeklyAvailabilityTrigger): string {
  const days = t.weekdays.length === 7 ? '毎日' : `毎週 ${t.weekdays.map((w) => WEEKDAY_LABELS[w]).join('・')}曜`;
  const conds = [`${t.include_today ? '当日' : '翌日'}から ${t.days} 日間`];
  if (t.duration_minutes > 0) conds.push(`${t.duration_minutes} 分の空き`);
  if (t.min_open_slots > 1) conds.push(`空き ${t.min_open_slots} 枠以上の時だけ`);
  if (t.staff_id) conds.push('スタッフ指定');
  return `${days}に空き状況を送る（${conds.join('・')}）`;
}

const JST_MS = 9 * 3600000;
const pad = (n: number) => String(n).padStart(2, '0');

function jstParts(now: Date): { y: number; m: number; d: number; dow: number } {
  const j = new Date(now.getTime() + JST_MS);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth(), d: j.getUTCDate(), dow: j.getUTCDay() };
}

/** 今日（日本時間）が送る曜日か */
export function isWeeklyAvailabilityDay(t: Pick<WeeklyAvailabilityTrigger, 'weekdays'>, now: Date): boolean {
  return t.weekdays.includes(jstParts(now).dow);
}

/** 載せる日付（日本時間。当日 or 翌日から days 日ぶん） */
export function weeklyAvailabilityDates(t: Pick<WeeklyAvailabilityTrigger, 'days' | 'include_today'>, now: Date): string[] {
  const p = jstParts(now);
  const out: string[] = [];
  for (let i = 0; i < t.days; i++) {
    const x = new Date(Date.UTC(p.y, p.m, p.d + i + (t.include_today ? 0 : 1)));
    out.push(`${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`);
  }
  return out;
}

/** 同じ日に 2 回送らないための目印 */
export function weeklyAvailabilityMarker(now: Date): string {
  const p = jstParts(now);
  return `week:${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
}

// ---- 集計: 日付 × 時間帯 ----

export type AvailabilityBandKey = 'morning' | 'afternoon' | 'evening';
export const AVAILABILITY_BANDS: Array<{ key: AvailabilityBandKey; label: string; hint: string; from: number; to: number }> = [
  { key: 'morning', label: '午前', hint: '〜12時', from: 0, to: 12 * 60 },
  { key: 'afternoon', label: '午後', hint: '12〜17時', from: 12 * 60, to: 17 * 60 },
  { key: 'evening', label: '夕方', hint: '17時〜', from: 17 * 60, to: 24 * 60 },
];

/**
 * ok = 空きあり / few = 残りわずか / ng = 満席（受付はしているが空きが無い）/ none = その時間帯は受付していない
 */
export type AvailabilityMark = 'ok' | 'few' | 'ng' | 'none';

export interface DaySlotsInput {
  date: string;
  /** その日の受付している時刻と、いま予約できるか（`evaluateDaySlots` の結果。定休日は空） */
  slots: Array<{ time: string; ok: boolean }>;
}

export interface AvailabilityDay {
  date: string;
  /** 受付している時刻が 1 つも無い日（定休日・受付期間外など） */
  closed: boolean;
  open: number;
  bands: Record<AvailabilityBandKey, { mark: AvailabilityMark; open: number; total: number }>;
}

export interface AvailabilitySummary {
  days: AvailabilityDay[];
  /** 空いている枠の合計 */
  totalOpen: number;
  /** 表に出す時間帯（期間中に受付のある時間帯だけ） */
  bands: AvailabilityBandKey[];
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function summarizeAvailability(input: DaySlotsInput[], fewThreshold: number): AvailabilitySummary {
  const used = new Set<AvailabilityBandKey>();
  let totalOpen = 0;
  const days = input.map((day) => {
    const bands = {} as AvailabilityDay['bands'];
    let open = 0;
    for (const band of AVAILABILITY_BANDS) {
      const inBand = day.slots.filter((s) => {
        const m = toMin(s.time);
        return m >= band.from && m < band.to;
      });
      const n = inBand.filter((s) => s.ok).length;
      open += n;
      if (inBand.length > 0) used.add(band.key);
      bands[band.key] = {
        total: inBand.length,
        open: n,
        mark: inBand.length === 0 ? 'none' : n === 0 ? 'ng' : n <= fewThreshold ? 'few' : 'ok',
      };
    }
    totalOpen += open;
    return { date: day.date, closed: day.slots.length === 0, open, bands };
  });
  return { days, totalOpen, bands: AVAILABILITY_BANDS.map((b) => b.key).filter((k) => used.has(k)) };
}

/** 送ってよいか: 空きの合計が設定した枠数以上 */
export function hasEnoughOpenSlots(t: Pick<WeeklyAvailabilityTrigger, 'min_open_slots'>, summary: AvailabilitySummary): boolean {
  return summary.totalOpen >= Math.max(1, t.min_open_slots);
}

// ---- カード ----

const THEME = '#f7a3a3';
const COLORS: Record<AvailabilityMark, string> = { ok: '#16a34a', few: '#ea580c', ng: '#9ca3af', none: '#d1d5db' };
const MARKS: Record<AvailabilityMark, string> = { ok: '〇', few: '△', ng: '✕', none: '－' };

/** "11/25(水)" と、土日の色 */
function dateCell(date: string): Record<string, unknown> {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return {
    type: 'text',
    text: `${m}/${d}(${WEEKDAY_LABELS[dow]})`,
    size: 'sm',
    flex: 4,
    gravity: 'center',
    color: dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : '#111827',
  };
}

export function renderWeeklyText(template: string, vars: { 店名?: string; 期間?: string }): string {
  return template.split('{店名}').join(vars.店名 || '').split('{期間}').join(vars.期間 || '').trim();
}

const shortDate = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
};

/**
 * 空き状況のカード（Flex のバブル）。日付 × 時間帯の 〇△✕ の表。
 * 文言を変えても、表・凡例・「配信時点の空き」の注意書きは必ず入る。予約ボタンは予約フォームの URL があるときだけ
 */
export function buildWeeklyAvailabilityFlex(
  card: WeeklyAvailabilityTrigger['card'],
  summary: AvailabilitySummary,
  input: { storeName?: string | null; bookingUrl?: string | null; staffName?: string | null }
): { alt_text: string; contents: Record<string, unknown> } {
  const first = summary.days[0]?.date;
  const last = summary.days[summary.days.length - 1]?.date;
  const period = first && last ? `${shortDate(first)}〜${shortDate(last)}` : '';
  const vars = { 店名: input.storeName || '', 期間: period };
  const title = renderWeeklyText(card.title, vars) || WEEKLY_DEFAULT_CARD.title;
  const body = renderWeeklyText(card.text, vars);
  const bands = AVAILABILITY_BANDS.filter((b) => summary.bands.includes(b.key));

  const header: Record<string, unknown>[] = [];
  if (input.storeName) header.push({ type: 'text', text: input.storeName, color: '#ffffffcc', size: 'xs' });
  header.push({ type: 'text', text: title, color: '#ffffff', size: 'lg', weight: 'bold', wrap: true });
  if (period) header.push({ type: 'text', text: `${period}${input.staffName ? `　担当: ${input.staffName}` : ''}`, color: '#ffffffcc', size: 'xs' });

  const rows: Record<string, unknown>[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '日付', size: 'xs', color: '#6b7280', flex: 4 },
        ...bands.map((b) => ({ type: 'text', text: b.label, size: 'xs', color: '#6b7280', align: 'center', flex: 2, weight: 'bold' })),
      ],
    },
    { type: 'separator', margin: 'sm' },
  ];
  for (const day of summary.days) {
    const cells: Record<string, unknown>[] = day.closed
      ? [{ type: 'text', text: '休み', size: 'sm', color: COLORS.ng, align: 'center', flex: Math.max(2, bands.length * 2), gravity: 'center' }]
      : bands.map((b) => {
          const mark = day.bands[b.key].mark;
          return { type: 'text', text: MARKS[mark], size: 'lg', weight: 'bold', color: COLORS[mark], align: 'center', flex: 2, gravity: 'center' };
        });
    rows.push({ type: 'box', layout: 'horizontal', margin: 'md', contents: [dateCell(day.date), ...cells] });
  }

  const contents: Record<string, unknown>[] = [];
  if (body) contents.push({ type: 'text', text: body, size: 'sm', wrap: true });
  contents.push({ type: 'box', layout: 'vertical', margin: body ? 'lg' : 'none', backgroundColor: '#f9fafb', cornerRadius: '8px', paddingAll: '12px', contents: rows });
  contents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    spacing: 'md',
    contents: [
      { type: 'text', text: '〇 空きあり', size: 'xxs', color: COLORS.ok, flex: 0 },
      { type: 'text', text: '△ 残りわずか', size: 'xxs', color: COLORS.few, flex: 0 },
      { type: 'text', text: '✕ 満席', size: 'xxs', color: COLORS.ng, flex: 0 },
    ],
  });
  contents.push({
    type: 'text',
    text: `${bands.map((b) => `${b.label}=${b.hint}`).join(' / ')}\n※ 配信時点の空き状況です。ご予約は先着順のため、すでに埋まっている場合があります。`,
    size: 'xxs',
    color: '#6b7280',
    wrap: true,
    margin: 'sm',
  });

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'mega',
    header: { type: 'box', layout: 'vertical', contents: header, spacing: 'xs', paddingAll: '20px', paddingTop: '15px', paddingBottom: '15px', backgroundColor: THEME },
    body: { type: 'box', layout: 'vertical', contents, paddingAll: '16px' },
  };
  if (input.bookingUrl) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [{ type: 'button', style: 'primary', color: THEME, height: 'sm', action: { type: 'uri', label: card.button_label || WEEKLY_DEFAULT_CARD.button_label, uri: input.bookingUrl } }],
    };
  }
  return { alt_text: `【${title}】${period}`.slice(0, 400), contents: bubble };
}

/** プレビュー用の例（空き状況を取得できないとき・フォーム未選択のとき） */
export function sampleAvailabilitySummary(dates: string[]): AvailabilitySummary {
  const pattern: AvailabilityMark[][] = [
    ['ok', 'few', 'ng'],
    ['ng', 'ok', 'ok'],
    ['ng', 'ng', 'ng'],
    ['few', 'ng', 'ng'],
    [],
    ['ok', 'ok', 'few'],
    ['ok', 'ok', 'ok'],
  ];
  const keys: AvailabilityBandKey[] = ['morning', 'afternoon', 'evening'];
  const days = dates.map((date, i) => {
    const p = pattern[i % pattern.length];
    const bands = {} as AvailabilityDay['bands'];
    keys.forEach((k, j) => {
      const mark = p[j] ?? 'none';
      bands[k] = { mark, open: mark === 'ok' ? 4 : mark === 'few' ? 1 : 0, total: p.length === 0 ? 0 : 4 };
    });
    return { date, closed: p.length === 0, open: keys.reduce((s, k) => s + bands[k].open, 0), bands };
  });
  return { days, totalOpen: days.reduce((s, d) => s + d.open, 0), bands: keys };
}
