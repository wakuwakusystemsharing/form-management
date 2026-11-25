/**
 * 1 対 1 トーク（④-5）: LINE の Webhook が「自動で返信した内容」を、その通知の処理のあいだだけ覚えておく — サーバー専用
 *
 * Webhook は、予約確認・キャンセル・予約変更・キーワード自動応答・あいさつメッセージなど、たくさんの場所から返信する。
 * それぞれの場所に手を入れずに済むよう、返信する共通の関数（replyLineMessage / replyRawMessages）が
 * ここに 1 行で書き留め、通知の処理が終わったところでまとめて会話に記録する。
 *
 * AsyncLocalStorage を使うので、同時に届いた別の通知の返信と混ざらない。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface ReplyLog {
  storeId: string | null;
  lineUserId: string | null;
  replies: Array<{ replyToken: string; messages: unknown[]; at: string }>;
}

const storage = new AsyncLocalStorage<ReplyLog>();

/** 通知 1 回ぶんの処理を、返信を書き留める入れ物の中で動かす。戻り値 = 処理の結果と、書き留めた返信 */
export async function runWithChatReplyLog<T>(fn: () => Promise<T>): Promise<{ result: T; log: ReplyLog }> {
  const log: ReplyLog = { storeId: null, lineUserId: null, replies: [] };
  const result = await storage.run(log, fn);
  return { result, log };
}

/** 返信する相手（店舗と LINE ユーザー）が決まったところで呼ぶ */
export function setChatReplyTarget(storeId: string, lineUserId: string): void {
  const log = storage.getStore();
  if (log) {
    log.storeId = storeId;
    log.lineUserId = lineUserId;
  }
}

/** 返信を送れたところで呼ぶ（入れ物の外 = テストなどから呼ばれたときは何もしない） */
export function noteChatReply(replyToken: string, messages: ReadonlyArray<unknown>): void {
  const log = storage.getStore();
  if (log && replyToken && messages.length > 0) log.replies.push({ replyToken, messages: [...messages], at: new Date().toISOString() });
}
