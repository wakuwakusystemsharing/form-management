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

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const storeId = url.searchParams.get('storeId');
  if (!storeId) {
    return NextResponse.json({ error: 'storeId が必要です' }, { status: 400 });
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
  }

  const { data: store, error: storeError } = await (adminClient as any)
    .from('stores')
    .select('id, line_channel_access_token, google_calendar_id')
    .eq('id', storeId)
    .single();

  if (storeError || !store) {
    return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
  }

  const accessToken = store.line_channel_access_token;
  if (!accessToken) {
    return NextResponse.json({ error: 'LINEチャネルアクセストークンが未設定です' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const event = (body?.events?.[0] || {}) as LineEvent;
  const replyToken = event.replyToken;
  const userId = event.source?.userId;
  const messageText = event.message?.text || '';

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
      .gte('reservation_date', todayStr)
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });

    if (!reservations || reservations.length === 0) {
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: '現在LINEでされた予約が見つかりませんでした。'
      }]);
      return NextResponse.json({ success: true });
    }

    const lines = reservations.map((r: any, index: number) => {
      const menu = r.submenu_name ? `${r.menu_name} > ${r.submenu_name}` : r.menu_name;
      return `${index + 1}. ${r.reservation_date} ${r.reservation_time} ${menu}`;
    });
    await replyLineMessage(replyToken, accessToken, [{
      type: 'text',
      text: `予約一覧:\n${lines.join('\n')}`
    }]);
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
      .gte('reservation_date', todayStr)
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });

    if (!reservations || reservations.length === 0) {
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: '現在LINEでされた予約がありません。'
      }]);
      return NextResponse.json({ success: true });
    }

    const lines = reservations.map((r: any, index: number) => {
      const menu = r.submenu_name ? `${r.menu_name} > ${r.submenu_name}` : r.menu_name;
      return `${index}. ${r.reservation_date} ${r.reservation_time} ${menu}`;
    });
    await replyLineMessage(replyToken, accessToken, [{
      type: 'text',
      text: `キャンセルしたい予約番号を送信してください。\n\n例: キャンセル: 0\n\n${lines.join('\n')}`
    }]);
    return NextResponse.json({ success: true });
  }

  if (messageText.startsWith('キャンセル:')) {
    const index = parseInt(messageText.replace('キャンセル:', '').trim(), 10);
    if (Number.isNaN(index)) {
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: 'キャンセル番号が正しくありません。'
      }]);
      return NextResponse.json({ success: true });
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const { data: reservations } = await (adminClient as any)
      .from('reservations')
      .select('*')
      .eq('store_id', storeId)
      .eq('line_user_id', userId)
      .gte('reservation_date', todayStr)
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });

    const target = reservations?.[index];
    if (!target) {
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: '指定された予約が見つかりません。'
      }]);
      return NextResponse.json({ success: true });
    }

    await (adminClient as any)
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', target.id);

    if (store.google_calendar_id) {
      try {
        const start = new Date(`${target.reservation_date}T00:00:00+09:00`).toISOString();
        const end = new Date(`${target.reservation_date}T23:59:59+09:00`).toISOString();
        const events = await listCalendarEvents(store.google_calendar_id, start, end, storeId);
        const event = events.find(e => e.location === userId && (e.summary || '').includes(target.customer_name));
        if (event?.id) {
          await deleteCalendarEvent(store.google_calendar_id, event.id, storeId);
        }
      } catch (calendarError) {
        console.error('[LINE] Calendar delete error:', calendarError);
      }
    }

    await replyLineMessage(replyToken, accessToken, [{
      type: 'text',
      text: `${target.reservation_date} ${target.reservation_time} の予約をキャンセルしました。`
    }]);
    return NextResponse.json({ success: true });
  }

  if (messageText.startsWith('【予約フォーム】')) {
    const details = parseReservationForm(messageText);
    if (!details.name || !details.phone || !details.dateTime) {
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: '予約フォームの情報が不足しています。'
      }]);
      return NextResponse.json({ success: true });
    }

    const { data: formData } = await (adminClient as any)
      .from('reservation_forms')
      .select('id')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!formData?.id) {
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: '利用可能な予約フォームが見つかりません。'
      }]);
      return NextResponse.json({ success: true });
    }

    const reservationDate = details.dateTime.toISOString().split('T')[0];
    const reservationTime = details.dateTime.toTimeString().slice(0, 5);
    const selectedMenus = details.menus.map(menu => ({
      menu_id: '',
      menu_name: menu,
      category_name: '',
      price: 0,
      duration: 0
    }));

    const reservationResponse = await fetch(new URL('/api/reservations', req.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        form_id: formData.id,
        store_id: storeId,
        customer_name: details.name,
        customer_phone: details.phone,
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        message: details.message || null,
        selected_menus: selectedMenus,
        selected_options: [],
        customer_info: {
          visit_count: details.visitCount || null,
          course: details.course || null
        },
        line_user_id: userId
      })
    });

    if (!reservationResponse.ok) {
      await replyLineMessage(replyToken, accessToken, [{
        type: 'text',
        text: '予約の作成に失敗しました。'
      }]);
      return NextResponse.json({ success: true });
    }

    await replyLineMessage(replyToken, accessToken, [{
      type: 'text',
      text: `予約を受け付けました。\n${reservationDate} ${reservationTime}`
    }]);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: true });
}
