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

function formatDateOnlyJapanese(dateStr: string): string {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const d = new Date(dateStr);
  const dayOfWeek = weekdays[d.getDay()];
  // dateStr: "2026-04-03" → "2026年04月03日（木）"
  const [year, month, day] = dateStr.split("-");
  return `${year}年${month}月${day}日（${dayOfWeek}）`;
}

// ===== リマインダー文面テンプレート =====
// ※ src/lib/reminder-template.ts（管理画面プレビュー）と同じロジック。変更時は両方を合わせること
const REMINDER_DEFAULT_HEADER_COLOR = "#877059";
const REMINDER_DEFAULT_TEXT_COLOR = "#333333";
const REMINDER_DEFAULT_FOOTER = "心よりお待ちしております";

function defaultHeaderTitle(daysBefore: number): string {
  return daysBefore === 1 ? "【予約前日メッセージ】" : `【予約${daysBefore}日前メッセージ】`;
}
function defaultBodyLabel(daysBefore: number): string {
  return daysBefore === 1 ? "明日の予約をお知らせします" : `${daysBefore}日後の予約をお知らせします`;
}
function isValidHex(v: unknown): boolean {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}
function applyReminderPlaceholders(text: string, ctx) {
  return String(text || "")
    .replace(/\{LINE名\}/g, ctx.lineDisplayName || ctx.customerName)
    .replace(/\{お名前\}/g, ctx.customerName)
    .replace(/\{予約日時\}/g, ctx.dateText)
    .replace(/\{予約日\}/g, ctx.dateOnly)
    .replace(/\{予約時間\}/g, ctx.timeOnly)
    .replace(/\{メニュー名\}/g, ctx.menuText)
    .replace(/\{担当スタッフ\}/g, ctx.staffName || "")
    .replace(/\{店舗名\}/g, ctx.storeName);
}
function resolveReminderContent(template, ctx) {
  const t = template && typeof template === "object" ? template : {};
  const headerTitle = (t.header_title || "").trim() ? applyReminderPlaceholders(t.header_title, ctx) : defaultHeaderTitle(ctx.daysBefore);
  const headerColor = isValidHex(t.header_color) ? t.header_color : REMINDER_DEFAULT_HEADER_COLOR;
  const textColor = isValidHex(t.text_color) ? t.text_color : REMINDER_DEFAULT_TEXT_COLOR;
  const customBody = (t.body_text || "").trim() ? applyReminderPlaceholders(t.body_text, ctx).trim() : "";
  const bodyText = customBody || defaultBodyLabel(ctx.daysBefore);
  const showDetails = t.show_details !== false;
  const showFooter = t.show_footer !== false;
  const footerText = (t.footer_text || "").trim() ? applyReminderPlaceholders(t.footer_text, ctx).trim() : REMINDER_DEFAULT_FOOTER;
  return { headerTitle, headerColor, textColor, bodyText, isCustomBody: !!customBody, showDetails, showFooter, footerText };
}

function buildFlexMessage(template, ctx) {
  const c = resolveReminderContent(template, ctx);
  const detailText = (label: string, value: string, margin: string) => [
    { type: "text", text: label, color: "#666666", size: "sm", weight: "bold", margin },
    { type: "text", text: value || " ", wrap: true, size: "sm", color: c.textColor, margin: "xs" },
  ];
  const bodyContents: unknown[] = [
    {
      type: "text",
      text: c.bodyText || " ",
      wrap: true,
      // カスタム本文は左寄せ・通常サイズ、デフォルト本文は従来どおり中央・太字
      ...(c.isCustomBody
        ? { size: "sm", color: c.textColor, margin: "md" }
        : { weight: "bold", size: "lg", color: c.textColor, align: "center", margin: "md" }),
    },
  ];
  if (c.showDetails) {
    bodyContents.push({ type: "separator", margin: "lg", color: "#CCCCCC" });
    bodyContents.push({
      type: "box",
      layout: "vertical",
      contents: [
        ...detailText("📅 日時", ctx.dateText, "md"),
        ...detailText("📝 メニュー", ctx.menuText, "lg"),
        ...(ctx.staffName ? detailText("👤 担当", ctx.staffName, "lg") : []),
        ...detailText("👤 お名前", `${ctx.customerName}様`, "lg"),
      ],
      margin: "lg",
    });
  }
  if (c.showFooter) {
    bodyContents.push({ type: "separator", margin: "xxl", color: "#CCCCCC" });
    bodyContents.push({ type: "text", text: c.footerText || " ", wrap: true, margin: "xl", size: "sm", align: "center", color: "#474646" });
  }
  return {
    type: "flex",
    altText: `${c.headerTitle}${c.isCustomBody ? "" : defaultBodyLabel(ctx.daysBefore)}`.slice(0, 400),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: ctx.storeName || " ", color: "#ffffff66", size: "sm" },
          { type: "text", text: c.headerTitle || " ", color: "#ffffff", size: "xl", weight: "bold", wrap: true },
        ],
        paddingAll: "20px",
        backgroundColor: c.headerColor,
      },
      body: { type: "box", layout: "vertical", contents: bodyContents },
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
    .select("id,name,line_channel_access_token,reminder_days_before,reminder_template")
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
      "id,store_id,reservation_date,reservation_time,menu_name,submenu_name,line_user_id,status,customer_name,staff_name"
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

  // {LINE名} 差し込み用に顧客の LINE 表示名を取得（無ければお名前にフォールバック）
  const lineNameMap = new Map<string, string>();
  try {
    const lineUserIds = [...new Set(reservations.map((r) => r.line_user_id).filter(Boolean))];
    if (lineUserIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("store_id,line_user_id,line_display_name")
        .in("store_id", storeIds)
        .in("line_user_id", lineUserIds);
      (customers || []).forEach((c) => {
        if (c.line_user_id && c.line_display_name) {
          lineNameMap.set(`${c.store_id}:${c.line_user_id}`, c.line_display_name);
        }
      });
    }
  } catch (e) {
    console.error("顧客取得エラー（LINE名はお名前で代替）:", e);
  }

  const storeMap = new Map<
    string,
    { token: string; name: string; daysBefore: number; template: unknown }
  >();
  eligibleStores.forEach((store) => {
    if (store.line_channel_access_token) {
      storeMap.set(store.id, {
        token: store.line_channel_access_token,
        name: store.name || "店舗",
        daysBefore: normalizeDaysBefore(store.reminder_days_before),
        template: store.reminder_template || null,
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

    const timeOnly = String(reservation.reservation_time || "").slice(0, 5);
    const dateOnly = formatDateOnlyJapanese(reservation.reservation_date);
    const customerName = reservation.customer_name || "お客";

    const flexMessage = buildFlexMessage(storeInfo.template, {
      storeName: storeInfo.name,
      daysBefore: storeInfo.daysBefore,
      lineDisplayName: lineNameMap.get(`${reservation.store_id}:${reservation.line_user_id}`) || customerName,
      customerName,
      dateText: `${dateOnly} ${timeOnly}`,
      dateOnly,
      timeOnly,
      menuText: menu,
      staffName: reservation.staff_name || "",
    });

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
