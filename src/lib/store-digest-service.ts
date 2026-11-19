/**
 * 朝のまとめ・月次レポートのサーバー側（fs / Supabase に依存。クライアントから import しない）
 * 設計: docs/朝のまとめ・月次レポート_実装設計.md
 *
 * 起動は pg_cron `run_store_digest`（毎時 0 分。本番のみ登録）→ POST /api/cron/store-digest → runDueDigests。
 * 送る前に store_digest_logs の行（店舗 × 種類 × 対象日 / 月）を確保するので、回が重なっても二重に送らない
 */
import { sendEmail as defaultSendEmail } from '@/lib/email-sender';
import { pushLineMessages } from '@/lib/line-push';
import { payloadsHaveRecipientLinks } from '@/lib/broadcast-items';
import { computeBroadcastResult } from '@/lib/broadcast-results';
import { listBroadcasts, listResultRecipients, listResultReservations } from '@/lib/broadcast-repository';
import { listWaitlistForStore } from '@/lib/waitlist-repository';
import {
  DIGEST_STAFF_MAX,
  buildMonthlyReportLineMessage,
  buildMorningDigest,
  buildMorningDigestLineMessage,
  computeMonthlyReport,
  digestJstDate,
  generateStaffCode,
  isDigestTimeDue,
  isReportMonth,
  listReportMonths,
  monthlyReportTargetMonth,
  normalizeDigestSettings,
  parseStaffCommand,
  renderMonthlyReportEmail,
  renderMorningDigestEmail,
  validateDigestSettings,
  type DigestLineMessage,
  type DigestSettings,
  type MonthlyBroadcastSummary,
  type MonthlyReport,
  type MorningDigest,
} from '@/lib/store-digest';
import {
  claimDigestLog,
  deleteDigestStaff,
  finishDigestLog,
  getDigestSettingsRow,
  getDigestStore,
  listDigestCustomers,
  listDigestLogs,
  listDigestReservations,
  listDigestStaff,
  listEnabledDigestSettings,
  listPendingVisitNotes,
  listReportReservations,
  recordStaffCodeFailure,
  upsertDigestSettingsRow,
  upsertDigestStaff,
  type DigestKind,
  type DigestLogRow,
  type DigestStore,
} from '@/lib/store-digest-repository';

export type DigestResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** 送信の差し替え口（テスト用） */
export interface DigestSenders {
  sendEmail: (p: { to: string; subject: string; body: string; fromName?: string }) => Promise<{ ok: boolean; error?: string }>;
  pushLine: (token: string, to: string, messages: Array<Record<string, unknown>>) => Promise<{ ok: boolean; status: number; body: string }>;
}
const defaultSenders: DigestSenders = { sendEmail: defaultSendEmail, pushLine: (token, to, messages) => pushLineMessages(token, to, messages) };

/** 画面に返すスタッフ（LINE ユーザー ID は返さない） */
export interface DigestStaffView {
  id: string;
  display_name: string;
  created_at: string;
}

export interface DigestState {
  settings: DigestSettings;
  /** スタッフ登録の合言葉（null = 無効。「合言葉を出し直す」で作る） */
  staff_code: string | null;
  staff: DigestStaffView[];
  logs: DigestLogRow[];
}

// ---------------------------------------------------------------------------
// 設定・スタッフ
// ---------------------------------------------------------------------------

/** 設定画面の内容。合言葉がまだ無い店舗は、ここで作る */
export async function getDigestState(storeId: string): Promise<DigestState> {
  let row = await getDigestSettingsRow(storeId);
  if (!row) row = await upsertDigestSettingsRow(storeId, { staff_code: generateStaffCode(), code_failures: 0 });
  const [staff, logs] = await Promise.all([listDigestStaff(storeId), listDigestLogs(storeId, 10)]);
  return {
    settings: row.settings,
    staff_code: row.staff_code,
    staff: staff.map((s) => ({ id: s.id, display_name: s.display_name || 'LINE のスタッフ', created_at: s.created_at })),
    logs,
  };
}

export async function saveDigestSettings(storeId: string, raw: unknown): Promise<DigestResult<DigestSettings>> {
  const checked = validateDigestSettings(raw);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const row = await upsertDigestSettingsRow(storeId, { settings: checked.value });
  return { ok: true, value: row.settings };
}

/** 合言葉を出し直す（古い合言葉は使えなくなる。登録済みのスタッフはそのまま） */
export async function reissueStaffCode(storeId: string): Promise<string> {
  const current = (await getDigestSettingsRow(storeId))?.staff_code ?? null;
  let code = generateStaffCode();
  while (code === current) code = generateStaffCode();
  await upsertDigestSettingsRow(storeId, { staff_code: code, code_failures: 0 });
  return code;
}

