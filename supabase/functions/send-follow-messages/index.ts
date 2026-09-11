// @ts-nocheck
/**
 * フォローメッセージ送信（Edge Function）
 *
 * pg_cron（毎時 5 分）から起動され、follow_messages のうち scheduled_at <= 今 の未送信行を処理する。
 * 設計: docs/フォローメッセージ機能_実装設計.md / 監査対応: docs/リマインダー・フォローメッセージ_送信動作監査レポート_完全版.md（修正パッケージ B）
 *
 * - 予約リマインダー（send-reminders）とは別 Function・別 cron。リマインダー側のコードには依存しない
 * - 送信前に「再予約あり」「リマインダーと同日」「店舗の設定 OFF」「トークン無し」「予約キャンセル済み」を確認して見送る
 * - 行の確保: status を scheduled → sending に条件付き UPDATE（claimed_at 付き）。送信中の再起動でも二重に確保しない。
 *   10 分以上 sending のままの行（前回の異常終了）は再確保できる
 * - X-Line-Retry-Key に行 ID（UUID 形式に整形）を付け、LINE 側でも重複を防ぐ
 * - 1 件ごとに try/catch + 10 秒タイムアウト。通信例外も試行回数に数え、3 回で failed（取得条件にも attempt_count < 3）
 * - 期限到来分は 200 件ずつ、時間の許す限り（約 50 秒）繰り返し処理する
 * - 補完: 直近 3 日に成立した LINE 予約で予定行が無いもの（予約作成時の失敗）に予定を作る
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
const TIME_BUDGET_MS = 50 * 1000;
const STALE_SENDING_MS = 10 * 60 * 1000;
const LINE_TIMEOUT_MS = 10 * 1000;
const BACKFILL_DAYS = 3;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ===== 日付ユーティリティ（JST） =====
function toJstDateString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`;
}
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function formatDateOnlyJapanese(dateStr: string): string {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const d = new Date(dateStr);
  const [year, month, day] = dateStr.split("-");
  return `${year}年${month}月${day}日（${weekdays[d.getDay()]}）`;
}

// ===== 設定の正規化・予定計算（src/lib/follow-message-scheduler.ts と同じ） =====
function normalizeFollowDaysAfter(v: unknown): number {
  const n = typeof v === "number" && isFinite(v) ? Math.floor(v) : NaN;
  return n >= 1 && n <= 60 ? n : 7;
}
function normalizeFollowTime(v: unknown): string {
  return typeof v === "string" && /^([01]\d|2[0-3]):00$/.test(v) ? v : "12:00";
}
function resolveBaseDate(reservation, base: string, now: Date): string | null {
  if (base === "created_at") {
    const created = reservation.created_at ? new Date(reservation.created_at) : now;
    return isNaN(created.getTime()) ? toJstDateString(now) : toJstDateString(created);
  }
  return typeof reservation.reservation_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reservation.reservation_date) ? reservation.reservation_date : null;
}
function computeScheduledAt(baseDate: string, daysAfter: number, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) return null;
  const [y, m, d] = baseDate.split("-").map((s) => parseInt(s, 10));
  const hour = parseInt(normalizeFollowTime(time).slice(0, 2), 10);
  const dt = new Date(Date.UTC(y, m - 1, d + normalizeFollowDaysAfter(daysAfter), hour, 0, 0) - JST_OFFSET_MS);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
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
  const n = typeof store.reminder_days_before === "number" && isFinite(store.reminder_days_before) ? Math.floor(store.reminder_days_before) : 1;
  const daysBefore = n >= 1 && n <= 30 ? n : 1;
  const target = addDays(todayJst, daysBefore);
  return reservations.some((r) => r && r.status !== "cancelled" && r.reservation_date === target);
}
/** 32 桁 hex の行 ID を LINE の X-Line-Retry-Key（UUID 形式）にする */
function toLineRetryKey(id: string | null | undefined): string | null {
  if (!id) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id.toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(id)) {
    const s = id.toLowerCase();
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
  return null;
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

// ===== LINE push（タイムアウト付き。例外は投げず結果で返す） =====
async function sendLinePush(accessToken: string, to: string, flexMessage: Record<string, unknown>, retryKey: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization: `Bearer ${accessToken}`,
    };
    if (retryKey) headers["X-Line-Retry-Key"] = retryKey;
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers,
      body: JSON.stringify({ to, messages: [flexMessage] }),
      signal: controller.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

async function markSkipped(id: string, reason: string) {
  const { error } = await supabase
    .from("follow_messages")
    .update({ status: "skipped", skip_reason: reason, claimed_at: null })
    .eq("id", id)
    .in("status", ["scheduled", "sending"]);
  if (error) console.error(`見送り更新エラー: id=${id} ${error.message}`);
}

/**
 * 行を確保する: scheduled → sending（claimed_at 付き）。
 * 10 分以上 sending のままの行は前回の異常終了とみなして再確保できる。
 * 確保できなければ null（他の実行が処理中）
 */
async function claimRow(row, nowIso: string): Promise<{ id: string; attempt: number } | null> {
  const attempt = (row.attempt_count || 0) + 1;
  let q = supabase
    .from("follow_messages")
    .update({ status: "sending", attempt_count: attempt, claimed_at: nowIso })
    .eq("id", row.id)
    .eq("attempt_count", row.attempt_count || 0);
  if (row.status === "sending") {
    const staleBefore = new Date(Date.now() - STALE_SENDING_MS).toISOString();
    q = q.eq("status", "sending").lt("claimed_at", staleBefore);
  } else {
    q = q.eq("status", "scheduled");
  }
  const { data, error } = await q.select("id");
  if (error || !data || data.length === 0) return null;
  return { id: row.id, attempt };
}

/** 予約作成時に予定行が作れなかった LINE 予約（直近 BACKFILL_DAYS 日）に予定を作る */
async function backfillMissingRows(now: Date): Promise<number> {
  let created = 0;
  try {
    const since = new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: stores, error: storeErr } = await supabase
      .from("stores")
      .select("id,follow_base,follow_days_after,follow_time")
      .eq("follow_enabled", true);
    if (storeErr || !stores || stores.length === 0) return 0;
    const storeMap = new Map(stores.map((s) => [s.id, s]));

    const { data: recent, error: rsvErr } = await supabase
      .from("reservations")
      .select("id,store_id,line_user_id,customer_id,reservation_date,created_at,status")
      .in("store_id", [...storeMap.keys()])
      .gte("created_at", since)
      .neq("status", "cancelled")
      .not("line_user_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (rsvErr || !recent || recent.length === 0) return 0;

    const ids = recent.map((r) => r.id);
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data: rows } = await supabase.from("follow_messages").select("reservation_id").in("reservation_id", ids.slice(i, i + 500));
      (rows || []).forEach((r) => existing.add(r.reservation_id));
    }

    for (const r of recent) {
      if (existing.has(r.id) || !r.line_user_id) continue;
      const store = storeMap.get(r.store_id);
      if (!store) continue;
      const baseDate = resolveBaseDate(r, store.follow_base === "created_at" ? "created_at" : "reservation_date", now);
      if (!baseDate) continue;
      const scheduledAt = computeScheduledAt(baseDate, store.follow_days_after, store.follow_time);
      if (!scheduledAt || new Date(scheduledAt).getTime() <= now.getTime()) continue;
      const { error } = await supabase.rpc("follow_message_schedule", {
        p_store_id: r.store_id,
        p_reservation_id: r.id,
        p_line_user_id: r.line_user_id,
        p_customer_id: r.customer_id ?? null,
        p_base_date: baseDate,
        p_scheduled_at: scheduledAt,
      });
      if (error) console.error(`補完作成エラー: reservation=${r.id} ${error.message}`);
      else { created++; existing.add(r.id); }
    }
  } catch (e) {
    console.error("補完処理エラー:", e);
  }
  return created;
}

