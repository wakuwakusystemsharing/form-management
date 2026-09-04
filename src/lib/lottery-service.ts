/**
 * 抽選フォームのアプリケーションサービス
 *
 * API ルートから呼ばれる「抽選の実行」「結果の整形」「保存前の検証」をまとめる。
 * DB アクセスは lottery-repository.ts、純粋ロジックは lottery-engine.ts に委ねる。
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { createCustomer, findCustomerByLineOrPhone } from '@/lib/customer-utils';
import {
  computeExpiresAt,
  generateQrToken,
  generateRedeemCode,
  getEntryLimitMessage,
  getEntryLimitWindow,
  getPeriodState,
  isAllSoldOut,
  isEntryExpired,
  secureRandomUnit,
  selectPrize,
} from '@/lib/lottery-engine';
import { findMissingRequiredAnswers } from '@/lib/lottery-validation';
import { buildLotteryResultText, buildLotteryWinFlex } from '@/lib/lottery-line-message';
import { pushLineMessages } from '@/lib/line-push';
import { resolveLineChannelId, verifyLineIdToken } from '@/lib/line-verify';
import {
  countPrizeEntries,
  findLatestUserEntry,
  insertLotteryEntryChecked,
  listUserEntries,
  redeemCodeExists,
  updateLotteryEntry,
  type LotteryEntryPatch,
  type NewLotteryEntry,
} from '@/lib/lottery-repository';
import type { LotteryConfig, LotteryDrawResponse, LotteryEntry, LotteryForm, LotteryPrize } from '@/types/lottery';

// ---------------------------------------------------------------------------
// 店舗情報（抽選で必要な列だけ）
// ---------------------------------------------------------------------------

export interface LotteryStoreInfo {
  id: string;
  name: string;
  line_channel_id: string | null;
  line_channel_access_token: string | null;
}

export async function getStoreForLottery(storeId: string): Promise<LotteryStoreInfo | null> {
  if (getAppEnvironment() === 'local') {
    const file = path.join(process.cwd(), 'data', 'stores.json');
    if (!fs.existsSync(file)) return null;
    try {
      const stores = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>[];
      const store = stores.find((s) => s.id === storeId);
      if (!store) return null;
      return {
        id: storeId,
        name: typeof store.name === 'string' ? store.name : '',
        line_channel_id: typeof store.line_channel_id === 'string' ? store.line_channel_id : null,
        line_channel_access_token: typeof store.line_channel_access_token === 'string' ? store.line_channel_access_token : null,
      };
    } catch {
      return null;
    }
  }
  const client = createAdminClient();
  if (!client) throw new Error('Supabase 接続エラー');
  const { data, error } = await (client as any)
    .from('stores')
    .select('id, name, line_channel_id, line_channel_access_token')
    .eq('id', storeId)
    .maybeSingle();
  if (error) throw new Error(`店舗の取得に失敗しました: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name || '',
    line_channel_id: data.line_channel_id || null,
    line_channel_access_token: data.line_channel_access_token || null,
  };
}

// 保存前の検証はクライアントでも使うため lottery-validation.ts に置き、ここから再 export する
export { validateLotteryConfigForSave, findMissingRequiredAnswers } from '@/lib/lottery-validation';

// ---------------------------------------------------------------------------
// LINE ユーザーの確定
// ---------------------------------------------------------------------------

export interface ResolvedLineUser {
  userId: string;
  displayName: string | null;
}

export type ResolveLineUserResult =
  | { ok: true; user: ResolvedLineUser }
  | { ok: false; status: number; error: string; detail?: string };

/**
 * local: body の line_user_id を信用（開発用）
 * それ以外: id_token を LINE で検証して sub を使う
 */
export async function resolveLineUser(
  body: { id_token?: unknown; line_user_id?: unknown; line_display_name?: unknown },
  store: LotteryStoreInfo
): Promise<ResolveLineUserResult> {
  const displayName = typeof body.line_display_name === 'string' && body.line_display_name.trim() ? body.line_display_name.trim() : null;
  if (getAppEnvironment() === 'local') {
    const userId = typeof body.line_user_id === 'string' ? body.line_user_id.trim() : '';
    if (!userId) return { ok: false, status: 400, error: 'line_user_id は必須です（local 環境）' };
    return { ok: true, user: { userId, displayName } };
  }
  const idToken = typeof body.id_token === 'string' ? body.id_token : '';
  if (!idToken) return { ok: false, status: 401, error: 'LINE の認証情報がありません。LINE アプリから開き直してください' };
  const channelId = resolveLineChannelId(store.line_channel_id);
  if (!channelId) {
    console.error('[lottery] LINE channel id is not configured for store', store.id);
    return { ok: false, status: 500, error: 'LINE チャネル ID が設定されていません。店舗管理者にお問い合わせください' };
  }
  const verified = await verifyLineIdToken(idToken, channelId);
  if (!verified.ok) return verified;
  return { ok: true, user: { userId: verified.payload.userId, displayName: verified.payload.displayName || displayName } };
}