export async function removeDigestStaff(storeId: string, staffId: string): Promise<boolean> {
  return (await deleteDigestStaff(storeId, { id: staffId })) > 0;
}

/**
 * 公式 LINE への発言がスタッフ登録の操作なら処理して、返信する文を返す（関係ない発言は null）。
 * 「スタッフ登録 4821」= 登録 / 「スタッフ登録解除」= 解除
 */
export async function handleStaffLineCommand(storeId: string, lineUserId: string, text: string, resolveDisplayName: () => Promise<string | null>): Promise<string | null> {
  const command = parseStaffCommand(text);
  if (!command) return null;
  if (command.type === 'unregister') {
    const removed = await deleteDigestStaff(storeId, { lineUserId });
    return removed > 0 ? 'スタッフの登録を解除しました。今後、予約のまとめ・レポートは届きません。' : 'スタッフとして登録されていません。';
  }
  if (!command.code) return 'スタッフ登録には合言葉が必要です。\n「スタッフ登録 1234」のように、管理画面に表示されている 4 桁の合言葉を付けて送ってください。';

  const row = await getDigestSettingsRow(storeId);
  if (!row || !row.staff_code) return 'スタッフ登録は現在受け付けていません。\n管理画面の「今日の予約まとめ・月次レポート」で合言葉を出し直してから、もう一度お試しください。';
  if (row.staff_code !== command.code) {
    const locked = await recordStaffCodeFailure(storeId);
    return locked ? '合言葉が違います。\n間違いが続いたため、合言葉を無効にしました。管理画面で合言葉を出し直してください。' : '合言葉が違います。\n管理画面に表示されている 4 桁の合言葉をご確認ください。';
  }
  const staff = await listDigestStaff(storeId);
  const already = staff.some((s) => s.line_user_id === lineUserId);
  if (!already && staff.length >= DIGEST_STAFF_MAX) return `登録できるスタッフは ${DIGEST_STAFF_MAX} 人までです。管理画面で不要な登録を解除してください。`;
  const displayName = await resolveDisplayName().catch(() => null);
  await upsertDigestStaff(storeId, lineUserId, displayName);
  if (row.code_failures > 0) await upsertDigestSettingsRow(storeId, { code_failures: 0 });
  return 'スタッフとして登録しました。\n「今日の予約まとめ」「月次レポート」を、この LINE にお届けします（管理画面で LINE への送信が ON のとき）。\n\n解除するには「スタッフ登録解除」と送ってください。';
}

// ---------------------------------------------------------------------------
// まとめ・レポートを作る
// ---------------------------------------------------------------------------

export async function buildMorningDigestForStore(store: DigestStore, date: string): Promise<MorningDigest> {
  const reservations = await listDigestReservations(store.id, date);
  const active = reservations.filter((r) => r.status !== 'cancelled');
  const uniq = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v))];
  const customers = await listDigestCustomers(store.id, uniq(active.map((r) => r.customer_id)), uniq(active.map((r) => r.line_user_id)));
  const [notes, waitlist] = await Promise.all([
    listPendingVisitNotes(store.id, customers.map((c) => c.id)).catch(() => ({})),
    listWaitlistForStore(store.id, { statuses: ['waiting', 'notified'], limit: 1000 }).catch(() => []),
  ]);
  return buildMorningDigest({ date, storeName: store.name, reservations, customers, notes, waitlistCount: waitlist.filter((e) => e.reservation_date === date).length });
}

/** その月に送った配信の成果（送信後 7 日以内）。配信が無い / 取得できないときは null */
async function monthlyBroadcastSummary(storeId: string, month: string, now: Date): Promise<MonthlyBroadcastSummary | null> {
  try {
    const sentTime = (b: { started_at: string | null; scheduled_at: string | null; finished_at: string | null; created_at: string }) => b.started_at ?? b.scheduled_at ?? b.finished_at ?? b.created_at;
    const targets = (await listBroadcasts(storeId)).filter((b) => (b.status === 'sent' || b.status === 'sending' || b.status === 'failed') && digestJstDate(new Date(sentTime(b))).slice(0, 7) === month);
    if (targets.length === 0) return null;
    const since = targets.map(sentTime).sort()[0];
    const [recipients, reservations] = await Promise.all([listResultRecipients(targets.map((b) => b.id)), listResultReservations(storeId, since)]);
    const summary: MonthlyBroadcastSummary = { count: 0, sent: 0, tapped_reservations: 0, tapped_revenue: 0, received_reservations: 0, received_revenue: 0 };
    for (const b of targets) {
      const result = computeBroadcastResult(
        recipients.filter((r) => r.broadcast_id === b.id),
        reservations,
        { days: 7, tracked: b.track_taps && payloadsHaveRecipientLinks(b.payloads), now }
      );
      if (result.sent === 0) continue;
      summary.count += 1;
      summary.sent += result.sent;
      summary.tapped_reservations += result.tapped.reservations;
      summary.tapped_revenue += result.tapped.revenue;
      summary.received_reservations += result.received.reservations;
      summary.received_revenue += result.received.revenue;
    }
    return summary.count > 0 ? summary : null;
  } catch (e) {
    console.warn('[store-digest] 配信の成果を取得できませんでした:', e);
    return null;
  }
}

