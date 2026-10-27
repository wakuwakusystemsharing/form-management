import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeForm } from '@/lib/form-normalizer';
import {
  createCustomerVisit,
  deleteCustomerVisitByReservation,
  findCustomerVisitByReservation,
  recalculateCustomerStats,
  calculateTotalAmount,
} from '@/lib/customer-utils';
import {
  cancelFollowMessageForReservation,
  rescheduleFollowMessageForReservation,
  restoreFollowMessageForUser,
  scheduleFollowMessageForReservation,
} from '@/lib/follow-message-repository';
import { prepareStayReservation, resolveStayCancelFee } from '@/lib/stay-reservation';
import { sanitizeStaySettings } from '@/lib/stay-pricing';
import { nightsBetween, occupiedCountByNight } from '@/lib/stay-availability';
import { checkStayNightsFree } from '@/lib/stay-service';

const DATA_DIR = path.join(process.cwd(), 'data');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');

function readReservations() {
  if (!fs.existsSync(RESERVATIONS_FILE)) return [];
  return JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf-8'));
}

function writeReservations(reservations: any[]) {
  fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2));
}

const VALID_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];

/**
 * 予約の変更に合わせてフォローメッセージの配信予定を同期する（失敗しても予約更新は成功扱い）。
 * - 非キャンセル → cancelled: 未送信の予定を取り消し、同じ顧客の差し替えられていた予定があれば復活させる
 * - cancelled → 非キャンセル: 予定を作り直す（店舗のフォロー設定が ON の場合）
 * - 予約日の変更（キャンセル中以外）: 未送信の予定日を計算し直す。メニュー等だけの編集では触らない
 */
async function syncFollowMessageForChange(
  reservation: any,
  previousStatus: string | undefined,
  nextStatus: string | undefined,
  dateChanged: boolean
): Promise<void> {
  try {
    const input = {
      id: reservation.id,
      store_id: reservation.store_id,
      line_user_id: reservation.line_user_id,
      customer_id: reservation.customer_id ?? null,
      reservation_date: reservation.reservation_date,
      created_at: reservation.created_at,
      status: reservation.status,
    };
    const wasCancelled = previousStatus === 'cancelled';
    const willBeCancelled = (nextStatus ?? previousStatus) === 'cancelled';
    if (!wasCancelled && willBeCancelled) {
      await cancelFollowMessageForReservation(reservation.id);
      await restoreFollowMessageForUser(reservation.store_id, reservation.line_user_id);
      return;
    }
    if (wasCancelled && !willBeCancelled) {
      await scheduleFollowMessageForReservation(input);
      return;
    }
    if (dateChanged && !willBeCancelled) {
      await rescheduleFollowMessageForReservation(input);
    }
  } catch (e) {
    console.error('[follow-message] sync error:', e);
  }
}

/**
 * 予約ステータス変更に応じて customer_visits を増減し、顧客統計を再計算する。
 *
 * - 非キャンセル → 'cancelled': 該当 visit を削除
 * - 'cancelled' → 非キャンセル: 該当 visit が無ければ予約情報から再作成
 * - その他の遷移: 何もしない（visit は既に存在）
 *
 * いずれの場合も最後に customer の統計を再計算する。
 */
async function syncCustomerVisitForStatusChange(
  reservation: any,
  previousStatus: string | undefined,
  nextStatus: string
): Promise<void> {
  const customerId = reservation?.customer_id as string | null | undefined;
  if (!customerId) return;

  const wasCancelled = previousStatus === 'cancelled';
  const willBeCancelled = nextStatus === 'cancelled';

  if (wasCancelled === willBeCancelled) {
    // 状態カテゴリが変わらない場合（pending→confirmed など）は visit はそのまま
    return;
  }

  if (willBeCancelled) {
    await deleteCustomerVisitByReservation(reservation.id);
    await recalculateCustomerStats(customerId);
    return;
  }

  // cancelled → non-cancelled に復帰: visit が無ければ再作成
  const existingVisit = await findCustomerVisitByReservation(reservation.id);
  if (!existingVisit) {
    await createCustomerVisit({
      customer_id: customerId,
      store_id: reservation.store_id,
      reservation_id: reservation.id,
      visit_date: reservation.reservation_date,
      visit_time: reservation.reservation_time,
      visit_type: 'reservation',
      treatment_menus: reservation.selected_menus,
      amount: calculateTotalAmount(
        reservation.selected_menus,
        reservation.selected_options
      ),
    });
  }
  await recalculateCustomerStats(customerId);
}

