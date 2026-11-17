/**
 * LINE の「予約を変更」で返すカード（Flex Message）の組み立て。純粋ロジック（Vitest 対象）
 * 見た目は「予約確認」「予約をキャンセル」のカード（Webhook の makeHeaderBox）に合わせる
 */
import {
  buildChangePostback,
  formatDateShortJa,
  formatDateTimeShortJa,
  type ChangeDay,
  type ChangeSlot,
} from './reservation-change';

export const CHANGE_THEME_COLOR = '#f7a3a3';
const OK_COLOR = '#16a34a';
const MUTED = '#9ca3af';
const NOTE = '#555555';
const WARN = '#b45309';

type Obj = Record<string, unknown>;

export interface ChangeCardReservation {
  id: string;
  reservation_date: string;
  reservation_time?: string | null;
  menu_name?: string | null;
  submenu_name?: string | null;
  staff_name?: string | null;
  staff_no_preference?: boolean | null;
}

function headerBox(title: string, storeName?: string | null): Obj {
  const contents: Obj[] = [];
  if (storeName) contents.push({ type: 'text', text: storeName, color: '#ffffffcc', size: 'xs' });
  contents.push({ type: 'text', text: title, color: '#ffffff', size: 'lg', weight: 'bold' });
  return {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'box', layout: 'vertical', contents, spacing: 'xs' }],
    paddingAll: '20px',
    backgroundColor: CHANGE_THEME_COLOR,
    paddingTop: '15px',
    paddingBottom: '15px',
  };
}

function bubble(title: string, storeName: string | null | undefined, contents: Obj[]): Obj {
  return {
    type: 'bubble',
    size: 'mega',
    header: headerBox(title, storeName),
    body: { type: 'box', layout: 'vertical', contents, paddingAll: '20px' },
  };
}

function flexMessage(altText: string, bubbles: Obj[]): Obj {
  return { type: 'flex', altText, contents: { type: 'carousel', contents: bubbles.slice(0, 12) } };
}

function menuText(r: ChangeCardReservation): string {
  const menu = r.submenu_name ? `${r.menu_name || ''} > ${r.submenu_name}` : r.menu_name || '';
  return menu && menu !== '未選択' ? menu : '';
}

/** 予約内容（日時・メニュー・担当）の行 */
function reservationLines(r: ChangeCardReservation, dateLabel = '📅 日時'): Obj[] {
  const menu = menuText(r);
  return [
    { type: 'text', text: dateLabel, size: 'sm', color: CHANGE_THEME_COLOR, weight: 'bold' },
    { type: 'text', text: formatDateTimeShortJa(r.reservation_date, r.reservation_time), size: 'sm', wrap: true },
    ...(menu
      ? [
          { type: 'text', text: '📋 メニュー', size: 'sm', color: CHANGE_THEME_COLOR, weight: 'bold', margin: 'md' },
          { type: 'text', text: `・${menu}`, size: 'sm', wrap: true },
        ]
      : []),
    ...(r.staff_name
      ? [
          { type: 'text', text: '👤 担当', size: 'sm', color: CHANGE_THEME_COLOR, weight: 'bold', margin: 'md' },
          { type: 'text', text: `${r.staff_name}${r.staff_no_preference ? '（指名なし）' : ''}`, size: 'sm', wrap: true },
        ]
      : []),
  ];
}

function button(label: string, action: Obj, style: 'primary' | 'secondary' = 'primary'): Obj {
  return {
    type: 'button',
    action: { ...action, label },
    style,
    ...(style === 'primary' ? { color: CHANGE_THEME_COLOR } : {}),
    margin: 'md',
    height: 'sm',
  };
}

const postback = (data: string, displayText: string): Obj => ({ type: 'postback', data, displayText });

/** タイトルと本文だけのカード */
export function buildChangeSimpleMessage(title: string, body: string, storeName?: string | null): Obj {
  return flexMessage(title, [bubble(title, storeName, [{ type: 'text', text: body, size: 'sm', wrap: true, margin: 'md' }])]);
}

export interface ChangeMenuItem {
  reservation: ChangeCardReservation;
  allowed: boolean;
  /** 変更できないときの案内文 */
  blockText?: string;
  mode: 'calendar' | 'form_only';
  /** 予約フォームを変更用に開く URL（LIFF）。無ければ「メニューを変更」を出さない */
  formUrl?: string | null;
  /** 変更の期限の表示（例: 11/19（木）14:00）。期限なしは null */
  deadlineText?: string | null;
}

