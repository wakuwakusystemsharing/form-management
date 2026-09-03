/**
 * 後日抽選のサービス（サーバー専用）
 *
 * 流れ: 応募受付（entered）→ 抽選実行（provisional = 仮当選）→ 手動修正 → 確定（drawn / lost）→ 当選者へ Bot push
 * - 自動抽選は lottery-engine の drawDeferredWinners（Fisher–Yates）で賞品ごとの当選数だけ選ぶ
 * - 確定前なら何度でも引き直し・入れ替えができる。確定後は変更不可（引換取り消しのみ）
 */
import {
  computeExpiresAt,
  drawDeferredWinners,
  generateQrToken,
  generateRedeemCode,
  getPeriodState,
  secureRandomUnit,
} from '@/lib/lottery-engine';
import { buildLotteryWinFlex } from '@/lib/lottery-line-message';
import { pushLineMessages } from '@/lib/line-push';
import { buildQrImageUrl } from '@/lib/lottery-qr';
import { listEntriesForForm, redeemCodeExists, updateLotteryEntry, updateLotteryForm } from '@/lib/lottery-repository';
import type { LotteryStoreInfo } from '@/lib/lottery-service';
import type { LotteryEntry, LotteryForm, LotteryPrize } from '@/types/lottery';

export type DeferredResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export interface DeferredSummary {
  form_id: string;
  deferred_draw_status: LotteryForm['deferred_draw_status'];
  is_closed: boolean;                 // 締切日時を過ぎている
  applicants: number;                 // 応募者数（cancelled 除く）
  provisional: LotteryEntry[];        // 仮当選（確定前）
  winners: LotteryEntry[];            // 確定当選（drawn / redeemed）
  unnotified: number;                 // 確定済みで push 未完了
  prize_capacity: Record<string, { stock: number; assigned: number }>;
}

function activeEntries(entries: LotteryEntry[]): LotteryEntry[] {
  return entries.filter((e) => e.status !== 'cancelled');
}

function capacityOf(form: LotteryForm, entries: LotteryEntry[], statuses: LotteryEntry['status'][]): Record<string, { stock: number; assigned: number }> {
  const result: Record<string, { stock: number; assigned: number }> = {};
  for (const p of form.config.prizes) result[p.id] = { stock: p.stock ?? 0, assigned: 0 };
  for (const e of entries) {
    if (e.prize_id && statuses.includes(e.status) && result[e.prize_id]) result[e.prize_id].assigned++;
  }
  return result;
}

export async function getDeferredSummary(form: LotteryForm, now: Date = new Date()): Promise<DeferredSummary> {
  const entries = activeEntries(await listEntriesForForm(form.id));
  const provisional = entries.filter((e) => e.status === 'provisional');
  const winners = entries.filter((e) => e.status === 'drawn' || e.status === 'redeemed');
  return {
    form_id: form.id,
    deferred_draw_status: form.deferred_draw_status,
    is_closed: getPeriodState(form.config, now) === 'after' || form.deferred_draw_status !== 'accepting',
    applicants: entries.length,
    provisional,
    winners,
    unnotified: winners.filter((e) => !e.push_sent).length,
    prize_capacity: capacityOf(form, entries, ['provisional', 'drawn', 'redeemed']),
  };
}

function assertDeferred(form: LotteryForm): DeferredResult<null> {
  if (form.config.lottery_type !== 'deferred') return { ok: false, status: 400, error: 'この抽選フォームは後日抽選ではありません' };
  return { ok: true, data: null };
}

/**
 * 自動抽選。応募者（entered / provisional）から賞品ごとの当選数だけランダムに選び provisional にする。
 * 再実行すると前回の仮当選はいったん entered に戻してから引き直す。
 */
