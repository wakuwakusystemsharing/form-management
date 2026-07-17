// 外部予約メール連携: 媒体別パーサーの共通型

// 媒体の識別子
export type ExternalMailSource = 'salonboard' | 'ekiten' | 'gmail_forwarding' | 'unknown';

// メールから抽出した予約情報
export interface ParsedReservation {
  source: ExternalMailSource;
  reservationNumber: string | null;
  // 予約日時（JST）
  year: number;
  month: number;   // 1-12
  day: number;
  hour: number;
  minute: number;
  customerName: string | null;
  customerPhone: string | null;
  menuText: string | null;
  staffText: string | null;
  couponText: string | null;
  totalAmountText: string | null;
  requestText: string | null;       // ご要望・ご相談
  // メール本文から抽出できた所要時間（分）。無ければ null → キーワードルール → デフォルトの順で決定
  durationMinutesFromMail: number | null;
}

export interface ParseResult {
  ok: boolean;
  reservation?: ParsedReservation;
  error?: string;
}

// 本文の正規化: 全角スペース→半角、CRLF→LF、転送ヘッダの除去
export function normalizeMailBody(body: string): string {
  let text = (body || '').replace(/\r\n/g, '\n').replace(/　/g, ' ');
  // Gmail 等の転送ヘッダ以降を本文として扱う（ヘッダより前の「転送しました」等のコメントを除去）
  const fwdMarkers = [
    /-{5,}\s*Forwarded message\s*-{5,}/i,
    /-{5,}\s*転送されたメッセージ\s*-{5,}/,
  ];
  for (const marker of fwdMarkers) {
    const m = marker.exec(text);
    if (m) {
      text = text.slice(m.index + m[0].length);
      break;
    }
  }
  return text;
}

// 「所要時間目安：2時間30分」「所要時間55分」等から分数を抽出
export function extractDurationMinutes(text: string): number | null {
  if (!text) return null;
  const m = /所要時間(?:目安)?\s*[：:]?\s*(?:(\d+)\s*時間)?\s*(?:(\d+)\s*分)?/.exec(text);
  if (!m || (!m[1] && !m[2])) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}