/**
 * 予約内容（日時・メニュー）の変更に合わせて来店履歴を作り直す（キャンセル中は対象外）
 */
async function syncCustomerVisitForContentChange(reservation: any): Promise<void> {
  const customerId = reservation?.customer_id as string | null | undefined;
  if (!customerId || reservation.status === 'cancelled') return;
  await deleteCustomerVisitByReservation(reservation.id);
  await createCustomerVisit({
    customer_id: customerId,
    store_id: reservation.store_id,
    reservation_id: reservation.id,
    visit_date: reservation.reservation_date,
    visit_time: reservation.reservation_time,
    visit_type: 'reservation',
    treatment_menus: reservation.selected_menus,
    amount: calculateTotalAmount(reservation.selected_menus, reservation.selected_options),
  });
  await recalculateCustomerStats(customerId);
}

// ---- 予約内容編集の入力検証 ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function sumDuration(menus: Array<Record<string, any>>, options: Array<Record<string, any>>): number {
  const m = menus.reduce((s, x) => s + (Number(x.duration) || 0), 0);
  const o = options.reduce((s, x) => s + (Number(x.duration) || 0), 0);
  return m + o;
}

function sumPrice(menus: Array<Record<string, any>>, options: Array<Record<string, any>>): number {
  const m = menus.reduce((s, x) => s + (Number(x.price) || 0), 0);
  const o = options.reduce((s, x) => s + (Number(x.price) || 0), 0);
  return m + o;
}

interface ContentEdit {
  reservation_date?: string;
  reservation_time?: string;
  total_duration?: number;
  selected_menus?: Array<Record<string, any>>;
  selected_options?: Array<Record<string, any>>;
  staff_id?: string | null;   // '' or null = 指名解除
  hasStaffChange: boolean;
  // 宿泊予約（checkout_date がある行）だけ
  checkout_date?: string;
  guest_counts?: Record<string, unknown>;
}

const STAY_EDIT_KEYS = ['reservation_date', 'reservation_time', 'checkout_date', 'guest_counts'] as const;

/**
 * 宿泊予約の日程・人数の編集: フォーム設定で検証し直し（受付期間は見ない）、料金を再計算して行に反映する。
 * 他の予約・カレンダー予定との重なりは呼び出し側で確認する
 */
function applyStayEdit(row: any, edit: ContentEdit, formConfig: any): { error?: string; nights: string[] } {
  const cs = formConfig?.calendar_settings;
  const prepared = prepareStayReservation(
    cs,
    {
      reservation_date: edit.reservation_date ?? row.reservation_date,
      checkout_date: edit.checkout_date ?? row.checkout_date,
      guest_counts: edit.guest_counts ?? row.guest_counts ?? (row.customer_info && row.customer_info.guest_counts),
      reservation_time: edit.reservation_time ?? String(row.reservation_time || '').slice(0, 5),
    },
    new Date(),
    { skipWindow: true }
  );
  if (!prepared.ok) return { error: prepared.error, nights: [] };
  const v = prepared.value;
  row.reservation_date = v.reservation_date;
  row.reservation_time = edit.reservation_time && /^\d{2}:\d{2}$/.test(edit.reservation_time) ? edit.reservation_time : v.reservation_time;
  row.checkout_date = v.checkout_date;
  row.stay_nights = v.stay_nights;
  row.guest_counts = v.guest_counts;
  row.guest_count = v.guest_count;
  row.stay_price_total = v.stay_price_total;
  row.customer_info = { ...((row.customer_info && typeof row.customer_info === 'object') ? row.customer_info : {}), ...v.customer_info, check_in_time: row.reservation_time };
  return { nights: v.nights };
}

