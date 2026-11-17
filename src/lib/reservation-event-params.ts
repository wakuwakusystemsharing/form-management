/**
 * 予約行 → Google カレンダーの予定の内容。
 * 管理画面からの予約編集（PATCH /api/reservations/{id}）と、LINE の「予約を変更」の両方で使う
 */
import { nightsBetween } from '@/lib/stay-availability';

/** 予約行から Google カレンダーイベントの内容を組み立てる（作成時と同じ説明文フォーマット） */
export function buildEventParamsFromReservation(
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
