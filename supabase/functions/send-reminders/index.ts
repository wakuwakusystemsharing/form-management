// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// JST で今日から days 日後の日付文字列（YYYY-MM-DD）を返す
function getDateStringJstAfterDays(days: number) {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const target = new Date(jstNow);
  target.setDate(jstNow.getDate() + days);
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// 店舗の reminder_days_before を 1〜30 の整数に正規化（未設定・不正値 = 1: 前日）
function normalizeDaysBefore(value: unknown): number {
  const n = typeof value === "number" && isFinite(value) ? Math.floor(value) : 1;
  return n >= 1 && n <= 30 ? n : 1;
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
  customerName: string,
  daysBefore: number
) {
  const headerLabel = daysBefore === 1 ? "【予約前日メッセージ】" : `【予約${daysBefore}日前メッセージ】`;
  const bodyLabel = daysBefore === 1 ? "明日の予約をお知らせします" : `${daysBefore}日後の予約をお知らせします`;
  return {
    type: "flex",
    altText: `${headerLabel}${bodyLabel}`,
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
            text: headerLabel,
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
            text: bodyLabel,
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

function getCurrentHourJst(): string {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const hh = String(jstNow.getHours()).padStart(2, "0");
  return `${hh}:00`;
}

Deno.serve(async () => {
  const currentHour = getCurrentHourJst();
  console.log(`現在時刻(JST): ${currentHour}`);

  // リマインダーが有効かつ送信時刻が一致する店舗のみ取得
  const { data: eligibleStores, error: storeError } = await supabase
    .from("stores")
    .select("id,name,line_channel_access_token,reminder_days_before")
    .eq("reminder_enabled", true)
    .eq("reminder_time", currentHour)
    .not("line_channel_access_token", "is", null);

  if (storeError) {
    console.error("店舗取得エラー:", storeError.message);
    return new Response(JSON.stringify({ error: "店舗取得に失敗しました" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!eligibleStores || eligibleStores.length === 0) {
    console.log(`${currentHour} に送信対象の店舗がありません`);
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const storeIds = eligibleStores.map((s) => s.id);
  console.log(`対象店舗数: ${eligibleStores.length}件 (${storeIds.join(", ")})`);

  // 店舗ごとの「何日前」設定からリマインド対象日を算出
  // 例: 前日設定(1) → 明日の予約 / 2日前設定(2) → 2日後の予約 が対象
  const targetDateByStore = new Map<string, string>();
  const targetDates = new Set<string>();
  eligibleStores.forEach((s) => {
    const days = normalizeDaysBefore(s.reminder_days_before);
    const date = getDateStringJstAfterDays(days);
    targetDateByStore.set(s.id, date);
    targetDates.add(date);
  });
  console.log(`リマインド対象日: ${[...targetDates].join(", ")}`);

  // 対象店舗のリマインド対象日の予約を取得
  const { data: reservations, error } = await supabase
    .from("reservations")
    .select(
      "id,store_id,reservation_date,reservation_time,menu_name,submenu_name,line_user_id,status,customer_name"
    )
    .in("reservation_date", [...targetDates])
    .neq("status", "cancelled")
    .not("line_user_id", "is", null)
    .in("store_id", storeIds);

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

  const { data: stores } = { data: eligibleStores };

  const DEFAULT_THEME_COLOR = "#877059";
  const storeMap = new Map<
    string,
    { token: string; name: string; themeColor: string; daysBefore: number }
  >();
  (stores || []).forEach((store) => {
    if (store.line_channel_access_token) {
      storeMap.set(store.id, {
        token: store.line_channel_access_token,
        name: store.name || "店舗",
        themeColor: DEFAULT_THEME_COLOR,
        daysBefore: normalizeDaysBefore(store.reminder_days_before),
      });
    }
  });

  let sent = 0;
  const errors: Array<{ reservationId: string; status: number; body: string }> =
    [];

  for (const reservation of reservations) {
    const storeInfo = storeMap.get(reservation.store_id);
    if (!storeInfo || !reservation.line_user_id) continue;

    // この予約日がこの店舗のリマインド対象日と一致する場合のみ送信
    // （複数店舗で異なる「何日前」設定があるため、まとめて取得した予約をここで振り分ける）
    if (reservation.reservation_date !== targetDateByStore.get(reservation.store_id)) continue;

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
      reservation.customer_name || "お客",
      storeInfo.daysBefore
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