/** キャンセル ↔ 復元に合わせてキャンセル料の記録を付け外しする（宿泊以外の予約でも段階設定があれば記録する） */
function applyCancelFee(row: any, body: any, status: string | undefined, previousStatus: string | undefined, formConfig: any): void {
  if (status === 'cancelled' && previousStatus !== 'cancelled') {
    const fee = resolveStayCancelFee(formConfig, row);
    const pct = typeof body.cancel_fee_percent === 'number' && Number.isFinite(body.cancel_fee_percent) ? Math.min(100, Math.max(0, Math.floor(body.cancel_fee_percent))) : fee.percent;
    const amt = typeof body.cancel_fee_amount === 'number' && Number.isFinite(body.cancel_fee_amount) ? Math.max(0, Math.floor(body.cancel_fee_amount)) : (pct === fee.percent ? fee.amount : Math.floor(((Number(row.stay_price_total) || 0) * pct) / 100 / 10) * 10);
    row.cancel_fee_percent = pct;
    row.cancel_fee_amount = amt;
    row.cancelled_at = new Date().toISOString();
  } else if (status !== undefined && status !== 'cancelled' && previousStatus === 'cancelled') {
    row.cancel_fee_percent = null;
    row.cancel_fee_amount = null;
    row.cancelled_at = null;
  }
}

/** 予約内容編集のボディを検証して正規化する。エラー時はメッセージを返す */
function parseContentEdit(body: any, existing: any): { edit: ContentEdit } | { error: string } {
  const edit: ContentEdit = { hasStaffChange: false };

  if (body.reservation_date !== undefined) {
    if (typeof body.reservation_date !== 'string' || !DATE_RE.test(body.reservation_date)) {
      return { error: '予約日の形式が正しくありません' };
    }
    edit.reservation_date = body.reservation_date;
  }
  if (body.reservation_time !== undefined) {
    if (typeof body.reservation_time !== 'string' || !TIME_RE.test(body.reservation_time)) {
      return { error: '開始時間の形式が正しくありません' };
    }
    edit.reservation_time = body.reservation_time;
  }
  if (body.selected_menus !== undefined) {
    if (!Array.isArray(body.selected_menus) || body.selected_menus.length === 0) {
      return { error: 'メニューを1つ以上選択してください' };
    }
    edit.selected_menus = body.selected_menus.filter((m: any) => m && typeof m === 'object');
  }
  if (body.selected_options !== undefined) {
    if (!Array.isArray(body.selected_options)) {
      return { error: 'オプションの形式が正しくありません' };
    }
    edit.selected_options = body.selected_options.filter((o: any) => o && typeof o === 'object');
  }

  // 終了時間 or 所要時間 → total_duration
  const startTime = edit.reservation_time || String(existing.reservation_time || '').slice(0, 5);
  if (body.end_time !== undefined) {
    if (typeof body.end_time !== 'string' || !TIME_RE.test(body.end_time)) {
      return { error: '終了時間の形式が正しくありません' };
    }
    const diff = toMinutes(body.end_time) - toMinutes(startTime);
    if (diff <= 0) return { error: '終了時間は開始時間より後にしてください' };
    edit.total_duration = diff;
  } else if (body.total_duration !== undefined) {
    const n = Number(body.total_duration);
    if (!Number.isFinite(n) || n <= 0) return { error: '所要時間が正しくありません' };
    edit.total_duration = Math.floor(n);
  }

  if (body.staff_id !== undefined) {
    if (body.staff_id !== null && typeof body.staff_id !== 'string') {
      return { error: '担当スタッフの指定が正しくありません' };
    }
    edit.staff_id = body.staff_id || null;
    edit.hasStaffChange = true;
  }

  if (body.checkout_date !== undefined) {
    if (typeof body.checkout_date !== 'string' || !DATE_RE.test(body.checkout_date)) {
      return { error: 'チェックアウト日の形式が正しくありません' };
    }
    edit.checkout_date = body.checkout_date;
  }
  if (body.guest_counts !== undefined) {
    if (!body.guest_counts || typeof body.guest_counts !== 'object' || Array.isArray(body.guest_counts)) {
      return { error: '宿泊人数の形式が正しくありません' };
    }
    edit.guest_counts = body.guest_counts;
  }

  return { edit };
}

