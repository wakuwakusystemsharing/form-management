/**
 * 1 対 1 トークの業務ロジック — サーバー専用
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
 *
 * ④-1: 設定（ON / OFF・保存期間。運営だけ）と、Webhook で届いたメッセージの保存
 */
import { after } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import {
  buildChatPreview,
  chatDisplayName,
  chatEnableBlocker,
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
  type ChatSettings,
  type ChatStats,
  type ChatThread,
  type ChatThreadFilter,
  type ChatThreadView,
} from '@/lib/chat';
import {
  countChatUnread,
  findChatCustomers,
  getChatSettings,
  getChatStats,
  getChatThread,
  insertChatOutbound,
  listChatMessages,
  listChatThreads,
  markChatThreadRead,
  recordChatInbound,
  saveChatSettings,
  setChatThreadCustomer,
  touchChatThreadAfterReply,
  updateChatOutboundStatus,
  type ChatCustomerBrief,
} from '@/lib/chat-repository';
import { LINE_PUSH_ENDPOINT } from '@/lib/line-push';
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
export async function recordChatInboundEvents(storeId: string, events: ReadonlyArray<unknown>, opts: { verified: boolean }): Promise<ChatInboundSummary> {
  const summary: ChatInboundSummary = { saved: 0, duplicated: 0, failed: 0 };
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
        if (await recordChatInbound(storeId, msg, autoKind)) summary.saved += 1;
        else summary.duplicated += 1;
      } catch (e) {
        summary.failed += 1;
        console.error(`[chat] メッセージの保存エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error(`[chat] 受信の処理エラー: storeId=${storeId}`, e instanceof Error ? e.message : e);
  }
  return summary;
}

/**
 * Webhook から呼ぶ入口。LINE への応答を返したあとに保存する（既存の応答を遅くしない）。
 * 保存の対象（お客様からのメッセージ）が無い通知では、何も読まずに終わる
 */
export function scheduleChatInbound(storeId: string, events: ReadonlyArray<unknown>, opts: { verified: boolean }): void {
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
  const filtered = views.filter((v) => (opts.filter === 'unread' ? v.unread_count > 0 : true) && matchesChatSearch(v.name, opts.search));
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
  deps: { push?: ChatPushFn; now?: Date } = {},
): Promise<ChatReplyResult> {
  const v = validateChatReply(input);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const thread = await getChatThread(storeId, threadId);
  if (!thread) return { ok: false, status: 404, error: '会話が見つかりません' };
  const { settings } = await getChatSettings(storeId);
  if (!settings.enabled) return { ok: false, status: 409, error: 'トーク機能が OFF のため、返信できません' };

  const now = deps.now ?? new Date();
  const { message, created } = await insertChatOutbound(storeId, threadId, { text: v.text, clientKey: v.clientKey, sentBy: user?.id ?? null, sentByName: user?.email ?? null, now });
  if (message.thread_id !== threadId) return { ok: false, status: 409, error: '送信の情報が正しくありません。画面を読み込み直してください' };
  if (!created) {
    const decision = decideResend(message, now);
    if (decision !== 'resend') return { ok: true, message: toChatMessageView(message) };
    await updateChatOutboundStatus(storeId, message.id, 'sending', null);
  }

  // local は LINE と通信せず、記録だけ更新する
  if (isLocal()) {
    await updateChatOutboundStatus(storeId, message.id, 'sent', null);
    await touchChatThreadAfterReply(storeId, threadId, message.created_at, buildChatPreview('text', message.text));
    return { ok: true, message: toChatMessageView({ ...message, send_status: 'sent', send_error: null }), notice: 'ローカル環境のため、LINE には送っていません（記録だけ更新しました）' };
  }

  const token = await getStoreLineToken(storeId).catch(() => null);
  if (!token) {
    const error = 'LINE のチャネルアクセストークンが未設定です（運営にお問い合わせください）';
    await updateChatOutboundStatus(storeId, message.id, 'failed', error);
    return { ok: false, status: 409, error, message: toChatMessageView({ ...message, send_status: 'failed', send_error: error }) };
  }
  const res = await (deps.push ?? pushChatText)(token, thread.line_user_id, message.text ?? v.text, v.clientKey);
  if (!res.ok) {
    const error = describeChatSendError(res.status, res.body);
    await updateChatOutboundStatus(storeId, message.id, 'failed', error).catch((e) => console.error('[chat] 送信結果の保存エラー:', e));
    return { ok: false, status: 502, error, message: toChatMessageView({ ...message, send_status: 'failed', send_error: error }) };
  }
  // 送れたあとの記録に失敗しても、送信は成功として返す（もう一度押されても、同じ鍵なので LINE には 2 回届かない）
  try {
    await updateChatOutboundStatus(storeId, message.id, 'sent', null);
    await touchChatThreadAfterReply(storeId, threadId, message.created_at, buildChatPreview('text', message.text));
  } catch (e) {
    console.error('[chat] 送信結果の保存エラー:', e instanceof Error ? e.message : e);
  }
  return { ok: true, message: toChatMessageView({ ...message, send_status: 'sent', send_error: null }) };
}
