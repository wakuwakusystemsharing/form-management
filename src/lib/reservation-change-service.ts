/**
 * LINE の「予約を変更」のサーバー側処理（Supabase / Google カレンダー / メールに依存）。
 * 判定とカードの組み立ては純粋ロジック（reservation-change.ts / reservation-change-flex.ts）。
 *
 * - トーク内の変更（日時・時間）: 予約の行をそのまま書き換える（`applyDateTimeChange`）
 * - 予約フォームを開いて変更（メニューを変更）: 新しい予約を作り、元の予約を「置き換え済み」として取り消す
 *   （`validateReservationReplacement` → POST /api/reservations → `retireReplacedReservation`）
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeForm } from '@/lib/form-normalizer';
import { deleteCalendarEvent, listCalendarEventsAll, updateReservationEvent } from '@/lib/google-calendar';
import { buildEventParamsFromReservation } from '@/lib/reservation-event-params';
import { calculateTotalAmount, createCustomerVisit, deleteCustomerVisitByReservation, recalculateCustomerStats } from '@/lib/customer-utils';
import { cancelFollowMessageForReservation, rescheduleFollowMessageForReservation } from '@/lib/follow-message-repository';
import { sendEmail } from '@/lib/email-sender';
import { formatDeadlineJst } from '@/lib/cancel-rules';
import { mergeStaffSchedule } from '@/lib/staff-schedule';
import { resolveMaxConcurrentEvents, type CalendarEventLike } from '@/lib/staff-availability';
import type { FormConfig } from '@/types/form';
import {
  CHANGE_DATES_PAGE_DAYS,
  addDays,
  describeChangeBlock,
  evaluateChangeDays,
  evaluateDaySlots,
  formatDateTimeShortJa,
  jstToday,
  listChangeWindowDates,
  parseChangePostback,
  reservationDurationMinutes,
  resolveChangeEligibility,
  resolveChangeWindowDays,
  type ChangeSlotContext,
} from '@/lib/reservation-change';
import {
  buildChangeConfirmMessage,
  buildChangeDatesMessage,
  buildChangeDoneMessage,
  buildChangeMenuMessage,
  buildChangeSimpleMessage,
  buildChangeTimesMessage,
  type ChangeMenuItem,
} from '@/lib/reservation-change-flex';

export interface ChangeStore {
  id: string;
  name?: string | null;
  phone?: string | null;
  owner_email?: string | null;
  google_calendar_id?: string | null;
}

type Message = Record<string, unknown>;

const LIST_HINT = '「予約を変更」と送ると、変更できるご予約を確認できます。';

async function loadFormConfig(adminClient: any, storeId: string, formId: string | null | undefined): Promise<FormConfig | null> {
  if (!formId) return null;
  try {
    const { data } = await adminClient
      .from('reservation_forms')
      .select('id, store_id, config, draft_config')
      .eq('store_id', storeId)
      .eq('id', formId)
      .maybeSingle();
    return data ? (normalizeForm(data).config as FormConfig) : null;
  } catch (e) {
    console.error('[reservation-change] form load error:', e);
    return null;
  }
}

/** 予約フォームを変更用に開く URL（LINE フォームで LIFF ID があるときだけ） */
export function buildChangeFormUrl(config: FormConfig | null | undefined, reservationId: string): string | null {
  if (!config || (config as { form_type?: string }).form_type === 'web') return null;
  const liffId = (config.basic_info?.liff_id || '').trim();
  if (liffId.length < 10) return null;
  return `https://liff.line.me/${liffId}?change=${encodeURIComponent(reservationId)}`;
}