/**
 * PATCH /api/reservations/[reservationId]
 * 予約ステータスの更新 + 予約内容（日時・メニュー・オプション・担当）の編集（管理者用）
 * 内容編集時は Google カレンダーのイベントと来店履歴も同期する
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> }
) {
  try {
    const { reservationId } = await params;
    const body = await request.json();
    const { status } = body;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: '有効なステータスを指定してください（pending, confirmed, cancelled, completed）' },
        { status: 400 }
      );
    }

    const hasContentEdit = ['reservation_date', 'reservation_time', 'end_time', 'total_duration', 'selected_menus', 'selected_options', 'staff_id', 'checkout_date', 'guest_counts']
      .some((k) => body[k] !== undefined);

    if (status === undefined && !hasContentEdit) {
      return NextResponse.json({ error: '更新する項目を指定してください' }, { status: 400 });
    }

    const env = getAppEnvironment();

    // ローカル環境: JSON を更新
    if (env === 'local') {
      const reservations = readReservations();
      const index = reservations.findIndex((r: any) => r.id === reservationId);

      if (index === -1) {
        return NextResponse.json(
          { error: '予約が見つかりません' },
          { status: 404 }
        );
      }

      const existing = reservations[index];
      const previousStatus = existing.status;
      const previousDate = existing.reservation_date;

      const localFormConfig = existing.checkout_date || status !== undefined ? await loadLocalFormConfig(existing.form_id) : null;
      if (hasContentEdit) {
        const parsed = parseContentEdit(body, existing);
        if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
        applyContentEdit(existing, parsed.edit, null);
        // 宿泊予約: 日程・人数の変更は料金を再計算し、同じ夜の空きを確認する
        if (existing.checkout_date && STAY_EDIT_KEYS.some((k) => parsed.edit[k] !== undefined)) {
          const applied = applyStayEdit(existing, parsed.edit, localFormConfig);
          if (applied.error) return NextResponse.json({ error: applied.error }, { status: 400 });
          const settings = sanitizeStaySettings(localFormConfig?.calendar_settings?.stay_settings);
          const occupied = occupiedCountByNight(
            { from: applied.nights[0], to: applied.nights[applied.nights.length - 1] },
            reservations.filter((r: any) => r.store_id === existing.store_id && r.id !== existing.id),
            [],
            settings
          );
          const roomCount = Math.max(1, settings.room_count || 1);
          if (applied.nights.some((n) => (occupied.get(n) || 0) >= roomCount)) {
            return NextResponse.json({ error: 'その日程は他の予約と重なっています', code: 'slot_taken' }, { status: 409 });
          }
        }
      }
      if (status !== undefined) existing.status = status;
      applyCancelFee(existing, body, status, previousStatus, localFormConfig);
      existing.updated_at = new Date().toISOString();
      reservations[index] = existing;
      writeReservations(reservations);

      // CRM 統計の補正
      try {
        if (status !== undefined) {
          await syncCustomerVisitForStatusChange(existing, previousStatus, status);
        }
        if (hasContentEdit) {
          await syncCustomerVisitForContentChange(existing);
        }
      } catch (e) {
        console.error('[CRM] visit sync error (local):', e);
      }
      await syncFollowMessageForChange(existing, previousStatus, status, hasContentEdit && existing.reservation_date !== previousDate);

      return NextResponse.json(existing);
    }

    // staging/production: Supabase を更新
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 変更前の予約を取得
    const { data: existing } = await (adminClient as any)
      .from('reservations')
      .select('*')
      .eq('id', reservationId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }
    const previousStatus = existing.status as string | undefined;

    // ---- 更新内容の組み立て ----
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    let staffResolved: { staff_id: string | null; staff_name: string | null; staff_calendar_id: string | null; event_color_id: string | null } | null = null;
    let formConfig: any = null;

    if (hasContentEdit) {
      const parsed = parseContentEdit(body, existing);
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const edit = parsed.edit;

      // 担当スタッフ変更はフォーム設定から名前・カレンダーを解決する
      if (edit.hasStaffChange) {
        formConfig = await loadFormConfig(adminClient, existing.form_id);
        if (edit.staff_id) {
          const member = (formConfig?.staff_selection?.staff || []).find((m: any) => m && m.id === edit.staff_id);
          if (!member) {
            return NextResponse.json({ error: '指定された担当スタッフがフォームに存在しません' }, { status: 400 });
          }
          staffResolved = {
            staff_id: member.id,
            staff_name: member.name || null,
            staff_calendar_id: member.calendar_id || null,
            event_color_id: member.event_color_id || null,
          };
        } else {
          staffResolved = { staff_id: null, staff_name: null, staff_calendar_id: null, event_color_id: null };
        }
      }

      const working = { ...existing };
      applyContentEdit(working, edit, staffResolved);
      // 宿泊予約: 日程・人数の変更は料金を再計算し、他の予約・カレンダー予定との重なりを確認する
      if (existing.checkout_date && STAY_EDIT_KEYS.some((k) => edit[k] !== undefined)) {
        if (!formConfig) formConfig = await loadFormConfig(adminClient, existing.form_id);
        const applied = applyStayEdit(working, edit, formConfig);
        if (applied.error) return NextResponse.json({ error: applied.error }, { status: 400 });
        try {
          const free = await checkStayNightsFree({
            storeId: existing.store_id,
            settings: sanitizeStaySettings(formConfig?.calendar_settings?.stay_settings),
            nights: applied.nights,
            excludeReservationId: existing.id,
          });
          if (!free.ok) return NextResponse.json({ error: 'その日程は他の予約と重なっています', code: 'slot_taken' }, { status: 409 });
        } catch (e) {
          console.error('[API] stay nights check error (edit):', e);
        }
      }
      // 変更されたカラムだけ更新対象にする
      ['reservation_date', 'reservation_time', 'selected_menus', 'selected_options', 'menu_name', 'submenu_name', 'customer_info', 'staff_id', 'staff_name', 'staff_calendar_id', 'staff_no_preference', 'checkout_date', 'stay_nights', 'guest_counts', 'guest_count', 'stay_price_total']
        .forEach((k) => { if (JSON.stringify(working[k]) !== JSON.stringify(existing[k])) updates[k] = working[k]; });
    }
    if (status !== undefined) updates.status = status;
    // キャンセル料の記録（キャンセル時に確定 / 復元でクリア）
    if (status !== undefined && status !== previousStatus) {
      if (!formConfig) formConfig = await loadFormConfig(adminClient, existing.form_id);
      const feeRow: any = { ...existing, ...updates };
      applyCancelFee(feeRow, body, status, previousStatus, formConfig);
      for (const k of ['cancel_fee_percent', 'cancel_fee_amount', 'cancelled_at']) {
        if (feeRow[k] !== existing[k]) updates[k] = feeRow[k];
      }
    }

    const { data: reservation, error } = await (adminClient as any)
      .from('reservations')
      .update(updates)
      .eq('id', reservationId)
      .select()
      .single();

    if (error || !reservation) {
      console.error('[API] Reservation update error:', error);
      return NextResponse.json(
        { error: '予約の更新に失敗しました' },
        { status: error?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    // CRM 統計の補正
    try {
      if (status !== undefined) {
        await syncCustomerVisitForStatusChange(reservation, previousStatus, status);
      }
      if (hasContentEdit) {
        await syncCustomerVisitForContentChange(reservation);
      }
    } catch (e) {
      console.error('[CRM] visit sync error:', e);
    }
    await syncFollowMessageForChange(reservation, previousStatus, status, updates.reservation_date !== undefined && updates.reservation_date !== existing.reservation_date);

    let calendarSync: 'updated' | 'moved' | 'failed' | 'skipped' | 'deleted' = 'skipped';

    // キャンセル時にGoogleカレンダーのイベントを削除
    // （スタッフ選択予約はスタッフのカレンダーから、それ以外は従来どおり店舗カレンダーから削除）
    if (status === 'cancelled' && reservation.google_calendar_event_id) {
      try {
        let targetCalendarId: string | null = (existing as { staff_calendar_id?: string | null }).staff_calendar_id || null;
        if (!targetCalendarId) {
          const { data: storeData } = await (adminClient as any)
            .from('stores')
            .select('google_calendar_id')
            .eq('id', reservation.store_id)
            .single();
          targetCalendarId = storeData?.google_calendar_id || null;
        }

        if (targetCalendarId) {
          const { deleteCalendarEvent } = await import('@/lib/google-calendar');
          await deleteCalendarEvent(
            targetCalendarId,
            reservation.google_calendar_event_id,
            reservation.store_id
          );
          calendarSync = 'deleted';
        }
      } catch (calendarError) {
        console.error('[API] Calendar event deletion error:', calendarError);
        // カレンダー削除失敗でも予約ステータス更新は成功として返す
      }
    } else if (hasContentEdit && reservation.status !== 'cancelled' && reservation.google_calendar_event_id) {
      // 予約内容の編集をカレンダーイベントに反映（同一カレンダーなら更新、担当変更でカレンダーが変わる場合は移動）
      try {
        const { data: storeData } = await (adminClient as any)
          .from('stores')
          .select('google_calendar_id')
          .eq('id', reservation.store_id)
          .single();
        const storeCalendarId: string | null = storeData?.google_calendar_id || null;
        const oldCalendarId: string | null = existing.staff_calendar_id || storeCalendarId;
        const newCalendarId: string | null = reservation.staff_calendar_id || storeCalendarId;

        if (!formConfig) formConfig = await loadFormConfig(adminClient, reservation.form_id);
        const eventParams = buildEventParamsFromReservation(reservation, newCalendarId || '', formConfig, staffResolved);

        if (newCalendarId) {
          const { updateReservationEvent, createReservationEvent, deleteCalendarEvent } = await import('@/lib/google-calendar');
          if (oldCalendarId === newCalendarId) {
            await updateReservationEvent(reservation.google_calendar_event_id, eventParams, reservation.store_id);
            calendarSync = 'updated';
          } else {
            // カレンダーが変わる: 旧イベント削除 → 新カレンダーに作成 → イベントIDを更新
            if (oldCalendarId) {
              try {
                await deleteCalendarEvent(oldCalendarId, reservation.google_calendar_event_id, reservation.store_id);
              } catch (delErr) {
                console.error('[API] old calendar event delete error:', delErr);
              }
            }
            const newEventId = await createReservationEvent(eventParams, reservation.store_id);
            await (adminClient as any)
              .from('reservations')
              .update({ google_calendar_event_id: newEventId })
              .eq('id', reservationId);
            reservation.google_calendar_event_id = newEventId;
            calendarSync = 'moved';
          }
        }
      } catch (calendarError) {
        console.error('[API] Calendar event update error:', calendarError);
        calendarSync = 'failed';
      }
    }

    return NextResponse.json({ ...reservation, calendar_sync: calendarSync });
  } catch (error) {
    console.error('Reservation update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** 予約行に編集内容を適用する（DB カラム + customer_info の合計値 + 表示用のメニュー名） */
