/**
 * 1 対 1 トークの業務ロジック — サーバー専用
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
 *
 * ④-1: 設定（ON / OFF・保存期間。運営だけ）と、Webhook で届いたメッセージの保存
 */
import { after } from 'next/server';
import { getAppEnvironment, getBaseUrl } from '@/lib/env';
import {
  CHAT_OUTBOUND_IMAGE_MAX_BYTES,
  buildChatPreview,
  chatDisplayName,
  chatEnableBlocker,
  chatImageExt,
  chatInboundImagePath,
  chatOutboundImagePathFromUrl,
  isChatThreadStatus,
  validateChatTemplates,
  classifyAutoMessage,
  decideResend,
  describeChatSendError,
  matchesChatSearch,
  sortChatThreads,
  toChatInbound,
  toChatMessageView,
  validateChatReply,
  validateChatSettingsInput,
  type ChatAutoContext,
  type ChatInbound,
  type ChatMessageView,
  type ChatReplyTemplate,
  type ChatSettings,
  type ChatStats,
  type ChatThread,
  type ChatThreadFilter,
  type ChatThreadStatus,
  type ChatThreadView,
} from '@/lib/chat';
import {
  addChatUsage,
  claimChatNotification,
  clearChatMessageMedia,
  countChatUnread,
  deleteChatThreadRows,
  findChatCustomers,
  findChatMessageByLineId,
  getChatMessage,
  getChatSettings,
  getChatStats,
  getChatThread,
  insertChatOutbound,
  listChatMessages,
  listChatThreadMedia,
  listChatThreads,
  listChatThreadsToNotify,
  listExpiredChatMedia,
  loadChatUsageSource,
  markChatThreadRead,
  purgeExpiredChat,
  recordChatInbound,
  recordChatSystemEvents,
  saveChatNotifySettings,
  saveChatSettings,
  saveChatTemplates,
  setChatMessageMedia,
  setChatThreadCustomer,
  setChatThreadStatus,
  touchChatThreadAfterReply,
  updateChatOutboundStatus,
  type ChatCustomerBrief,
  type ChatPurgeResult,
} from '@/lib/chat-repository';
import { LINE_PUSH_ENDPOINT, pushLineMessages } from '@/lib/line-push';
import {
  CHAT_NOTIFY_DEFAULTS,
  CHAT_RETENTION_BATCH,
  buildChatAdminUrl,
  buildChatNotifyEmail,
  buildChatNotifyLineText,
  chatNotifySkipReason,
  validateChatNotifySettings,
  type ChatNotifyContent,
  type ChatNotifySettings,
} from '@/lib/chat-notify';
import { sendEmail } from '@/lib/email-sender';
import {
  EMPTY_USAGE,
  autoReplyEventText,
  chatUsageMonth,
  isUsageMonth,
  normalizeChatSystemEvent,
  previousUsageMonth,
  sortChatUsageRows,
  type ChatSystemEvent,
  type ChatUsageCounts,
  type ChatUsageRow,
} from '@/lib/chat-events';
import { fetchLineImageContent, readChatInboundImage, removeChatMedia, saveChatInboundImage, saveChatOutboundImage, type ChatImageContent } from '@/lib/chat-media';
import { readImageInfo } from '@/lib/line-rich-menu';
import { getDigestStore, listDigestStaff } from '@/lib/store-digest-repository';
import { getStoreLineSecret } from '@/lib/line-secret-repository';
import { listEnabledLineFlexMessages } from '@/lib/line-flex-repository';
import { getBroadcastSettings, getStoreLineToken } from '@/lib/broadcast-repository';

const isLocal = () => getAppEnvironment() === 'local';

export interface ChatSettingsView extends ChatSettings {
  /** チャネルシークレットが登録済みか（ON にする条件） */
  secret_set: boolean;
  /** ON にできない理由（できるなら null） */
  enable_blocker: string | null;
  stats: ChatStats;
}

/** 設定画面に返す内容（会話の中身・LINE ユーザー ID は含めない） */
export async function getChatSettingsView(storeId: string): Promise<ChatSettingsView> {
  const [{ settings, missing }, secret, stats] = await Promise.all([getChatSettings(storeId), getStoreLineSecret(storeId), getChatStats(storeId)]);
  const secretSet = secret.status === 'set';
  return { ...settings, secret_set: secretSet, enable_blocker: chatEnableBlocker({ secretSet, tableMissing: missing, local: isLocal() }), stats };
}

export type ChatSettingsUpdateResult = { ok: true; view: ChatSettingsView } | { ok: false; status: number; error: string };

/** 設定を変える（運営だけが呼ぶ。役割の確認は API 側で行う） */
export async function updateChatSettings(storeId: string, input: unknown, userId?: string | null): Promise<ChatSettingsUpdateResult> {
  const { settings: current, missing } = await getChatSettings(storeId);
  if (missing) return { ok: false, status: 409, error: 'データベースの更新（マイグレーション）がまだ適用されていません' };
  const v = validateChatSettingsInput(input, current);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  // OFF → ON にするときだけ条件を確かめる（ON のまま保存期間を変える・OFF にするのは、いつでもできる）
  if (v.value.enabled && !current.enabled) {
    const secret = await getStoreLineSecret(storeId);
    const blocker = chatEnableBlocker({ secretSet: secret.status === 'set', local: isLocal() });
    if (blocker) return { ok: false, status: 409, error: blocker };
  }
  try {
    await saveChatSettings(storeId, v.value, { current, userId });
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : 'トークの設定の保存に失敗しました' };
  }
  return { ok: true, view: await getChatSettingsView(storeId) };
}