/** 「予約を変更」と送ったときの最初のカード（予約ごとに 1 枚。日時 / 時間 / メニューの変更ボタン） */
export function buildChangeMenuMessage(storeName: string | null | undefined, items: ChangeMenuItem[]): Obj {
  const total = items.length;
  const bubbles = items.slice(0, 10).map((item, i) => {
    const r = item.reservation;
    const contents: Obj[] = [
      { type: 'text', text: '変更するご予約', size: 'xs', color: NOTE },
      { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: reservationLines(r) },
      { type: 'separator', margin: 'lg' },
    ];
    if (!item.allowed) {
      contents.push({ type: 'text', text: item.blockText || 'このご予約は LINE から変更できません。', size: 'xs', wrap: true, color: WARN, margin: 'lg' });
    } else if (item.mode === 'calendar') {
      contents.push(
        { type: 'text', text: '変更したい内容を選んでください', size: 'xs', color: NOTE, margin: 'lg', align: 'center' },
        button('日時を変更', postback(buildChangePostback({ kind: 'dates', reservationId: r.id, page: 0 }), '日時を変更')),
        button('時間を変更（同じ日）', postback(buildChangePostback({ kind: 'times', reservationId: r.id, date: r.reservation_date }), '時間を変更')),
        ...(item.formUrl ? [button('メニューを変更', { type: 'uri', uri: item.formUrl })] : [])
      );
      if (item.deadlineText) contents.push({ type: 'text', text: `変更できるのは ${item.deadlineText} までです。`, size: 'xxs', color: NOTE, wrap: true, margin: 'md' });
    } else if (item.formUrl) {
      contents.push(
        { type: 'text', text: '予約フォームを開いて、内容を選び直してください。送信すると、このご予約が新しい内容に置き換わります。', size: 'xs', color: NOTE, margin: 'lg', wrap: true },
        button('予約内容を変更', { type: 'uri', uri: item.formUrl })
      );
    } else {
      contents.push({ type: 'text', text: 'このご予約は LINE から変更できません。店舗まで直接ご連絡ください。', size: 'xs', wrap: true, color: WARN, margin: 'lg' });
    }
    return bubble(`【予約の変更】${total > 1 ? ` ${i + 1}/${total}` : ''}`, storeName, contents);
  });
  return flexMessage('予約の変更', bubbles);
}

export interface ChangeDatesArgs {
  storeName?: string | null;
  reservation: ChangeCardReservation;
  /** このページに出す日付（定休日などは除いたもの） */
  days: ChangeDay[];
  /** 何日先まで選べるか（注意書き用） */
  windowDays: number;
  /** 選べる最後の日付 */
  lastDate: string;
  /** 続きのページ番号（無ければ null） */
  nextPage: number | null;
}

