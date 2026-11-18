/**
 * 空き待ち（キャンセル待ち）で LINE に送るカード（Flex Message）の組み立て。純粋ロジック（Vitest 対象）
 * 見た目は「予約を変更」のカード（reservation-change-flex.ts）に合わせる
 */
import { formatDateTimeShortJa } from './reservation-change';
import { buildWaitlistCancelPostback, waitlistMenuText, type WaitlistEntry } from './waitlist';

export const WAITLIST_THEME_COLOR = '#f7a3a3';
const NOTE = '#555555';
const WARN = '#b45309';

type Obj = Record<string, unknown>;
type CardEntry = Pick<WaitlistEntry, 'id' | 'reservation_date' | 'reservation_time' | 'menu_text' | 'selected_menus' | 'staff_name' | 'status'>;

/** 表示する注意文言（登録しても予約は保証されない / お知らせは先着順） */
export const WAITLIST_NOTICE_NO_GUARANTEE = '空き待ちを登録しても、ご予約をお約束するものではありません。';
export const WAITLIST_NOTICE_FIRST_COME = 'お知らせは登録された方全員にお送りします。ご予約は先着順のため、開いたときには埋まっている場合があります。';

function headerBox(title: string, storeName?: string | null): Obj {
  const contents: Obj[] = [];
  if (storeName) contents.push({ type: 'text', text: storeName, color: '#ffffffcc', size: 'xs' });
  contents.push({ type: 'text', text: title, color: '#ffffff', size: 'lg', weight: 'bold' });
  return {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'box', layout: 'vertical', contents, spacing: 'xs' }],
    paddingAll: '20px',
    backgroundColor: WAITLIST_THEME_COLOR,
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
  return { type: 'flex', altText: altText.slice(0, 400), contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles.slice(0, 12) } };
}

function entryLines(e: CardEntry, dateLabel = '📅 ご希望の日時'): Obj[] {
  const menu = waitlistMenuText(e);
  return [
    { type: 'text', text: dateLabel, size: 'sm', color: WAITLIST_THEME_COLOR, weight: 'bold' },
    { type: 'text', text: formatDateTimeShortJa(e.reservation_date, e.reservation_time), size: 'sm', wrap: true },
    ...(menu
      ? [
          { type: 'text', text: '📋 メニュー', size: 'sm', color: WAITLIST_THEME_COLOR, weight: 'bold', margin: 'md' },
          { type: 'text', text: `・${menu}`, size: 'sm', wrap: true },
        ]
      : []),
    ...(e.staff_name
      ? [
          { type: 'text', text: '👤 担当', size: 'sm', color: WAITLIST_THEME_COLOR, weight: 'bold', margin: 'md' },
          { type: 'text', text: e.staff_name, size: 'sm', wrap: true },
        ]
      : []),
  ];
}

const note = (text: string, color = NOTE): Obj => ({ type: 'text', text, size: 'xs', color, wrap: true, margin: 'md' });

/** タイトルと本文だけのカード */
export function buildWaitlistSimpleMessage(title: string, body: string, storeName?: string | null): Obj {
  return flexMessage(title, [bubble(title, storeName, [{ type: 'text', text: body, size: 'sm', wrap: true, margin: 'md' }])]);
}

/** 登録したとき: 「空き待ちを受け付けました」 */
export function buildWaitlistRegisteredMessage(storeName: string | null | undefined, entry: CardEntry): Obj {
  return flexMessage('空き待ちを受け付けました', [
    bubble('空き待ちを受け付けました', storeName, [
      { type: 'box', layout: 'vertical', spacing: 'sm', contents: entryLines(entry) },
      { type: 'separator', margin: 'lg' },
      { type: 'text', text: 'この日時に空きが出たら、LINE でお知らせします。', size: 'sm', wrap: true, margin: 'lg' },
      note(`※ ${WAITLIST_NOTICE_NO_GUARANTEE}`, WARN),
      note(`※ ${WAITLIST_NOTICE_FIRST_COME}`),
      note('「空き待ち確認」と送ると、登録中の空き待ちの確認・取り消しができます。'),
    ]),
  ]);
}

/** 「空き待ち確認」と送ったとき: 登録中の空き待ち（1 件 1 枚。取り消しボタン付き） */
export function buildWaitlistListMessage(storeName: string | null | undefined, entries: CardEntry[]): Obj {
  if (entries.length === 0) {
    return buildWaitlistSimpleMessage('空き待ち', '現在、登録中の空き待ちはありません。', storeName);
  }
  const total = entries.length;
  const bubbles = entries.slice(0, 10).map((e, i) =>
    bubble(`空き待ち${total > 1 ? ` ${i + 1}/${total}` : ''}`, storeName, [
      { type: 'box', layout: 'vertical', spacing: 'sm', contents: entryLines(e) },
      { type: 'separator', margin: 'lg' },
      note(e.status === 'notified' ? '空きをお知らせ済みです（先着順）。' : '空きが出たら LINE でお知らせします。'),
      {
        type: 'button',
        action: { type: 'postback', label: 'この空き待ちを取り消す', data: buildWaitlistCancelPostback(e.id), displayText: '空き待ちを取り消す' },
        style: 'secondary',
        margin: 'lg',
        height: 'sm',
      },
    ])
  );
  return flexMessage('登録中の空き待ち', bubbles);
}

/** 枠が空いたとき: 予約フォームへのボタン付き */
export function buildWaitlistSlotOpenedMessage(storeName: string | null | undefined, entry: CardEntry, bookingUrl: string | null): Obj {
  const contents: Obj[] = [
    { type: 'text', text: 'お待ちいただいていた日時に空きが出ました。', size: 'sm', wrap: true },
    { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: entryLines(entry, '📅 空きが出た日時') },
    { type: 'separator', margin: 'lg' },
    note(`※ ${WAITLIST_NOTICE_FIRST_COME}`, WARN),
  ];
  if (bookingUrl) {
    contents.push({
      type: 'button',
      action: { type: 'uri', label: 'この日時で予約する', uri: bookingUrl },
      style: 'primary',
      color: WAITLIST_THEME_COLOR,
      margin: 'lg',
      height: 'sm',
    });
  } else {
    contents.push(note('ご予約は、予約フォームからお願いします。'));
  }
  return flexMessage(`【空きが出ました】${formatDateTimeShortJa(entry.reservation_date, entry.reservation_time)}`, [bubble('空きが出ました', storeName, contents)]);
}

/** お知らせした枠が埋まったとき: おわび（空き待ちは続く） */
export function buildWaitlistSlotFilledMessage(storeName: string | null | undefined, entry: CardEntry): Obj {
  return flexMessage('お知らせした枠は埋まりました', [
    bubble('お知らせした枠は埋まりました', storeName, [
      { type: 'text', text: '申し訳ありません。先ほどお知らせした日時は、ほかのお客様のご予約で埋まりました。', size: 'sm', wrap: true },
      { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: entryLines(entry) },
      { type: 'separator', margin: 'lg' },
      note('空き待ちは継続しています。また空きが出たらお知らせします。'),
      note('取り消すときは「空き待ち確認」と送ってください。'),
    ]),
  ]);
}