/** 「予約を変更」と送られたとき: これからの予約を一覧にして、変更のボタンを出す */
export async function buildChangeMenuReply(adminClient: any, store: ChangeStore, userId: string, now: Date = new Date()): Promise<Message[]> {
  const { data: reservations } = await adminClient
    .from('reservations')
    .select('id,reservation_date,reservation_time,menu_name,submenu_name,staff_name,staff_no_preference,form_id,status,checkout_date')
    .eq('store_id', store.id)
    .eq('line_user_id', userId)
    .neq('status', 'cancelled')
    .gte('reservation_date', jstToday(now))
    .order('reservation_date', { ascending: true })
    .order('reservation_time', { ascending: true });

  const rows: any[] = Array.isArray(reservations) ? reservations : [];
  if (rows.length === 0) {
    return [buildChangeSimpleMessage('予約の変更', '現在変更できるご予約はありません。', store.name)];
  }
  const configCache = new Map<string, FormConfig | null>();
  const items: ChangeMenuItem[] = [];
  for (const r of rows) {
    const key = r.form_id || '';
    if (!configCache.has(key)) configCache.set(key, await loadFormConfig(adminClient, store.id, r.form_id));
    const config = configCache.get(key) || null;
    const e = resolveChangeEligibility(r, config, now);
    items.push({
      reservation: r,
      allowed: e.allowed,
      blockText: e.allowed ? undefined : describeChangeBlock(e, store.phone),
      mode: e.mode,
      formUrl: e.allowed ? buildChangeFormUrl(config, r.id) : null,
      deadlineText: e.deadline ? formatDeadlineJst(e.deadline) : null,
    });
  }
  return [buildChangeMenuMessage(store.name, items)];
}