// ---------------------------------------------------------------------------
// 結果の整形
// ---------------------------------------------------------------------------

export function findPrizeById(config: LotteryConfig, prizeId: string | null): LotteryPrize | null {
  if (!prizeId) return null;
  const prize = config.prizes.find((p) => p.id === prizeId);
  if (prize) return prize;
  if (config.consolation_prize && config.consolation_prize.id === prizeId) return config.consolation_prize;
  return null;
}

export function toDrawResponse(
  form: LotteryForm,
  entry: LotteryEntry,
  storeName: string,
  isExisting: boolean
): LotteryDrawResponse {
  // 仮当選（provisional）は確定までお客様に賞品を見せない（応募済みとして返す）
  const isProvisional = entry.status === 'provisional';
  const prize = isProvisional ? null : findPrizeById(form.config, entry.prize_id);
  if (isProvisional) entry = { ...entry, prize_id: null, prize_name: null, is_win: false, is_consolation: false };
  const messageText = buildLotteryResultText(form.config, entry, prize, {
    storeName,
    lineDisplayName: entry.line_display_name || '',
  });
  const second = form.config.basic_info.second_message;
  return {
    entry: {
      id: entry.id,
      status: entry.status,
      is_win: entry.is_win,
      is_consolation: entry.is_consolation,
      prize_id: entry.prize_id,
      prize_name: entry.prize_name,
      redeem_code: entry.redeem_code,
      qr_token: entry.qr_token,
      expires_at: entry.expires_at,
      entered_at: entry.entered_at,
      redeemed_at: entry.redeemed_at,
    },
    is_expired: isEntryExpired(entry, new Date()),
    prize,
    message_text: messageText,
    second_message: second && second.enabled && second.text ? { enabled: true, text: second.text } : null,
    is_existing: isExisting,
  };
}

// ---------------------------------------------------------------------------
// 抽選の実行
// ---------------------------------------------------------------------------

export interface DrawParams {
  form: LotteryForm;
  store: LotteryStoreInfo;
  user: ResolvedLineUser;
  lineFriendFlag: boolean | null;
  answers: Record<string, unknown> | null;
  userAgent: string | null;
  now?: Date;
  /** テスト用: 乱数を差し替える */
  rng?: () => number;
  /** テスト用: QR 画像 URL の生成を差し替える */
  qrImageUrlBuilder?: (qrToken: string) => string | null;
}

export type DrawOutcome =
  | { ok: true; status: number; response: LotteryDrawResponse }
  | { ok: false; status: number; error: string; existing?: LotteryDrawResponse };

async function generateUniqueRedeemCode(storeId: string, rng: () => number): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRedeemCode(rng);
    if (!(await redeemCodeExists(storeId, code))) return code;
  }
  throw new Error('引換コードの生成に失敗しました');
}

/** 履歴を更新し、戻り値が欠けても手元の entry にパッチを重ねて返す（結果の返却を止めない） */
async function applyEntryPatch(entry: LotteryEntry, patch: LotteryEntryPatch): Promise<LotteryEntry> {
  try {
    const updated = await updateLotteryEntry(entry.id, patch);
    return { ...entry, ...patch, ...(updated ?? {}) };
  } catch (error) {
    console.warn('[lottery] entry update failed (ignored):', error);
    return { ...entry, ...patch };
  }
}

async function linkCustomer(entry: LotteryEntry, user: ResolvedLineUser, lineFriendFlag: boolean | null): Promise<string | null> {
  try {
    const existing = await findCustomerByLineOrPhone(entry.store_id, user.userId, null);
    if (existing) return existing.id;
    const created = await createCustomer({
      store_id: entry.store_id,
      line_user_id: user.userId,
      name: user.displayName || 'LINEユーザー',
      line_display_name: user.displayName,
      line_friend_flag: lineFriendFlag === true,
    });
    return created.id;
  } catch (error) {
    console.warn('[lottery] customer link failed (ignored):', error);
    return null;
  }
}

/**
 * 即時抽選 / 後日抽選の応募を 1 回実行する。
 * 期間外・回数上限・在庫切れなどは ok:false で理由（日本語）を返す。
 */