function applyContentEdit(
  row: any,
  edit: ContentEdit,
  staffResolved: { staff_id: string | null; staff_name: string | null; staff_calendar_id: string | null } | null
): void {
  if (edit.reservation_date) row.reservation_date = edit.reservation_date;
  if (edit.reservation_time) row.reservation_time = edit.reservation_time;

  const menus: Array<Record<string, any>> = edit.selected_menus ?? (Array.isArray(row.selected_menus) ? row.selected_menus : []);
  const options: Array<Record<string, any>> = edit.selected_options ?? (Array.isArray(row.selected_options) ? row.selected_options : []);
  if (edit.selected_menus) row.selected_menus = menus;
  if (edit.selected_options) row.selected_options = options;

  if (edit.selected_menus) {
    const first = menus[0] || {};
    row.menu_name = first.menu_name || first.name || '未選択';
    row.submenu_name = first.submenu_name || null;
  }

  const info = (row.customer_info && typeof row.customer_info === 'object') ? { ...row.customer_info } : {};
  const menuOrOptionChanged = !!(edit.selected_menus || edit.selected_options);
  if (edit.total_duration !== undefined) {
    info.total_duration = edit.total_duration;
  } else if (menuOrOptionChanged) {
    const base = sumDuration(menus, options);
    info.total_duration = base > 0 ? base : (info.total_duration ?? 60);
  }
  if (menuOrOptionChanged) {
    info.total_price = sumPrice(menus, options);
  }
  row.customer_info = info;

  if (staffResolved) {
    row.staff_id = staffResolved.staff_id;
    row.staff_name = staffResolved.staff_name;
    row.staff_calendar_id = staffResolved.staff_calendar_id;
    row.staff_no_preference = false;
  }
}

