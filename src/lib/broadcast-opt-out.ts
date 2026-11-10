/**
 * 配信の停止 / 再開（LINE Webhook から呼ぶ。サーバー専用）
 *
 * お客様が店舗の配信停止キーワード（既定「配信停止」）をそのまま送ると、以後のセグメント配信・自動配信から外す。
 * 再開キーワード（既定「配信再開」）で戻す。予約の確認・リマインダー・フォローメッセージは止めない。
 * 返り値 = 返信する文（該当しない発言なら null）。
 *
 * 配信機能の列（stores.broadcast_* / customers.line_opt_out_at）が未適用の環境や取得失敗時は、
 * Webhook の他の処理を止めないよう null を返す
 */
import { getBroadcastSettings, setLineOptOut } from '@/lib/broadcast-repository';
import { BROADCAST_KEYWORD_MAX, matchOptKeyword } from '@/lib/broadcast-quota';

export function buildOptOutReply(optInKeyword: string): string {
  return `お知らせ・キャンペーンの配信を停止しました。\nご予約の確認・リマインダーは引き続きお送りします。\n\n配信を再開するには「${optInKeyword}」と送ってください。`;
}
export function buildOptInReply(optOutKeyword: string): string {
  return `お知らせ・キャンペーンの配信を再開しました。\n\n停止するには「${optOutKeyword}」と送ってください。`;
}

export async function handleBroadcastOptCommand(storeId: string, lineUserId: string, text: string): Promise<string | null> {
  const t = (text ?? '').trim();
  // キーワードは 20 文字まで。長い発言・フォーム送信（【…】）は設定を読まずに素通し
  if (!t || t.length > BROADCAST_KEYWORD_MAX || t.startsWith('【')) return null;
  try {
    const settings = await getBroadcastSettings(storeId);
    const action = matchOptKeyword(t, settings);
    if (!action) return null;
    await setLineOptOut(storeId, lineUserId, action === 'opt_out');
    return action === 'opt_out' ? buildOptOutReply(settings.opt_in_keyword) : buildOptInReply(settings.opt_out_keyword);
  } catch (e) {
    console.warn('[broadcast] 配信停止 / 再開の処理に失敗:', e);
    return null;
  }
}
