// @ts-nocheck
/**
 * 配信の送信（Edge Function）
 *
 * pg_cron（5 分おき）と、管理画面の「今すぐ送る」から起動され、broadcasts のうち
 * status = scheduled / sending で scheduled_at <= 今 のものを送る。
 * 仕様: docs/LINE配信機能_仕様書.md §7
 *
 * - 配信の確保: status を sending・claimed_at = 今 に条件付き UPDATE（claimed_at が NULL か 10 分以上前のものだけ）。
 *   同時に 2 つ動いても同じ配信を二重に処理しない。時間切れのときは claimed_at を NULL に戻して次の回がすぐ続きを送る
 * - 宛先は broadcast_recipients（予約時に確定済み）の pending を 500 人ずつ処理し、結果を 1 人ずつ記録する。
 *   途中で止まっても pending だけを続きから送る
 * - 差し込み無し: multicast（1 リクエスト 500 人まで）。X-Line-Retry-Key = そのバッチの先頭の宛先行 ID（UUID）。
 *   LINE が受け付けたあと記録前に落ちても、同じ並びで再送されるので LINE 側が 409 で重複を止める（409 は送信済みとして扱う）
 * - 差し込みあり（{name}）: 1 人ずつ push（X-Line-Retry-Key = 宛先行 ID）。10 件ずつ並列
 * - 401 / 403（トークン無効）は配信全体を failed。429 / 5xx / 通信エラーは pending のまま次の回に回す
 *   （開始から 6 時間たっても終わらなければ残りを failed にして打ち切る）
 * - payloads は保存時にサーバーで組み立て済み。ここでは {name} の置き換えだけを行う
 *   （src/lib/broadcast-items.ts の personalizePayloads と同じ規則。変更時は両方を合わせること）
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TIME_BUDGET_MS = 50 * 1000;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const GIVE_UP_MS = 6 * 60 * 60 * 1000;
const LINE_TIMEOUT_MS = 10 * 1000;
const MULTICAST_MAX = 500;
const PUSH_CONCURRENCY = 10;
const BROADCAST_LIMIT = 20;
const NAME_TOKEN = "{name}";
const NAME_FALLBACK = "お客様";
const TEXT_MAX = 5000;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

async function callLine(path: "push" | "multicast", accessToken: string, body: Record<string, unknown>, retryKey: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization: `Bearer ${accessToken}`,
    };
    if (retryKey) headers["X-Line-Retry-Key"] = retryKey;
    const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** LINE の応答の分類: sent = 送れた（409 = 同じ Retry-Key で受付済み）/ auth = トークン無効 / retry = あとで再試行 / reject = この宛先・内容では送れない */
function classify(res: { ok: boolean; status: number }): "sent" | "auth" | "retry" | "reject" {
  if (res.ok || res.status === 409) return "sent";
  if (res.status === 401 || res.status === 403) return "auth";
  if (res.status === 0 || res.status === 429 || res.status >= 500) return "retry";
  return "reject";
}

function personalize(payloads: Record<string, unknown>[], name: string | null) {
  const n = (name || "").trim() || NAME_FALLBACK;
  return payloads.map((p) => (p.type === "text" && typeof p.text === "string" ? { ...p, text: p.text.split(NAME_TOKEN).join(n).slice(0, TEXT_MAX) } : p));
}

async function markRecipients(ids: string[], patch: Record<string, unknown>) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("broadcast_recipients").update(patch).in("id", ids.slice(i, i + 200));
    if (error) console.error("宛先の更新エラー:", error.message);
  }
}

async function countRecipients(broadcastId: string, status: string): Promise<number> {
  const { count } = await supabase.from("broadcast_recipients").select("id", { count: "exact", head: true }).eq("broadcast_id", broadcastId).eq("status", status);
  return count ?? 0;
}

/** 件数を集計して配信を締める（pending が残っていなければ sent / failed） */
async function finalize(broadcastId: string, opts: { error?: string | null; forceFailed?: boolean } = {}) {
  const [sent, failed, pending] = await Promise.all([countRecipients(broadcastId, "sent"), countRecipients(broadcastId, "failed"), countRecipients(broadcastId, "pending")]);
  const done = pending === 0;
  const patch: Record<string, unknown> = { sent_count: sent, failed_count: failed, claimed_at: null, updated_at: new Date().toISOString() };
  if (opts.error !== undefined) patch.error = opts.error;
  if (opts.forceFailed) {
    patch.status = "failed";
    patch.finished_at = new Date().toISOString();
  } else if (done) {
    patch.status = sent === 0 && failed > 0 ? "failed" : "sent";
    patch.finished_at = new Date().toISOString();
  }
  const { error } = await supabase.from("broadcasts").update(patch).eq("id", broadcastId);
  if (error) console.error("配信の更新エラー:", error.message);
  return { sent, failed, pending, done };
}