/** その店舗の「自動」の判定に使う合言葉（読めなければ空 = 印が付かないだけで、保存は続ける） */
async function loadAutoContext(storeId: string): Promise<ChatAutoContext> {
  const [flex, opt] = await Promise.allSettled([listEnabledLineFlexMessages(storeId), getBroadcastSettings(storeId)]);
  const keywords = flex.status === 'fulfilled' ? flex.value.flatMap((m) => (Array.isArray(m.keywords) ? m.keywords : [])) : [];
  const optKeywords = opt.status === 'fulfilled' ? [opt.value.opt_out_keyword, opt.value.opt_in_keyword].filter((k): k is string => !!k) : [];
  return { keywords, optKeywords };
}

export interface ChatInboundSummary {
  /** 保存した数 */
  saved: number;
  /** 同じメッセージを保存済みで飛ばした数 */
  duplicated: number;
  /** 保存に失敗した数 */
  failed: number;
  /** 保存しなかった理由（保存の対象が無い / OFF / 署名を確認できていない） */
  skipped?: 'none' | 'disabled' | 'unverified';
}

/**
 * Webhook に届いた通知のうち、お客様からのメッセージを会話に保存する。
 * - トーク機能が ON の店舗だけ
 * - 署名を確認できた通知だけ（偽の通知を会話として保存しない。local は確認なし）
 * - **例外を投げない**（保存に失敗しても、予約確認などの既存の応答を止めない）
 */
