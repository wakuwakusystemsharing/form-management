// 外部予約メール連携: 媒体判定と解析の入口

import { ParseResult, ExternalMailSource, normalizeMailBody } from './types';
import { parseSalonboardMail } from './parse-salonboard';
import { parseEkitenMail } from './parse-ekiten';

export type { ParsedReservation, ParseResult, ExternalMailSource } from './types';

/**
 * 差出人・件名・本文から媒体を判定する。
 * 転送メールでは差出人が店舗のアドレスになるため、本文のマーカーも見る。
 * Gmail の転送確認メールは 'gmail_forwarding' として特別扱い（管理画面で確認コードを見せる）。
 */
export function detectMailSource(from: string, subject: string, body: string): ExternalMailSource {
  const f = (from || '').toLowerCase();
  const s = subject || '';
  const b = normalizeMailBody(body || '');

  // Gmail 自動転送の確認メール（7-2 対策）
  if (f.includes('forwarding-noreply@google.com') || s.includes('Gmail の転送の確認')) {
    return 'gmail_forwarding';
  }

  // サロンボード（HOT PEPPER Beauty）
  if (
    f.includes('salonboard.com') || f.includes('hotpepper.jp')
    || b.includes('SALON BOARD') || b.includes('salonboard.com')
  ) {
    return 'salonboard';
  }

  // エキテン
  if (
    f.includes('ekiten.jp')
    || s.includes('エキテン ネット予約')
    || b.includes('エキテン ネット予約')
  ) {
    return 'ekiten';
  }

  return 'unknown';
}

/** 媒体に応じたパーサーで本文を解析する */
export function parseExternalMail(source: ExternalMailSource, body: string): ParseResult {
  switch (source) {
    case 'salonboard':
      return parseSalonboardMail(body);
    case 'ekiten':
      return parseEkitenMail(body);
    default:
      return { ok: false, error: '対応していない媒体のメールです' };
  }
}