export async function runDeferredDraw(
  form: LotteryForm,
  options: { force?: boolean; now?: Date; rng?: () => number } = {}
): Promise<DeferredResult<DeferredSummary>> {
  const guard = assertDeferred(form);
  if (!guard.ok) return guard;
  if (form.deferred_draw_status === 'notified') return { ok: false, status: 409, error: 'すでに当選が確定・通知済みです' };
  const now = options.now ?? new Date();
  if (form.deferred_draw_status === 'accepting' && getPeriodState(form.config, now) !== 'after' && !options.force) {
    return { ok: false, status: 400, error: '応募締切前です。締切を待つか「締め切って抽選する」を選んでください' };
  }

  const entries = activeEntries(await listEntriesForForm(form.id));
  const candidates = entries.filter((e) => e.status === 'entered' || e.status === 'provisional');
  for (const e of entries.filter((x) => x.status === 'provisional')) {
    await updateLotteryEntry(e.id, { status: 'entered', prize_id: null, prize_name: null });
  }
  const winners = drawDeferredWinners(form.config.prizes, candidates.map((e) => e.id), options.rng ?? secureRandomUnit);
  const prizeById = new Map(form.config.prizes.map((p) => [p.id, p]));
  for (const w of winners) {
    const prize = prizeById.get(w.prize_id);
    if (!prize) continue;
    await updateLotteryEntry(w.entry_id, { status: 'provisional', prize_id: prize.id, prize_name: prize.name });
  }
  const updated = await updateLotteryForm(form.id, { deferred_draw_status: 'drawn', deferred_drawn_at: now.toISOString() });
  return { ok: true, data: await getDeferredSummary(updated ?? { ...form, deferred_draw_status: 'drawn' }, now) };
}

/** 仮当選の手動修正（外す / 応募者から追加）。確定前のみ */
export async function updateDeferredWinners(
  form: LotteryForm,
  changes: { remove?: string[]; add?: Array<{ entry_id: string; prize_id: string }> }
): Promise<DeferredResult<DeferredSummary>> {
  const guard = assertDeferred(form);
  if (!guard.ok) return guard;
  if (form.deferred_draw_status !== 'drawn') return { ok: false, status: 409, error: '仮当選の修正は「抽選を実行」してから「確定」するまでの間だけ行えます' };

  const entries = activeEntries(await listEntriesForForm(form.id));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const prizeById = new Map(form.config.prizes.map((p) => [p.id, p]));

  for (const id of changes.remove ?? []) {
    const e = byId.get(id);
    if (!e || e.status !== 'provisional') return { ok: false, status: 400, error: '仮当選ではない応募を外そうとしています' };
    await updateLotteryEntry(e.id, { status: 'entered', prize_id: null, prize_name: null });
    byId.set(e.id, { ...e, status: 'entered', prize_id: null, prize_name: null });
  }
  const capacity = capacityOf(form, [...byId.values()], ['provisional', 'drawn', 'redeemed']);
  for (const a of changes.add ?? []) {
    const e = byId.get(a.entry_id);
    const prize = prizeById.get(a.prize_id);
    if (!e || e.status !== 'entered') return { ok: false, status: 400, error: '追加できるのは未当選の応募者だけです' };
    if (!prize) return { ok: false, status: 400, error: '賞品が見つかりません' };
    if (capacity[prize.id].assigned >= capacity[prize.id].stock) {
      return { ok: false, status: 400, error: `「${prize.name}」の当選数（${prize.stock}）を超えています` };
    }
    await updateLotteryEntry(e.id, { status: 'provisional', prize_id: prize.id, prize_name: prize.name });
    byId.set(e.id, { ...e, status: 'provisional', prize_id: prize.id, prize_name: prize.name });
    capacity[prize.id].assigned++;
  }
  return { ok: true, data: await getDeferredSummary(form) };
}

async function generateUniqueRedeemCode(storeId: string, rng: () => number): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRedeemCode(rng);
    if (!(await redeemCodeExists(storeId, code))) return code;
  }
  throw new Error('引換コードの生成に失敗しました');
}

async function pushWinner(form: LotteryForm, store: LotteryStoreInfo, entry: LotteryEntry, prize: LotteryPrize, baseUrl: string): Promise<boolean> {
  if (!store.line_channel_access_token) return false;
  const qrImageUrl = entry.qr_token ? buildQrImageUrl(entry.qr_token, baseUrl) : null;
  const flex = buildLotteryWinFlex({ config: form.config, prize, entry, storeName: store.name, qrImageUrl });
  const result = await pushLineMessages(store.line_channel_access_token, entry.line_user_id, [flex]);
  return result.ok;
}

