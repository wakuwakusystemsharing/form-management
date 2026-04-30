/**
 * 予約完了時のメール送信オーケストレーション
 *
 * /api/reservations から非ブロッキングで呼び出される。
 * - お客様向け: customer_email が存在すれば送信
 * - 店舗向け:  form.config.calendar_settings.notification_email > store.owner_email
 *             の優先順位でフォールバック
 */

import type { Store } from '@/types/store';
import type { Form } from '@/types/form';
import { sendEmail } from './email-sender';
import { buildCustomerConfirmationEmail, buildStoreNotificationEmail } from './email-templates';

interface ReservationLike {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  reservation_date: string;
  reservation_time: string;
  selected_menus?: any[] | null;
  selected_options?: any[] | null;
  message?: string | null;
}

export async function sendReservationEmails({
  reservation,
  store,
  form,
}: {
  reservation: ReservationLike;
  store: Pick<Store, 'name' | 'address' | 'phone' | 'postal_code' | 'owner_email'>;
  form: Pick<Form, 'config'>;
}): Promise<void> {
  // お客様向けメール
  const customerEmail = (reservation.customer_email || '').trim();
  if (customerEmail) {
    try {
      const built = buildCustomerConfirmationEmail({ store, reservation });
      const result = await sendEmail({
        to: customerEmail,
        subject: built.subject,
        body: built.body,
        fromName: built.fromName,
        replyTo: built.replyTo,
      });
      if (!result.ok) {
        console.warn(`[reservation-email] customer mail skipped/failed: ${result.error}`);
      }
    } catch (err) {
      console.error('[reservation-email] customer mail error:', err);
    }
  }

  // 店舗向けメール
  const overrideEmail = (form.config?.calendar_settings?.notification_email || '').trim();
  const storeRecipient = overrideEmail || (store.owner_email || '').trim();
  if (storeRecipient) {
    try {
      const built = buildStoreNotificationEmail({ store, reservation });
      const result = await sendEmail({
        to: storeRecipient,
        subject: built.subject,
        body: built.body,
        fromName: built.fromName,
        replyTo: built.replyTo,
      });
      if (!result.ok) {
        console.warn(`[reservation-email] store mail skipped/failed: ${result.error}`);
      }
    } catch (err) {
      console.error('[reservation-email] store mail error:', err);
    }
  } else {
    console.warn('[reservation-email] no store recipient (notification_email/owner_email both empty)');
  }
}
