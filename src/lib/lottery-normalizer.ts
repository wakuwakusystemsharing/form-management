/**
 * 抽選フォームの正規化（後方互換）
 *
 * DB / JSON から読んだ抽選フォームは必ずここを通し、欠落フィールドを既定値で補う。
 * `normalizeForm()`（予約フォーム）と同じ位置づけ。互換性のため無期限に保持する。
 */
import type {
  DeferredDrawStatus,
  LotteryAnimation,
  LotteryConfig,
  LotteryDraftStatus,
  LotteryEntryLimit,
  LotteryForm,
  LotteryFormStatus,
  LotteryPrize,
  LotteryRedeemMethod,
  LotteryScratchStyle,
  LotteryType,
} from '@/types/lottery';
import type { SurveyQuestion } from '@/types/survey';

export const LOTTERY_DEFAULT_THEME_COLOR = '#1b2a4e';

export const LOTTERY_DEFAULT_WIN_TEXT =
  '🎯 {抽選名} に参加しました\n結果：{賞品名}\n引換コード：{引換コード}\n有効期限：{有効期限}\n\n※店頭でこの画面をご提示ください';
export const LOTTERY_DEFAULT_LOSE_TEXT =
  '🎯 {抽選名} に参加しました\n結果：はずれ\n\nまたのご参加をお待ちしております';
export const LOTTERY_DEFAULT_ENTRY_TEXT =
  '🎯 {抽選名} に応募しました\n抽選日：{抽選日}\n\n結果は LINE でお知らせします';
export const LOTTERY_DEFAULT_ENTRY_COMPLETE_TEXT = '応募を受け付けました。抽選結果は LINE でお知らせします。';
export const LOTTERY_DEFAULT_WIN_TITLE = 'おめでとうございます！';
export const LOTTERY_DEFAULT_LOSE_TITLE = '残念、今回ははずれでした';
export const LOTTERY_DEFAULT_SUBMIT_TEXT = '抽選する';