/** フォーム設定を取得（normalize 済み config）。見つからなければ null */
async function loadFormConfig(adminClient: any, formId: string): Promise<any | null> {
  if (!formId) return null;
  try {
    const { data } = await adminClient
      .from('reservation_forms')
      .select('id, store_id, config, draft_config')
      .eq('id', formId)
      .maybeSingle();
    if (!data) return null;
    return normalizeForm(data).config;
  } catch (e) {
    console.error('[API] loadFormConfig error:', e);
    return null;
  }
}

/** 予約行から Google カレンダーイベントの内容を組み立てる（作成時と同じ説明文フォーマット） */
function buildEventParamsFromReservation(
  reservation: any,
  calendarId: string,
  formConfig: any,
  staffResolved: { event_color_id: string | null } | null
) {
  const info = (reservation.customer_info && typeof reservation.customer_info === 'object') ? reservation.customer_info : {};
  const labelOf = (list: any[] | undefined, value: string | null | undefined) => {
    if (!value) return null;
    const opt = (list || []).find((o: any) => o && o.value === value);
    return opt?.label || value;
  };
  const staffColor = staffResolved?.event_color_id
    || (formConfig?.staff_selection?.staff || []).find((m: any) => m && m.id === reservation.staff_id)?.event_color_id
    || null;
  return {
    calendarId,
    reservationDate: String(reservation.reservation_date),
    reservationTime: String(reservation.reservation_time).slice(0, 5),
    customerName: reservation.customer_name,
    customerPhone: reservation.customer_phone,
    lineUserId: reservation.line_user_id || null,
    lineDisplayName: info.line_display_name || null,
    message: reservation.message || info.message || null,
    visitCount: info.visit_count_label || labelOf(formConfig?.visit_count_selection?.options, reservation.visit_count || info.visit_count),
    preferredDate2: info.preferred_date2 || null,
    preferredTime2: info.preferred_time2 || null,
    preferredDate3: info.preferred_date3 || null,
    preferredTime3: info.preferred_time3 || null,
    selectedMenus: Array.isArray(reservation.selected_menus) ? reservation.selected_menus : [],
    selectedOptions: Array.isArray(reservation.selected_options) ? reservation.selected_options : [],
    gender: info.gender_label || labelOf(formConfig?.gender_selection?.options, reservation.gender || info.gender),
    coupon: info.coupon_label || labelOf(formConfig?.coupon_selection?.options, reservation.coupon || info.coupon),
    customFields: (info.custom_fields_labeled && typeof info.custom_fields_labeled === 'object') ? info.custom_fields_labeled : null,
    eventColorId: staffColor || formConfig?.calendar_settings?.event_color_id || null,
    staffName: reservation.staff_name || null,
    durationMinutesOverride: typeof info.total_duration === 'number' && info.total_duration > 0 ? info.total_duration : null,
    // 宿泊予約: 終了はチェックアウト日のチェックアウト時刻
    stay: reservation.checkout_date ? {
      checkoutDate: String(reservation.checkout_date),
      checkOutTime: String(info.check_out_time || formConfig?.calendar_settings?.stay_settings?.check_out_time || '10:00'),
      nights: Number(reservation.stay_nights) || nightsBetween(String(reservation.reservation_date), String(reservation.checkout_date)).length,
      guestText: info.guest_text || null,
      priceText: typeof reservation.stay_price_total === 'number' ? `¥${reservation.stay_price_total.toLocaleString()}` : null,
    } : null,
  };
}

/** local: data/forms*.json からフォーム設定（normalize 済み config）を探す */
async function loadLocalFormConfig(formId: string): Promise<any | null> {
  if (!formId) return null;
  try {
    if (!fs.existsSync(DATA_DIR)) return null;
    for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('forms') && f.endsWith('.json'))) {
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
        const found = Array.isArray(arr) ? arr.find((f: any) => f?.id === formId) : null;
        if (found) return normalizeForm(found).config;
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.error('[API] loadLocalFormConfig error:', e);
  }
  return null;
}