export interface ConfirmResult extends DeferredSummary {
  notified: number;
  failed: number;
  lost: number;
}

/**
 * 当選を確定して通知。provisional → drawn（引換コード・QR・有効期限を発行）、entered → lost。
 * 当選者に Bot から Flex を push（失敗は push_sent=false のまま残し、再送できる）。
 */
export async function confirmDeferredWinners(
  form: LotteryForm,
  store: LotteryStoreInfo,
  options: { baseUrl: string; now?: Date; rng?: () => number }
): Promise<DeferredResult<ConfirmResult>> {
  const guard = assertDeferred(form);
  if (!guard.ok) return guard;
  if (form.deferred_draw_status === 'notified') return { ok: false, status: 409, error: 'すでに当選が確定・通知済みです' };
  if (form.deferred_draw_status !== 'drawn') return { ok: false, status: 409, error: '先に「抽選を実行」してください' };
  if (!store.line_channel_access_token) {
    return { ok: false, status: 400, error: '当選通知には店舗の LINE チャネルアクセストークンが必要です' };
  }
  const now = options.now ?? new Date();
  const rng = options.rng ?? secureRandomUnit;
  const entries = activeEntries(await listEntriesForForm(form.id));
  const prizeById = new Map(form.config.prizes.map((p) => [p.id, p]));

  let notified = 0;
  let failed = 0;
  let lost = 0;
  for (const e of entries) {
    if (e.status === 'provisional' && e.prize_id && prizeById.has(e.prize_id)) {
      const prize = prizeById.get(e.prize_id)!;
      const patch = {
        status: 'drawn' as const,
        is_win: true,
        redeem_code: await generateUniqueRedeemCode(form.store_id, rng),
        qr_token: form.config.redeem_method === 'qr' ? generateQrToken(rng) : null,
        expires_at: computeExpiresAt(prize, now),
      };
      const updated = (await updateLotteryEntry(e.id, patch)) ?? { ...e, ...patch };
      const ok = await pushWinner(form, store, updated, prize, options.baseUrl);
      if (ok) {
        await updateLotteryEntry(e.id, { push_sent: true });
        notified++;
      } else {
        failed++;
      }
    } else if (e.status === 'entered' || e.status === 'provisional') {
      await updateLotteryEntry(e.id, { status: 'lost', prize_id: null, prize_name: null });
      lost++;
    }
  }
  const updatedForm = await updateLotteryForm(form.id, { deferred_draw_status: 'notified', deferred_notified_at: now.toISOString() });
  const summary = await getDeferredSummary(updatedForm ?? { ...form, deferred_draw_status: 'notified' }, now);
  return { ok: true, data: { ...summary, notified, failed, lost } };
}

/** 確定済みで push 未完了の当選者に再送 */
export async function resendDeferredNotifications(
  form: LotteryForm,
  store: LotteryStoreInfo,
  options: { baseUrl: string }
): Promise<DeferredResult<{ notified: number; failed: number }>> {
  const guard = assertDeferred(form);
  if (!guard.ok) return guard;
  if (form.deferred_draw_status !== 'notified') return { ok: false, status: 409, error: '当選が確定していません' };
  if (!store.line_channel_access_token) {
    return { ok: false, status: 400, error: '当選通知には店舗の LINE チャネルアクセストークンが必要です' };
  }
  const entries = activeEntries(await listEntriesForForm(form.id));
  const prizeById = new Map(form.config.prizes.map((p) => [p.id, p]));
  let notified = 0;
  let failed = 0;
  for (const e of entries) {
    if ((e.status !== 'drawn' && e.status !== 'redeemed') || e.push_sent || !e.prize_id) continue;
    const prize = prizeById.get(e.prize_id);
    if (!prize) continue;
    const ok = await pushWinner(form, store, e, prize, options.baseUrl);
    if (ok) {
      await updateLotteryEntry(e.id, { push_sent: true });
      notified++;
    } else {
      failed++;
    }
  }
  return { ok: true, data: { notified, failed } };
}