const LOTTERY_TYPES: LotteryType[] = ['instant', 'deferred'];
const REDEEM_METHODS: LotteryRedeemMethod[] = ['code', 'qr'];
const ANIMATIONS: LotteryAnimation[] = ['scratch', 'gacha', 'simple'];
const ENTRY_LIMITS: LotteryEntryLimit[] = ['once', 'daily', 'period_n'];
const SCRATCH_STYLES: LotteryScratchStyle[] = ['silver', 'gold', 'image'];
const FORM_STATUSES: LotteryFormStatus[] = ['active', 'inactive', 'paused'];
const DRAFT_STATUSES: LotteryDraftStatus[] = ['none', 'draft', 'ready_to_publish'];
const DEFERRED_STATUSES: DeferredDrawStatus[] = ['accepting', 'closed', 'drawn', 'notified'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeLotteryPrize(raw: unknown, index: number): LotteryPrize {
  const p = obj(raw);
  const stockRaw = p.stock;
  let stock: number | null = null;
  if (stockRaw !== null && stockRaw !== undefined && stockRaw !== '') {
    const n = num(stockRaw, NaN);
    stock = Number.isNaN(n) ? null : n;
  }
  const prize: LotteryPrize = {
    id: str(p.id) || `prize_${index + 1}`,
    name: str(p.name),
    probability: num(p.probability, 0),
    stock,
  };
  const description = optStr(p.description);
  if (description !== undefined) prize.description = description;
  const imageUrl = optStr(p.image_url);
  if (imageUrl !== undefined) prize.image_url = imageUrl;
  const rankColor = optStr(p.rank_color);
  if (rankColor !== undefined) prize.rank_color = rankColor;
  if (p.expires_in_days !== undefined && p.expires_in_days !== null && p.expires_in_days !== '') {
    const n = num(p.expires_in_days, NaN);
    if (!Number.isNaN(n)) prize.expires_in_days = n;
  }
  const expiresAt = optStr(p.expires_at);
  if (expiresAt !== undefined) prize.expires_at = expiresAt;
  const redeemNote = optStr(p.redeem_note);
  if (redeemNote !== undefined) prize.redeem_note = redeemNote;
  return prize;
}

export function normalizeLotteryConfig(raw: unknown): LotteryConfig {
  const c = parseJson(raw);
  const basic = obj(c.basic_info);
  const rules = obj(c.entry_rules);
  const pres = obj(c.presentation);
  const msgs = obj(c.messages);
  const ui = obj(c.ui_settings);
  const deferred = obj(c.deferred);
  const period = obj(basic.period);
  const second = obj(basic.second_message);
  const footer = obj(msgs.flex_footer_button);

  const lotteryType = pick(c.lottery_type, LOTTERY_TYPES, 'instant');
  const themeColor = str(basic.theme_color) || str(ui.theme_color) || LOTTERY_DEFAULT_THEME_COLOR;

  const prizes = Array.isArray(c.prizes) ? c.prizes.map(normalizeLotteryPrize) : [];
  const consolation = c.consolation_prize ? normalizeLotteryPrize(c.consolation_prize, 999) : undefined;

  const config: LotteryConfig = {
    lottery_type: lotteryType,
    redeem_method: pick(c.redeem_method, REDEEM_METHODS, 'code'),
    basic_info: {
      title: str(basic.title),
      liff_id: str(basic.liff_id),
      theme_color: themeColor,
    },
    prizes,
    entry_rules: {
      // 後日抽選は 1 人 1 口固定
      limit: lotteryType === 'deferred' ? 'once' : pick(rules.limit, ENTRY_LIMITS, 'once'),
      require_friend: bool(rules.require_friend, false),
      when_sold_out: rules.when_sold_out === 'close' ? 'close' : 'lose',
      pre_questions: Array.isArray(rules.pre_questions) ? (rules.pre_questions as SurveyQuestion[]) : [],
    },
    presentation: {
      animation: pick(pres.animation, ANIMATIONS, 'scratch'),
      scratch_style: pick(pres.scratch_style, SCRATCH_STYLES, 'silver'),
      show_probability: bool(pres.show_probability, false),
      show_stock: bool(pres.show_stock, false),
      confetti: bool(pres.confetti, true),
      win_title: str(pres.win_title) || LOTTERY_DEFAULT_WIN_TITLE,
      lose_title: str(pres.lose_title) || LOTTERY_DEFAULT_LOSE_TITLE,
    },
    messages: {
      win_text: str(msgs.win_text) || LOTTERY_DEFAULT_WIN_TEXT,
      lose_text: str(msgs.lose_text) || LOTTERY_DEFAULT_LOSE_TEXT,
      entry_text: str(msgs.entry_text) || LOTTERY_DEFAULT_ENTRY_TEXT,
      push_flex_enabled: bool(msgs.push_flex_enabled, false),
    },
    ui_settings: {
      submit_button_text: str(ui.submit_button_text) || LOTTERY_DEFAULT_SUBMIT_TEXT,
      theme_color: themeColor,
    },
  };

  // 任意フィールド（値があるときだけ載せる。JSON 比較で undefined と欠落を同一視するため）
  const storeName = optStr(basic.store_name);
  if (storeName !== undefined) config.basic_info.store_name = storeName;
  const logoUrl = optStr(basic.logo_url);
  if (logoUrl !== undefined) config.basic_info.logo_url = logoUrl;
  const notice = optStr(basic.notice);
  if (notice !== undefined) config.basic_info.notice = notice;
  const startAt = optStr(period.start_at);
  const endAt = optStr(period.end_at);
  if (startAt !== undefined || endAt !== undefined) {
    config.basic_info.period = {};
    if (startAt !== undefined) config.basic_info.period.start_at = startAt;
    if (endAt !== undefined) config.basic_info.period.end_at = endAt;
  }
  if (Object.keys(second).length > 0) {
    config.basic_info.second_message = { enabled: bool(second.enabled, false), text: str(second.text) };
  }
  if (lotteryType === 'deferred' || Object.keys(deferred).length > 0) {
    config.deferred = {
      entry_complete_text: str(deferred.entry_complete_text) || LOTTERY_DEFAULT_ENTRY_COMPLETE_TEXT,
    };
    const scheduled = optStr(deferred.draw_scheduled_at);
    if (scheduled !== undefined) config.deferred.draw_scheduled_at = scheduled;
  }
  if (consolation) config.consolation_prize = consolation;
  if (config.entry_rules.limit === 'period_n') {
    const max = num(rules.period_max, 1);
    config.entry_rules.period_max = Number.isInteger(max) && max >= 1 ? max : 1;
  }
  const scratchImage = optStr(pres.scratch_image_url);
  if (scratchImage !== undefined) config.presentation.scratch_image_url = scratchImage;
  const loseMessage = optStr(pres.lose_message);
  if (loseMessage !== undefined) config.presentation.lose_message = loseMessage;
  if (optStr(footer.label) && optStr(footer.url)) {
    config.messages.flex_footer_button = { label: str(footer.label), url: str(footer.url) };
  }

  return config;
}

/**
 * DB / JSON の行を LotteryForm に正規化する。
 * Supabase の JSONB が文字列で返ってきた場合もパースする。
 */
export function normalizeLotteryForm(row: Record<string, unknown>): LotteryForm {
  const draftRaw = row.draft_config;
  const hasDraft = draftRaw !== null && draftRaw !== undefined && draftRaw !== '';
  const now = new Date().toISOString();
  const staticDeploy = row.static_deploy ? parseJson(row.static_deploy) : null;

  return {
    id: str(row.id),
    store_id: str(row.store_id),
    config: normalizeLotteryConfig(row.config),
    draft_config: hasDraft ? normalizeLotteryConfig(draftRaw) : null,
    status: pick(row.status, FORM_STATUSES, 'inactive'),
    draft_status: pick(row.draft_status, DRAFT_STATUSES, 'none'),
    deferred_draw_status: pick(row.deferred_draw_status, DEFERRED_STATUSES, 'accepting'),
    deferred_drawn_at: optStr(row.deferred_drawn_at) ?? null,
    deferred_notified_at: optStr(row.deferred_notified_at) ?? null,
    created_at: str(row.created_at) || now,
    updated_at: str(row.updated_at) || now,
    last_published_at: optStr(row.last_published_at) ?? null,
    static_deploy: staticDeploy && Object.keys(staticDeploy).length > 0 ? (staticDeploy as unknown as LotteryForm['static_deploy']) : null,
  };
}

/** 新規作成時の初期 config（3 賞品のサンプル） */
export function createDefaultLotteryConfig(params: {
  title: string;
  liff_id?: string;
  store_name?: string;
  theme_color?: string;
  lottery_type?: LotteryType;
  generateId: () => string;
}): LotteryConfig {
  const lotteryType = params.lottery_type ?? 'instant';
  const base = normalizeLotteryConfig({
    lottery_type: lotteryType,
    basic_info: {
      title: params.title,
      liff_id: params.liff_id ?? '',
      store_name: params.store_name,
      theme_color: params.theme_color || LOTTERY_DEFAULT_THEME_COLOR,
    },
    prizes: [
      { id: params.generateId(), name: 'A賞', description: 'お会計 10% OFF', rank_color: '#d4af37', probability: 5, stock: 10, expires_in_days: 30 },
      { id: params.generateId(), name: 'B賞', description: 'ドリンク 1 杯サービス', rank_color: '#a8a9ad', probability: 15, stock: 50, expires_in_days: 30 },
      { id: params.generateId(), name: 'C賞', description: 'オリジナルステッカー', rank_color: '#cd7f32', probability: 30, stock: null, expires_in_days: 30 },
    ],
    entry_rules: { limit: 'once', require_friend: false, when_sold_out: 'lose', pre_questions: [] },
  });
  if (lotteryType === 'deferred') {
    base.prizes = base.prizes.map((p) => ({ ...p, probability: 0, stock: p.stock ?? 1 }));
  }
  return base;
}
