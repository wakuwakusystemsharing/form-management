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

async function sendLinePush(accessToken: string, to: string, text: string) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }],
    }),
  });
}

Deno.serve(async () => {
  const targetDate = getTomorrowDateStringJst();

  const { data: reservations, error } = await supabase
    .from("reservations")
    .select("id,store_id,reservation_date,reservation_time,menu_name,submenu_name,line_user_id,status,customer_name")
    .eq("reservation_date", targetDate)
    .neq("status", "cancelled")
    .not("line_user_id", "is", null);

  if (error) {
    return new Response(JSON.stringify({ error: "予約取得に失敗しました" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!reservations || reservations.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const storeIds = Array.from(new Set(reservations.map(r => r.store_id)));
  const { data: stores } = await supabase
    .from("stores")
    .select("id,line_channel_access_token")
    .in("id", storeIds);

  const tokenMap = new Map<string, string>();
  (stores || []).forEach(store => {
    if (store.line_channel_access_token) {
      tokenMap.set(store.id, store.line_channel_access_token);
    }
  });

  let sent = 0;
  for (const reservation of reservations) {
    const accessToken = tokenMap.get(reservation.store_id);
    if (!accessToken || !reservation.line_user_id) continue;

    const menu = reservation.submenu_name
      ? `${reservation.menu_name} > ${reservation.submenu_name}`
      : reservation.menu_name;
    const message = `明日の予約をお知らせします。\n${reservation.reservation_date} ${reservation.reservation_time}\n${menu}\n${reservation.customer_name}様`;

    try {
      await sendLinePush(accessToken, reservation.line_user_id, message);
      sent += 1;
    } catch (_error) {
      // 送信失敗はスキップ
    }
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
