import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { createReservationEvent, deleteCalendarEvent, listCalendarEvents } from '@/lib/google-calendar';
import { normalizeForm } from '@/lib/form-normalizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LineEvent = {
  replyToken?: string;
  type?: string;
  message?: { type?: string; text?: string };
  source?: { userId?: string };
};

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${year}年${parseInt(month)}月${parseInt(day)}日（${weekdays[d.getDay()]}）`;
}

function formatTime(timeStr: string): string {
  return timeStr.slice(0, 5);
}

function parseDateTimeString(str: string): Date | null {
  // "2026年03月25日 09:00" or "第一希望：2026年03月25日 09:00" 形式に対応
  const match = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return new Date(
    parseInt(match[1], 10),
    parseInt(match[2], 10) - 1,
    parseInt(match[3], 10),
    parseInt(match[4], 10),
    parseInt(match[5], 10)
  );
}

function parseReservationForm(text: string) {
  const lines = text.split('\n');
  const details: {
    name?: string;
    phone?: string;
    menus: string[];
    visitCount?: string;
    course?: string;
    message?: string;
    dateTime?: Date | null;
    dateTime2?: Date | null;
    dateTime3?: Date | null;
  } = {
    menus: [],
  };

  // 新フォーマット（《ラベル》\n値）を検出
  const isNewFormat = text.includes('《お名前》');

  if (isNewFormat) {
    let pendingLabel = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) { pendingLabel = ''; continue; }

      if (line === '《お名前》') { pendingLabel = 'name'; }
      else if (line === '《電話番号》') { pendingLabel = 'phone'; }
      else if (line === '《メニュー》') { pendingLabel = 'menu'; }
      else if (line === '《ご来店回数》') { pendingLabel = 'visitCount'; }
      else if (line === '《メッセージ》') { pendingLabel = 'message'; }
      else if (line === '《第一希望日》' || line === '《希望日》') { pendingLabel = 'date1'; }
      else if (line === '《第二希望日》') { pendingLabel = 'date2'; }
      else if (line === '《第三希望日》') { pendingLabel = 'date3'; }
      else if (line.startsWith('【') || line.startsWith('《')) {
        pendingLabel = '';
      } else if (pendingLabel) {
        switch (pendingLabel) {
          case 'name': details.name = line; break;
          case 'phone': details.phone = line; break;
          case 'menu': details.menus = line ? line.split(',').map(s => s.trim()).filter(Boolean) : []; break;
          case 'visitCount': details.visitCount = line; break;
          case 'message': details.message = line; break;
          case 'date1': { const dt = parseDateTimeString(line); if (dt) details.dateTime = dt; break; }
          case 'date2': { const dt = parseDateTimeString(line); if (dt) details.dateTime2 = dt; break; }
          case 'date3': { const dt = parseDateTimeString(line); if (dt) details.dateTime3 = dt; break; }
        }
        pendingLabel = '';
      }
    }
  } else {
    // 旧フォーマット（ラベル：値）
    let inDateSection = false;
    for (const line of lines) {
      if (line.startsWith('お名前：')) {
        details.name = line.replace('お名前：', '').trim();
        inDateSection = false;
      } else if (line.startsWith('電話番号：')) {
        details.phone = line.replace('電話番号：', '').trim();
        inDateSection = false;
      } else if (line.startsWith('メニュー：')) {
        const menuText = line.replace('メニュー：', '').trim();
        details.menus = menuText ? menuText.split(',').map(item => item.trim()).filter(Boolean) : [];
        inDateSection = false;
      } else if (line.startsWith('ご来店回数：')) {
        details.visitCount = line.replace('ご来店回数：', '').trim();
        inDateSection = false;
      } else if (line.startsWith('コース：')) {
        details.course = line.replace('コース：', '').trim();
        inDateSection = false;
      } else if (line.startsWith('希望日時：')) {
        inDateSection = true;
      } else if (inDateSection && line.trim()) {
        const trimmed = line.trim();
        if (trimmed.startsWith('メッセージ：') || trimmed.startsWith('合計') || trimmed.startsWith('性別：') || trimmed.startsWith('クーポン：')) {
          inDateSection = false;
          if (trimmed.startsWith('メッセージ：')) {
            details.message = trimmed.replace('メッセージ：', '').trim();
          }
          continue;
        }
        const dt = parseDateTimeString(trimmed);
        if (dt) {
          if (trimmed.includes('第二希望')) {
            details.dateTime2 = dt;
          } else if (trimmed.includes('第三希望')) {
            details.dateTime3 = dt;
          } else {
            if (!details.dateTime) details.dateTime = dt;
          }
        }
      } else if (line.startsWith('メッセージ：')) {
        details.message = line.replace('メッセージ：', '').trim();
        inDateSection = false;
      }
    }
  }

  return details;
}

async function replyLineMessage(replyToken: string, accessToken: string, messages: Array<{ type: string; text: string }>) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

async function replyFlexMessage(replyToken: string, accessToken: string, altText: string, bubbles: object[]) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{
        type: 'flex',
        altText,
        contents: { type: 'carousel', contents: bubbles }
      }]
    }),
  });
}

const DEFAULT_HEADER_COLOR = '#f7a3a3';

function makeHeaderBox(title: string, storeName?: string, themeColor?: string) {
  const bgColor = themeColor || DEFAULT_HEADER_COLOR;
  const contents: object[] = [];
  if (storeName) {
    contents.push({ type: 'text', text: storeName, color: '#ffffffcc', size: 'xs' });
  }
  contents.push({ type: 'text', text: title, color: '#ffffff', size: 'lg', weight: 'bold' });
  return {
    type: 'box',
    layout: 'vertical',
    contents: [{
      type: 'box',
      layout: 'vertical',
      contents,
      spacing: 'xs'
    }],
    paddingAll: '20px',
    backgroundColor: bgColor,
    paddingTop: '15px',
    paddingBottom: '15px'
  };
}

function makeSimpleBubble(title: string, body: string, storeName?: string, themeColor?: string) {
  return {
    type: 'bubble',
    header: makeHeaderBox(title, storeName, themeColor),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: body, margin: 'md', wrap: true }],
      paddingAll: '20px'
    }
  };
}

/**
 * 店舗内の全フォームの max_concurrent_reservations_per_user の最大値を返す。
 * どのフォームも 0 または未設定なら 0。
 */
async function getMaxReservationLimitForStore(
  adminClient: any,
  storeId: string
): Promise<number> {
  if (!adminClient) return 0;
  const { data, error } = await adminClient
    .from('forms')
    .select('id, config, draft_config')
    .eq('store_id', storeId);
  if (error || !Array.isArray(data) || data.length === 0) return 0;
  let max = 0;
  for (const row of data) {
    try {
      const normalized = normalizeForm(row);
      const v = normalized?.config?.calendar_settings?.max_concurrent_reservations_per_user;
      if (typeof v === 'number' && v > max) max = Math.floor(v);
    } catch {
      /* ignore single-form errors */
    }
  }
  return max;
}

/**
 * 指定ユーザーの「未来かつ未キャンセル」の予約数を返す（webhook 用）。
 */
async function countActiveReservationsForUserInWebhook(
  adminClient: any,
  storeId: string,
  lineUserId: string | null | undefined,
  customerPhone: string | null | undefined
): Promise<number> {
  if (!adminClient) return 0;
  if (!lineUserId && !customerPhone) return 0;

  const now = new Date();
  const jstParts = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const todayStr = `${jstParts.getFullYear()}-${String(jstParts.getMonth() + 1).padStart(2, '0')}-${String(jstParts.getDate()).padStart(2, '0')}`;
  const nowMs = now.getTime();

  const orParts: string[] = [];
  if (lineUserId) orParts.push(`line_user_id.eq.${lineUserId}`);
  if (customerPhone) orParts.push(`customer_phone.eq.${customerPhone}`);

  const { data, error } = await adminClient
    .from('reservations')
    .select('reservation_date, reservation_time, status, line_user_id, customer_phone')
    .eq('store_id', storeId)
    .neq('status', 'cancelled')
    .gte('reservation_date', todayStr)
    .or(orParts.join(','));

  if (error || !Array.isArray(data)) return 0;

  return data.filter((r: any) => {
    if (!r?.reservation_date || !r?.reservation_time) return false;
    const dt = new Date(`${r.reservation_date}T${r.reservation_time}+09:00`).getTime();
    return Number.isFinite(dt) && dt > nowMs;
  }).length;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const storeId = url.searchParams.get('storeId');
  if (!storeId) {
    console.warn('[LINE Webhook] storeId が未指定');
    return NextResponse.json({ error: 'storeId が必要です' }, { status: 400 });
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    console.error('[LINE Webhook] Supabase 接続エラー');
    return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
  }

  const { data: store, error: storeError } = await (adminClient as any)
    .from('stores')
    .select('id, name, line_channel_access_token, google_calendar_id')
    .eq('id', storeId)
    .single();

  if (storeError || !store) {
    console.error(`[LINE Webhook] 店舗が見つかりません: storeId=${storeId}`, storeError);
    return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
  }

  const accessToken = store.line_channel_access_token;
  if (!accessToken) {
    console.warn(`[LINE Webhook] LINEチャネルアクセストークン未設定: storeId=${storeId}`);
    return NextResponse.json({ error: 'LINEチャネルアクセストークンが未設定です' }, { status: 400 });
  }

  const themeColor = DEFAULT_HEADER_COLOR;

  const body = await req.json().catch(() => null);
  const event = (body?.events?.[0] || {}) as LineEvent;
  const replyToken = event.replyToken;
  const userId = event.source?.userId;
  const messageText = event.message?.text || '';

  console.log(`[LINE Webhook] storeId=${storeId} type=${event.type || 'unknown'} userId=${userId ? 'yes' : 'no'} message=${messageText ? messageText.substring(0, 30) : '(empty)'}`);

  if (!replyToken || !userId) {
    return NextResponse.json({ success: true });
  }

  if (messageText === '予約確認') {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const { data: reservations } = await (adminClient as any)
      .from('reservations')
      .select('reservation_date,reservation_time,menu_name,submenu_name')
      .eq('store_id', storeId)
      .eq('line_user_id', userId)
      .neq('status', 'cancelled')
      .gte('reservation_date', todayStr)
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });

    if (!reservations || reservations.length === 0) {
      await replyFlexMessage(replyToken, accessToken, '予約確認', [
        makeSimpleBubble('予約確認', '現在ご予約はありません。', store.name, themeColor)
      ]);
      return NextResponse.json({ success: true });
    }

    const bubbles = reservations.map((r: any, index: number) => {
      const menu = r.submenu_name ? `${r.menu_name} > ${r.submenu_name}` : r.menu_name;
      const timeMinutes = r.reservation_time ? formatTime(r.reservation_time) : '';
      const [h, m] = timeMinutes.split(':');
      const timeText = h && m ? `${parseInt(h)}時${parseInt(m)}分` : timeMinutes;
      return {
        type: 'bubble',
        size: 'mega',
        header: makeHeaderBox(`【予約内容】${reservations.length > 1 ? ` ${index + 1}/${reservations.length}` : ''}`, store.name, themeColor),
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
              contents: [
                { type: 'text', text: '📅 日時', size: 'sm', color: themeColor, weight: 'bold' },
                { type: 'text', text: `${formatDate(r.reservation_date)} ${timeText}`, size: 'sm', wrap: true }
              ]
            },
            {
              type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
              contents: [
                { type: 'text', text: '📋 メニュー', size: 'sm', color: themeColor, weight: 'bold' },
                { type: 'text', text: `・${menu}`, size: 'sm', wrap: true }
              ]
            }
          ],
          paddingAll: '20px'
        }
      };
    });
    await replyFlexMessage(replyToken, accessToken, 'ご予約一覧', bubbles);
    return NextResponse.json({ success: true });
  }

  if (messageText === '予約をキャンセル') {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const { data: reservations } = await (adminClient as any)
      .from('reservations')
      .select('reservation_date,reservation_time,menu_name,submenu_name')
      .eq('store_id', storeId)
      .eq('line_user_id', userId)
      .neq('status', 'cancelled')
      .gte('reservation_date', todayStr)
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });

    if (!reservations || reservations.length === 0) {
      await replyFlexMessage(replyToken, accessToken, '予約キャンセル', [
        makeSimpleBubble('予約をキャンセル', '現在キャンセルできるご予約はありません。', store.name, themeColor)
      ]);
      return NextResponse.json({ success: true });
    }

    const eventList: object[] = [];
    reservations.forEach((r: any, index: number) => {
      const menu = r.submenu_name ? `${r.menu_name} > ${r.submenu_name}` : r.menu_name;
      const timeMinutes = r.reservation_time ? formatTime(r.reservation_time) : '';
      const [h, m] = timeMinutes.split(':');
      const timeText = h && m ? `${parseInt(h)}時${parseInt(m)}分` : timeMinutes;
      if (index > 0) {
        eventList.push({ type: 'separator', margin: 'lg' });
      }
      eventList.push(
        {
          type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
          contents: [
            { type: 'text', text: '📅 日時', size: 'sm', color: themeColor, weight: 'bold' },
            { type: 'text', text: `${formatDate(r.reservation_date)} ${timeText}`, size: 'sm', wrap: true },
            { type: 'text', text: '📋 メニュー', size: 'sm', color: themeColor, weight: 'bold', margin: 'md' },
            { type: 'text', text: `・${menu}`, size: 'sm', wrap: true }
          ]
        },
        {
          type: 'button',
          action: { type: 'message', label: `予約 ${index + 1} をキャンセル`, text: `キャンセル: ${index}` },
          color: themeColor,
          style: 'primary',
          margin: 'md',
          height: 'sm'
        }
      );
    });

    await replyFlexMessage(replyToken, accessToken, '予約をキャンセル', [{
      type: 'bubble',
      size: 'mega',
      header: makeHeaderBox('【予約キャンセル】', store.name, themeColor),
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'キャンセルする予約を選択してください', size: 'sm', align: 'center', margin: 'md', color: '#555555' },
          { type: 'box', layout: 'vertical', spacing: 'sm', contents: eventList }
        ],
        paddingAll: '20px'
      }
    }]);
    return NextResponse.json({ success: true });
  }

  if (messageText.startsWith('キャンセル:') || messageText.startsWith('キャンセル: ')) {
    const index = parseInt(messageText.replace(/^キャンセル:\s*/, '').trim(), 10);
    if (Number.isNaN(index)) {
      await replyFlexMessage(replyToken, accessToken, 'エラー', [
        makeSimpleBubble('エラー', 'キャンセル番号が正しくありません。\n\n「予約をキャンセル」と送ると予約一覧を確認できます。', store.name, themeColor)
      ]);
      return NextResponse.json({ success: true });
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const { data: reservations } = await (adminClient as any)
      .from('reservations')
      .select('*')
      .eq('store_id', storeId)
      .eq('line_user_id', userId)
      .neq('status', 'cancelled')
      .gte('reservation_date', todayStr)
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });

    const target = reservations?.[index];
    if (!target) {
      await replyFlexMessage(replyToken, accessToken, 'エラー', [
        makeSimpleBubble('エラー', '指定された番号の予約が見つかりません。\n\n「予約をキャンセル」と送ると予約一覧を確認できます。', store.name, themeColor)
      ]);
      return NextResponse.json({ success: true });
    }

    await (adminClient as any)
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', target.id);

    if (store.google_calendar_id) {
      try {
        const eventIdToDelete = (target as { google_calendar_event_id?: string | null })
          .google_calendar_event_id || null;
        if (eventIdToDelete) {
          await deleteCalendarEvent(store.google_calendar_id, eventIdToDelete, storeId);
        } else {
          // 旧予約: イベントID未保存の場合は日付範囲で検索して一致するイベントを削除
          const start = new Date(`${target.reservation_date}T00:00:00+09:00`).toISOString();
          const end = new Date(`${target.reservation_date}T23:59:59+09:00`).toISOString();
          const events = await listCalendarEvents(store.google_calendar_id, start, end, storeId);
          const timeStr =
            typeof target.reservation_time === 'string'
              ? target.reservation_time.slice(0, 5)
              : '';
          const expectedStart = new Date(
            `${target.reservation_date}T${timeStr}:00+09:00`
          ).toISOString();
          const event = events.find((e) => {
            const matchSummary = (e.summary || '').includes(target.customer_name);
            const matchLocation = !userId || e.location === userId;
            const startDt = e.start?.dateTime ?? '';
            const matchTime = !startDt || startDt.startsWith(expectedStart.slice(0, 16));
            return matchSummary && (matchLocation || matchTime);
          });
          if (event?.id) {
            await deleteCalendarEvent(store.google_calendar_id, event.id, storeId);
          }
        }
      } catch (calendarError) {
        console.error('[LINE] Calendar delete error:', calendarError);
      }
    }

    const menu = target.submenu_name
      ? `${target.menu_name} > ${target.submenu_name}`
      : target.menu_name;
    const cancelTimeStr = target.reservation_time ? formatTime(target.reservation_time) : '';
    const [ch, cm] = cancelTimeStr.split(':');
    const cancelTimeText = ch && cm ? `${parseInt(ch)}時${parseInt(cm)}分` : cancelTimeStr;
    const cancelDateText = `${formatDate(target.reservation_date)} ${cancelTimeText}`;

    await replyFlexMessage(replyToken, accessToken, 'キャンセル完了', [{
      type: 'bubble',
      size: 'mega',
      header: makeHeaderBox('【キャンセル完了】', store.name, themeColor),
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '予約をキャンセルしました', weight: 'bold', size: 'md', align: 'center', margin: 'lg' },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
            contents: [
              { type: 'text', text: '📅 キャンセルした予約', size: 'sm', color: themeColor, weight: 'bold' },
              { type: 'text', text: cancelDateText, size: 'sm', wrap: true },
              { type: 'text', text: '📋 メニュー', size: 'sm', color: themeColor, weight: 'bold', margin: 'md' },
              { type: 'text', text: `・${menu}`, size: 'sm', wrap: true }
            ]
          }
        ],
        paddingAll: '20px'
      }
    }]);
    return NextResponse.json({ success: true });
  }

  if (messageText.startsWith('【予約フォーム】') || (messageText.startsWith('【') && messageText.includes('《お名前》'))) {
    // 予約はフォームのAPI直接呼び出し（/api/reservations）で既に作成済み。
    // Webhookでは確認メッセージの返信のみ行う（二重予約防止）。
    const details = parseReservationForm(messageText);

    // 防御的チェック: API 側で同時予約数上限が超過したのを取りこぼした場合の保険。
    // 通常 API 側で 409 になり LIFF 送信もスキップされるため、このブランチに来るのは異常ケース。
    try {
      const maxLimit = await getMaxReservationLimitForStore(adminClient, storeId);
      if (maxLimit > 0) {
        const activeCount = await countActiveReservationsForUserInWebhook(
          adminClient,
          storeId,
          userId,
          details.phone || null
        );
        if (activeCount > maxLimit) {
          await replyFlexMessage(replyToken, accessToken, '予約通知', [{
            type: 'bubble',
            size: 'mega',
            header: makeHeaderBox('【予約通知】', store.name, themeColor),
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [{
                type: 'text',
                text: '既に予約があります。\n予約が過ぎるまで新しい予約はできません。',
                size: 'sm',
                wrap: true,
                margin: 'md',
                align: 'center',
              }],
              paddingAll: '20px',
            },
          }]);
          return NextResponse.json({ success: true });
        }
      }
    } catch (limitErr) {
      console.error('[LINE Webhook] 同時予約数チェックエラー:', limitErr);
      // チェック失敗は無視して通常の確認返信を続行
    }

    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const fmtDt = (dt: Date) => `${dt.getFullYear()}年${String(dt.getMonth() + 1).padStart(2, '0')}月${String(dt.getDate()).padStart(2, '0')}日（${weekdays[dt.getDay()]}）${dt.getHours()}時${String(dt.getMinutes()).padStart(2, '0')}分`;

    const bodyContents: object[] = [];

    // タイトル
    bodyContents.push({
      type: 'text',
      text: 'ご予約を承りました',
      weight: 'bold',
      size: 'md',
      align: 'center',
      margin: 'lg'
    });

    bodyContents.push({ type: 'separator', margin: 'lg' });

    // 日時セクション
    if (details.dateTime) {
      bodyContents.push({
        type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
        contents: [
          { type: 'text', text: '📅 日時', size: 'sm', color: themeColor, weight: 'bold' },
          ...(details.dateTime2 || details.dateTime3 ? [
            { type: 'text', text: `・第一希望：${fmtDt(details.dateTime)}`, size: 'sm', wrap: true },
            ...(details.dateTime2 ? [{ type: 'text', text: `・第二希望：${fmtDt(details.dateTime2)}`, size: 'sm', wrap: true }] : []),
            ...(details.dateTime3 ? [{ type: 'text', text: `・第三希望：${fmtDt(details.dateTime3)}`, size: 'sm', wrap: true }] : [])
          ] : [
            { type: 'text', text: fmtDt(details.dateTime), size: 'sm', wrap: true }
          ])
        ]
      });
    }

    // メニューセクション
    if (details.menus.length > 0) {
      bodyContents.push({
        type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
        contents: [
          { type: 'text', text: '📋 メニュー', size: 'sm', color: themeColor, weight: 'bold' },
          ...details.menus.map(m => ({ type: 'text', text: `・${m}`, size: 'sm', wrap: true }))
        ]
      });
    }

    // お名前セクション
    if (details.name) {
      bodyContents.push({
        type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
        contents: [
          { type: 'text', text: '👤 お名前', size: 'sm', color: themeColor, weight: 'bold' },
          { type: 'text', text: details.name, size: 'sm' }
        ]
      });
    }

    bodyContents.push({ type: 'separator', margin: 'xl' });

    // フッターメッセージ
    bodyContents.push({
      type: 'text',
      text: '予約完了いたしました。\nご来店心よりお待ちしております。',
      size: 'sm',
      align: 'center',
      margin: 'lg',
      wrap: true,
      color: '#555555'
    });

    await replyFlexMessage(replyToken, accessToken, '予約通知', [{
      type: 'bubble',
      size: 'mega',
      header: makeHeaderBox('【ご予約確認】', store.name, themeColor),
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
        paddingAll: '20px'
      }
    }]);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: true });
}