export async function recordChatInboundEvents(storeId: string, events: ReadonlyArray<unknown>, opts: { verified: boolean; origin?: string | null }, deps: ChatNotifyDeps & ChatImageDeps = {}): Promise<ChatInboundSummary> {
  const summary: ChatInboundSummary = { saved: 0, duplicated: 0, failed: 0 };
  // 新しく保存できたメッセージ（通知の対象を決めるのに使う。同じ通知の送り直しでは、もう一度知らせない）
  const savedIds: string[] = [];
  // 新しく保存できた画像のメッセージ（このあと LINE から中身を取りにいく）
  const savedImageIds: string[] = [];
  try {
    const inbounds = events.map((ev) => toChatInbound(ev)).filter((m): m is ChatInbound => m !== null);
    if (inbounds.length === 0) return { ...summary, skipped: 'none' };
    const { settings } = await getChatSettings(storeId);
    if (!settings.enabled) return { ...summary, skipped: 'disabled' };
    if (!opts.verified && !isLocal()) {
      console.warn(`[chat] 署名を確認できていない通知のため保存しません: storeId=${storeId}`);
      return { ...summary, skipped: 'unverified' };
    }
    const ctx = inbounds.some((m) => m.kind === 'text') ? await loadAutoContext(storeId) : {};
    // 送られた順に保存する（フォームの送信文 → 続けて送った文 の順で見るため）
    const ordered = [...inbounds].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    for (const msg of ordered) {
      try {
        const autoKind = msg.kind === 'text' ? classifyAutoMessage(msg.text, ctx) : null;
        if (await recordChatInbound(storeId, msg, autoKind)) {
          summary.saved += 1;
          savedIds.push(msg.lineMessageId);
          if (msg.kind === 'image') savedImageIds.push(msg.lineMessageId);
        } else summary.duplicated += 1;
      } catch (e) {
        summary.failed += 1;
        console.error(`[chat] メッセージの保存エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error(`[chat] 受信の処理エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
  }
  // 新着の通知（スタッフの LINE・メール。任意）。通知に失敗しても、保存の結果は変えない
  if (savedIds.length > 0) await notifyChatInbound(storeId, savedIds, { origin: opts.origin }, deps);
  // 届いた画像の中身を LINE から取得して保存する（公開しない置き場）。local は LINE と通信しない
  if (!isLocal() || deps.fetchContent) for (const id of savedImageIds) await storeChatInboundImage(storeId, id, deps);
  return summary;
}

/**
 * Webhook から呼ぶ入口。LINE への応答を返したあとに保存する（既存の応答を遅くしない）。
 * 保存の対象（お客様からのメッセージ）が無い通知では、何も読まずに終わる
 */
export function scheduleChatInbound(storeId: string, events: ReadonlyArray<unknown>, opts: { verified: boolean; origin?: string | null }): void {
  if (!events.some((ev) => toChatInbound(ev) !== null)) return;
  const run = async () => {
    await recordChatInboundEvents(storeId, events, opts);
  };
  try {
    after(run);
  } catch {
    // リクエストの外（テストなど）から呼ばれたとき
    void run();
  }
}

// ---------------------------------------------------------------------------
// ④-2: トーク画面（会話の一覧・会話・既読）と返信
// ---------------------------------------------------------------------------

export interface ChatOverview {
  /** トーク機能が ON か（OFF の店舗では、保存済みの会話は読めるが、新しく届かず返信もできない） */
  enabled: boolean;
  threads: ChatThreadView[];
  unread_total: number;
}

function toThreadView(t: ChatThread, customer: ChatCustomerBrief | undefined): ChatThreadView {
  return {
    id: t.id,
    name: chatDisplayName(customer?.name),
    customer_id: customer?.id ?? t.customer_id ?? null,
    last_message_at: t.last_message_at,
    preview: t.last_message_preview,
    unread_count: t.unread_count || 0,
    status: t.status === 'done' ? 'done' : 'open',
    blocked: !!customer?.line_blocked_at,
  };
}

/** LINE ユーザー ID → 顧客（同じ人が 2 人登録されているときは、登録の古いほう） */
async function customersByLineUser(storeId: string, threads: ChatThread[]): Promise<Map<string, ChatCustomerBrief>> {
  const map = new Map<string, ChatCustomerBrief>();
  try {
    for (const c of await findChatCustomers(
      storeId,
      threads.map((t) => t.line_user_id),
    )) {
      if (c.line_user_id && !map.has(c.line_user_id)) map.set(c.line_user_id, c);
    }
  } catch (e) {
    console.error('[chat] 顧客の読み取りエラー:', e instanceof Error ? e.message : e);
  }
  return map;
}

/** 会話の一覧（未読が上・新しい順）。名前での絞り込み・未読だけの絞り込み */
export async function getChatOverview(storeId: string, opts: { filter?: ChatThreadFilter; search?: string | null } = {}): Promise<ChatOverview> {
  const [{ settings }, threads] = await Promise.all([getChatSettings(storeId), listChatThreads(storeId)]);
  const customers = await customersByLineUser(storeId, threads);
  const views = threads.map((t) => toThreadView(t, customers.get(t.line_user_id)));
  const filtered = views.filter((v) => (opts.filter === 'unread' ? v.unread_count > 0 : opts.filter === 'open' ? v.status === 'open' : true) && matchesChatSearch(v.name, opts.search));
  return { enabled: settings.enabled, threads: sortChatThreads(filtered), unread_total: views.reduce((sum, v) => sum + v.unread_count, 0) };
}

/** タブのバッジ用: ON かどうかと、未読の合計だけ */
export async function getChatUnread(storeId: string): Promise<{ enabled: boolean; unread: number }> {
  const { settings } = await getChatSettings(storeId);
  const unread = await countChatUnread(storeId);
  return { enabled: settings.enabled, unread };
}

export interface ChatThreadDetail {
  thread: ChatThreadView;
  messages: ChatMessageView[];
  /** さかのぼって読めるメッセージがまだあるか */
  has_more: boolean;
}

/**
 * 会話 1 本とメッセージ。**他の店舗の会話 ID を指定されたら null**（API は 404）。
 * 開いたら既読にする（read = false のときはしない = 新着の確認だけ）
 */
export async function getChatThreadDetail(
  storeId: string,
  threadId: string,
  opts: { beforeId?: string | null; afterId?: string | null; read?: boolean } = {},
): Promise<ChatThreadDetail | null> {
  const thread = await getChatThread(storeId, threadId);
  if (!thread) return null;
  const [{ messages, hasMore }, customers] = await Promise.all([listChatMessages(storeId, threadId, { beforeId: opts.beforeId, afterId: opts.afterId }), customersByLineUser(storeId, [thread])]);
  const customer = customers.get(thread.line_user_id);
  // 会話ができたあとで顧客が登録された人は、ここでひも付ける
  if (customer && !thread.customer_id) await setChatThreadCustomer(storeId, threadId, customer.id).catch(() => undefined);
  let unread = thread.unread_count || 0;
  if (opts.read !== false && unread > 0) {
    await markChatThreadRead(storeId, threadId);
    unread = 0;
  }
  return { thread: { ...toThreadView(thread, customer), unread_count: unread }, messages: messages.map(toChatMessageView), has_more: hasMore };
}

const CHAT_PUSH_TIMEOUT_MS = 10000;

/** LINE に文字を 1 通送る（10 秒で打ち切り。同じ鍵の再送は LINE 側で 1 回にまとまる） */
export type ChatPushFn = (accessToken: string, to: string, text: string, retryKey: string) => Promise<{ ok: boolean; status: number; body: string }>;

export const pushChatText: ChatPushFn = async (accessToken, to, text, retryKey) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', Authorization: `Bearer ${accessToken}`, 'X-Line-Retry-Key': retryKey },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
      signal: controller.signal,
    });
    const body = await res.text().catch(() => '');
    // 409 = 同じ鍵の送信を LINE がすでに受け付けている（前回の送信が届いていた）
    return { ok: res.ok || res.status === 409, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
};

/** LINE に画像を 1 通送る（imageUrl = 公開の https の URL。プレビューも同じ画像を使う = 1MB 以下の JPEG / PNG） */
export const pushChatImage: ChatPushFn = async (accessToken, to, imageUrl, retryKey) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', Authorization: `Bearer ${accessToken}`, 'X-Line-Retry-Key': retryKey },
      body: JSON.stringify({ to, messages: [{ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl }] }),
      signal: controller.signal,
    });
    const body = await res.text().catch(() => '');
    return { ok: res.ok || res.status === 409, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
};

export type ChatReplyResult =
  | { ok: true; message: ChatMessageView; notice?: string }
  | { ok: false; status: number; error: string; message?: ChatMessageView };

/**
 * 返信を送る。
 * ① 検証 → ② 「送信中」で保存（同じ送信の ID は 1 回だけ）→ ③ LINE に push → ④ 送信済み / 失敗 を記録
 * 連打・通信の再試行で同じ ID が 2 回届いても、送るのは 1 回。失敗した返信は、同じ ID でもう一度送れる
 */