/** 日付を選ぶカード（1 枚に 7 日ぶん。空きのある日だけ押せる） */
export function buildChangeDatesMessage(args: ChangeDatesArgs): Obj {
  const r = args.reservation;
  const note = `今日から ${args.windowDays} 日先（${formatDateShortJa(args.lastDate)}）までの日付に変更できます。`;
  const shown = args.days.filter((d) => d.status !== 'closed');
  if (shown.length === 0) {
    return flexMessage('日時を変更', [
      bubble('【日時を変更】', args.storeName, [
        { type: 'text', text: 'この期間に変更できる日付がありません。', size: 'sm', wrap: true, margin: 'md' },
        { type: 'text', text: note, size: 'xs', color: NOTE, wrap: true, margin: 'md' },
        ...(args.nextPage !== null
          ? [button('続きの日付を見る', postback(buildChangePostback({ kind: 'dates', reservationId: r.id, page: args.nextPage }), '続きの日付を見る'), 'secondary')]
          : []),
      ]),
    ]);
  }
  const chunks: ChangeDay[][] = [];
  for (let i = 0; i < shown.length; i += 7) chunks.push(shown.slice(i, i + 7));
  const bubbles = chunks.slice(0, 10).map((chunk, i, all) => {
    const rows: Obj[] = chunk.map((d) => {
      const open = d.status === 'open';
      return {
        type: 'box',
        layout: 'horizontal',
        paddingAll: '10px',
        margin: 'sm',
        cornerRadius: '8px',
        borderWidth: '1px',
        borderColor: open ? CHANGE_THEME_COLOR : '#e5e7eb',
        backgroundColor: open ? '#ffffff' : '#f3f4f6',
        contents: [
          { type: 'text', text: formatDateShortJa(d.date), size: 'sm', weight: 'bold', color: open ? '#111827' : MUTED, flex: 3 },
          { type: 'text', text: open ? '〇 空きあり' : '✕ 空きなし', size: 'sm', color: open ? OK_COLOR : MUTED, align: 'end', flex: 2 },
        ],
        ...(open ? { action: postback(buildChangePostback({ kind: 'times', reservationId: r.id, date: d.date }), formatDateShortJa(d.date)) } : {}),
      };
    });
    const contents: Obj[] = [
      { type: 'text', text: `現在のご予約：${formatDateTimeShortJa(r.reservation_date, r.reservation_time)}`, size: 'xs', color: NOTE, wrap: true },
      { type: 'text', text: '変更したい日付を選んでください', size: 'sm', weight: 'bold', margin: 'md' },
      { type: 'box', layout: 'vertical', margin: 'md', contents: rows },
      { type: 'text', text: note, size: 'xxs', color: NOTE, wrap: true, margin: 'lg' },
    ];
    if (i === all.length - 1 && args.nextPage !== null) {
      contents.push(button('続きの日付を見る', postback(buildChangePostback({ kind: 'dates', reservationId: r.id, page: args.nextPage }), '続きの日付を見る'), 'secondary'));
    }
    return bubble(`【日時を変更】${all.length > 1 ? ` ${i + 1}/${all.length}` : ''}`, args.storeName, contents);
  });
  return flexMessage('日時を変更（日付を選んでください）', bubbles);
}

export interface ChangeTimesArgs {
  storeName?: string | null;
  reservation: ChangeCardReservation;
  date: string;
  slots: ChangeSlot[];
}

const SLOTS_PER_BUBBLE = 30;
const SLOTS_PER_ROW = 3;

/** 時間を選ぶカード（〇 = 変更できる / ✕ = 変更できない。いまの予約の時間は「現在」） */
export function buildChangeTimesMessage(args: ChangeTimesArgs): Obj {
  const r = args.reservation;
  const currentTime = r.reservation_date === args.date ? String(r.reservation_time || '').slice(0, 5) : '';
  const backButton = button('ほかの日付を選ぶ', postback(buildChangePostback({ kind: 'dates', reservationId: r.id, page: 0 }), 'ほかの日付を選ぶ'), 'secondary');
  const selectable = args.slots.filter((s) => s.ok && s.time !== currentTime);
  if (selectable.length === 0) {
    return flexMessage('時間を変更', [
      bubble('【時間を変更】', args.storeName, [
        { type: 'text', text: formatDateShortJa(args.date), size: 'md', weight: 'bold', margin: 'md' },
        { type: 'text', text: 'この日は変更できる時間がありません。ほかの日付をお選びください。', size: 'sm', wrap: true, margin: 'md' },
        backButton,
      ]),
    ]);
  }
  const cell = (s: ChangeSlot | null): Obj => {
    if (!s) return { type: 'box', layout: 'vertical', contents: [{ type: 'filler' }], flex: 1 };
    const isCurrent = s.time === currentTime;
    const ok = s.ok && !isCurrent;
    return {
      type: 'box',
      layout: 'vertical',
      flex: 1,
      paddingAll: '8px',
      cornerRadius: '8px',
      borderWidth: '1px',
      borderColor: ok ? CHANGE_THEME_COLOR : '#e5e7eb',
      backgroundColor: ok ? '#ffffff' : '#f3f4f6',
      contents: [
        { type: 'text', text: isCurrent ? '現在' : ok ? '〇' : '✕', size: 'xs', align: 'center', color: ok ? OK_COLOR : MUTED, weight: 'bold' },
        { type: 'text', text: s.time, size: 'sm', align: 'center', color: ok ? '#111827' : MUTED, weight: 'bold' },
      ],
      ...(ok ? { action: postback(buildChangePostback({ kind: 'confirm', reservationId: r.id, date: args.date, time: s.time }), `${formatDateShortJa(args.date)} ${s.time}`) } : {}),
    };
  };
  const chunks: ChangeSlot[][] = [];
  for (let i = 0; i < args.slots.length; i += SLOTS_PER_BUBBLE) chunks.push(args.slots.slice(i, i + SLOTS_PER_BUBBLE));
  const bubbles = chunks.slice(0, 10).map((chunk, i, all) => {
    const rows: Obj[] = [];
    for (let j = 0; j < chunk.length; j += SLOTS_PER_ROW) {
      const rowSlots: Array<ChangeSlot | null> = chunk.slice(j, j + SLOTS_PER_ROW);
      while (rowSlots.length < SLOTS_PER_ROW) rowSlots.push(null);
      rows.push({ type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'sm', contents: rowSlots.map(cell) });
    }
    return bubble(`【時間を変更】${all.length > 1 ? ` ${i + 1}/${all.length}` : ''}`, args.storeName, [
      { type: 'text', text: `現在のご予約：${formatDateTimeShortJa(r.reservation_date, r.reservation_time)}`, size: 'xs', color: NOTE, wrap: true },
      { type: 'text', text: `${formatDateShortJa(args.date)} の時間を選んでください`, size: 'sm', weight: 'bold', margin: 'md', wrap: true },
      { type: 'box', layout: 'vertical', margin: 'md', contents: rows },
      { type: 'text', text: '〇 = 変更できます　✕ = 変更できません', size: 'xxs', color: NOTE, margin: 'lg' },
      ...(i === all.length - 1 ? [backButton] : []),
    ]);
  });
  return flexMessage('時間を変更（時間を選んでください）', bubbles);
}