/** 期限到来分を 1 バッチ処理。処理した件数と集計を返す */
async function processBatch(now: Date, totals) {
  const nowIso = now.toISOString();
  const todayJst = toJstDateString(now);
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS).toISOString();

  // 1. 送信予定時刻を過ぎた未送信行（scheduled）+ 放置された sending
  const { data: due, error: dueError } = await supabase
    .from("follow_messages")
    .select("id,store_id,reservation_id,line_user_id,base_date,scheduled_at,attempt_count,status,claimed_at")
    .or(`status.eq.scheduled,and(status.eq.sending,claimed_at.lt.${staleBefore})`)
    .lte("scheduled_at", nowIso)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (dueError) throw new Error(`配信予定取得エラー: ${dueError.message}`);
  if (!due || due.length === 0) return 0;

  // 2. 店舗（フォロー設定 + リマインダー設定は読むだけ）
  const storeIds = [...new Set(due.map((r) => r.store_id))];
  const { data: stores, error: storeError } = await supabase
    .from("stores")
    .select("id,name,line_channel_access_token,follow_enabled,follow_template,reminder_enabled,reminder_days_before")
    .in("id", storeIds);
  if (storeError) throw new Error(`店舗取得エラー: ${storeError.message}`);
  const storeMap = new Map((stores || []).map((s) => [s.id, s]));

  // 3. フォロー元の予約（本文用・キャンセル確認）
  const { data: sourceReservations, error: srcError } = await supabase
    .from("reservations")
    .select("id,store_id,reservation_date,reservation_time,menu_name,submenu_name,customer_name,staff_name,status,line_user_id")
    .in("id", due.map((r) => r.reservation_id));
  if (srcError) throw new Error(`予約取得エラー: ${srcError.message}`);
  const sourceMap = new Map((sourceReservations || []).map((r) => [r.id, r]));

  // 4. 同じ顧客の他の予約（再予約・リマインダー同日の判定用）。基準日以降だけ取れば十分
  const lineUserIds = [...new Set(due.map((r) => r.line_user_id))];
  const minBaseDate = due.reduce((min, r) => (r.base_date < min ? r.base_date : min), due[0].base_date);
  const byUser = new Map<string, unknown[]>();
  for (let i = 0; i < lineUserIds.length; i += 200) {
    const { data: others, error: otherError } = await supabase
      .from("reservations")
      .select("id,store_id,line_user_id,reservation_date,status")
      .in("store_id", storeIds)
      .in("line_user_id", lineUserIds.slice(i, i + 200))
      .neq("status", "cancelled")
      .gte("reservation_date", minBaseDate)
      .limit(5000);
    if (otherError) throw new Error(`再予約確認エラー: ${otherError.message}`);
    (others || []).forEach((r) => {
      const key = `${r.store_id}:${r.line_user_id}`;
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(r);
    });
  }

  // 5. {LINE名} 用の表示名
  const lineNameMap = new Map<string, string>();
  try {
    for (let i = 0; i < lineUserIds.length; i += 500) {
      const { data: customers } = await supabase
        .from("customers")
        .select("store_id,line_user_id,line_display_name")
        .in("store_id", storeIds)
        .in("line_user_id", lineUserIds.slice(i, i + 500));
      (customers || []).forEach((c) => {
        if (c.line_user_id && c.line_display_name) lineNameMap.set(`${c.store_id}:${c.line_user_id}`, c.line_display_name);
      });
    }
  } catch (e) {
    console.error("顧客取得エラー（LINE名はお名前で代替）:", e);
  }

  let processed = 0;
  for (const row of due) {
    processed++;
    try {
      const store = storeMap.get(row.store_id);
      const source = sourceMap.get(row.reservation_id);
      const userKey = `${row.store_id}:${row.line_user_id}`;
      const userReservations = byUser.get(userKey) || [];

      // ---- 見送り判定（確保前。scheduled のときだけ更新される） ----
      if (!store || store.follow_enabled !== true) { await markSkipped(row.id, "store_disabled"); totals.skipped++; continue; }
      if (!store.line_channel_access_token) { await markSkipped(row.id, "no_token"); totals.skipped++; continue; }
      if (!source || source.status === "cancelled") { await markSkipped(row.id, "reservation_cancelled"); totals.skipped++; continue; }
      if (hasRebooking(userReservations, row.base_date, row.reservation_id)) { await markSkipped(row.id, "rebooked"); totals.skipped++; continue; }
      if (isReminderSameDay(store, userReservations, todayJst)) { await markSkipped(row.id, "reminder_same_day"); totals.skipped++; continue; }

      // ---- 行の確保（scheduled → sending） ----
      const claim = await claimRow(row, nowIso);
      if (!claim) { totals.busy++; continue; }

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
      const result = await sendLinePush(store.line_channel_access_token, row.line_user_id, flexMessage, toLineRetryKey(row.id));
      if (result.ok) {
        const { error } = await supabase
          .from("follow_messages")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
          .eq("id", row.id)
          .eq("status", "sending");
        if (error) console.error(`送信済み更新エラー: id=${row.id} ${error.message}`);
        console.log(`送信成功: follow=${row.id} reservation=${row.reservation_id}`);
        totals.sent++;
      } else {
        const lastError = `HTTP ${result.status}: ${result.body}`.slice(0, 500);
        const patch = claim.attempt >= MAX_ATTEMPTS
          ? { status: "failed", last_error: lastError, claimed_at: null }
          : { status: "scheduled", last_error: lastError, claimed_at: null }; // 次回に再試行
        const { error } = await supabase.from("follow_messages").update(patch).eq("id", row.id).eq("status", "sending");
        if (error) console.error(`失敗更新エラー: id=${row.id} ${error.message}`);
        console.error(`送信失敗(${claim.attempt}/${MAX_ATTEMPTS}): follow=${row.id} ${lastError}`);
        totals.failed++;
      }
    } catch (e) {
      // 1 件の異常で残りを止めない。確保済みなら失敗として記録（次回再試行 or failed）
      console.error(`行処理エラー: id=${row.id}`, e);
      try {
        const attempt = (row.attempt_count || 0) + 1;
        await supabase.from("follow_messages")
          .update({ status: attempt >= MAX_ATTEMPTS ? "failed" : "scheduled", last_error: String(e).slice(0, 500), claimed_at: null })
          .eq("id", row.id).eq("status", "sending");
      } catch { /* ignore */ }
      totals.failed++;
    }
  }
  return processed;
}

