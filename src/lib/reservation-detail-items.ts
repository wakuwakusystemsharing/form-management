/**
 * 予約内容の項目リスト（メール本文用）
 *
 * 予約フォームの「送信時の項目編集」（config.line_message_items）に合わせて、
 * LINE メッセージと同じ項目・同じ並び順で { label, value } の配列を組み立てる。
 * 純粋関数（DB / fs 非依存）で Vitest 対象。
 */

import type { Form } from '@/types/form';

export interface DetailReservationInput {
  customer_name?: string | null;
  customer_phone?: string | null;
  reservation_date: string;
  reservation_time: string;
  selected_menus?: Array<{
    menu_id?: string;
    menu_name?: string;
    submenu_name?: string;
    category_name?: string;
  }> | null;
  selected_options?: Array<{
    option_name?: string;
    menu_id?: string;
    category_id?: string;
    price?: number;
    duration?: number;
  }> | null;
  customer_info?: {
    gender?: string;
    gender_label?: string;
    visit_count?: string;
    visit_count_label?: string;
    coupon?: string;
    coupon_label?: string;
    custom_fields_labeled?: Record<string, string>;
    total_price?: number;
    total_duration?: number;
    preferred_date2?: string;
    preferred_time2?: string;
    preferred_date3?: string;
    preferred_time3?: string;
    booking_mode?: string;
  } | null;
  message?: string | null;
  staff_name?: string | null;
  staff_no_preference?: boolean | null;
  booking_mode?: string | null;
}

export interface DetailItem {
  label: string;
  value: string;
}

type FormConfigLike = Partial<Form['config']> | null | undefined;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "2026-04-30" + "14:30:00" → "2026年04月30日（木） 14:30" */
export function formatJpDateTime(dateStr: string | null | undefined, timeStr: string | null | undefined): string {
  if (!dateStr || !timeStr) return '';
  const time = String(timeStr).slice(0, 5);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!m) return `${dateStr} ${time}`;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = Number.isNaN(d.getTime()) ? '' : `（${WEEKDAYS[d.getDay()]}）`;
  return `${m[1]}年${m[2]}月${m[3]}日${dow} ${time}`;
}

function formatOptionLine(o: { option_name?: string; price?: number; duration?: number }, showDuration: boolean): string {
  const price = (o.price || 0) > 0 ? ` ¥${Number(o.price).toLocaleString()}` : '';
  const duration = showDuration && (o.duration || 0) > 0 ? ` (${o.duration}分)` : '';
  return `　└ ${o.option_name || ''}${price}${duration}`;
}

/**
 * 《メニュー》テキスト（LINE メッセージと同じ書式）:
 * ・メニュー名（> サブメニュー）+「　└ オプション ¥価格」。カテゴリー名見出しは設定に応じて表示
 */
export function formatMenuText(config: FormConfigLike, reservation: DetailReservationInput): string {
  const items = config?.line_message_items || {};
  const menus = reservation.selected_menus || [];
  const options = reservation.selected_options || [];
  type Group = { category: string; lines: string[]; catOptions: string[] };
  const groups: Group[] = [];
  const getGroup = (name: string): Group => {
    let g = groups.find((x) => x.category === name);
    if (!g) {
      g = { category: name, lines: [], catOptions: [] };
      groups.push(g);
    }
    return g;
  };
  const showOptionLines = items.options !== false;
  const showOptDuration = items.option_duration === true;

  menus.forEach((m) => {
    const label = m.submenu_name ? `${m.menu_name || ''} > ${m.submenu_name}` : m.menu_name || '';
    if (!label) return;
    const g = getGroup(m.category_name || '');
    g.lines.push(`・${label}`);
    if (showOptionLines && m.menu_id) {
      options
        .filter((o) => o.menu_id && o.menu_id === m.menu_id)
        .forEach((o) => g.lines.push(formatOptionLine(o, showOptDuration)));
    }
  });
  // カテゴリー共通オプション（menu_id を持たないもの）は末尾にぶら下げる
  if (showOptionLines) {
    options
      .filter((o) => !o.menu_id)
      .forEach((o) => {
        const g = groups.length > 0 ? groups[groups.length - 1] : getGroup('');
        g.catOptions.push(formatOptionLine(o, showOptDuration));
      });
  }

  const catMode = items.menu_category_display || 'auto';
  const showCategory = catMode === 'show' || (catMode === 'auto' && groups.length > 1);
  return groups
    .map((g) => {
      const lines: string[] = [];
      if (showCategory) lines.push(`-（${g.category || '未分類'}）-`);
      lines.push(...g.lines, ...g.catOptions);
      return lines.join('\n');
    })
    .join('\n');
}

/**
 * 送信時の項目編集に合わせた予約内容の項目リスト。
 * 並び順は LINE メッセージと同じ（お名前 → 電話番号 → 担当スタッフ → 性別 → ご来店回数 → クーポン
 * → カスタム項目 → メニュー → 合計金額 → 合計時間 → 希望日時 → メッセージ）
 */
