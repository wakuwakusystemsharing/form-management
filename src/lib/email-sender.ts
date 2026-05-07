/**
 * メール送信ユーティリティ（Resend REST API を fetch で直接呼び出し）
 *
 * RESEND_API_KEY が未設定のときはログ出力のみでスキップする（local 開発用）。
 * エラーは throw せず { ok: false } を返す（呼び出し元の本処理を止めない）。
 *
 * Resend SDK は使わない:
 *   v4/v6 ともに非 ASCII 文字を扱うとき内部で Headers コンストラクタに
 *   生の文字列を渡してしまい "Cannot convert argument to a ByteString" で落ちる
 *   バグがあったため、API を直接叩く形にしてある。
 *
 * From の表示名: 呼び出し元から `fromName`（例: 店舗名）を渡すと、
 * EMAIL_FROM_ADDRESS のメアド部分はそのままに表示名のみ動的に差し替える。
 * Reply-To: 呼び出し元から `replyTo`（例: 店舗オーナーのメアド）を渡すと、
 * 受信者が「返信」したときにそのアドレスへ届くようになる。
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

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

/**
 * RFC 2047 MIME encoded-word 形式で表示名をエンコードする。
 * 日本語など非 ASCII を含む値を ASCII セーフにし、Resend SDK が値を HTTP ヘッダーに
 * 渡しても "ByteString conversion" エラーで落ちないようにする。
 * 受信者側のメーラーは自動でデコードして元の文字列を表示する。
 */
function encodeDisplayNameForHeader(name: string): string {
  if (!name) return '';
  // ASCII のみなら encode 不要（受信者の表示が崩れる可能性を抑える）
  if (/^[\x20-\x7E]*$/.test(name)) return name;
  const base64 = Buffer.from(name, 'utf-8').toString('base64');
  return `=?UTF-8?B?${base64}?=`;
}

/**
 * メールアドレスの簡易フォーマット検証。
 * Resend は不正な reply_to を 422 で弾くため、事前に弾いて Resend へのリクエスト自体をスキップする。
 */
function isValidEmailAddress(value: string): boolean {
  if (!value) return false;
  return /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(value);
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
  try {
    const trimmedTo = (to || '').trim();
    if (!trimmedTo) {
      return { ok: false, error: '送信先メールアドレスが空です' };
    }

    const apiKey = process.env.RESEND_API_KEY;
    const fromRaw = (process.env.EMAIL_FROM_ADDRESS || '').trim();
    if (!fromRaw) {
      console.warn('[email-sender] EMAIL_FROM_ADDRESS not set, skipping');
      return { ok: false, error: 'EMAIL_FROM_ADDRESS not set' };
    }

    const { address, defaultName } = parseFromAddress(fromRaw);
    const displayName = sanitizeDisplayName(fromName || defaultName);
    const encodedDisplayName = encodeDisplayNameForHeader(displayName);
    const from = encodedDisplayName ? `${encodedDisplayName} <${address}>` : address;

    const trimmedReplyTo = (replyTo || '').trim();
    if (trimmedReplyTo && !isValidEmailAddress(trimmedReplyTo)) {
      console.warn(`[email-sender] dropping invalid replyTo "${trimmedReplyTo}" (will send without Reply-To)`);
    }
    const safeReplyTo = trimmedReplyTo && isValidEmailAddress(trimmedReplyTo) ? trimmedReplyTo : '';

    if (!apiKey) {
      console.warn(
        `[email-sender] RESEND_API_KEY not set, skipping (would send from "${from}" to "${trimmedTo}", reply-to "${safeReplyTo || '-'}", subject length ${subject.length})`
      );
      return { ok: false, error: 'RESEND_API_KEY not set' };
    }

    // Resend REST API リクエストボディ。snake_case (reply_to) なことに注意。
    const payload: Record<string, unknown> = {
      from,
      to: trimmedTo,
      subject,
      text: body,
    };
    if (safeReplyTo) payload.reply_to = safeReplyTo;

    console.log(
      `[email-sender] sending from="${from}" to="${trimmedTo}" replyTo="${safeReplyTo || '-'}" subjectLen=${subject.length}`
    );

    // ヘッダー値はすべて ASCII のみ（Bearer トークンと固定値）。
    // Body は JSON.stringify で UTF-8 エンコードされ fetch がバイト列に変換する。
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(
        `[email-sender] Resend API error status=${response.status} body=${errorText.slice(0, 500)}`
      );
      return { ok: false, error: `Resend ${response.status}` };
    }

    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err: any) {
    console.error('[email-sender] send failed:', err);
    return { ok: false, error: err?.message || 'unexpected error' };
  }
}