Deno.serve(async () => {
  const startedAt = Date.now();
  const now = new Date();
  console.log(`フォローメッセージ処理開始: now=${now.toISOString()} today(JST)=${toJstDateString(now)}`);

  const totals = { sent: 0, skipped: 0, failed: 0, busy: 0, backfilled: 0 };

  // 予約作成時に作れなかった予定の補完
  totals.backfilled = await backfillMissingRows(now);
  if (totals.backfilled > 0) console.log(`補完作成: ${totals.backfilled}件`);

  // 期限到来分をバッチで処理（時間の許す限り）
  try {
    let rounds = 0;
    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const before = totals.sent + totals.skipped + totals.failed;
      const processed = await processBatch(new Date(), totals);
      rounds++;
      if (processed < BATCH_LIMIT) break;
      // 1 件も進まなかった（すべて他の実行が処理中）ならこの回は終了
      if (totals.sent + totals.skipped + totals.failed === before) break;
      if (rounds >= 20) break;
    }
  } catch (e) {
    console.error(String(e));
    return json({ error: String(e), ...totals }, 500);
  }

  console.log(`処理結果: 送信=${totals.sent}件 見送り=${totals.skipped}件 失敗=${totals.failed}件 処理中=${totals.busy}件 補完=${totals.backfilled}件 (${Date.now() - startedAt}ms)`);
  return json(totals);
});
