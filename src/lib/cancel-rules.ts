/**
 * キャンセルルール（予約フォーム編集 → 営業時間・ルール → キャンセルルール設定）の純粋ロジック
 *
 * - deadline_hours: 予約日時の何時間前までお客様自身（LINE の「予約をキャンセル」）でキャンセルできるか（0 = いつでも）
 * - policy_text / show_policy_on_form: キャンセル規定の文言をフォームの送信ボタンの上に表示
 * - notify_store_on_cancel: お客様が LINE でキャンセルしたとき店舗へメールで知らせる
 *
 * 店舗管理画面からのキャンセル（管理者操作）には期限を適用しない。
 */
import type { Form } from '@/types/form';

export interface CancelRules {
  deadline_hours: number;
  policy_text: string;
  show_policy_on_form: boolean;
  notify_store_on_cancel: boolean;
}

/** 締切の選択肢（時間）。0 = いつでもキャンセル可 */
export const CANCEL_DEADLINE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'いつでもキャンセル可（制限なし）' },
  { value: 1, label: '1 時間前まで' },
  { value: 2, label: '2 時間前まで' },
  { value: 3, label: '3 時間前まで' },
  { value: 6, label: '6 時間前まで' },
  { value: 12, label: '12 時間前まで' },
  { value: 24, label: '24 時間前まで（前日）' },
  { value: 48, label: '48 時間前まで（2 日前）' },
  { value: 72, label: '72 時間前まで（3 日前）' },
  { value: 168, label: '1 週間前まで' },
];

export const DEFAULT_CANCEL_RULES: CancelRules = {
  deadline_hours: 0,
  policy_text: '',
  show_policy_on_form: false,
  notify_store_on_cancel: false,
};

/** 保存データを既定値で補完する（normalizeForm と Webhook の両方で使う） */
export function resolveCancelRules(config: Partial<Pick<Form['config'], 'cancel_rules'>> | null | undefined): CancelRules {
  const raw = (config?.cancel_rules ?? {}) as Partial<Record<keyof CancelRules, unknown>>;
  const hours = typeof raw.deadline_hours === 'number' && Number.isFinite(raw.deadline_hours) && raw.deadline_hours > 0
    ? Math.floor(raw.deadline_hours)
    : 0;
  return {
    deadline_hours: hours,
    policy_text: typeof raw.policy_text === 'string' ? raw.policy_text : '',
    show_policy_on_form: raw.show_policy_on_form === true,
    notify_store_on_cancel: raw.notify_store_on_cancel === true,
  };
}

/** 予約日時（JST）を Date にする。時刻が無い / 不正なら null */
export function reservationDateTimeJst(reservationDate: string, reservationTime: string | null | undefined): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(reservationDate || ''));
  if (!d) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(String(reservationTime || '00:00'));
  const hh = t ? t[1].padStart(2, '0') : '00';
  const mm = t ? t[2] : '00';
  const dt = new Date(`${d[1]}-${d[2]}-${d[3]}T${hh}:${mm}:00+09:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** お客様がキャンセルできる期限（Date）。制限なし / 判定不能は null */
export function getCancelDeadline(rules: Pick<CancelRules, 'deadline_hours'>, reservationDate: string, reservationTime: string | null | undefined): Date | null {
  if (!rules.deadline_hours || rules.deadline_hours <= 0) return null;
  const at = reservationDateTimeJst(reservationDate, reservationTime);
  if (!at) return null;
  return new Date(at.getTime() - rules.deadline_hours * 3600000);
}

/** 今キャンセルできるか。期限を過ぎていれば allowed: false と期限を返す */
export function isCancelAllowed(
  rules: Pick<CancelRules, 'deadline_hours'>,
  reservationDate: string,
  reservationTime: string | null | undefined,
  now: Date = new Date()
): { allowed: boolean; deadline: Date | null } {
  const deadline = getCancelDeadline(rules, reservationDate, reservationTime);
  if (!deadline) return { allowed: true, deadline: null };
  return { allowed: now.getTime() <= deadline.getTime(), deadline };
}

/** "9/19（土）19:00" 形式（JST） */
export function formatDeadlineJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()];
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${dow}）${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}

/** 期限を過ぎているときに LINE で返す案内文 */
export function buildCancelDeadlineMessage(rules: Pick<CancelRules, 'deadline_hours'>, deadline: Date | null, storePhone?: string | null): string {
  const lines = [
    `このご予約は、ご予約日時の ${rules.deadline_hours} 時間前までキャンセルを受け付けております。`,
  ];
  if (deadline) lines.push(`（キャンセル期限: ${formatDeadlineJst(deadline)}）`);
  lines.push('');
  lines.push('期限を過ぎているため、LINE からはキャンセルできません。');
  lines.push(storePhone ? `お手数ですが店舗（TEL: ${storePhone}）まで直接ご連絡ください。` : 'お手数ですが店舗まで直接ご連絡ください。');
  return lines.join('\n');
}

/** お客様が LINE でキャンセルしたときに店舗へ送るメール */
export function buildCancelNotificationEmail(args: {
  storeName: string;
  reservation: {
    customer_name: string;
    customer_phone?: string | null;
    reservation_date: string;
    reservation_time?: string | null;
    menu_name?: string | null;
    submenu_name?: string | null;
    staff_name?: string | null;
  };
  cancelledAt?: Date;
}): { subject: string; body: string } {
  const r = args.reservation;
  const time = r.reservation_time ? String(r.reservation_time).slice(0, 5) : '';
  const menu = r.submenu_name ? `${r.menu_name || ''} > ${r.submenu_name}` : r.menu_name || '';
  const when = args.cancelledAt ? formatDeadlineJst(args.cancelledAt) : '';
  const lines = [
    '管理者各位',
    '',
    `「${args.storeName}」のご予約がお客様によりキャンセルされました（LINE から操作）。`,
    '',
    '──────────────────────',
    `■ 日時　　：${r.reservation_date}${time ? ' ' + time : ''}`,
    `■ お名前　：${r.customer_name}`,
    `■ 電話　　：${r.customer_phone || '-'}`,
  ];
  if (menu) lines.push(`■ メニュー：${menu}`);
  if (r.staff_name) lines.push(`■ 担当　　：${r.staff_name}`);
  if (when) lines.push(`■ 操作日時：${when}`);
  lines.push('──────────────────────');
  return {
    subject: `【予約キャンセル】${r.customer_name}様｜${r.reservation_date}${time ? ' ' + time : ''}`,
    body: lines.join('\n'),
  };
}