export function buildReservationDetailItems(config: FormConfigLike, reservation: DetailReservationInput): DetailItem[] {
  const items = (config?.line_message_items || {}) as NonNullable<Form['config']['line_message_items']>;
  const show = (key: keyof NonNullable<Form['config']['line_message_items']>): boolean => items[key] !== false;
  const cs = config?.calendar_settings;
  const info = reservation.customer_info || {};
  const out: DetailItem[] = [];

  if (show('name') && cs?.show_customer_name !== false && (reservation.customer_name || '').trim()) {
    out.push({ label: 'お名前', value: String(reservation.customer_name).trim() });
  }
  if (show('phone') && cs?.show_customer_phone !== false && (reservation.customer_phone || '').trim()) {
    out.push({ label: '電話番号', value: String(reservation.customer_phone).trim() });
  }
  if (show('staff') && config?.staff_selection?.enabled === true) {
    if (reservation.staff_name) {
      out.push({
        label: '担当スタッフ',
        value: reservation.staff_no_preference ? `指名なし（担当: ${reservation.staff_name}）` : reservation.staff_name,
      });
    } else if (reservation.staff_no_preference) {
      out.push({ label: '担当スタッフ', value: '指名なし' });
    }
  }
  if (show('gender') && config?.gender_selection?.enabled) {
    const v = info.gender_label || info.gender;
    if (v) out.push({ label: '性別', value: v });
  }
  if (show('visit_count') && config?.visit_count_selection?.enabled) {
    const v = info.visit_count_label || info.visit_count;
    if (v) out.push({ label: 'ご来店回数', value: v });
  }
  if (show('coupon') && config?.coupon_selection?.enabled) {
    const v = info.coupon_label || info.coupon;
    if (v) out.push({ label: 'クーポン', value: v });
  }
  if (show('custom_fields') && info.custom_fields_labeled && typeof info.custom_fields_labeled === 'object') {
    const labeled = info.custom_fields_labeled;
    const configTitles = (config?.custom_fields || []).map((f) => String(f.title || '').replace(/\s*\r?\n\s*/g, ' ').trim());
    const ordered = [
      ...configTitles.filter((t) => t && Object.prototype.hasOwnProperty.call(labeled, t)),
      ...Object.keys(labeled).filter((t) => !configTitles.includes(t)),
    ];
    ordered.forEach((title) => {
      const v = labeled[title];
      if (v !== undefined && v !== null && String(v).trim()) out.push({ label: title, value: String(v) });
    });
  }
  if (show('menu')) {
    const menuText = formatMenuText(config, reservation);
    if (menuText) out.push({ label: 'メニュー', value: menuText });
  }
  const totalPrice = Number(info.total_price || 0);
  if (show('total_price') && totalPrice > 0) {
    out.push({ label: '合計金額', value: `¥${totalPrice.toLocaleString()}` });
  }
  const totalDuration = Number(info.total_duration || 0);
  if (show('total_duration') && totalDuration > 0) {
    out.push({ label: '合計時間', value: `${totalDuration}分` });
  }
  if (show('datetime')) {
    const mode = reservation.booking_mode || info.booking_mode || cs?.booking_mode || 'calendar';
    const first = formatJpDateTime(reservation.reservation_date, reservation.reservation_time);
    if (mode === 'multiple_dates') {
      out.push({ label: '第一希望日', value: first });
      const second = formatJpDateTime(info.preferred_date2, info.preferred_time2);
      if (second) out.push({ label: '第二希望日', value: second });
      const third = formatJpDateTime(info.preferred_date3, info.preferred_time3);
      if (third) out.push({ label: '第三希望日', value: third });
    } else {
      out.push({ label: 'ご来店日時', value: first });
    }
  }
  if (show('message')) {
    out.push({ label: 'メッセージ', value: (reservation.message || '').trim() || 'なし' });
  }
  return out;
}

// ========== 店舗管理画面（予約詳細）用 ==========

/** フォーム設定からカスタム項目・追加質問の定義を ID で引く（管理画面での表示ラベル・日付整形用） */
function collectFieldDefs(config: FormConfigLike): Map<string, { title: string; type?: string }> {
  const map = new Map<string, { title: string; type?: string }>();
  const push = (list: unknown) => {
    (Array.isArray(list) ? list : []).forEach((q) => {
      const f = q as { id?: string; title?: string; type?: string };
      if (f && f.id && f.title && !map.has(f.id)) {
        map.set(f.id, { title: String(f.title).replace(/\s*\r?\n\s*/g, ' ').trim(), type: f.type });
      }
    });
  };
  const processMenu = (menu: unknown) => {
    const m = menu as { additional_questions?: unknown; options?: Array<{ additional_questions?: unknown }> };
    push(m?.additional_questions);
    (m?.options || []).forEach((o) => push(o?.additional_questions));
  };
  const ms = config?.menu_structure as
    | { categories?: Array<{ menus?: unknown[]; options?: Array<{ additional_questions?: unknown }> }>; menus?: unknown[] }
    | undefined;
  (ms?.categories || []).forEach((cat) => {
    (cat.menus || []).forEach(processMenu);
    (cat.options || []).forEach((o) => push(o?.additional_questions));
  });
  (ms?.menus || []).forEach(processMenu);
  (config?.custom_fields || []).forEach((field) => {
    push([field]);
    ((field as { options?: Array<{ additional_questions?: unknown }> }).options || []).forEach((o) => push(o?.additional_questions));
  });
  return map;
}