/** 変更前 → 変更後 を見せて確定してもらうカード */
export function buildChangeConfirmMessage(storeName: string | null | undefined, r: ChangeCardReservation, date: string, time: string): Obj {
  return flexMessage('予約変更の確認', [
    bubble('【変更内容の確認】', storeName, [
      { type: 'text', text: '変更前', size: 'sm', color: CHANGE_THEME_COLOR, weight: 'bold', margin: 'md' },
      { type: 'text', text: formatDateTimeShortJa(r.reservation_date, r.reservation_time), size: 'sm', color: MUTED, decoration: 'line-through' },
      { type: 'text', text: '変更後', size: 'sm', color: CHANGE_THEME_COLOR, weight: 'bold', margin: 'lg' },
      { type: 'text', text: formatDateTimeShortJa(date, time), size: 'lg', weight: 'bold' },
      ...(menuText(r) ? [{ type: 'text', text: `メニュー：${menuText(r)}`, size: 'xs', color: NOTE, wrap: true, margin: 'lg' }] : []),
      { type: 'text', text: 'よろしければ下のボタンを押してください。', size: 'xs', color: NOTE, wrap: true, margin: 'md' },
      button('この日時に変更する', postback(buildChangePostback({ kind: 'apply', reservationId: r.id, date, time }), 'この日時に変更する')),
      button('ほかの日時を選ぶ', postback(buildChangePostback({ kind: 'dates', reservationId: r.id, page: 0 }), 'ほかの日時を選ぶ'), 'secondary'),
    ]),
  ]);
}

/** 変更完了のカード（r は変更後の予約） */
export function buildChangeDoneMessage(
  storeName: string | null | undefined,
  before: { reservation_date: string; reservation_time?: string | null },
  r: ChangeCardReservation
): Obj {
  return flexMessage('予約を変更しました', [
    bubble('【予約変更完了】', storeName, [
      { type: 'text', text: 'ご予約を変更しました', weight: 'bold', size: 'md', align: 'center', margin: 'lg' },
      { type: 'separator', margin: 'lg' },
      { type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm', contents: reservationLines(r, '📅 新しい日時') },
      { type: 'text', text: `変更前：${formatDateTimeShortJa(before.reservation_date, before.reservation_time)}`, size: 'xs', color: MUTED, margin: 'lg', wrap: true },
      { type: 'separator', margin: 'lg' },
      { type: 'text', text: 'ご来店心よりお待ちしております。', size: 'sm', align: 'center', margin: 'lg', color: NOTE, wrap: true },
    ]),
  ]);
}