export async function sendChatReply(
  storeId: string,
  threadId: string,
  input: unknown,
  user: { id: string; email?: string | null } | null,
  deps: { push?: ChatPushFn; pushImage?: ChatPushFn; now?: Date } = {},
): Promise<ChatReplyResult> {
  const v = validateChatReply(input, { storeId });
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const thread = await getChatThread(storeId, threadId);
  if (!thread) return { ok: false, status: 404, error: '会話が見つかりません' };
  const { settings } = await getChatSettings(storeId);
  if (!settings.enabled) return { ok: false, status: 409, error: 'トーク機能が OFF のため、返信できません' };

  const now = deps.now ?? new Date();
  // 画像の返信: 送る画像の置き場の中のパス（保存期間を過ぎたとき、画像のファイルも消すために持っておく）
  const imagePath = v.imageUrl ? chatOutboundImagePathFromUrl(v.imageUrl, storeId) : null;
  const image = v.imageUrl && imagePath ? { url: v.imageUrl, path: imagePath } : null;
  const preview = image ? '画像を送りました' : buildChatPreview('text', v.text);
  const { message, created } = await insertChatOutbound(storeId, threadId, { text: v.text, image, clientKey: v.clientKey, sentBy: user?.id ?? null, sentByName: user?.email ?? null, now });
  if (message.thread_id !== threadId) return { ok: false, status: 409, error: '送信の情報が正しくありません。画面を読み込み直してください' };
  if (!created) {
    const decision = decideResend(message, now);
    if (decision !== 'resend') return { ok: true, message: toChatMessageView(message) };
    await updateChatOutboundStatus(storeId, message.id, 'sending', null);
  }

  // local は LINE と通信せず、記録だけ更新する
  if (isLocal()) {
    await updateChatOutboundStatus(storeId, message.id, 'sent', null);
    await touchChatThreadAfterReply(storeId, threadId, message.created_at, preview);
    await addChatUsageSafe(storeId, { outbound: 1 }, now);
    return { ok: true, message: toChatMessageView({ ...message, send_status: 'sent', send_error: null }), notice: 'ローカル環境のため、LINE には送っていません（記録だけ更新しました）' };
  }

  const token = await getStoreLineToken(storeId).catch(() => null);
  if (!token) {
    const error = 'LINE のチャネルアクセストークンが未設定です（運営にお問い合わせください）';
    await updateChatOutboundStatus(storeId, message.id, 'failed', error);
    return { ok: false, status: 409, error, message: toChatMessageView({ ...message, send_status: 'failed', send_error: error }) };
  }
  // 送る内容は、保存してある内容（同じ送信の ID の送り直しでも、最初に保存した内容を送る）
  const savedImageUrl = message.kind === 'image' ? message.meta?.image_url : null;
  const res = savedImageUrl
    ? await (deps.pushImage ?? pushChatImage)(token, thread.line_user_id, savedImageUrl, v.clientKey)
    : await (deps.push ?? pushChatText)(token, thread.line_user_id, message.text ?? v.text, v.clientKey);
  if (!res.ok) {
    const error = describeChatSendError(res.status, res.body);
    await updateChatOutboundStatus(storeId, message.id, 'failed', error).catch((e) => console.error('[chat] 送信結果の保存エラー:', e));
    return { ok: false, status: 502, error, message: toChatMessageView({ ...message, send_status: 'failed', send_error: error }) };
  }
  // 送れたあとの記録に失敗しても、送信は成功として返す（もう一度押されても、同じ鍵なので LINE には 2 回届かない）
  try {
    await updateChatOutboundStatus(storeId, message.id, 'sent', null);
    await touchChatThreadAfterReply(storeId, threadId, message.created_at, preview);
  } catch (e) {
    console.error('[chat] 送信結果の保存エラー:', e instanceof Error ? e.message : e);
  }
  // 利用量: 送れた返信だけを数える（失敗・送り直しの途中は数えない）
  await addChatUsageSafe(storeId, { outbound: 1 }, now);
  return { ok: true, message: toChatMessageView({ ...message, send_status: 'sent', send_error: null }) };
}

// ---------------------------------------------------------------------------
// ④-3: 新着の通知（スタッフの LINE・メール）と、保存期間を過ぎた会話の自動削除
// ---------------------------------------------------------------------------

export interface ChatNotifyDeps {
  /** スタッフの LINE に送る（差し替え用） */
  pushLine?: (accessToken: string, to: string, text: string) => Promise<{ ok: boolean }>;
  /** メールを送る（差し替え用） */
  sendMail?: (params: { to: string; subject: string; body: string; fromName?: string }) => Promise<{ ok: boolean }>;
  now?: Date;
}

export interface ChatNotifyResult {
  line_sent: number;
  email_sent: number;
  failed: number;
}

const defaultPushLine: NonNullable<ChatNotifyDeps['pushLine']> = (token, to, text) => pushLineMessages(token, to, [{ type: 'text', text }]);
const defaultSendMail: NonNullable<ChatNotifyDeps['sendMail']> = (params) => sendEmail(params);

/** 通知を送る（スタッフの LINE・メール）。1 件ずつ送り、失敗しても残りは送る。例外は投げない */
async function deliverChatNotification(storeId: string, settings: ChatNotifySettings, content: ChatNotifyContent, opts: { excludeLineUserId?: string | null }, deps: ChatNotifyDeps = {}): Promise<ChatNotifyResult> {
  const result: ChatNotifyResult = { line_sent: 0, email_sent: 0, failed: 0 };
  if (settings.line) {
    try {
      const [store, staff] = await Promise.all([getDigestStore(storeId), listDigestStaff(storeId)]);
      // メッセージを送ってきた本人がスタッフのときは、その人には知らせない
      const targets = staff.filter((s) => s.line_user_id && s.line_user_id !== opts.excludeLineUserId);
      if (store?.line_channel_access_token) {
        const text = buildChatNotifyLineText(content);
        for (const s of targets) {
          const res = await (deps.pushLine ?? defaultPushLine)(store.line_channel_access_token, s.line_user_id, text).catch(() => ({ ok: false }));
          if (res.ok) result.line_sent += 1;
          else result.failed += 1;
        }
      } else if (targets.length > 0) {
        result.failed += targets.length;
      }
    } catch (e) {
      console.error('[chat] スタッフの LINE への通知エラー:', e instanceof Error ? e.message : e);
      result.failed += 1;
    }
  }
  if (settings.email) {
    const mail = buildChatNotifyEmail(content);
    for (const to of settings.emails) {
      const res = await (deps.sendMail ?? defaultSendMail)({ to, subject: mail.subject, body: mail.body, fromName: content.storeName }).catch(() => ({ ok: false }));
      if (res.ok) result.email_sent += 1;
      else result.failed += 1;
    }
  }
  return result;
}