function formatFieldValue(raw: unknown, type?: string): string {
  const text = Array.isArray(raw) ? raw.join(', ') : raw == null ? '' : String(raw);
  if (!text.trim()) return '';
  if (type === 'date' || type === 'datetime') {
    const dt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
    if (dt) return `${dt[1]}年${dt[2]}月${dt[3]}日 ${dt[4]}:${dt[5]}`;
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (d) return `${d[1]}年${d[2]}月${d[3]}日`;
  }
  return text;
}

export interface AdminReservationInput extends DetailReservationInput {
  customer_info?: (DetailReservationInput['customer_info'] & { custom_fields?: Record<string, unknown>; notes?: string }) | null;
}

/**
 * 店舗管理画面の予約詳細に出す「予約内容」の行。
 * 送信時の項目編集の ON/OFF は見ない（店舗は入力されたすべてを確認できる）。
 * 並び順は LINE メッセージと同じ。お名前 / 電話番号 / 予約日時（第一希望）は基本情報の固定欄に出すため含めない。
 * カスタム項目は customer_info.custom_fields（ID → 値）をフォーム定義（追加質問含む）で表示名に変換する
 */
export function buildAdminReservationRows(config: FormConfigLike, reservation: AdminReservationInput): DetailItem[] {
  const info = reservation.customer_info || {};
  const rows: DetailItem[] = [];
  const optLabel = (
    opts: Array<{ value: string; label: string }> | undefined,
    v: unknown,
    fallback: Record<string, string>
  ): string => {
    const s = v == null ? '' : String(v);
    if (!s) return '';
    return opts?.find((o) => o.value === s)?.label || fallback[s] || s;
  };

  if (reservation.staff_name) {
    rows.push({
      label: '担当スタッフ',
      value: reservation.staff_no_preference ? `指名なし（担当: ${reservation.staff_name}）` : reservation.staff_name,
    });
  } else if (reservation.staff_no_preference) {
    rows.push({ label: '担当スタッフ', value: '指名なし' });
  }
  const gender = info.gender_label || optLabel(config?.gender_selection?.options, info.gender, { male: '男性', female: '女性' });
  if (gender) rows.push({ label: '性別', value: gender });
  const visit = info.visit_count_label || optLabel(config?.visit_count_selection?.options, info.visit_count, { first: '初回', repeat: '2回目以降' });
  if (visit) rows.push({ label: 'ご来店回数', value: visit });
  const coupon = info.coupon_label || optLabel(config?.coupon_selection?.options, info.coupon, { use: '利用する', not_use: '利用しない' });
  if (coupon) rows.push({ label: 'クーポン', value: coupon });

  // カスタム項目（追加質問含む）: フォーム定義の順 → 定義に無いものは入力順
  const defs = collectFieldDefs(config);
  const raw = info.custom_fields && typeof info.custom_fields === 'object' ? (info.custom_fields as Record<string, unknown>) : null;
  if (raw) {
    const ids = [
      ...Array.from(defs.keys()).filter((id) => Object.prototype.hasOwnProperty.call(raw, id)),
      ...Object.keys(raw).filter((id) => !defs.has(id)),
    ];
    ids.forEach((id) => {
      const def = defs.get(id);
      const value = formatFieldValue(raw[id], def?.type);
      if (value) rows.push({ label: def?.title || id, value });
    });
  } else if (info.custom_fields_labeled && typeof info.custom_fields_labeled === 'object') {
    Object.entries(info.custom_fields_labeled).forEach(([title, v]) => {
      const value = formatFieldValue(v);
      if (value) rows.push({ label: title, value });
    });
  }

  const totalPrice = Number(info.total_price || 0);
  if (totalPrice > 0) rows.push({ label: '合計金額', value: `¥${totalPrice.toLocaleString()}` });
  const totalDuration = Number(info.total_duration || 0);
  if (totalDuration > 0) rows.push({ label: '合計時間', value: `${totalDuration}分` });
  const second = formatJpDateTime(info.preferred_date2, info.preferred_time2);
  if (second) rows.push({ label: '第二希望日', value: second });
  const third = formatJpDateTime(info.preferred_date3, info.preferred_time3);
  if (third) rows.push({ label: '第三希望日', value: third });
  if ((reservation.message || '').trim()) rows.push({ label: 'メッセージ', value: String(reservation.message).trim() });
  if (info.notes && String(info.notes).trim()) rows.push({ label: 'メモ', value: String(info.notes).trim() });
  return rows;
}
