/**
 * 予約完了時に送信するメール本文を組み立てるユーティリティ
 *
 * - お客様向け: 予約確定通知
 * - 店舗向け: 管理者通知
 *
 * 予約内容の項目は予約フォームの「送信時の項目編集」（config.line_message_items）に従い、
 * LINE メッセージと同じ項目・並び順で載せる（`buildReservationDetailItems`）。
 */

import type { Store } from '@/types/store';
import type { Form } from '@/types/form';
import { buildReservationDetailItems, formatJpDateTime, type DetailReservationInput } from './reservation-detail-items';

export interface EmailReservationLike extends DetailReservationInput {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
}

interface BuildArgs {
  store: Pick<Store, 'name' | 'address' | 'phone' | 'postal_code' | 'owner_email'>;
  reservation: EmailReservationLike;
  /** 予約フォーム（送信時の項目編集の参照用）。未指定 = 既定（全項目 ON） */
  form?: { config?: Partial<Form['config']> | null } | null;
}

interface BuiltEmail {
  subject: string;
  body: string;
  /** From 表示名（例: 店舗名）。受信トレイで「○○ から」と表示される */
  fromName?: string;
  /** Reply-To。受信者が「返信」したときに届くアドレス */
  replyTo?: string;
}

function formatMenuSubject(reservation: EmailReservationLike): string {
  const menus = reservation.selected_menus || [];
  return menus
    .map((m) => (m.submenu_name ? `${m.menu_name} > ${m.submenu_name}` : m.menu_name || ''))
    .filter(Boolean)
    .join(' / ');
}

/**
 * お客様向け予約確定メール
 *
 * - From 表示名: 店舗名（実メアドは EMAIL_FROM_ADDRESS のシステム固定）
 * - Reply-To: 店舗オーナーのメール（お客様の返信が店舗に直接届く）
 */
export function buildCustomerConfirmationEmail({ store, reservation, form }: BuildArgs): BuiltEmail {
  const dateTimeText = formatJpDateTime(reservation.reservation_date, reservation.reservation_time);
  const menuText = formatMenuSubject(reservation) || '未設定';
  const storeName = store.name || '';
  const postal = store.postal_code ? `〒${store.postal_code} ` : '';
  const address = store.address || '';
  const phone = store.phone || '';
  const items = buildReservationDetailItems(form?.config, reservation);

  const subject = `【ご予約確定】${dateTimeText}｜${menuText}`;

  const lines: string[] = [];
  lines.push(`${reservation.customer_name} 様`);
  lines.push('');
  lines.push(`この度は「${storeName}」へご予約いただきありがとうございます。`);
  lines.push('以下の内容でご予約を承りました。');
  lines.push('');
  lines.push('──────────────────────');
  lines.push('■ 店舗名');
  lines.push(storeName);
  items.forEach((item) => {
    lines.push(`■ ${item.label}`);
    lines.push(item.value);
  });
  lines.push('──────────────────────');
  lines.push(storeName);
  if (postal || address) lines.push(`${postal}${address}`.trim());
  if (phone) lines.push(`TEL：${phone}`);
  lines.push('──────────────────────');
  lines.push('');
  lines.push('※本メールは自動送信です。ご返信は店舗まで直接届きます。');
  lines.push('※ご予約に関してご不明点がある場合は、お電話にてお問い合わせください。');

  return {
    subject,
    body: lines.join('\n'),
    fromName: storeName || undefined,
    replyTo: store.owner_email || undefined,
  };
}

/**
 * 店舗向け予約管理通知メール
 *
 * - From 表示名: 店舗名（システムドメインから送信されつつ、店舗単位で識別しやすく）
 * - Reply-To は設定しない（送信元 = システム、店舗オーナーから店舗オーナーへ返信は無意味）
 * - 予約内容は送信時の項目編集に従う。お客様の連絡先（お名前 / 電話 / メール）は店舗が連絡に使うため常に載せる
 */
export function buildStoreNotificationEmail({ store, reservation, form }: BuildArgs): BuiltEmail {
  const items = buildReservationDetailItems(form?.config, reservation);

  const subject = `【予約管理通知】ご予約されました｜${reservation.customer_name}様`;

  const lines: string[] = [];
  lines.push('管理者各位');
  lines.push('');
  lines.push(`「${store.name || ''}」に新規のご予約を受付しました。`);
  lines.push('');
  lines.push('──────────────────────');
  lines.push('[予約内容]');
  items.forEach((item) => {
    if (item.value.includes('\n')) {
      lines.push(`■ ${item.label}：`);
      lines.push(item.value);
    } else {
      lines.push(`■ ${item.label}：${item.value}`);
    }
  });
  lines.push('');
  lines.push('[お客様情報]');
  lines.push(`■ お名前：${reservation.customer_name}`);
  lines.push(`■ 電話　：${reservation.customer_phone || '-'}`);
  lines.push(`■ メール：${reservation.customer_email || '-'}`);
  lines.push('──────────────────────');

  return {
    subject,
    body: lines.join('\n'),
    fromName: store.name || undefined,
  };
}