export async function executeLotteryDraw(params: DrawParams): Promise<DrawOutcome> {
  const { form, store, user } = params;
  const config = form.config;
  const now = params.now ?? new Date();
  const rng = params.rng ?? secureRandomUnit;

  if (form.status !== 'active') {
    return { ok: false, status: 403, error: 'この抽選は現在受け付けていません' };
  }
  const periodState = getPeriodState(config, now);
  if (periodState === 'before') return { ok: false, status: 403, error: '受付開始前です' };
  if (periodState === 'after') return { ok: false, status: 403, error: '受付期間外です' };
  if (config.lottery_type === 'deferred' && form.deferred_draw_status !== 'accepting') {
    return { ok: false, status: 403, error: 'この抽選の応募は締め切りました' };
  }
  if (config.entry_rules.require_friend && params.lineFriendFlag === false) {
    return { ok: false, status: 403, error: '友だち追加をしてから抽選にご参加ください' };
  }
  const missing = findMissingRequiredAnswers(config.entry_rules.pre_questions, params.answers);
  if (missing.length > 0) {
    return { ok: false, status: 400, error: `必須項目が未入力です: ${missing.join('、')}` };
  }

  // 回数制限（事前チェック。最終判定は insertLotteryEntryChecked が行う）
  const limit = getEntryLimitWindow(config, now);
  const latest = await findLatestUserEntry(form.id, user.userId);
  const limitError = (): DrawOutcome => ({
    ok: false,
    status: 409,
    error: getEntryLimitMessage(config.entry_rules.limit, config.lottery_type),
    existing: latest ? toDrawResponse(form, latest, store.name, true) : undefined,
  });
  if (latest && limit.max_entries !== null) {
    const windowStart = limit.window_start;
    const inWindow = !windowStart || new Date(latest.entered_at) >= windowStart;
    if (inWindow && limit.max_entries === 1) return limitError();
  }

  const baseEntry: NewLotteryEntry = {
    lottery_form_id: form.id,
    store_id: form.store_id,
    line_user_id: user.userId,
    line_display_name: user.displayName,
    line_friend_flag: params.lineFriendFlag,
    customer_id: null,
    prize_id: null,
    prize_name: null,
    is_win: false,
    is_consolation: false,
    redeem_code: null,
    qr_token: null,
    expires_at: null,
    status: 'lost',
    redeemed_at: null,
    redeemed_by: null,
    redeemed_note: null,
    answers: params.answers,
    user_agent: params.userAgent,
    entered_at: now.toISOString(),
  };

  // ---- 後日抽選: 応募として記録するだけ ----
  if (config.lottery_type === 'deferred') {
    const inserted = await insertLotteryEntryChecked({
      form_id: form.id,
      line_user_id: user.userId,
      prize_id: null,
      prize_stock: null,
      window_start: limit.window_start,
      max_entries: limit.max_entries,
      entry: { ...baseEntry, status: 'entered' },
    });
    if (!inserted.ok) {
      if (inserted.reason === 'limit') return limitError();
      return { ok: false, status: 404, error: '抽選フォームが見つかりません' };
    }
    const customerId = await linkCustomer(inserted.entry, user, params.lineFriendFlag);
    const entry = customerId ? await applyEntryPatch(inserted.entry, { customer_id: customerId }) : inserted.entry;
    return { ok: true, status: 201, response: toDrawResponse(form, entry, store.name, false) };
  }

  // ---- 即時抽選 ----
  const counts = await countPrizeEntries(form.id);
  if (config.entry_rules.when_sold_out === 'close' && isAllSoldOut(config.prizes, counts)) {
    return { ok: false, status: 410, error: 'この抽選は終了しました（賞品がなくなりました）' };
  }

  const selection = selectPrize(config.prizes, rng(), counts);
  let prize: LotteryPrize | null = selection.prize;
  let isConsolation = false;
  if (!prize && config.consolation_prize) {
    prize = config.consolation_prize;
    isConsolation = true;
  }

  const buildEntry = async (p: LotteryPrize | null, consolation: boolean): Promise<NewLotteryEntry> => {
    if (!p) return { ...baseEntry, status: 'lost' };
    const redeemCode = await generateUniqueRedeemCode(form.store_id, rng);
    return {
      ...baseEntry,
      prize_id: p.id,
      prize_name: p.name,
      is_win: !consolation,
      is_consolation: consolation,
      redeem_code: redeemCode,
      qr_token: config.redeem_method === 'qr' ? generateQrToken(rng) : null,
      expires_at: computeExpiresAt(p, now),
      status: 'drawn',
    };
  };

  let entryToInsert = await buildEntry(prize, isConsolation);
  let inserted = await insertLotteryEntryChecked({
    form_id: form.id,
    line_user_id: user.userId,
    prize_id: entryToInsert.prize_id,
    prize_stock: prize ? prize.stock : null,
    window_start: limit.window_start,
    max_entries: limit.max_entries,
    entry: entryToInsert,
  });

  // 同時アクセスで在庫が尽きた場合は「はずれ」（残念賞があれば残念賞）として記録し直す
  if (!inserted.ok && inserted.reason === 'sold_out' && !isConsolation) {
    prize = config.consolation_prize ?? null;
    isConsolation = !!prize;
    entryToInsert = await buildEntry(prize, isConsolation);
    inserted = await insertLotteryEntryChecked({
      form_id: form.id,
      line_user_id: user.userId,
      prize_id: entryToInsert.prize_id,
      prize_stock: prize ? prize.stock : null,
      window_start: limit.window_start,
      max_entries: limit.max_entries,
      entry: entryToInsert,
    });
  }
  // 残念賞まで在庫切れなら純粋なはずれ
  if (!inserted.ok && inserted.reason === 'sold_out') {
    entryToInsert = { ...baseEntry, status: 'lost' };
    inserted = await insertLotteryEntryChecked({
      form_id: form.id,
      line_user_id: user.userId,
      prize_id: null,
      prize_stock: null,
      window_start: limit.window_start,
      max_entries: limit.max_entries,
      entry: entryToInsert,
    });
  }
  if (!inserted.ok) {
    if (inserted.reason === 'limit') return limitError();
    return { ok: false, status: 404, error: '抽選フォームが見つかりません' };
  }

  let entry = inserted.entry;

  // 顧客に紐付け（失敗しても抽選結果は返す）
  const customerId = await linkCustomer(entry, user, params.lineFriendFlag);
  if (customerId) entry = await applyEntryPatch(entry, { customer_id: customerId });

  // Bot からの当選カード push（当選 / 残念賞のみ。はずれには送らない）
  const finalPrize = findPrizeById(config, entry.prize_id);
  if (finalPrize && config.messages.push_flex_enabled && store.line_channel_access_token) {
    const qrImageUrl = entry.qr_token && params.qrImageUrlBuilder ? params.qrImageUrlBuilder(entry.qr_token) : null;
    const flex = buildLotteryWinFlex({ config, prize: finalPrize, entry, storeName: store.name, qrImageUrl });
    const result = await pushLineMessages(store.line_channel_access_token, user.userId, [flex]);
    if (result.ok) entry = await applyEntryPatch(entry, { push_sent: true });
  }

  return { ok: true, status: 201, response: toDrawResponse(form, entry, store.name, false) };
}

