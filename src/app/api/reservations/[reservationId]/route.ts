import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import {
  createCustomerVisit,
  deleteCustomerVisitByReservation,
  findCustomerVisitByReservation,
  recalculateCustomerStats,
  calculateTotalAmount,
} from '@/lib/customer-utils';

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
 * PATCH /api/reservations/[reservationId]
 * 予約ステータスの更新（管理者用）
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> }
) {
  try {
    const { reservationId } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: '有効なステータスを指定してください（pending, confirmed, cancelled, completed）' },
        { status: 400 }
      );
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

      const previousStatus = reservations[index].status;
      reservations[index].status = status;
      reservations[index].updated_at = new Date().toISOString();
      writeReservations(reservations);

      // CRM 統計の補正
      try {
        await syncCustomerVisitForStatusChange(reservations[index], previousStatus, status);
      } catch (e) {
        console.error('[CRM] visit sync error (local):', e);
      }

      return NextResponse.json(reservations[index]);
    }

    // staging/production: Supabase を更新
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 変更前のステータスを取得
    const { data: previous } = await (adminClient as any)
      .from('reservations')
      .select('status')
      .eq('id', reservationId)
      .maybeSingle();
    const previousStatus = previous?.status as string | undefined;

    const { data: reservation, error } = await (adminClient as any)
      .from('reservations')
      .update({ status, updated_at: new Date().toISOString() })
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
      await syncCustomerVisitForStatusChange(reservation, previousStatus, status);
    } catch (e) {
      console.error('[CRM] visit sync error:', e);
    }

    // キャンセル時にGoogleカレンダーのイベントを削除
    if (status === 'cancelled' && reservation.google_calendar_event_id) {
      try {
        const { data: storeData } = await (adminClient as any)
          .from('stores')
          .select('google_calendar_id')
          .eq('id', reservation.store_id)
          .single();

        if (storeData?.google_calendar_id) {
          const { deleteCalendarEvent } = await import('@/lib/google-calendar');
          await deleteCalendarEvent(
            storeData.google_calendar_id,
            reservation.google_calendar_event_id,
            reservation.store_id
          );
        }
      } catch (calendarError) {
        console.error('[API] Calendar event deletion error:', calendarError);
        // カレンダー削除失敗でも予約ステータス更新は成功として返す
      }
    }

    return NextResponse.json(reservation);
  } catch (error) {
    console.error('Reservation update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