async function fetchEvents(calendarId: string, fromDate: string, toDateExclusive: string, storeId: string, excludeEventId: string | null): Promise<CalendarEventLike[] | null> {
  try {
    const items = await listCalendarEventsAll(calendarId, `${fromDate}T00:00:00+09:00`, `${toDateExclusive}T00:00:00+09:00`, storeId);
    return (items as Array<CalendarEventLike & { id?: string | null }>).filter((ev) => !excludeEventId || ev.id !== excludeEventId);
  } catch (e) {
    console.error(`[reservation-change] events.list failed (calendar=${calendarId}):`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** 空きを判定する材料（設定 + カレンダーの予定）。fromDate 〜 toDate（両端含む）の予定を取る */
async function buildSlotContext(store: ChangeStore, reservation: any, config: FormConfig, fromDate: string, toDate: string): Promise<ChangeSlotContext> {
  const formCs = config.calendar_settings;
  const durationMinutes = reservationDurationMinutes(reservation);
  const ownEventId: string | null = reservation.google_calendar_event_id || null;
  const toExclusive = addDays(toDate, 1);

  if (reservation.staff_calendar_id) {
    // スタッフのカレンダーに入っている予約: いまの担当スタッフのまま変更する
    const ss = config.staff_selection;
    const staff = Array.isArray(ss?.staff) ? ss!.staff : [];
    const member = staff.find((m) => m && m.id === reservation.staff_id);
    const cs = mergeStaffSchedule(formCs, member?.schedule);
    const events = await fetchEvents(reservation.staff_calendar_id, fromDate, toExclusive, store.id, ownEventId);
    const ssAny = ss as { enabled?: boolean; max_staff_concurrent_enabled?: boolean; max_staff_concurrent_events?: number } | undefined;
    let staffCap: number | null = null;
    let otherStaffEvents: Array<CalendarEventLike[] | null> | undefined;
    if (ssAny?.enabled === true && ssAny.max_staff_concurrent_enabled === true) {
      const v = ssAny.max_staff_concurrent_events;
      staffCap = typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
      const others = staff.filter((m) => m && m.name && m.calendar_id && m.calendar_id !== reservation.staff_calendar_id);
      otherStaffEvents = await Promise.all(others.map((m) => fetchEvents(m.calendar_id, fromDate, toExclusive, store.id, ownEventId)));
    }
    return { cs, durationMinutes, events, staffMode: true, capacity: 1, staffCap, otherStaffEvents };
  }

  const events = store.google_calendar_id
    ? await fetchEvents(store.google_calendar_id, fromDate, toExclusive, store.id, ownEventId)
    : undefined;
  return { cs: formCs, durationMinutes, events, staffMode: false, capacity: resolveMaxConcurrentEvents(formCs) };
}

/** お客様が LINE で予約を変更したときに店舗へ送るメール */
export function buildChangeNotificationEmail(args: {
  storeName: string;
  before: { reservation_date: string; reservation_time?: string | null; menu_name?: string | null; submenu_name?: string | null };
  after: { customer_name?: string | null; customer_phone?: string | null; reservation_date: string; reservation_time?: string | null; menu_name?: string | null; submenu_name?: string | null; staff_name?: string | null };
  changedAt?: Date;
}): { subject: string; body: string } {
  const menuOf = (r: { menu_name?: string | null; submenu_name?: string | null }) => {
    const menu = r.submenu_name ? `${r.menu_name || ''} > ${r.submenu_name}` : r.menu_name || '';
    return menu && menu !== '未選択' ? menu : '';
  };
  const a = args.after;
  const beforeMenu = menuOf(args.before);
  const afterMenu = menuOf(a);
  const lines = [
    '管理者各位',
    '',
    `「${args.storeName}」のご予約がお客様により変更されました（LINE から操作）。`,
    '',
    '──────────────────────',
    `■ 変更前　：${formatDateTimeShortJa(args.before.reservation_date, args.before.reservation_time)}${beforeMenu && beforeMenu !== afterMenu ? `　${beforeMenu}` : ''}`,
    `■ 変更後　：${formatDateTimeShortJa(a.reservation_date, a.reservation_time)}${afterMenu && beforeMenu !== afterMenu ? `　${afterMenu}` : ''}`,
    `■ お名前　：${a.customer_name || '-'}`,
    `■ 電話　　：${a.customer_phone || '-'}`,
  ];
  if (afterMenu && beforeMenu === afterMenu) lines.push(`■ メニュー：${afterMenu}`);
  if (a.staff_name) lines.push(`■ 担当　　：${a.staff_name}`);
  if (args.changedAt) lines.push(`■ 操作日時：${formatDeadlineJst(args.changedAt)}`);
  lines.push('──────────────────────');
  return {
    subject: `【予約変更】${a.customer_name || ''}様｜${formatDateTimeShortJa(a.reservation_date, a.reservation_time)}`,
    body: lines.join('\n'),
  };
}

async function notifyStoreOfChange(store: ChangeStore, config: FormConfig | null, before: any, after: any): Promise<void> {
  try {
    if (!config || (config.cancel_rules as { notify_store_on_cancel?: boolean } | undefined)?.notify_store_on_cancel !== true) return;
    const recipient = (config.calendar_settings?.notification_email || '').trim() || (store.owner_email || '').trim();
    if (!recipient) return;
    const mail = buildChangeNotificationEmail({ storeName: store.name || '', before, after, changedAt: new Date() });
    const result = await sendEmail({ to: recipient, subject: mail.subject, body: mail.body, fromName: store.name || undefined });
    if (!result.ok) console.warn('[reservation-change] notify mail skipped/failed:', result.error);
  } catch (e) {
    console.error('[reservation-change] notify mail error:', e);
  }
}

/** 予約の日時を書き換え、カレンダーの予定・来店履歴・フォローメッセージの予定・店舗への通知を合わせる */
async function applyDateTimeChange(adminClient: any, store: ChangeStore, reservation: any, config: FormConfig, date: string, time: string): Promise<any | null> {
  const { data: updated, error } = await adminClient
    .from('reservations')
    .update({ reservation_date: date, reservation_time: time, updated_at: new Date().toISOString() })
    .eq('id', reservation.id)
    .eq('store_id', store.id)
    .neq('status', 'cancelled')
    .select()
    .single();
  if (error || !updated) {
    console.error('[reservation-change] update error:', error);
    return null;
  }

  // Google カレンダーの予定（スタッフ選択の予約はスタッフのカレンダー、それ以外は店舗カレンダー）
  const calendarId: string | null = updated.staff_calendar_id || store.google_calendar_id || null;
  if (calendarId && updated.google_calendar_event_id) {
    try {
      await updateReservationEvent(updated.google_calendar_event_id, buildEventParamsFromReservation(updated, calendarId, config, null), store.id);
    } catch (e) {
      console.error('[reservation-change] calendar update error:', e);
    }
  }

  // 来店履歴を新しい日時で作り直す
  if (updated.customer_id) {
    try {
      await deleteCustomerVisitByReservation(updated.id);
      await createCustomerVisit({
        customer_id: updated.customer_id,
        store_id: updated.store_id,
        reservation_id: updated.id,
        visit_date: updated.reservation_date,
        visit_time: updated.reservation_time,
        visit_type: 'reservation',
        treatment_menus: updated.selected_menus,
        amount: calculateTotalAmount(updated.selected_menus, updated.selected_options),
      });
      await recalculateCustomerStats(updated.customer_id);
    } catch (e) {
      console.error('[reservation-change] visit sync error:', e);
    }
  }

  // フォローメッセージ: 予約日が変わったときだけ予定日を計算し直す
  if (updated.reservation_date !== reservation.reservation_date) {
    try {
      await rescheduleFollowMessageForReservation({
        id: updated.id,
        store_id: updated.store_id,
        line_user_id: updated.line_user_id,
        customer_id: updated.customer_id ?? null,
        reservation_date: updated.reservation_date,
        created_at: updated.created_at,
        status: updated.status,
      });
    } catch (e) {
      console.error('[reservation-change] follow reschedule error:', e);
    }
  }

  await notifyStoreOfChange(store, config, reservation, updated);
  return updated;
}

/**
 * 「予約を変更」のボタン（postback。data = `rc:...`）が押されたとき。
 * 押されるたびに、予約が本人のものか・変更できる期限内か・その枠がまだ空いているかを確認し直す
 * （トークに残った古いボタンを後から押されても、空いていない日時には変更しない）
 */
export async function handleChangePostback(adminClient: any, store: ChangeStore, userId: string, data: string, now: Date = new Date()): Promise<Message[] | null> {
  const action = parseChangePostback(data);
  if (!action) return null;
  const simple = (title: string, body: string) => [buildChangeSimpleMessage(title, body, store.name)];

  const { data: reservation } = await adminClient
    .from('reservations')
    .select('*')
    .eq('id', action.reservationId)
    .eq('store_id', store.id)
    .eq('line_user_id', userId)
    .maybeSingle();
  if (!reservation) return simple('予約の変更', `ご予約が見つかりませんでした。\n\n${LIST_HINT}`);

  const config = await loadFormConfig(adminClient, store.id, reservation.form_id);
  const eligibility = resolveChangeEligibility(reservation, config, now);
  if (!eligibility.allowed || !config) return simple('予約の変更', describeChangeBlock(eligibility, store.phone));
  if (eligibility.mode !== 'calendar') {
    return simple('予約の変更', `このご予約は、予約フォームを開いて変更してください。\n\n${LIST_HINT}`);
  }

  const cs = config.calendar_settings;
  const windowDates = listChangeWindowDates(cs, now);
  const lastDate = windowDates[windowDates.length - 1];
  const current = { date: String(reservation.reservation_date), time: String(reservation.reservation_time || '').slice(0, 5) };

  if (action.kind === 'dates') {
    const start = action.page * CHANGE_DATES_PAGE_DAYS;
    const pageDates = windowDates.slice(start, start + CHANGE_DATES_PAGE_DAYS);
    if (pageDates.length === 0) return simple('日時を変更', `これより先の日付には変更できません。\n\n${LIST_HINT}`);
    const ctx = await buildSlotContext(store, reservation, config, pageDates[0], pageDates[pageDates.length - 1]);
    const days = evaluateChangeDays(ctx, pageDates, now, current);
    const nextPage = start + CHANGE_DATES_PAGE_DAYS < windowDates.length ? action.page + 1 : null;
    return [buildChangeDatesMessage({ storeName: store.name, reservation, days, windowDays: resolveChangeWindowDays(cs), lastDate, nextPage })];
  }

  if (!windowDates.includes(action.date)) {
    return simple('予約の変更', `その日付には変更できません（変更できるのは ${formatDateTimeShortJa(lastDate, '')} までです）。\n\n${LIST_HINT}`);
  }
  const ctx = await buildSlotContext(store, reservation, config, action.date, action.date);
  const slots = evaluateDaySlots(ctx, action.date, now);

  if (action.kind === 'times') {
    return [buildChangeTimesMessage({ storeName: store.name, reservation, date: action.date, slots })];
  }

  // confirm / apply: 選んだ時間がまだ空いているか
  const isCurrent = action.date === current.date && action.time === current.time;
  const slot = slots.find((s) => s.time === action.time);
  if (isCurrent) return simple('予約の変更', 'その日時は現在のご予約と同じです。');
  if (!slot || !slot.ok) {
    return [
      buildChangeSimpleMessage('予約の変更', '申し訳ありません。その時間は変更できなくなりました。別の時間をお選びください。', store.name),
      buildChangeTimesMessage({ storeName: store.name, reservation, date: action.date, slots }),
    ];
  }
  if (action.kind === 'confirm') {
    return [buildChangeConfirmMessage(store.name, reservation, action.date, action.time)];
  }

  const updated = await applyDateTimeChange(adminClient, store, reservation, config, action.date, action.time);
  if (!updated) return simple('予約の変更', '予約を変更できませんでした。お手数ですが、時間をおいてもう一度お試しください。');
  return [buildChangeDoneMessage(store.name, reservation, updated)];
}

// ---- 予約フォームを開いて変更する（メニューを変更） ----

const DATA_DIR = path.join(process.cwd(), 'data');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');

function readLocalReservations(): any[] {
  try {
    return fs.existsSync(RESERVATIONS_FILE) ? JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf-8')) : [];
  } catch {
    return [];
  }
}

function loadLocalFormConfig(formId: string | null | undefined): FormConfig | null {
  if (!formId || !fs.existsSync(DATA_DIR)) return null;
  for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('forms') && f.endsWith('.json'))) {
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
      const found = Array.isArray(arr) ? arr.find((f: any) => f?.id === formId) : null;
      if (found) return normalizeForm(found).config as FormConfig;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export type ReplacementCheck =
  | { ok: true; reservation: any; config: FormConfig | null }
  | { ok: false; error: string };

/**
 * 予約フォームからの変更（元の予約を置き換える）を受け付けてよいか。
 * 元の予約が同じ店舗・同じ LINE ユーザーのもので、変更できる期限内であること
 */
export async function validateReservationReplacement(args: {
  reservationId: string;
  storeId: string;
  lineUserId: string | null | undefined;
  now?: Date;
}): Promise<ReplacementCheck> {
  const now = args.now ?? new Date();
  const notFound = { ok: false as const, error: '変更するご予約が見つかりませんでした。公式LINEで「予約を変更」と送って、もう一度お試しください。' };
  if (!args.reservationId || !args.storeId || !args.lineUserId) return notFound;

  let reservation: any = null;
  let config: FormConfig | null = null;
  let phone: string | null = null;
  if (getAppEnvironment() === 'local') {
    reservation = readLocalReservations().find((r) => r && r.id === args.reservationId && r.store_id === args.storeId && r.line_user_id === args.lineUserId) || null;
    if (reservation) config = loadLocalFormConfig(reservation.form_id);
  } else {
    const adminClient = createAdminClient();
    if (!adminClient) return { ok: false, error: '予約を確認できませんでした。時間をおいてもう一度お試しください。' };
    const { data } = await (adminClient as any)
      .from('reservations')
      .select('*')
      .eq('id', args.reservationId)
      .eq('store_id', args.storeId)
      .eq('line_user_id', args.lineUserId)
      .maybeSingle();
    reservation = data || null;
    if (reservation) {
      config = await loadFormConfig(adminClient, args.storeId, reservation.form_id);
      const { data: store } = await (adminClient as any).from('stores').select('phone').eq('id', args.storeId).maybeSingle();
      phone = store?.phone || null;
    }
  }
  if (!reservation) return notFound;
  const e = resolveChangeEligibility(reservation, config, now);
  if (!e.allowed) return { ok: false, error: describeChangeBlock(e, phone) };
  return { ok: true, reservation, config };
}

/**
 * 予約フォームからの変更で新しい予約ができたあと、元の予約を「置き換え済み」として取り消す。
 * キャンセルとは区別できるよう customer_info.replaced_by_reservation_id を残す（分析のキャンセル数には数えない）。
 * 失敗しても新しい予約は成功扱い
 */
export async function retireReplacedReservation(old: any, replacement: any, config: FormConfig | null): Promise<void> {
  const info = { ...(old.customer_info && typeof old.customer_info === 'object' ? old.customer_info : {}), replaced_by_reservation_id: replacement?.id || null };
  const nowIso = new Date().toISOString();
  try {
    if (getAppEnvironment() === 'local') {
      const all = readLocalReservations();
      const i = all.findIndex((r) => r && r.id === old.id);
      if (i >= 0) {
        all[i] = { ...all[i], status: 'cancelled', cancelled_at: nowIso, updated_at: nowIso, customer_info: info };
        fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(all, null, 2));
      }
    } else {
      const adminClient = createAdminClient();
      if (!adminClient) return;
      const { error } = await (adminClient as any)
        .from('reservations')
        .update({ status: 'cancelled', cancelled_at: nowIso, updated_at: nowIso, customer_info: info })
        .eq('id', old.id);
      if (error) console.error('[reservation-change] retire update error:', error);

      const { data: store } = await (adminClient as any)
        .from('stores')
        .select('id, name, phone, owner_email, google_calendar_id')
        .eq('id', old.store_id)
        .maybeSingle();
      const calendarId: string | null = old.staff_calendar_id || store?.google_calendar_id || null;
      if (calendarId && old.google_calendar_event_id) {
        try {
          await deleteCalendarEvent(calendarId, old.google_calendar_event_id, old.store_id);
        } catch (e) {
          console.error('[reservation-change] retire calendar delete error:', e);
        }
      }
      if (store) await notifyStoreOfChange(store, config, old, replacement);
    }
    if (old.customer_id) {
      await deleteCustomerVisitByReservation(old.id);
      await recalculateCustomerStats(old.customer_id);
    }
    await cancelFollowMessageForReservation(old.id);
  } catch (e) {
    console.error('[reservation-change] retire error:', e);
  }
}

/** 予約フォームを変更用に開いたときに見せる、いまの予約の内容（本人確認: 予約 ID + LINE ユーザー ID） */
export async function getChangeSourceForForm(args: { reservationId: string; storeId: string; lineUserId: string | null | undefined }): Promise<
  | { ok: true; reservation: { id: string; date_text: string; menu_text: string; staff_name: string | null; customer_name: string | null; customer_phone: string | null; selected_menus: unknown; selected_options: unknown; gender: string | null; visit_count: string | null; coupon: string | null } }
  | { ok: false; error: string }
> {
  const check = await validateReservationReplacement(args);
  if (!check.ok) return check;
  const r = check.reservation;
  const menu = r.submenu_name ? `${r.menu_name || ''} > ${r.submenu_name}` : r.menu_name || '';
  const info = r.customer_info && typeof r.customer_info === 'object' ? r.customer_info : {};
  return {
    ok: true,
    reservation: {
      id: r.id,
      date_text: formatDateTimeShortJa(String(r.reservation_date), r.reservation_time),
      menu_text: menu && menu !== '未選択' ? menu : '',
      staff_name: r.staff_name || null,
      customer_name: r.customer_name || null,
      customer_phone: r.customer_phone || null,
      selected_menus: Array.isArray(r.selected_menus) ? r.selected_menus : [],
      selected_options: Array.isArray(r.selected_options) ? r.selected_options : [],
      gender: r.gender || info.gender || null,
      visit_count: r.visit_count || info.visit_count || null,
      coupon: r.coupon || info.coupon || null,
    },
  };
}

/** 空き状況 API 用: 変更元の予約のカレンダー予定 ID（その予定を除いて空きを見せる）。無ければ null */
export async function getChangeExcludeEventId(storeId: string, reservationId: string | null | undefined): Promise<string | null> {
  if (!reservationId || getAppEnvironment() === 'local') return null;
  try {
    const adminClient = createAdminClient();
    if (!adminClient) return null;
    const { data } = await (adminClient as any)
      .from('reservations')
      .select('google_calendar_event_id')
      .eq('id', reservationId)
      .eq('store_id', storeId)
      .neq('status', 'cancelled')
      .maybeSingle();
    return data?.google_calendar_event_id || null;
  } catch {
    return null;
  }
}
