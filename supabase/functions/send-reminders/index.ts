// @ts-nocheck
/**
 * 予約リマインダー送信（Edge Function）
 *
 * pg_cron（毎時 0 分）から起動される。監査対応: docs/リマインダー・フォローメッセージ_送信動作監査レポート_完全版.md（修正パッケージ A）
 *
 * 動作:
 *   1. reminder_enabled = true でトークンが空でない店舗を取得
 *   2. 店舗ごとに「現在時刻(JST) >= reminder_time」なら対象。対象日 = 今日(JST) + reminder_days_before
 *      （完全一致ではなく「以降」にしているので、cron が 1 回止まっても同じ日のうちなら次の回で回収できる。
 *        日付が変わると対象日も変わるため、前日分を翌日に送ることはない）
 *   3. 対象日の予約（キャンセル以外・line_user_id あり）を取得
 *   4. reminder_logs に (reservation_id, target_date) で行を確保（sending）してから送信 → sent / failed
 *      - 既に sent / skipped の予約は送らない（二重送信防止）
 *      - failed は 3 回まで再試行。sending のまま 10 分以上経った行（前回の異常終了）は再確保できる
 *      - X-Line-Retry-Key に reminder_logs.id（UUID）を付け、LINE 側でも重複を防ぐ
 *   5. 1 件ごとに try/catch + 10 秒タイムアウト。1 件の通信失敗で残りを止めない
 *
 * ※ 文面テンプレートは src/lib/reminder-template.ts と同じロジック。変更時は両方を合わせること
 * ※ 判定ロジックは src/lib/follow-message-scheduler.ts（isReminderTimeReached / reminderTargetDate）と同じ
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MAX_ATTEMPTS = 3;
const PAGE_SIZE = 1000;
const STALE_SENDING_MS = 10 * 60 * 1000;
const LINE_TIMEOUT_MS = 10 * 1000;

// ===== 日付ユーティリティ（JST） =====
function jstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function getTodayJst(): string {
  const d = jstNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function getCurrentHHMMJst(): string {
  const d = jstNow();
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
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

// ===== 設定の正規化・判定（src/lib/follow-message-scheduler.ts と同じ） =====
function normalizeReminderTime(v: unknown): string {
  return typeof v === "string" && /^([01]\d|2[0-3]):00$/.test(v) ? v : "19:00";
}
function normalizeDaysBefore(value: unknown): number {
  const n = typeof value === "number" && isFinite(value) ? Math.floor(value) : 1;
  return n >= 1 && n <= 30 ? n : 1;
}
function isReminderTimeReached(reminderTime: unknown, currentHHMM: string): boolean {
  return currentHHMM >= normalizeReminderTime(reminderTime);
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

/** ページングして全件取得（PostgREST の既定上限 1000 行を超えても取り逃さない） */
async function fetchAll(buildQuery: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * reminder_logs の行を確保する。確保できたら行 id（= リトライキー）を返し、送らない場合は null。
 * - 行が無い: sending で INSERT（一意制約の競合 = 他の実行が確保済み → null）
 * - failed かつ attempt < MAX: 条件付き UPDATE で sending に（競合時は null）
 * - sending が STALE 以上前: 前回の異常終了とみなし再確保
 * - sent / skipped / 試行上限: null
 */
async function claimReminderLog(row, nowIso: string): Promise<{ id: string; attempt: number } | null> {
  const { data: existing, error } = await supabase
    .from("reminder_logs")
    .select("id,status,attempt_count,claimed_at")
    .eq("reservation_id", row.reservation_id)
    .eq("target_date", row.target_date)
    .maybeSingle();
  if (error) { console.error(`記録取得エラー: ${error.message}`); return null; }

  if (!existing) {
    const { data: inserted, error: insErr } = await supabase
      .from("reminder_logs")
      .insert({
        store_id: row.store_id,
        reservation_id: row.reservation_id,
        target_date: row.target_date,
        line_user_id: row.line_user_id,
        status: "sending",
        attempt_count: 1,
        claimed_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    if (insErr) {
      // 23505 = 一意制約違反（同時実行が先に確保）
      if (insErr.code !== "23505") console.error(`記録作成エラー: ${insErr.message}`);
      return null;
    }
    return inserted ? { id: inserted.id, attempt: 1 } : null;
  }

  if (existing.status === "sent" || existing.status === "skipped") return null;
  const attempts = existing.attempt_count || 0;
  if (existing.status === "failed" && attempts >= MAX_ATTEMPTS) return null;
  if (existing.status === "sending") {
    const claimedAt = existing.claimed_at ? new Date(existing.claimed_at).getTime() : 0;
    if (Date.now() - claimedAt < STALE_SENDING_MS) return null; // 他の実行が処理中
  }
  const { data: claimed, error: updErr } = await supabase
    .from("reminder_logs")
    .update({ status: "sending", attempt_count: attempts + 1, claimed_at: nowIso })
    .eq("id", existing.id)
    .eq("status", existing.status)
    .eq("attempt_count", attempts)
    .select("id");
  if (updErr || !claimed || claimed.length === 0) return null;
  return { id: existing.id, attempt: attempts + 1 };
}

Deno.serve(async () => {
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const todayJst = getTodayJst();
  const currentHHMM = getCurrentHHMMJst();
  console.log(`リマインダー処理開始: today(JST)=${todayJst} now(JST)=${currentHHMM}`);

  // 1. リマインダー有効 & トークンあり の店舗
  let stores;
  try {
    stores = await fetchAll((from, to) =>
      supabase
        .from("stores")
        .select("id,name,line_channel_access_token,reminder_time,reminder_days_before,reminder_template")
        .eq("reminder_enabled", true)
        .not("line_channel_access_token", "is", null)
        .neq("line_channel_access_token", "")
        .order("id")
        .range(from, to)
    );
  } catch (e) {
    console.error("店舗取得エラー:", e);
    return json({ error: "店舗取得に失敗しました" }, 500);
  }

  // 2. 送信時刻に達している店舗だけ対象。店舗ごとの対象日を決める
  const targetDateByStore = new Map<string, string>();
  const storeMap = new Map();
  for (const s of stores) {
    if (!isReminderTimeReached(s.reminder_time, currentHHMM)) continue;
    const daysBefore = normalizeDaysBefore(s.reminder_days_before);
    targetDateByStore.set(s.id, addDays(todayJst, daysBefore));
    storeMap.set(s.id, { token: s.line_channel_access_token, name: s.name || "店舗", daysBefore, template: s.reminder_template || null });
  }
  if (storeMap.size === 0) {
    console.log("送信時刻に達している店舗がありません");
    return json({ sent: 0, already: 0, skipped: 0, failed: 0 });
  }
  const storeIds = [...storeMap.keys()];
  const targetDates = [...new Set(targetDateByStore.values())];
  console.log(`対象店舗数: ${storeIds.length}件 / 対象日: ${targetDates.join(", ")}`);

  // 3. 対象日の予約
  let reservations;
  try {
    reservations = await fetchAll((from, to) =>
      supabase
        .from("reservations")
        .select("id,store_id,reservation_date,reservation_time,menu_name,submenu_name,line_user_id,status,customer_name,staff_name")
        .in("reservation_date", targetDates)
        .in("store_id", storeIds)
        .neq("status", "cancelled")
        .not("line_user_id", "is", null)
        .order("id")
        .range(from, to)
    );
  } catch (e) {
    console.error("予約取得エラー:", e);
    return json({ error: "予約取得に失敗しました" }, 500);
  }
  // 店舗ごとの対象日と一致するものだけ（店舗ごとに「何日前」が違うため）
  reservations = reservations.filter((r) => r.line_user_id && r.reservation_date === targetDateByStore.get(r.store_id));
  if (reservations.length === 0) {
    console.log("対象の予約がありません");
    return json({ sent: 0, already: 0, skipped: 0, failed: 0 });
  }
  console.log(`対象予約数: ${reservations.length}件`);

  // 4. {LINE名} 差し込み用の表示名
  const lineNameMap = new Map<string, string>();
  try {
    const lineUserIds = [...new Set(reservations.map((r) => r.line_user_id))];
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

  // 5. 送信済み・見送り済みをまとめて除外（毎時の起動で同じ予約を何度も確保しに行かない）
  const doneKeys = new Set<string>();
  try {
    const ids = reservations.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      const { data: logs } = await supabase
        .from("reminder_logs")
        .select("reservation_id,target_date,status,attempt_count")
        .in("reservation_id", ids.slice(i, i + 500))
        .in("target_date", targetDates);
      (logs || []).forEach((l) => {
        if (l.status === "sent" || l.status === "skipped" || (l.status === "failed" && (l.attempt_count || 0) >= MAX_ATTEMPTS)) {
          doneKeys.add(`${l.reservation_id}:${l.target_date}`);
        }
      });
    }
  } catch (e) {
    console.error("送信記録の取得エラー（個別確保で続行）:", e);
  }

  // 6. 送信
  let sent = 0, skipped = 0, failed = 0, already = 0;
  for (const reservation of reservations) {
    try {
      const storeInfo = storeMap.get(reservation.store_id);
      if (!storeInfo) continue;
      if (doneKeys.has(`${reservation.id}:${reservation.reservation_date}`)) { already++; continue; }

      const claim = await claimReminderLog(
        { store_id: reservation.store_id, reservation_id: reservation.id, target_date: reservation.reservation_date, line_user_id: reservation.line_user_id },
        nowIso
      );
      if (!claim) { skipped++; continue; } // 送信済み / 他の実行が処理中 / 試行上限

      const menu = reservation.submenu_name ? `${reservation.menu_name} > ${reservation.submenu_name}` : reservation.menu_name || "未設定";
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

      const result = await sendLinePush(storeInfo.token, reservation.line_user_id, flexMessage, claim.id);
      if (result.ok) {
        const { error } = await supabase.from("reminder_logs")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
          .eq("id", claim.id);
        if (error) console.error(`送信済み更新エラー: id=${claim.id} ${error.message}`);
        console.log(`送信成功: reservation=${reservation.id}`);
        sent++;
      } else {
        const lastError = `HTTP ${result.status}: ${result.body}`.slice(0, 500);
        const { error } = await supabase.from("reminder_logs")
          .update({ status: "failed", last_error: lastError })
          .eq("id", claim.id);
        if (error) console.error(`失敗更新エラー: id=${claim.id} ${error.message}`);
        console.error(`送信失敗(${claim.attempt}/${MAX_ATTEMPTS}): reservation=${reservation.id} ${lastError}`);
        failed++;
      }
    } catch (e) {
      // 1 件の異常で残りを止めない
      console.error(`予約処理エラー: reservation=${reservation.id}`, e);
      failed++;
    }
  }

  console.log(`送信結果: 成功=${sent}件 送信済み=${already}件 見送り=${skipped}件 失敗=${failed}件 (${Date.now() - startedAt}ms)`);
  return json({ sent, already, skipped, failed });
});