/** 1 つの配信を、時間の許す限り送る。戻り値 = この回で送れた / 失敗した人数 */
async function processBroadcast(b, token: string, deadline: number, totals) {
  const payloads: Record<string, unknown>[] = Array.isArray(b.payloads) ? b.payloads.slice(0, 5) : [];
  if (payloads.length === 0) {
    await markRecipients((await pendingBatch(b.id, 100000)).map((r) => r.id), { status: "failed", error: "メッセージが空です" });
    await finalize(b.id, { error: "メッセージが空のため送信できませんでした", forceFailed: true });
    return;
  }

  while (Date.now() < deadline) {
    const batch = await pendingBatch(b.id, MULTICAST_MAX);
    if (batch.length === 0) break;
    const nowIso = new Date().toISOString();

    if (!b.has_personalization) {
      // 全員同じ内容 → multicast。Retry-Key はバッチ先頭の行 ID（同じ並びの再送を LINE 側で止める）
      const res = await callLine("multicast", token, { to: batch.map((r) => r.line_user_id), messages: payloads }, batch[0].id);
      const kind = classify(res);
      if (kind === "sent") {
        await markRecipients(batch.map((r) => r.id), { status: "sent", sent_at: nowIso, error: null });
        totals.sent += batch.length;
        continue;
      }
      if (kind === "auth") {
        await finalize(b.id, { error: `LINE のチャネルアクセストークンが無効です（${res.status}）。店舗編集で設定を確認してください`, forceFailed: true });
        totals.failed += batch.length;
        return;
      }
      if (kind === "retry") {
        console.warn(`配信 ${b.id}: multicast 再試行待ち (${res.status}) ${res.body.slice(0, 200)}`);
        await supabase.from("broadcasts").update({ error: `一時的に送信できませんでした（${res.status || "通信エラー"}）。自動で再試行します` }).eq("id", b.id);
        break;
      }
      // reject（400 など）: 宛先のどれかが原因のことがあるので、このバッチは 1 人ずつ送って切り分ける
      console.warn(`配信 ${b.id}: multicast 拒否 (${res.status}) → 1 人ずつ送信 ${res.body.slice(0, 200)}`);
      const r = await pushEach(b, token, batch, payloads, false, totals);
      if (r !== "ok") return;
      continue;
    }

    const r = await pushEach(b, token, batch, payloads, true, totals);
    if (r !== "ok") return;
  }
}

/**
 * 1 人ずつ push（PUSH_CONCURRENCY 件ずつ並列）。
 * 戻り値: ok = 続けてよい / abort = 配信全体を打ち切った（トークン無効）/ pause = 一時的に送れない人がいるので、この回はここまで（残りは次の回）
 */
async function pushEach(b, token: string, batch, payloads, withName: boolean, totals): Promise<"ok" | "abort" | "pause"> {
  for (let i = 0; i < batch.length; i += PUSH_CONCURRENCY) {
    const group = batch.slice(i, i + PUSH_CONCURRENCY);
    const results = await Promise.all(
      group.map(async (r) => {
        const messages = withName ? personalize(payloads, r.display_name) : payloads;
        const res = await callLine("push", token, { to: r.line_user_id, messages }, r.id);
        return { r, res, kind: classify(res) };
      })
    );
    const nowIso = new Date().toISOString();
    const sentIds = results.filter((x) => x.kind === "sent").map((x) => x.r.id);
    if (sentIds.length > 0) {
      await markRecipients(sentIds, { status: "sent", sent_at: nowIso, error: null });
      totals.sent += sentIds.length;
    }
    for (const x of results.filter((y) => y.kind === "reject")) {
      await markRecipients([x.r.id], { status: "failed", error: `LINE エラー ${x.res.status}: ${x.res.body.slice(0, 200)}` });
      totals.failed += 1;
    }
    if (results.some((x) => x.kind === "auth")) {
      const st = results.find((x) => x.kind === "auth").res.status;
      await finalize(b.id, { error: `LINE のチャネルアクセストークンが無効です（${st}）。店舗編集で設定を確認してください`, forceFailed: true });
      return "abort";
    }
    // retry（429 / 5xx / 通信エラー）の人は pending のまま。同じ人に続けて送り直さないよう、この配信はこの回ここまで
    const retry = results.find((x) => x.kind === "retry");
    if (retry) {
      console.warn(`配信 ${b.id}: push 再試行待ち (${retry.res.status}) ${retry.res.body.slice(0, 200)}`);
      await supabase.from("broadcasts").update({ error: `一時的に送信できませんでした（${retry.res.status || "通信エラー"}）。自動で再試行します` }).eq("id", b.id);
      return "pause";
    }
  }
  return "ok";
}