export async function buildMonthlyReportForStore(storeId: string, month: string, now: Date = new Date()): Promise<MonthlyReport> {
  const [all, broadcasts] = await Promise.all([listReportReservations(storeId), monthlyBroadcastSummary(storeId, month, now)]);
  return computeMonthlyReport(all, month, broadcasts);
}

/** 月次レポートのページ（month が無い / 不正なら先月。先月に予約が無ければ今月） */
export async function getMonthlyReportPage(storeId: string, rawMonth: unknown, now: Date = new Date()): Promise<{ months: string[]; report: MonthlyReport; current_month: string }> {
  const all = await listReportReservations(storeId);
  const months = listReportMonths(all, now);
  const month = isReportMonth(rawMonth) && months.includes(rawMonth) ? rawMonth : (months[1] ?? months[0]);
  return { months, report: computeMonthlyReport(all, month, await monthlyBroadcastSummary(storeId, month, now)), current_month: months[0] };
}

// ---------------------------------------------------------------------------
// 送る
// ---------------------------------------------------------------------------

export interface DigestDelivery {
  email_sent: number;
  line_sent: number;
  failed_count: number;
  detail: string | null;
}

async function deliver(store: DigestStore, settings: DigestSettings, mail: { subject: string; body: string }, line: DigestLineMessage, senders: DigestSenders): Promise<DigestDelivery> {
  const out: DigestDelivery = { email_sent: 0, line_sent: 0, failed_count: 0, detail: null };
  const problems: string[] = [];
  if (settings.channels.email) {
    for (const to of settings.emails) {
      const r = await senders.sendEmail({ to, subject: mail.subject, body: mail.body, fromName: store.name }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      if (r.ok) out.email_sent += 1;
      else {
        out.failed_count += 1;
        problems.push(`メール: ${r.error || '送信できませんでした'}`);
      }
    }
  }
  if (settings.channels.line) {
    const staff = await listDigestStaff(store.id);
    if (!store.line_channel_access_token) problems.push('LINE: チャネルアクセストークンが未設定です');
    else if (staff.length === 0) problems.push('LINE: 登録済みのスタッフがいません');
    else {
      for (const s of staff) {
        const r = await senders.pushLine(store.line_channel_access_token, s.line_user_id, [line as unknown as Record<string, unknown>]);
        if (r.ok) out.line_sent += 1;
        else {
          out.failed_count += 1;
          problems.push(`LINE（${s.display_name || 'スタッフ'}）: 送信できませんでした${r.status ? `（${r.status}）` : ''}`);
        }
      }
    }
  }
  out.detail = problems.length > 0 ? [...new Set(problems)].join(' / ').slice(0, 500) : null;
  return out;
}

const reservationsUrl = (origin: string, storeId: string) => `${origin}/${storeId}/admin?tab=reservations`;
const reportUrl = (origin: string, storeId: string, month: string) => `${origin}/${storeId}/admin?tab=dashboard&report=${month}`;

async function deliverMorning(store: DigestStore, settings: DigestSettings, digest: MorningDigest, origin: string, senders: DigestSenders): Promise<DigestDelivery> {
  const url = reservationsUrl(origin, store.id);
  return deliver(store, settings, renderMorningDigestEmail(digest, url), buildMorningDigestLineMessage(digest, url), senders);
}

async function deliverMonthly(store: DigestStore, settings: DigestSettings, report: MonthlyReport, origin: string, senders: DigestSenders): Promise<DigestDelivery> {
  const url = reportUrl(origin, store.id, report.month);
  return deliver(store, settings, renderMonthlyReportEmail(report, store.name, url), buildMonthlyReportLineMessage(report, store.name, url), senders);
}

const statusOf = (d: DigestDelivery): 'sent' | 'failed' => (d.email_sent + d.line_sent > 0 ? 'sent' : 'failed');

export interface DigestRunSummary {
  /** 送る時刻になっていた店舗の数 */
  checked: number;
  morning: number;
  monthly: number;
  /** 予約が 0 件で送らなかった朝のまとめ */
  skipped: number;
  failed: number;
  /** 時間切れで次の回に回した店舗の数 */
  deferred: number;
}

/**
 * 送る時刻になった店舗へ、朝のまとめ（今日ぶん）と月次レポート（1〜3 日に前月ぶん）を送る。
 * どちらも 店舗 × 対象日 / 月 で 1 回だけ。予約が 0 件の日の朝のまとめは送らない
 */
export async function runDueDigests(now: Date, origin: string, deadlineMs: number, opts: { storeId?: string } = {}, senders: DigestSenders = defaultSenders): Promise<DigestRunSummary> {
  const summary: DigestRunSummary = { checked: 0, morning: 0, monthly: 0, skipped: 0, failed: 0, deferred: 0 };
  const today = digestJstDate(now);
  const reportMonth = monthlyReportTargetMonth(now);
  const rows = (await listEnabledDigestSettings(opts.storeId)).filter((r) => isDigestTimeDue(r.settings.morning.time, now));

  for (const row of rows) {
    if (Date.now() > deadlineMs) {
      summary.deferred += 1;
      continue;
    }
    summary.checked += 1;
    const { settings } = row;
    try {
      const jobs: Array<{ kind: DigestKind; key: string }> = [];
      if (settings.morning.enabled) jobs.push({ kind: 'morning', key: today });
      if (settings.monthly.enabled && reportMonth) jobs.push({ kind: 'monthly', key: reportMonth });
      let store: DigestStore | null | undefined;
      for (const job of jobs) {
        const logId = await claimDigestLog(row.store_id, job.kind, job.key);
        if (!logId) continue;
        if (store === undefined) store = await getDigestStore(row.store_id);
        if (!store) {
          await finishDigestLog(logId, { status: 'failed', email_sent: 0, line_sent: 0, failed_count: 0, detail: '店舗が見つかりません' });
          summary.failed += 1;
          continue;
        }
        try {
          let delivery: DigestDelivery;
          if (job.kind === 'morning') {
            const digest = await buildMorningDigestForStore(store, job.key);
            if (digest.count === 0) {
              await finishDigestLog(logId, { status: 'skipped', email_sent: 0, line_sent: 0, failed_count: 0, detail: '予約が 0 件のため送っていません' });
              summary.skipped += 1;
              continue;
            }
            delivery = await deliverMorning(store, settings, digest, origin, senders);
          } else {
            delivery = await deliverMonthly(store, settings, await buildMonthlyReportForStore(store.id, job.key, now), origin, senders);
          }
          const status = statusOf(delivery);
          await finishDigestLog(logId, { status, ...delivery });
          if (status === 'sent') summary[job.kind] += 1;
          else summary.failed += 1;
        } catch (e) {
          console.error(`[store-digest] ${job.kind} の送信に失敗 store=${row.store_id}:`, e);
          await finishDigestLog(logId, { status: 'failed', email_sent: 0, line_sent: 0, failed_count: 0, detail: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
          summary.failed += 1;
        }
      }
    } catch (e) {
      console.error(`[store-digest] 店舗の処理に失敗 store=${row.store_id}:`, e);
      summary.failed += 1;
    }
  }
  return summary;
}

/** テスト送信（保存済みの送り先へ、いまの内容を送る。記録には残さない。月次は先月ぶん） */
export async function sendDigestTest(storeId: string, kind: DigestKind, origin: string, now: Date = new Date(), senders: DigestSenders = defaultSenders): Promise<DigestResult<DigestDelivery>> {
  const [row, store] = await Promise.all([getDigestSettingsRow(storeId), getDigestStore(storeId)]);
  if (!store) return { ok: false, status: 404, error: '店舗が見つかりません' };
  const settings = normalizeDigestSettings(row?.settings);
  if (!settings.channels.email && !settings.channels.line) return { ok: false, status: 400, error: '送り先（メール / LINE）を選んで保存してから、テスト送信してください' };
  const delivery =
    kind === 'morning'
      ? await deliverMorning(store, settings, await buildMorningDigestForStore(store, digestJstDate(now)), origin, senders)
      : await deliverMonthly(store, settings, (await getMonthlyReportPage(storeId, null, now)).report, origin, senders);
  if (delivery.email_sent + delivery.line_sent === 0) return { ok: false, status: 400, error: delivery.detail || '送信できませんでした。送り先をご確認ください' };
  return { ok: true, value: delivery };
}