/**
 * 新しく保存したメッセージについて、通知を送る。
 * - 通知が OFF・夜間（送らない時間帯）なら何もしない（夜間に届いたぶんは、明けたあとの最初の新着と一緒に知らせる）
 * - 自動の印が付いた文（フォームの送信文・コマンド）は知らせない
 * - 同じ会話については 10 分に 1 回まで（先に通知の日時を書き換えて確保してから送る = 二重に送らない）
 * **例外を投げない**
 */
export async function notifyChatInbound(storeId: string, lineMessageIds: string[], opts: { origin?: string | null }, deps: ChatNotifyDeps = {}): Promise<ChatNotifyResult & { threads: number; skipped?: 'off' | 'quiet' | 'none' }> {
  const empty = { line_sent: 0, email_sent: 0, failed: 0, threads: 0 };
  try {
    if (lineMessageIds.length === 0) return { ...empty, skipped: 'none' };
    const now = deps.now ?? new Date();
    const state = await getChatSettings(storeId);
    const settings = state.notify ?? CHAT_NOTIFY_DEFAULTS;
    const skip = chatNotifySkipReason(settings, now);
    if (skip) return { ...empty, skipped: skip };
    const threadIds = await listChatThreadsToNotify(storeId, lineMessageIds);
    if (threadIds.length === 0) return { ...empty, skipped: 'none' };
    const store = await getDigestStore(storeId);
    const total = { ...empty };
    for (const threadId of threadIds) {
      if (!(await claimChatNotification(storeId, threadId, now))) continue;
      const thread = await getChatThread(storeId, threadId);
      if (!thread) continue;
      const customer = (await customersByLineUser(storeId, [thread])).get(thread.line_user_id);
      const content: ChatNotifyContent = {
        storeName: store?.name ?? '店舗',
        customerName: customer?.name ?? '',
        unread: thread.unread_count || 1,
        url: buildChatAdminUrl(opts.origin || getBaseUrl(), storeId),
      };
      const r = await deliverChatNotification(storeId, settings, content, { excludeLineUserId: thread.line_user_id }, deps);
      total.threads += 1;
      total.line_sent += r.line_sent;
      total.email_sent += r.email_sent;
      total.failed += r.failed;
    }
    if (total.failed > 0) console.warn(`[chat] 通知の一部を送れませんでした: storeId=${storeId} 失敗=${total.failed}`);
    return total;
  } catch (e) {
    console.error(`[chat] 通知の処理エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
    return empty;
  }
}

export interface ChatNotifyView {
  settings: ChatNotifySettings;
  /** トーク機能が ON か（OFF の店舗では、通知する新着が届かない） */
  chat_enabled: boolean;
  /** LINE で受け取るスタッフの人数（「今日の予約まとめ」と同じ登録） */
  staff_count: number;
  /** マイグレーションが未適用で、通知の設定を保存できない */
  unavailable: boolean;
}

/** 通知の設定の画面に返す内容（スタッフの LINE ユーザー ID は返さない） */
export async function getChatNotifyView(storeId: string): Promise<ChatNotifyView> {
  const [state, staff] = await Promise.all([getChatSettings(storeId), listDigestStaff(storeId).catch(() => [])]);
  return { settings: state.notify ?? CHAT_NOTIFY_DEFAULTS, chat_enabled: state.settings.enabled, staff_count: staff.length, unavailable: state.missing || state.notifyMissing === true };
}

export type ChatNotifyUpdateResult = { ok: true; view: ChatNotifyView } | { ok: false; status: number; error: string };

/** 通知の設定を変える（店舗管理者も変えられる） */
export async function updateChatNotifySettings(storeId: string, input: unknown): Promise<ChatNotifyUpdateResult> {
  const v = validateChatNotifySettings(input);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  try {
    await saveChatNotifySettings(storeId, v.value);
  } catch (e) {
    const message = e instanceof Error ? e.message : '通知の設定の保存に失敗しました';
    return { ok: false, status: message.includes('マイグレーション') ? 409 : 500, error: message };
  }
  return { ok: true, view: await getChatNotifyView(storeId) };
}

/** テストの通知を送る（保存済みの設定の送り先へ。夜間・10 分に 1 回の制限は見ない） */
export async function sendChatNotifyTest(storeId: string, origin: string | null, deps: ChatNotifyDeps = {}): Promise<({ ok: true } & ChatNotifyResult) | { ok: false; status: number; error: string }> {
  const state = await getChatSettings(storeId);
  const settings = state.notify ?? CHAT_NOTIFY_DEFAULTS;
  if (!settings.line && !(settings.email && settings.emails.length > 0)) return { ok: false, status: 400, error: '通知が OFF です。送り先を選んで保存してから、テストを送ってください' };
  const store = await getDigestStore(storeId);
  const content: ChatNotifyContent = { storeName: store?.name ?? '店舗', customerName: 'テスト', unread: 1, url: buildChatAdminUrl(origin || getBaseUrl(), storeId) };
  const result = await deliverChatNotification(storeId, settings, content, {}, deps);
  if (result.line_sent + result.email_sent === 0) {
    return { ok: false, status: 502, error: settings.line && !settings.email ? 'LINE で受け取るスタッフが登録されていないか、送信に失敗しました' : '通知を送れませんでした。送り先を確認してください' };
  }
  return { ok: true, ...result };
}

/** 保存期間を過ぎた会話の自動削除（1 日 1 回の cron から）。1 回に 5000 通まで。残りは次の日に回す */
export async function runChatRetention(now: Date = new Date()): Promise<ChatPurgeResult> {
  // 先に画像のファイルを消す（行を先に消すと、画像の場所が分からなくなって画像だけ残る）。失敗しても、文字のメッセージの削除は続ける
  try {
    const media = await purgeExpiredChatMedia(now);
    if (media.removed > 0 || media.failed > 0) console.log(`[chat] 自動削除（画像）: 消した=${media.removed} 消せなかった=${media.failed}`);
  } catch (e) {
    console.error('[chat] 画像の自動削除エラー:', e instanceof Error ? e.message : e);
  }
  const result = await purgeExpiredChat(now, CHAT_RETENTION_BATCH);
  if (result.messages > 0 || result.threads > 0) console.log(`[chat] 自動削除: メッセージ=${result.messages} 会話=${result.threads} 残り=${result.remaining ? 'あり' : 'なし'}`);
  return result;
}

// ---------------------------------------------------------------------------
// ④-4: 画像の受信と返信・定型文・対応済みの切り替え
// ---------------------------------------------------------------------------

/** 届いた画像を LINE から取りにいく回数（LINE 側の準備中・一時的な通信エラーのとき） */
const INBOUND_IMAGE_TRIES = 3;

export interface ChatImageDeps {
  /** LINE から画像の中身を取得する（差し替え用） */
  fetchContent?: (accessToken: string, lineMessageId: string) => Promise<{ content: ChatImageContent | null; reason?: string; retry?: boolean }>;
  /** 待つ（差し替え用。テストでは待たない） */
  wait?: (ms: number) => Promise<void>;
}

/**
 * お客様から届いた画像の中身を、LINE から取得して保存する（公開しない置き場）。
 * 取得できなかったときは「読み込めませんでした」の印を付ける（メッセージは残す）。**例外を投げない**
 */
export async function storeChatInboundImage(storeId: string, lineMessageId: string, deps: ChatImageDeps = {}): Promise<'saved' | 'failed' | 'skipped'> {
  try {
    const message = await findChatMessageByLineId(storeId, lineMessageId);
    if (!message || message.kind !== 'image' || message.direction !== 'in' || message.media_path) return 'skipped';
    const fail = async (reason: string) => {
      console.warn(`[chat] 画像を保存できませんでした: storeId=${storeId} ${reason}`);
      await setChatMessageMedia(storeId, message.id, { media_path: null, meta: { ...(message.meta ?? {}), media_error: '1' } });
      return 'failed' as const;
    };
    const token = await getStoreLineToken(storeId).catch(() => null);
    if (!token) return fail('トークン未設定');
    const fetchContent = deps.fetchContent ?? fetchLineImageContent;
    const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let last = '';
    for (let i = 0; i < INBOUND_IMAGE_TRIES; i++) {
      const res = await fetchContent(token, lineMessageId);
      if (res.content) {
        const ext = chatImageExt(res.content.contentType);
        if (!ext) return fail('画像の種類が分かりません');
        const mediaPath = chatInboundImagePath(storeId, message.thread_id, message.id, ext);
        await saveChatInboundImage(mediaPath, res.content);
        await addChatUsageSafe(storeId, { image_bytes: res.content.data.length });
        const meta = { ...(message.meta ?? {}) };
        delete meta.media_error;
        await setChatMessageMedia(storeId, message.id, { media_path: mediaPath, meta: Object.keys(meta).length > 0 ? meta : null });
        return 'saved';
      }
      last = res.reason ?? '取得できません';
      if (!res.retry) break;
      if (i < INBOUND_IMAGE_TRIES - 1) await wait(1500 * (i + 1));
    }
    return fail(last);
  } catch (e) {
    console.error(`[chat] 画像の保存エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
    return 'failed';
  }
}

/**
 * お客様から届いた画像を返す（トークの画面用）。
 * **他の店舗のメッセージ・店舗が送った画像・画像の無いメッセージは null**（API は 404）
 */
export async function getChatInboundImage(storeId: string, messageId: string): Promise<ChatImageContent | null> {
  const message = await getChatMessage(storeId, messageId);
  if (!message || message.direction !== 'in' || message.kind !== 'image' || !message.media_path) return null;
  // 保存先は「店舗 ID / 会話 ID / メッセージ ID」。記録が書き換えられていても、その店舗の置き場の外は読まない
  if (!message.media_path.startsWith(`${storeId}/`)) return null;
  return readChatInboundImage(message.media_path);
}

export type ChatImageUploadResult = { ok: true; url: string } | { ok: false; status: number; error: string };

/**
 * 返信で送る画像を受け取り、公開の置き場に保存して URL を返す（このあと sendChatReply に image_url として渡す）。
 * JPEG / PNG・1MB まで（画面で縮めてから送る。LINE のプレビュー画像の上限が 1MB のため）
 */
export async function uploadChatReplyImage(storeId: string, data: Buffer): Promise<ChatImageUploadResult> {
  const { settings } = await getChatSettings(storeId);
  if (!settings.enabled) return { ok: false, status: 409, error: 'トーク機能が OFF のため、画像を送れません' };
  if (data.length === 0) return { ok: false, status: 400, error: '画像を選んでください' };
  if (data.length > CHAT_OUTBOUND_IMAGE_MAX_BYTES) return { ok: false, status: 400, error: '画像が大きすぎます（1MB まで）。もう一度、画像を選び直してください' };
  // ファイルの中身の先頭を見て、本当に JPEG / PNG かを確かめる（拡張子や申告された種類は信用しない）
  const info = readImageInfo(new Uint8Array(data.buffer, data.byteOffset, Math.min(data.length, 65536)));
  if (!info) return { ok: false, status: 400, error: '送れるのは JPEG か PNG の画像だけです' };
  try {
    const saved = await saveChatOutboundImage(storeId, data, info.type === 'png' ? 'png' : 'jpg');
    await addChatUsageSafe(storeId, { image_bytes: data.length });
    return { ok: true, url: saved.url };
  } catch (e) {
    console.error('[chat] 画像のアップロードエラー:', e instanceof Error ? e.message : e);
    return { ok: false, status: 500, error: '画像のアップロードに失敗しました' };
  }
}

/** 対応中 / 対応済み を切り替える */
export async function updateChatThreadStatus(storeId: string, threadId: string, input: unknown): Promise<{ ok: true; status: ChatThreadStatus } | { ok: false; status: number; error: string }> {
  const status = (input && typeof input === 'object' ? (input as Record<string, unknown>).status : null) as unknown;
  if (!isChatThreadStatus(status)) return { ok: false, status: 400, error: '対応の状態が正しくありません' };
  if (!(await setChatThreadStatus(storeId, threadId, status))) return { ok: false, status: 404, error: '会話が見つかりません' };
  return { ok: true, status };
}

/** 定型文の一覧 */
export async function getChatTemplates(storeId: string): Promise<ChatReplyTemplate[]> {
  return (await getChatSettings(storeId)).templates ?? [];
}

/** 定型文を保存する（一覧をまるごと差し替える。店舗管理者も変えられる） */
export async function updateChatTemplates(storeId: string, input: unknown): Promise<{ ok: true; templates: ChatReplyTemplate[] } | { ok: false; status: number; error: string }> {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).templates : input;
  const v = validateChatTemplates(raw);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  try {
    return { ok: true, templates: await saveChatTemplates(storeId, v.value) };
  } catch (e) {
    const message = e instanceof Error ? e.message : '定型文の保存に失敗しました';
    return { ok: false, status: message.includes('マイグレーション') ? 409 : 500, error: message };
  }
}