async function pendingBatch(broadcastId: string, limit: number) {
  const { data, error } = await supabase
    .from("broadcast_recipients")
    .select("id,line_user_id,display_name")
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending")
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`宛先取得エラー: ${error.message}`);
  return data || [];
}

Deno.serve(async () => {
  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const totals = { broadcasts: 0, sent: 0, failed: 0, busy: 0 };

  try {
    // 1. 送信時刻を過ぎた配信（予約済み + 送信途中のもの）
    const { data: due, error: dueError } = await supabase
      .from("broadcasts")
      .select("id,store_id,status,payloads,has_personalization,started_at,claimed_at")
      .in("status", ["scheduled", "sending"])
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(BROADCAST_LIMIT);
    if (dueError) throw new Error(`配信取得エラー: ${dueError.message}`);
    if (!due || due.length === 0) return json({ ...totals, message: "対象なし" });

    const storeIds = [...new Set(due.map((b) => b.store_id))];
    const { data: stores, error: storeError } = await supabase.from("stores").select("id,line_channel_access_token").in("id", storeIds);
    if (storeError) throw new Error(`店舗取得エラー: ${storeError.message}`);
    const tokenMap = new Map((stores || []).map((s) => [s.id, typeof s.line_channel_access_token === "string" ? s.line_channel_access_token.trim() : ""]));

    for (const b of due) {
      if (Date.now() >= deadline) break;

      // 2. 確保（他の実行が処理中なら飛ばす）
      const { data: claimed, error: claimError } = await supabase
        .from("broadcasts")
        .update({ status: "sending", claimed_at: new Date().toISOString(), started_at: b.started_at ?? new Date().toISOString() })
        .eq("id", b.id)
        .in("status", ["scheduled", "sending"])
        .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
        .select("id");
      if (claimError) {
        console.error(`配信 ${b.id}: 確保エラー ${claimError.message}`);
        continue;
      }
      if (!claimed || claimed.length === 0) {
        totals.busy++;
        continue;
      }
      totals.broadcasts++;

      try {
        const token = tokenMap.get(b.store_id) || "";
        if (!token) {
          await finalize(b.id, { error: "店舗の LINE チャネルアクセストークンが未設定のため送信できませんでした", forceFailed: true });
          continue;
        }
        // 開始から長時間たっても終わらない配信は、残りを失敗にして打ち切る
        if (b.started_at && now.getTime() - Date.parse(b.started_at) > GIVE_UP_MS) {
          const rest = await pendingBatch(b.id, 100000);
          await markRecipients(rest.map((r) => r.id), { status: "failed", error: "時間内に送信できませんでした" });
          totals.failed += rest.length;
          await finalize(b.id, { error: "一部の宛先に時間内に送信できませんでした" });
          continue;
        }

        await processBroadcast(b, token, deadline, totals);
        // processBroadcast が打ち切った（failed）場合は finalize 済み。それ以外は集計して、残りがあれば次の回へ
        const { data: cur } = await supabase.from("broadcasts").select("status").eq("id", b.id).maybeSingle();
        if (cur?.status === "sending") {
          const r = await finalize(b.id);
          if (r.done) await supabase.from("broadcasts").update({ error: null }).eq("id", b.id).eq("status", "sent");
        }
      } catch (e) {
        console.error(`配信 ${b.id}: 処理エラー ${String(e)}`);
        // 確保を外して次の回に任せる
        await supabase.from("broadcasts").update({ claimed_at: null }).eq("id", b.id).eq("status", "sending");
      }
    }
  } catch (e) {
    console.error(String(e));
    return json({ error: String(e), ...totals }, 500);
  }

  console.log(`配信処理: 配信=${totals.broadcasts}件 送信=${totals.sent}人 失敗=${totals.failed}人 処理中=${totals.busy}件 (${Date.now() - startedAt}ms)`);
  return json(totals);
});
