// エキテン ネット予約の予約通知メールを解析する
// 実メールサンプル: docs/メールに届いた予約通知を自動的にGoogleカレンダーに予定を作成する資料/
//                   エキテンの店舗に届く通知メール内容
//
// 本文形式:
//   【予約番号】
//   S0124e
//   【来店日時】
//   2026年7月18日 (土) 14:40
//   【メニュー】
//   全体染め…　所要時間55分
//   【予約者情報】
//   お名前：橋 理
//   電話番号：09812

import { ParseResult, extractDurationMinutes, normalizeMailBody } from './types';

// 【ラベル】から次の【 / 罫線 までのブロックを取得
function pickBlock(body: string, label: string): string | null {
  const re = new RegExp('【' + label + '】\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:【|▼|●|━)|$)');
  const m = re.exec(body);
  if (!m) return null;
  const block = m[1].split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim();
  return block || null;
}

export function parseEkitenMail(rawBody: string): ParseResult {
  const body = normalizeMailBody(rawBody);

  const reservationNumber = pickBlock(body, '予約番号');
  const dateTimeBlock = pickBlock(body, '来店日時');
  const dtMatch = dateTimeBlock
    ? /(\d{4})年(\d{1,2})月(\d{1,2})日\s*[（(][^）)]*[）)]\s*(\d{1,2}):(\d{2})/.exec(dateTimeBlock)
    : null;
  const nameMatch = /お名前\s*[：:]\s*([^\n]+)/.exec(body);

  if (!reservationNumber || !dtMatch || !nameMatch) {
    return {
      ok: false,
      error: `エキテン解析失敗: ${[
        !reservationNumber ? '予約番号' : null,
        !dtMatch ? '来店日時' : null,
        !nameMatch ? 'お名前' : null,
      ].filter(Boolean).join('・')} が見つかりません`,
    };
  }

  const menuText = pickBlock(body, 'メニュー');
  const staffText = pickBlock(body, 'スタッフ');
  const couponText = pickBlock(body, 'ご利用クーポン');
  const phoneMatch = /電話番号\s*[：:]\s*([^\n]+)/.exec(body);
  const requestBlock = pickBlock(body, '予約者からの要望');

  return {
    ok: true,
    reservation: {
      source: 'ekiten',
      // 予約番号ブロックの1行目のみ（万一複数行取れた場合の保険）
      reservationNumber: reservationNumber.split('\n')[0].trim(),
      year: parseInt(dtMatch[1], 10),
      month: parseInt(dtMatch[2], 10),
      day: parseInt(dtMatch[3], 10),
      hour: parseInt(dtMatch[4], 10),
      minute: parseInt(dtMatch[5], 10),
      customerName: nameMatch[1].trim(),
      customerPhone: phoneMatch ? phoneMatch[1].trim() : null,
      menuText,
      staffText,
      couponText,
      totalAmountText: null,
      requestText: requestBlock,
      // エキテンはメニュー名末尾に「所要時間55分」が含まれるケースがある
      durationMinutesFromMail: extractDurationMinutes(menuText || ''),
    },
  };
}