/**
 * 保存期間を過ぎたメッセージの画像を消す（自動削除の前に行う）。
 * 画像のファイルを消せたメッセージだけ、画像の場所を空にする（= このあと行を消せるようになる）。
 * 消せなかった画像のメッセージは、行を残して次の日にもう一度試す
 */
export async function purgeExpiredChatMedia(now: Date, limit = 200): Promise<{ removed: number; failed: number }> {
  const items = await listExpiredChatMedia(now, limit);
  if (items.length === 0) return { removed: 0, failed: 0 };
  const cleared: string[] = [];
  let failed = 0;
  for (const kind of ['inbound', 'outbound'] as const) {
    const group = items.filter((m) => (kind === 'inbound' ? m.direction === 'in' : m.direction !== 'in'));
    if (group.length === 0) continue;
    const failedPaths = new Set(
      await removeChatMedia(
        kind,
        group.map((m) => m.media_path),
      ).catch(() => group.map((m) => m.media_path)),
    );
    for (const m of group) {
      if (failedPaths.has(m.media_path)) failed += 1;
      else cleared.push(m.id);
    }
  }
  await clearChatMessageMedia(cleared);
  return { removed: cleared.length, failed };
}

// ---------------------------------------------------------------------------
// ④-5: 自動で送ったメッセージを会話に出す・利用量の記録
// ---------------------------------------------------------------------------

