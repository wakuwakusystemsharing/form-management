// @ts-nocheck
/**
 * フォローメッセージ送信（Edge Function）
 *
 * pg_cron（毎時 5 分）から起動され、follow_messages のうち scheduled_at <= 今 の未送信行を処理する。
 * 設計: docs/フォローメッセージ機能_実装設計.md
 *
 * - 予約リマインダー（send-reminders）とは別 Function・別 cron。リマインダー側のコードには依存しない
 * - 送信前に「再予約あり」「リマインダーと同日」「店舗の設定 OFF」「トークン無し」「予約キャンセル済み」を確認して見送る
 * - 送信失敗は attempt_count を増やして次回に再試行（3 回で failed）
 * - 同時起動時の二重送信防止: attempt_count を条件にした楽観ロックで行を確保してから送信する
 *
 * ※ 文面の解決ロジックは src/lib/reminder-template.ts + src/lib/follow-template.ts、
 *   判定ロジックは src/lib/follow-message-scheduler.ts と同じ。変更時は両方を合わせること
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 200;

// ===== 日付ユーティリティ（JST） =====
function getTodayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function formatDateOnlyJapanese(dateStr: string): string {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const d = new Date(dateStr);
  const dayOfWeek = weekdays[d.getDay()];
  const [year, month, day] = dateStr.split("-");
  return `${year}年${month}月${day}日（${dayOfWeek}）`;
}

// ===== 判定ロジック（src/lib/follow-message-scheduler.ts と同じ） =====
function hasRebooking(reservations, baseDate: string, excludeReservationId: string): boolean {
  if (!Array.isArray(reservations)) return false;
  return reservations.some((r) => {
    if (!r || r.status === "cancelled") return false;
    if (r.id === excludeReservationId) return false;
    return typeof r.reservation_date === "string" && r.reservation_date > baseDate;
  });
}

function isReminderSameDay(store, reservations, todayJst: string): boolean {
  if (store.reminder_enabled === false) return false;
  if (!Array.isArray(reservations)) return false;
  const n = typeof store.reminder_days_before === "number" && isFinite(store.reminder_days_before)
    ? Math.floor(store.reminder_days_before) : 1;
  const daysBefore = n >= 1 && n <= 30 ? n : 1;
  const target = addDays(todayJst, daysBefore);
  return reservations.some((r) => r && r.status !== "cancelled" && r.reservation_date === target);
}

// ===== 文面テンプレート（src/lib/reminder-template.ts + follow-template.ts と同じ） =====
const DEFAULT_HEADER_COLOR = "#877059";
const DEFAULT_TEXT_COLOR = "#333333";
const FOLLOW_DEFAULT_HEADER_TITLE = "【ご来店ありがとうございました】";
const FOLLOW_DEFAULT_BODY = "先日はご来店いただきありがとうございました。\n次回のご予約もお待ちしております。";
const FOLLOW_DEFAULT_FOOTER = "またのご来店を心よりお待ちしております";

function isValidHex(v: unknown): boolean {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}
function applyPlaceholders(text: string, ctx) {
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
function resolveFollowContent(template, ctx) {
  const t = template && typeof template === "object" ? template : {};
  const headerTitle = (t.header_title || "").trim() ? applyPlaceholders(t.header_title, ctx) : FOLLOW_DEFAULT_HEADER_TITLE;
  const headerColor = isValidHex(t.header_color) ? t.header_color : DEFAULT_HEADER_COLOR;
  const textColor = isValidHex(t.text_color) ? t.text_color : DEFAULT_TEXT_COLOR;
  const customBody = (t.body_text || "").trim() ? applyPlaceholders(t.body_text, ctx).trim() : "";
  const bodyText = customBody || FOLLOW_DEFAULT_BODY;
  const showDetails = t.show_details !== false;
  const showFooter = t.show_footer !== false;
  const footerText = (t.footer_text || "").trim() ? applyPlaceholders(t.footer_text, ctx).trim() : FOLLOW_DEFAULT_FOOTER;
  return { headerTitle, headerColor, textColor, bodyText, isCustomBody: !!customBody, showDetails, showFooter, footerText };
}

function buildFlexMessage(template, ctx) {
  const c = resolveFollowContent(template, ctx);
  const detailText = (label: string, value: string, margin: string) => [
    { type: "text", text: label, color: "#666666", size: "sm", weight: "bold", margin },
    { type: "text", text: value || " ", wrap: true, size: "sm", color: c.textColor, margin: "xs" },
  ];
  const bodyContents: unknown[] = [
    {
      type: "text",
      text: c.bodyText || " ",
      wrap: true,
      // カスタム本文は左寄せ・通常サイズ、デフォルト本文は中央・太字（管理画面プレビューと同じ）
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
        ...detailText("📅 前回のご予約", ctx.dateText, "md"),
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
    altText: `${c.headerTitle}${c.isCustomBody ? "" : FOLLOW_DEFAULT_BODY.replace(/\n/g, "")}`.slice(0, 400),
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

async function sendLinePush(accessToken: string, to: string, flexMessage: Record<string, unknown>) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to, messages: [flexMessage] }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

async function markSkipped(id: string, reason: string) {
  const { error } = await supabase
    .from("follow_messages")
    .update({ status: "skipped", skip_reason: reason })
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) console.error(`見送り更新エラー: id=${id} ${error.message}`);
}

Deno.serve(async () => {
  const nowIso = new Date().toISOString();
  const todayJst = getTodayJst();
  console.log(`フォローメッセージ処理開始: now=${nowIso} today(JST)=${todayJst}`);

  // 1. 送信予定時刻を過ぎた未送信行
  const { data: due, error: dueError } = await supabase
    .from("follow_messages")
    .select("id,store_id,reservation_id,line_user_id,base_date,scheduled_at,attempt_count")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (dueError) {
    console.error("配信予定取得エラー:", dueError.message);
    return json({ error: "配信予定の取得に失敗しました" }, 500);
  }
  if (!due || due.length === 0) {
    console.log("送信対象がありません");
    return json({ sent: 0, skipped: 0, failed: 0 });
  }
  console.log(`対象件数: ${due.length}件`);

  // 2. 店舗（フォロー設定 + リマインダー設定は読むだけ）
  const storeIds = [...new Set(due.map((r) => r.store_id))];
  const { data: stores, error: storeError } = await supabase
    .from("stores")
    .select("id,name,line_channel_access_token,follow_enabled,follow_template,reminder_enabled,reminder_days_before")
    .in("id", storeIds);
  if (storeError) {
    console.error("店舗取得エラー:", storeError.message);
    return json({ error: "店舗取得に失敗しました" }, 500);
  }
  const storeMap = new Map((stores || []).map((s) => [s.id, s]));

  // 3. フォロー元の予約（本文用・キャンセル確認）
  const reservationIds = due.map((r) => r.reservation_id);
  const { data: sourceReservations, error: srcError } = await supabase
    .from("reservations")
    .select("id,store_id,reservation_date,reservation_time,menu_name,submenu_name,customer_name,staff_name,status,line_user_id")
    .in("id", reservationIds);
  if (srcError) {
    console.error("予約取得エラー:", srcError.message);
    return json({ error: "予約取得に失敗しました" }, 500);
  }
  const sourceMap = new Map((sourceReservations || []).map((r) => [r.id, r]));

  // 4. 同じ顧客の他の予約（再予約・リマインダー同日の判定用）。基準日以降だけ取れば十分
  const lineUserIds = [...new Set(due.map((r) => r.line_user_id))];
  const minBaseDate = due.reduce((min, r) => (r.base_date < min ? r.base_date : min), due[0].base_date);
  const { data: otherReservations, error: otherError } = await supabase
    .from("reservations")
    .select("id,store_id,line_user_id,reservation_date,status")
    .in("store_id", storeIds)
    .in("line_user_id", lineUserIds)
    .neq("status", "cancelled")
    .gte("reservation_date", minBaseDate);
  if (otherError) {
    console.error("再予約確認エラー:", otherError.message);
    return json({ error: "再予約確認に失敗しました" }, 500);
  }
  const byUser = new Map<string, unknown[]>();
  (otherReservations || []).forEach((r) => {
    const key = `${r.store_id}:${r.line_user_id}`;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key)!.push(r);
  });

  // 5. {LINE名} 用の表示名
  const lineNameMap = new Map<string, string>();
  try {
    const { data: customers } = await supabase
      .from("customers")
      .select("store_id,line_user_id,line_display_name")
      .in("store_id", storeIds)
      .in("line_user_id", lineUserIds);
    (customers || []).forEach((c) => {
      if (c.line_user_id && c.line_display_name) lineNameMap.set(`${c.store_id}:${c.line_user_id}`, c.line_display_name);
    });
  } catch (e) {
    console.error("顧客取得エラー（LINE名はお名前で代替）:", e);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of due) {
    const store = storeMap.get(row.store_id);
    const source = sourceMap.get(row.reservation_id);
    const userKey = `${row.store_id}:${row.line_user_id}`;
    const userReservations = byUser.get(userKey) || [];

    // ---- 見送り判定 ----
    if (!store || store.follow_enabled !== true) {
      await markSkipped(row.id, "store_disabled"); skipped++; continue;
    }
    if (!store.line_channel_access_token) {
      await markSkipped(row.id, "no_token"); skipped++; continue;
    }
    if (!source || source.status === "cancelled") {
      await markSkipped(row.id, "reservation_cancelled"); skipped++; continue;
    }
    if (hasRebooking(userReservations, row.base_date, row.reservation_id)) {
      await markSkipped(row.id, "rebooked"); skipped++; continue;
    }
    if (isReminderSameDay(store, userReservations, todayJst)) {
      await markSkipped(row.id, "reminder_same_day"); skipped++; continue;
    }

    // ---- 行の確保（同時起動の二重送信防止: attempt_count が変わっていなければ自分が担当） ----
    const currentAttempt = row.attempt_count || 0;
    const { data: claimed, error: claimError } = await supabase
      .from("follow_messages")
      .update({ attempt_count: currentAttempt + 1 })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .eq("attempt_count", currentAttempt)
      .select("id");
    if (claimError || !claimed || claimed.length === 0) {
      console.log(`他の実行が処理中のためスキップ: id=${row.id}`);
      continue;
    }

    // ---- 文面 ----
    const menu = source.submenu_name ? `${source.menu_name} > ${source.submenu_name}` : source.menu_name || "未設定";
    const timeOnly = String(source.reservation_time || "").slice(0, 5);
    const dateOnly = formatDateOnlyJapanese(source.reservation_date);
    const customerName = source.customer_name || "お客";
    const flexMessage = buildFlexMessage(store.follow_template, {
      storeName: store.name || "店舗",
      lineDisplayName: lineNameMap.get(userKey) || customerName,
      customerName,
      dateText: `${dateOnly} ${timeOnly}`,
      dateOnly,
      timeOnly,
      menuText: menu,
      staffName: source.staff_name || "",
    });

    // ---- 送信 ----
    const result = await sendLinePush(store.line_channel_access_token, row.line_user_id, flexMessage);
    if (result.ok) {
      const { error } = await supabase
        .from("follow_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      if (error) console.error(`送信済み更新エラー: id=${row.id} ${error.message}`);
      console.log(`送信成功: follow=${row.id} reservation=${row.reservation_id}`);
      sent++;
    } else {
      const attempts = currentAttempt + 1;
      const lastError = `HTTP ${result.status}: ${result.body}`.slice(0, 500);
      const patch = attempts >= MAX_ATTEMPTS
        ? { status: "failed", last_error: lastError }
        : { last_error: lastError };
      const { error } = await supabase.from("follow_messages").update(patch).eq("id", row.id);
      if (error) console.error(`失敗更新エラー: id=${row.id} ${error.message}`);
      console.error(`送信失敗(${attempts}/${MAX_ATTEMPTS}): follow=${row.id} status=${result.status} body=${result.body}`);
      failed++;
    }
  }

  console.log(`処理結果: 送信=${sent}件 見送り=${skipped}件 失敗=${failed}件`);
  return json({ sent, skipped, failed });
});
