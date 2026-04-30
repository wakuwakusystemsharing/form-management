/**
 * メール送信ユーティリティ（Resend ラッパ）
 *
 * RESEND_API_KEY が未設定のときはログ出力のみでスキップする（local 開発用）。
 * エラーは throw せず { ok: false } を返す（呼び出し元の本処理を止めない）。
 *
 * From の表示名: 呼び出し元から `fromName`（例: 店舗名）を渡すと、
 * EMAIL_FROM_ADDRESS のメアド部分はそのままに表示名のみ動的に差し替える。
 * Reply-To: 呼び出し元から `replyTo`（例: 店舗オーナーのメアド）を渡すと、
 * 受信者が「返信」したときにそのアドレスへ届くようになる。
 */

import { Resend } from 'resend';

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) resendClient = new Resend(apiKey);
  return resendClient;
}

/**
 * "予約システム <noreply@example.com>" → { address: 'noreply@example.com', defaultName: '予約システム' }
 * "noreply@example.com"             → { address: 'noreply@example.com', defaultName: '' }
 */
function parseFromAddress(raw: string): { address: string; defaultName: string } {
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { defaultName: m[1].trim(), address: m[2].trim() };
  return { address: raw.trim(), defaultName: '' };
}

/**
 * 表示名のサニタイズ。RFC 5322 で意味を持つ `<>",;` を除去（受信側の表示崩れ防止）
 */
function sanitizeDisplayName(name: string): string {
  return name.replace(/[<>",;]/g, '').trim();
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  /** 表示名のオーバーライド（例: 店舗名）。未指定なら EMAIL_FROM_ADDRESS の名前部分を使用 */
  fromName?: string;
  /** Reply-To ヘッダ（例: 店舗オーナーのメアド）。未指定なら設定しない */
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { to, subject, body, fromName, replyTo } = params;
  const trimmedTo = (to || '').trim();
  if (!trimmedTo) {
    return { ok: false, error: '送信先メールアドレスが空です' };
  }

  const fromRaw = (process.env.EMAIL_FROM_ADDRESS || '').trim();
  if (!fromRaw) {
    console.warn('[email-sender] EMAIL_FROM_ADDRESS not set, skipping');
    return { ok: false, error: 'EMAIL_FROM_ADDRESS not set' };
  }

  const { address, defaultName } = parseFromAddress(fromRaw);
  const displayName = sanitizeDisplayName(fromName || defaultName);
  const from = displayName ? `${displayName} <${address}>` : address;

  const trimmedReplyTo = (replyTo || '').trim();

  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email-sender] RESEND_API_KEY not set, skipping (would send from "${from}" to "${trimmedTo}", reply-to "${trimmedReplyTo || '-'}", subject "${subject}")`
    );
    return { ok: false, error: 'RESEND_API_KEY not set' };
  }

  try {
    const sendArgs: any = {
      from,
      to: trimmedTo,
      subject,
      text: body,
    };
    if (trimmedReplyTo) sendArgs.replyTo = trimmedReplyTo;
    const result = await resend.emails.send(sendArgs);
    if (result.error) {
      console.error('[email-sender] Resend API error:', result.error);
      return { ok: false, error: result.error.message || 'send failed' };
    }
    return { ok: true, id: result.data?.id };
  } catch (err: any) {
    console.error('[email-sender] send failed:', err);
    return { ok: false, error: err?.message || 'unexpected error' };
  }
}
