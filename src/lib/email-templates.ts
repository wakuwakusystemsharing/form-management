/**
 * 予約完了時に送信するメール本文を組み立てるユーティリティ
 *
 * - お客様向け: 予約確定通知（{{店舗名}} 等のテンプレ差し込み）
 * - 店舗向け: 管理者通知（original/email.gas:564 準拠）
 */

import type { Store } from '@/types/store';

interface SelectedMenuLike {
  menu_name?: string;
  submenu_name?: string;
}

interface SelectedOptionLike {
  option_name?: string;
  price?: number;
  duration?: number;
}

interface ReservationLike {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  reservation_date: string;
  reservation_time: string;
  selected_menus?: SelectedMenuLike[] | null;
  selected_options?: SelectedOptionLike[] | null;
  message?: string | null;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatJpDateTime(dateStr: string, timeStr: string): string {
  // dateStr: "2026-04-30", timeStr: "14:30:00" or "14:30"
  if (!dateStr || !timeStr) return '';
  const time = timeStr.slice(0, 5);
  const d = new Date(`${dateStr}T${time}:00+09:00`);
  if (Number.isNaN(d.getTime())) return `${dateStr} ${time}`;
  const [hour, minute] = time.split(':');
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dow = WEEKDAYS[d.getDay()];
  return `${yyyy}年${mm}月${dd}日（${dow}） ${hour}:${minute}`;
}

function formatMenuList(reservation: ReservationLike): string {
  const menus = reservation.selected_menus || [];
  if (menus.length === 0) return '';
  return menus
    .map((m) => (m.submenu_name ? `${m.menu_name} > ${m.submenu_name}` : m.menu_name || ''))
    .filter(Boolean)
    .join(' / ');
}

function formatOptionsLines(reservation: ReservationLike): string {
  const opts = reservation.selected_options || [];
  if (opts.length === 0) return '';
  return opts
    .map((o) => {
      const name = o.option_name || '';
      const price = (o.price || 0) > 0 ? ` ¥${Number(o.price).toLocaleString()}` : '';
      const duration = (o.duration || 0) > 0 ? ` (${o.duration}分)` : '';
      return `・${name}${price}${duration}`;
    })
    .join('\n');
}

interface BuildArgs {
  store: Pick<Store, 'name' | 'address' | 'phone' | 'postal_code' | 'owner_email'>;
  reservation: ReservationLike;
}

interface BuiltEmail {
  subject: string;
  body: string;
  /** From 表示名（例: 店舗名）。受信トレイで「○○ から」と表示される */
  fromName?: string;
  /** Reply-To。受信者が「返信」したときに届くアドレス */
  replyTo?: string;
}

/**
 * お客様向け予約確定メール
 *
 * - From 表示名: 店舗名（実メアドは EMAIL_FROM_ADDRESS のシステム固定）
 * - Reply-To: 店舗オーナーのメール（お客様の返信が店舗に直接届く）
 */
export function buildCustomerConfirmationEmail({ store, reservation }: BuildArgs): BuiltEmail {
  const dateTimeText = formatJpDateTime(reservation.reservation_date, reservation.reservation_time);
  const menuText = formatMenuList(reservation) || '未設定';
  const optionsText = formatOptionsLines(reservation);
  const messageText = (reservation.message || '').trim() || 'なし';
  const storeName = store.name || '';
  const postal = store.postal_code ? `〒${store.postal_code} ` : '';
  const address = store.address || '';
  const phone = store.phone || '';

  const subject = `【ご予約確定】${dateTimeText}｜${menuText}（予約番号：${reservation.id}）`;

  const lines: string[] = [];
  lines.push(`${reservation.customer_name} 様`);
  lines.push('');
  lines.push(`この度は「${storeName}」へご予約いただきありがとうございます。`);
  lines.push('以下の内容でご予約を承りました。');
  lines.push('');
  lines.push('──────────────────────');
  lines.push('■ ご来店日時');
  lines.push(dateTimeText);
  lines.push('■ 店舗名');
  lines.push(storeName);
  lines.push('■ メニュー');
  lines.push(menuText);
  if (optionsText) {
    lines.push('■ オプション');
    lines.push(optionsText);
  }
  lines.push('■ お客様メッセージ');
  lines.push(messageText);
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
 */
export function buildStoreNotificationEmail({ store, reservation }: BuildArgs): BuiltEmail {
  const dateTimeText = formatJpDateTime(reservation.reservation_date, reservation.reservation_time);
  const menuText = formatMenuList(reservation) || '未設定';
  const optionsText = formatOptionsLines(reservation);

  const subject = `【予約管理通知】ご予約されました｜${reservation.customer_name}様`;

  const lines: string[] = [];
  lines.push('管理者各位');
  lines.push('');
  lines.push(`「${store.name || ''}」に新規のご予約を受付しました。`);
  lines.push('');
  lines.push('──────────────────────');
  lines.push('[予約概要]');
  lines.push(`■ 日時　　：${dateTimeText}`);
  lines.push(`■ メニュー：${menuText}`);
  if (optionsText) {
    lines.push('■ オプション：');
    lines.push(optionsText);
  }
  lines.push('');
  lines.push('[お客様情報]');
  lines.push(`■ お名前：${reservation.customer_name}`);
  lines.push(`■ 電話　：${reservation.customer_phone || '-'}`);
  lines.push(`■ メール：${reservation.customer_email || '-'}`);
  if ((reservation.message || '').trim()) {
    lines.push(`■ メッセージ：${(reservation.message || '').trim()}`);
  }
  lines.push(`■ 予約番号：${reservation.id}`);
  lines.push('──────────────────────');

  return {
    subject,
    body: lines.join('\n'),
    fromName: store.name || undefined,
  };
}