// ---------------------------------------------------------------------------
// お客様自身による「使用済みにする」
// ---------------------------------------------------------------------------

export type SelfRedeemOutcome =
  | { ok: true; response: LotteryDrawResponse }
  | { ok: false; status: number; error: string };

/**
 * 当選画面の「この賞品を使用済みにする」。
 * 本人（ID トークン検証済みの LINE ユーザー）の当選で、未引換かつ期限内のときだけ redeemed にする。
 * 店舗管理者の抽選履歴には「本人操作」の備考付きで引換済みとして表示される。
 */
export async function selfRedeemEntry(
  form: LotteryForm,
  store: LotteryStoreInfo,
  user: ResolvedLineUser,
  entryId: string,
  now: Date = new Date()
): Promise<SelfRedeemOutcome> {
  if (!form.config.presentation.allow_self_redeem) {
    return { ok: false, status: 403, error: 'この抽選では店頭スタッフが引換を行います。画面をスタッフにご提示ください' };
  }
  const entries = await listUserEntries(form.id, user.userId);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) {
    return { ok: false, status: 404, error: '当選情報が見つかりません' };
  }
  if (entry.status === 'redeemed') {
    return { ok: true, response: toDrawResponse(form, entry, store.name, true) };
  }
  if (entry.status !== 'drawn' || !entry.prize_id) {
    return { ok: false, status: 400, error: 'この結果は使用済みにできません' };
  }
  if (isEntryExpired(entry, now)) {
    return { ok: false, status: 400, error: '有効期限が切れているため使用できません' };
  }
  const updated = await updateLotteryEntry(entry.id, {
    status: 'redeemed',
    redeemed_at: now.toISOString(),
    redeemed_by: null,
    redeemed_note: '本人操作（お客様がフォームで使用済みにしました）',
  });
  return { ok: true, response: toDrawResponse(form, updated ?? { ...entry, status: 'redeemed', redeemed_at: now.toISOString() }, store.name, true) };
}