type RawChatSystemEvent = Parameters<typeof normalizeChatSystemEvent>[0];

/**
 * 自動で送ったメッセージ（リマインダー・フォロー・配信・自動応答・空き待ちのお知らせ）を、会話に 1 行で残す。
 * トーク機能が ON の店舗・すでに会話のあるお客様だけ（それ以外は何もしない）。
 * **例外を投げない**（記録に失敗しても、送信そのものの結果は変えない）。戻り値 = 記録した件数
 */
export async function recordChatSystemEventsSafe(storeId: string | null | undefined, events: ReadonlyArray<RawChatSystemEvent>): Promise<number> {
  try {
    if (!storeId) return 0;
    const normalized = events.map((e) => normalizeChatSystemEvent(e)).filter((e): e is ChatSystemEvent => e !== null);
    if (normalized.length === 0) return 0;
    return await recordChatSystemEvents(storeId, normalized);
  } catch (e) {
    console.error(`[chat] 自動の記録エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
    return 0;
  }
}

/** LINE への応答を返したあとに、自動で送ったメッセージを会話に残す（送信の処理を遅くしない） */
export function scheduleChatSystemEvents(storeId: string | null | undefined, events: ReadonlyArray<RawChatSystemEvent>): void {
  if (!storeId || events.length === 0) return;
  const run = async () => {
    await recordChatSystemEventsSafe(storeId, events);
  };
  try {
    after(run);
  } catch {
    // リクエストの外（テスト・cron の処理の途中など）から呼ばれたとき
    void run();
  }
}

/**
 * Webhook が自動で返信した内容を、会話に残す（1 回の返信 = 1 行）。
 * 同じ通知が LINE から送り直されても、返信の鍵（replyToken）が同じなので 1 回だけ記録される
 */
export function scheduleChatAutoReplyEvents(storeId: string | null | undefined, lineUserId: string | null | undefined, replies: ReadonlyArray<{ replyToken: string; messages: ReadonlyArray<unknown>; at: string }>): void {
  if (!storeId || !lineUserId || replies.length === 0) return;
  const events: RawChatSystemEvent[] = [];
  replies.forEach((r, i) => {
    const text = autoReplyEventText(r.messages);
    // replyToken は英数字。念のため、鍵に使える文字だけを残す
    const token = r.replyToken.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (text && token) events.push({ line_user_id: lineUserId, kind: 'auto_reply', text, source_key: `reply:${token}:${i}`, at: r.at });
  });
  scheduleChatSystemEvents(storeId, events);
}

/** 利用量を足す。**例外を投げない**（数えるのに失敗しても、受信・返信の結果は変えない） */
async function addChatUsageSafe(storeId: string, delta: Partial<ChatUsageCounts>, at: Date = new Date()): Promise<void> {
  try {
    await addChatUsage(storeId, chatUsageMonth(at), delta);
  } catch (e) {
    console.error(`[chat] 利用量の記録エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
  }
}

export interface ChatUsageReport {
  month: string;
  previous_month: string;
  rows: ChatUsageRow[];
  totals: ChatUsageCounts;
  /** 利用量の表が無い（マイグレーション未適用）= 数はすべて 0 */
  unavailable: boolean;
}

/** 全店舗のトークの利用状況（運営 = マスター管理者の一覧用）。month = 日本時間の YYYY-MM（省略 = 今月） */
export async function getChatUsageReport(month?: string | null, now: Date = new Date()): Promise<ChatUsageReport> {
  const target = isUsageMonth(month) ? month : chatUsageMonth(now);
  const previous = previousUsageMonth(target);
  const source = await loadChatUsageSource([target, previous]);
  const pick = (storeId: string, m: string): ChatUsageCounts => {
    const u = source.usage.find((x) => x.store_id === storeId && x.month === m);
    return u ? { inbound: u.inbound, outbound: u.outbound, image_bytes: u.image_bytes } : { ...EMPTY_USAGE };
  };
  const ids = [...new Set([...source.settings.map((s) => s.store_id), ...source.usage.map((u) => u.store_id)])];
  const rows = ids.map((id): ChatUsageRow => {
    const s = source.settings.find((x) => x.store_id === id);
    return { store_id: id, store_name: source.storeNames[id] ?? id, enabled: s?.enabled === true, enabled_at: s?.enabled_at ?? null, current: pick(id, target), previous: pick(id, previous) };
  });
  // トークを一度も ON にしていない店舗（通知や定型文だけ保存した店舗）で、利用も無いものは出さない
  const shown = rows.filter((r) => r.enabled || r.enabled_at || r.current.inbound + r.current.outbound + r.previous.inbound + r.previous.outbound > 0);
  const totals = shown.reduce<ChatUsageCounts>((sum, r) => ({ inbound: sum.inbound + r.current.inbound, outbound: sum.outbound + r.current.outbound, image_bytes: sum.image_bytes + r.current.image_bytes }), { ...EMPTY_USAGE });
  return { month: target, previous_month: previous, rows: sortChatUsageRows(shown), totals, unavailable: source.missing };
}

// ---------------------------------------------------------------------------
// 会話を消す（お客様から削除を求められたとき。運営だけが呼ぶ。役割の確認は API 側で行う）
// ---------------------------------------------------------------------------

export type ChatThreadDeleteResult = { ok: true; messages: number; images: number } | { ok: false; status: number; error: string };

/**
 * 会話 1 本を、メッセージ・画像ごと消す（元に戻せない）。
 * 順番: ① 画像のファイルを消す → ② 会話とメッセージの行を消す。
 * 画像を消せなかったときは、行を消さずに失敗で返す（行を先に消すと、画像の場所が分からなくなって画像だけ残る）。
 * 消すのは、このシステムに保存した分だけ。お客様や店舗の LINE アプリに残っているトークは消えない
 */
export async function deleteChatThread(storeId: string, threadId: string, user: { id: string; email?: string | null } | null): Promise<ChatThreadDeleteResult> {
  const thread = await getChatThread(storeId, threadId);
  if (!thread) return { ok: false, status: 404, error: '会話が見つかりません' };
  const media = await listChatThreadMedia(storeId, threadId);
  // 消すのは、その店舗の置き場にある画像だけ（記録が書き換えられていても、ほかの場所のファイルは消さない）
  const inbound = media.filter((m) => m.direction === 'in' && m.media_path.startsWith(`${storeId}/`)).map((m) => m.media_path);
  const outbound = media.filter((m) => m.direction !== 'in' && chatOutboundImagePathFromUrl(m.media_path, storeId) === m.media_path).map((m) => m.media_path);
  try {
    const failed = [...(await removeChatMedia('inbound', inbound)), ...(await removeChatMedia('outbound', outbound))];
    if (failed.length > 0) return { ok: false, status: 500, error: '画像を消せなかったため、会話を削除していません。少し待ってから、もう一度お試しください' };
  } catch (e) {
    console.error(`[chat] 会話の画像の削除エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
    return { ok: false, status: 500, error: '画像を消せなかったため、会話を削除していません。少し待ってから、もう一度お試しください' };
  }
  const deleted = await deleteChatThreadRows(storeId, threadId);
  if (!deleted) return { ok: false, status: 404, error: '会話が見つかりません' };
  // だれが・いつ・どの会話を消したかをログに残す（会話の中身・お客様の名前は残さない）
  console.log(`[chat] 会話を削除しました: storeId=${storeId} thread=${threadId} messages=${deleted.messages} images=${inbound.length + outbound.length} by=${user?.id ?? 'local'}`);
  return { ok: true, messages: deleted.messages, images: inbound.length + outbound.length };
}
