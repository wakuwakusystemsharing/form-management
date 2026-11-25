/**
 * 1 対 1 トークの業務ロジック — サーバー専用
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
 *
 * ④-1: 設定（ON / OFF・保存期間。運営だけ）と、Webhook で届いたメッセージの保存
 */
import { after } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import {
  chatEnableBlocker,
  classifyAutoMessage,
  toChatInbound,
  validateChatSettingsInput,
  type ChatAutoContext,
  type ChatInbound,
  type ChatSettings,
  type ChatStats,
} from '@/lib/chat';
import { getChatSettings, getChatStats, recordChatInbound, saveChatSettings } from '@/lib/chat-repository';
import { getStoreLineSecret } from '@/lib/line-secret-repository';
import { listEnabledLineFlexMessages } from '@/lib/line-flex-repository';
import { getBroadcastSettings } from '@/lib/broadcast-repository';

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
