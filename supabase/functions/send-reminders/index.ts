// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function getTomorrowDateStringJst() {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const tomorrow = new Date(jstNow);
  tomorrow.setDate(jstNow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const dd = String(tomorrow.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateJapanese(dateStr: string, timeStr: string): string {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const d = new Date(dateStr);
  const dayOfWeek = weekdays[d.getDay()];
  // dateStr: "2026-04-03" → "2026年04月03日（木）"
  const [year, month, day] = dateStr.split("-");
  return `${year}年${month}月${day}日（${dayOfWeek}） ${timeStr}`;
}

function buildFlexMessage(
  storeName: string,
  themeColor: string,
  dateText: string,
  menuText: string,
  customerName: string
) {
  return {
    type: "flex",
    altText: "【予約前日メッセージ】明日の予約をお知らせします",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: storeName,
            color: "#ffffff66",
            size: "sm",
          },
          {
            type: "text",
            text: "【予約前日メッセージ】",
            color: "#ffffff",
            size: "xl",
            weight: "bold",
          },
        ],
        paddingAll: "20px",
        backgroundColor: themeColor,
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "明日の予約をお知らせします",
            weight: "bold",
            size: "lg",
            color: "#333333",
            wrap: true,
            align: "center",
            margin: "md",
          },
          {
            type: "separator",
            margin: "lg",
            color: "#CCCCCC",
          },
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "📅 日時",
                color: "#666666",
                size: "sm",
                weight: "bold",
                margin: "md",
              },
              {
                type: "text",
                text: dateText,
                wrap: true,
                size: "sm",
                color: "#333333",
                margin: "xs",
              },
              {
                type: "text",
                text: "📝 メニュー",
                color: "#666666",
                size: "sm",
                weight: "bold",
                margin: "lg",
              },
              {
                type: "text",
                text: menuText,
                wrap: true,
                size: "sm",
                color: "#333333",
                margin: "xs",
              },
              {
                type: "text",
                text: "👤 お名前",
                color: "#666666",
                size: "sm",
                weight: "bold",
                margin: "lg",
              },
              {
                type: "text",
                text: `${customerName}様`,
                wrap: true,
                size: "sm",
                color: "#333333",
                margin: "xs",
              },
            ],
            margin: "lg",
          },
          {
            type: "separator",
            margin: "xxl",
            color: "#CCCCCC",
          },
          {
            type: "text",
            text: "心よりお待ちしております",
            wrap: true,
            margin: "xl",
            size: "sm",
            align: "center",
            color: "#474646",
          },
        ],
      },
    },
  };
}

async function sendLinePush(
  accessToken: string,
  to: string,
  flexMessage: Record<string, unknown>
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to,
      messages: [flexMessage],
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async () => {
  const targetDate = getTomorrowDateStringJst();
  console.log(`リマインド対象日: ${targetDate}`);

  const { data: reservations, error } = await supabase
    .from("reservations")
    .select(
      "id,store_id,reservation_date,reservation_time,menu_name,submenu_name,line_user_id,status,customer_name"
    )
    .eq("reservation_date", targetDate)
    .neq("status", "cancelled")
    .not("line_user_id", "is", null);

  if (error) {
    console.error("予約取得エラー:", error.message);
    return new Response(JSON.stringify({ error: "予約取得に失敗しました" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!reservations || reservations.length === 0) {
    console.log("対象の予約がありません");
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`対象予約数: ${reservations.length}件`);

  const storeIds = Array.from(new Set(reservations.map((r) => r.store_id)));
  const { data: stores } = await supabase
    .from("stores")
    .select("id,name,line_channel_access_token")
    .in("id", storeIds);

  const DEFAULT_THEME_COLOR = "#877059";
  const storeMap = new Map<
    string,
    { token: string; name: string; themeColor: string }
  >();
  (stores || []).forEach((store) => {
    if (store.line_channel_access_token) {
      storeMap.set(store.id, {
        token: store.line_channel_access_token,
        name: store.name || "店舗",
        themeColor: DEFAULT_THEME_COLOR,
      });
    }
  });

  let sent = 0;
  const errors: Array<{ reservationId: string; status: number; body: string }> =
    [];

  for (const reservation of reservations) {
    const storeInfo = storeMap.get(reservation.store_id);
    if (!storeInfo || !reservation.line_user_id) continue;

    const menu = reservation.submenu_name
      ? `${reservation.menu_name} > ${reservation.submenu_name}`
      : reservation.menu_name || "未設定";

    const dateText = formatDateJapanese(
      reservation.reservation_date,
      reservation.reservation_time
    );

    const flexMessage = buildFlexMessage(
      storeInfo.name,
      storeInfo.themeColor,
      dateText,
      menu,
      reservation.customer_name || "お客"
    );

    const result = await sendLinePush(
      storeInfo.token,
      reservation.line_user_id,
      flexMessage
    );

    if (result.ok) {
      console.log(
        `送信成功: reservation=${reservation.id} user=${reservation.line_user_id}`
      );
      sent += 1;
    } else {
      console.error(
        `送信失敗: reservation=${reservation.id} status=${result.status} body=${result.body}`
      );
      errors.push({
        reservationId: reservation.id,
        status: result.status,
        body: result.body,
      });
    }
  }

  console.log(`送信結果: 成功=${sent}件 失敗=${errors.length}件`);

  return new Response(JSON.stringify({ sent, errors: errors.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
