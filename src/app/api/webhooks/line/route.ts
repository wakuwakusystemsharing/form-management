import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { createReservationEvent, deleteCalendarEvent, listCalendarEvents } from '@/lib/google-calendar';

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
  } = {
    menus: [],
  };

  let nextLineIsDate = false;
  for (const line of lines) {
    if (line.startsWith('お名前：')) {
      details.name = line.replace('お名前：', '').trim();
    } else if (line.startsWith('電話番号：')) {
      details.phone = line.replace('電話番号：', '').trim();
    } else if (line.startsWith('メニュー：')) {
      const menuText = line.replace('メニュー：', '').trim();
      details.menus = menuText ? menuText.split(',').map(item => item.trim()).filter(Boolean) : [];
    } else if (line.startsWith('ご来店回数：')) {
      details.visitCount = line.replace('ご来店回数：', '').trim();
    } else if (line.startsWith('コース：')) {
      details.course = line.replace('コース：', '').trim();
    } else if (line.startsWith('希望日時：')) {
      nextLineIsDate = true;
    } else if (nextLineIsDate && line.trim()) {
      const match = line.trim().match(/^(\d{4})年(\d{1,2})月(\d{1,2})日 (\d{1,2}):(\d{2})$/);
      if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const day = parseInt(match[3], 10);
        const hour = parseInt(match[4], 10);
        const minute = parseInt(match[5], 10);
        details.dateTime = new Date(year, month, day, hour, minute);
      }
      nextLineIsDate = false;
    } else if (line.startsWith('メッセージ：')) {
      details.message = line.replace('メッセージ：', '').trim();
      nextLineIsDate = false;
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

function makeHeaderBox(title: string) {
  return {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'text', text: title, color: '#ffffff', size: 'xl', weight: 'bold' }],
    paddingAll: '20px',
    backgroundColor: '#f7a3a3',
    height: '70px',
    paddingTop: '22px'
  };
}

function makeSimpleBubble(title: string, body: string) {
  return {
    type: 'bubble',
    header: makeHeaderBox(title),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: body, margin: 'md', wrap: true }]
    }
  };
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
    .select('id, line_channel_access_token, google_calendar_id')
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
        makeSimpleBubble('予約確認', '現在ご予約はありません。')
      ]);
      return NextResponse.json({ success: true });
    }

    const bubbles = reservations.map((r: any, index: number) => {
      const menu = r.submenu_name ? `${r.menu_name} > ${r.submenu_name}` : r.menu_name;
      return {
        type: 'bubble',
        size: 'mega',
        header: makeHeaderBox('予約内容'),
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `【${index + 1}件目】`, weight: 'bold', margin: 'md' },
            { type: 'text', text: `📅 ${formatDate(r.reservation_date)}`, margin: 'md', wrap: true },
            { type: 'text', text: `🕐 ${formatTime(r.reservation_time)}`, margin: 'sm' },
            { type: 'text', text: `📌 ${menu}`, margin: 'sm', wrap: true }
          ]
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
        makeSimpleBubble('予約をキャンセル', '現在キャンセルできるご予約はありません。')
      ]);
      return NextResponse.json({ success: true });
    }

    const cancelContents: object[] = [];
    reservations.forEach((r: any, index: number) => {
      const menu = r.submenu_name ? `${r.menu_name} > ${r.submenu_name}` : r.menu_name;
      if (index > 0) cancelContents.push({ type: 'separator', margin: 'lg' });
      cancelContents.push(
        { type: 'text', text: `📅 ${formatDate(r.reservation_date)}`, margin: 'lg', wrap: true },
        { type: 'text', text: `🕐 ${formatTime(r.reservation_time)}`, margin: 'sm' },
        { type: 'text', text: `📌 ${menu}`, margin: 'sm', wrap: true },
        {
          type: 'button',
          action: { type: 'message', label: `予約${index + 1}をキャンセルする`, text: `キャンセル: ${index}` },
          color: '#f7a3a3',
          style: 'primary',
          margin: 'md'
        }
      );
    });
    cancelContents.push({ type: 'text', text: '↑ タップしてキャンセル', size: 'sm', color: '#888888', align: 'center', margin: 'lg' });

    await replyFlexMessage(replyToken, accessToken, '予約をキャンセル', [{
      type: 'bubble',
      size: 'mega',
      header: makeHeaderBox('予約をキャンセル'),
      body: { type: 'box', layout: 'vertical', contents: cancelContents }
    }]);
    return NextResponse.json({ success: true });
  }

  if (messageText.startsWith('キャンセル:') || messageText.startsWith('キャンセル: ')) {
    const index = parseInt(messageText.replace(/^キャンセル:\s*/, '').trim(), 10);
    if (Number.isNaN(index)) {
      await replyFlexMessage(replyToken, accessToken, 'エラー', [
        makeSimpleBubble('エラー', 'キャンセル番号が正しくありません。\n\n「予約をキャンセル」と送ると予約一覧を確認できます。')
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
        makeSimpleBubble('エラー', '指定された番号の予約が見つかりません。\n\n「予約をキャンセル」と送ると予約一覧を確認できます。')
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
    await replyFlexMessage(replyToken, accessToken, 'キャンセル完了', [{
      type: 'bubble',
      size: 'mega',
      header: makeHeaderBox('キャンセル完了'),
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '以下の予約をキャンセルしました。', margin: 'md', wrap: true },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: `📅 ${formatDate(target.reservation_date)}`, margin: 'lg', wrap: true },
          { type: 'text', text: `🕐 ${formatTime(target.reservation_time)}`, margin: 'sm' },
          { type: 'text', text: `📌 ${menu || ''}`, margin: 'sm', wrap: true },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: 'またのご利用をお待ちしております。', margin: 'lg', wrap: true, color: '#888888', size: 'sm' }
        ]
      }
    }]);
    return NextResponse.json({ success: true });
  }

  if (messageText.startsWith('【予約フォーム】')) {
    // 予約はフォームのAPI直接呼び出し（/api/reservations）で既に作成済み。
    // Webhookでは確認メッセージの返信のみ行う（二重予約防止）。
    const details = parseReservationForm(messageText);
    if (details.dateTime) {
      const reservationDate = details.dateTime.toISOString().split('T')[0];
      const reservationTime = details.dateTime.toTimeString().slice(0, 5);
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: `予約を受け付けました。\n${reservationDate} ${reservationTime}`
      }]);
    } else {
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: '予約を受け付けました。'
      }]);
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: true });
}
