// サロンボード（HOT PEPPER Beauty）の予約通知メールを解析する
// 実メールサンプル: docs/メールに届いた予約通知を自動的にGoogleカレンダーに予定を作成する資料/
//                   サロンボード（ホットペッパービューティー）の店舗に届く通知メール内容
//
// 本文形式（テキスト。行頭は全角スペースで字下げされているため normalizeMailBody で半角化してから解析）:
//   ◇ご予約内容
//   ■予約番号
//    BF013
//   ■氏名
//    谷 美（カヤ ノミ）
//   ■来店日時
//    2026年06月02日（火）15:30
//   ■メニュー
//    【ブライダル】ライトコース …（所要時間目安：2時間30分）
//   ...
//   SMS番号
//   0809342

import { ParseResult, extractDurationMinutes, normalizeMailBody } from './types';

function pickLine(body: string, label: string): string | null {
  const re = new RegExp('■' + label + '\\s*\\n\\s*([^\\n]+)');
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}

// ■ラベル から次の ■ / ◇ までの複数行ブロックを取得
function pickBlock(body: string, label: string): string | null {
  const re = new RegExp('■' + label + '\\s*\\n([\\s\\S]*?)(?=\\n\\s*[■◇]|$)');
  const m = re.exec(body);
  if (!m) return null;
  const block = m[1].split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim();
  return block || null;
}

export function parseSalonboardMail(rawBody: string): ParseResult {
  const body = normalizeMailBody(rawBody);

  const reservationNumber = pickLine(body, '予約番号');
  const customerName = pickLine(body, '氏名');
  const dateTimeLine = pickLine(body, '来店日時');
  const dtMatch = dateTimeLine
    ? /(\d{4})年(\d{1,2})月(\d{1,2})日\s*[（(][^）)]*[）)]\s*(\d{1,2}):(\d{2})/.exec(dateTimeLine)
    : null;

  if (!reservationNumber || !customerName || !dtMatch) {
    return {
      ok: false,
      error: `サロンボード解析失敗: ${[
        !reservationNumber ? '予約番号' : null,
        !customerName ? '氏名' : null,
        !dtMatch ? '来店日時' : null,
      ].filter(Boolean).join('・')} が見つかりません`,
    };
  }

  const menuText = pickBlock(body, 'メニュー');
  const staffText = pickLine(body, '指名スタッフ');
  const couponText = pickLine(body, 'ご利用クーポン');
  const totalMatch = /予約時合計金額\s*([\d,]+円)/.exec(body);
  const requestBlock = pickBlock(body, 'ご要望・ご相談');
  // SMS番号（電話番号相当）。ラベルの次行 or 同一行
  const phoneMatch = /SMS番号\s*\n?\s*([0-9+\-]{6,})/.exec(body);

  return {
    ok: true,
    reservation: {
      source: 'salonboard',
      reservationNumber,
      year: parseInt(dtMatch[1], 10),
      month: parseInt(dtMatch[2], 10),
      day: parseInt(dtMatch[3], 10),
      hour: parseInt(dtMatch[4], 10),
      minute: parseInt(dtMatch[5], 10),
      customerName,
      customerPhone: phoneMatch ? phoneMatch[1].trim() : null,
      menuText,
      staffText,
      couponText,
      totalAmountText: totalMatch ? totalMatch[1].trim() : null,
      requestText: requestBlock && requestBlock !== '-' ? requestBlock : null,
      durationMinutesFromMail: extractDurationMinutes(menuText || ''),
    },
  };
}
