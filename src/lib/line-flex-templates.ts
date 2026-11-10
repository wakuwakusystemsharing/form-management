/**
 * 公式 LINE の Flex Message をテンプレートから組み立てる純粋ロジック（DB / LINE API 非依存）
 *
 * - buildTemplateFlex(template, data) … 入力値 → contents（bubble / carousel）
 * - instrumentFlexLinks(contents, baseUrl, id) … ボタン等の URL を計測リンク /go/{id}/{key} に置き換える
 * - validateFlexContents / normalizeKeywords / buildLinePayload … 保存時の検証
 * - menuCarouselFromForm / storeCardFromStore … 既存データからの下書き
 *
 * LINE の制限: Flex の JSON は 30KB まで、カルーセルは 12 バブルまで、altText は 400 文字まで
 */
import type {
  BookingCardData,
  CouponCardData,
  FlexButtonInput,
  FlexContainer,
  LineFlexTemplate,
  LineFlexTemplateData,
  MenuCarouselData,
  MenuCarouselItem,
  MenuListData,
  NoticeCardData,
  StaffCarouselData,
  StaffCarouselItem,
  StepsCardData,
  StoreCardData,
} from '@/types/line-flex';

import { isBranchLink } from '@/lib/line-flex-branch';
import { buildScenarioFlex, defaultScenarioData } from '@/lib/line-flex-scenario';
import type { ScenarioData } from '@/types/line-flex';

export const LINE_FLEX_TEMPLATES: Array<{ id: LineFlexTemplate; label: string; description: string }> = [
  { id: 'custom', label: 'JSON から作成（上級者向け）', description: 'LINE の Flex Message Simulator などで作った JSON を貼り付ける' },
  { id: 'booking_card', label: '予約導線カード', description: '画像 + 見出し + 説明 + ボタン（予約フォーム / 電話 / 地図など最大 3 つ）。いちばん使われる形' },
  { id: 'menu_carousel', label: 'メニュー・料金カルーセル', description: '横にスワイプするカード列（最大 12 枚）。予約フォームのメニュー構成から下書きを作れる' },
  { id: 'menu_list', label: '料金表（リスト）', description: '1 枚のカードにメニュー名と料金を縦に並べる（最大 15 行）。スワイプなしで全部見せたいとき' },
  { id: 'store_card', label: '店舗紹介カード', description: '営業時間・電話・住所（地図）・公式サイト・予約ボタン。店舗情報から自動で埋める' },
  { id: 'coupon_card', label: 'クーポン・キャンペーン', description: '割引を大きく見せるカード。有効期限・利用条件・提示コード・ボタン' },
  { id: 'notice_card', label: 'お知らせ・営業案内', description: '色付きの見出し帯 + 日付 + 本文（臨時休業・新メニュー・イベント告知など）' },
  { id: 'staff_carousel', label: 'スタッフ紹介カルーセル', description: '写真・名前・得意分野・ひとことを横に並べる。指名予約のボタン付き' },
  { id: 'steps_card', label: 'ご利用の流れ', description: '番号付きのステップで予約〜来店までの流れを案内。初めてのお客様向け' },
  { id: 'scenario', label: '分岐アンケート（かんたん）', description: '質問 → 選択肢 → 選んだら次の質問や結果を出す。ボタンを押すたびに次のカードが届く（タグ付け・集計つき）' },
];
export const LINE_FLEX_MENU_LIST_MAX = 15;
export const LINE_FLEX_STEPS_MAX = 8;

export const LINE_FLEX_MAX_JSON_BYTES = 30 * 1024;
export const LINE_FLEX_ALT_TEXT_MAX = 400;
export const LINE_FLEX_KEYWORD_MAX = 10;
export const LINE_FLEX_KEYWORD_LEN_MAX = 50;
export const LINE_FLEX_CAROUSEL_MAX = 12;
export const LINE_FLEX_BUTTONS_MAX = 3;
export const LINE_FLEX_NAME_MAX = 60;
export const LINE_FLEX_DEFAULT_COLOR = '#06C755';
export const LINE_FLEX_ID_PATTERN = /^[a-z0-9]{12}$/;

const TEXT_MUTED = '#666666';
const TEXT_DARK = '#222222';

function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}
function color(v: unknown): string {
  return isHex(v) ? v : LINE_FLEX_DEFAULT_COLOR;
}
/** ボタンのリンク先として使える値（https / tel / 分岐 = `next:{メッセージID}`） */
export function isFlexActionUrl(url: unknown): url is string {
  return typeof url === 'string' && (/^https:\/\/\S+$/i.test(url.trim()) || /^tel:[0-9+\-()]+$/i.test(url.trim()) || isBranchLink(url.trim()));
}
function isHttpsImage(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/\S+$/i.test(url.trim());
}
function nonEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
/** Flex の text は空文字不可 */
function textOrSpace(v: string): string {
  return v || ' ';
}

function buttonComponent(btn: FlexButtonInput, accent: string, primary: boolean): Record<string, unknown> | null {
  const label = nonEmpty(btn.label).slice(0, 40);
  const url = nonEmpty(btn.url);
  if (!label || !isFlexActionUrl(url)) return null;
  return {
    type: 'button',
    style: primary ? 'primary' : 'secondary',
    height: 'sm',
    ...(primary ? { color: accent } : {}),
    action: { type: 'uri', label, uri: url },
  };
}

function heroImage(url: unknown, aspectRatio = '20:13'): Record<string, unknown> | null {
  if (!isHttpsImage(url)) return null;
  return { type: 'image', url: String(url).trim(), size: 'full', aspectRatio, aspectMode: 'cover' };
}

// ---------------------------------------------------------------------------
// テンプレート
// ---------------------------------------------------------------------------

export function buildBookingCardFlex(data: BookingCardData): FlexContainer | null {
  const title = nonEmpty(data.title);
  const text = nonEmpty(data.text);
  if (!title && !text) return null;
  const accent = color(data.color);
  const body: Record<string, unknown>[] = [];
  if (title) body.push({ type: 'text', text: title, weight: 'bold', size: 'xl', wrap: true, color: TEXT_DARK });
  if (text) body.push({ type: 'text', text, size: 'sm', wrap: true, color: '#555555', margin: title ? 'md' : 'none' });
  const buttons = (data.buttons ?? [])
    .slice(0, LINE_FLEX_BUTTONS_MAX)
    .map((b, i) => buttonComponent(b, accent, i === 0))
    .filter((b): b is Record<string, unknown> => !!b);
  const hero = heroImage(data.image_url);
  return {
    type: 'bubble',
    size: 'mega',
    ...(hero ? { hero } : {}),
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: '20px' },
    ...(buttons.length > 0 ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons, paddingAll: '16px' } } : {}),
  };
}

function menuBubble(item: MenuCarouselItem, data: MenuCarouselData): FlexContainer | null {
  const name = nonEmpty(item.name);
  if (!name) return null;
  const accent = color(data.color);
  const body: Record<string, unknown>[] = [{ type: 'text', text: name, weight: 'bold', size: 'md', wrap: true, color: TEXT_DARK }];
  const price = nonEmpty(item.price);
  const duration = nonEmpty(item.duration);
  if (price || duration) {
    const row: Record<string, unknown>[] = [];
    if (price) row.push({ type: 'text', text: price, weight: 'bold', size: 'lg', color: accent, flex: 0 });
    if (duration) row.push({ type: 'text', text: duration, size: 'sm', color: TEXT_MUTED, ...(price ? { margin: 'md' } : {}), flex: 0 });
    body.push({ type: 'box', layout: 'baseline', contents: row, margin: 'sm' });
  }
  const description = nonEmpty(item.description);
  if (description) body.push({ type: 'text', text: description, size: 'xs', color: TEXT_MUTED, wrap: true, margin: 'md' });
  const btnInput: FlexButtonInput | null = item.button && nonEmpty(item.button.label) && nonEmpty(item.button.url)
    ? item.button
    : nonEmpty(data.button_label) && nonEmpty(data.button_url)
      ? { key: 'common', label: data.button_label as string, url: data.button_url as string }
      : null;
  const button = btnInput ? buttonComponent(btnInput, accent, true) : null;
  const hero = heroImage(item.image_url, '4:3');
  return {
    type: 'bubble',
    size: 'kilo',
    ...(hero ? { hero } : {}),
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: '16px' },
    ...(button ? { footer: { type: 'box', layout: 'vertical', contents: [button], paddingAll: '12px' } } : {}),
  };
}

export function buildMenuCarouselFlex(data: MenuCarouselData): FlexContainer | null {
  const bubbles = (data.items ?? [])
    .map((item) => menuBubble(item, data))
    .filter((b): b is FlexContainer => !!b)
    .slice(0, LINE_FLEX_CAROUSEL_MAX);
  if (bubbles.length === 0) return null;
  if (bubbles.length === 1) return bubbles[0];
  return { type: 'carousel', contents: bubbles };
}

function infoRow(icon: string, label: string, value: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: `${icon} ${label}`, size: 'sm', color: TEXT_MUTED, flex: 0 },
      { type: 'text', text: textOrSpace(value), size: 'sm', color: TEXT_DARK, wrap: true, flex: 1, margin: 'md' },
    ],
  };
}

export function buildStoreCardFlex(data: StoreCardData): FlexContainer | null {
  const name = nonEmpty(data.name);
  if (!name) return null;
  const accent = color(data.color);
  const body: Record<string, unknown>[] = [{ type: 'text', text: name, weight: 'bold', size: 'xl', wrap: true, color: TEXT_DARK }];
  const rows: Record<string, unknown>[] = [];
  if (nonEmpty(data.hours)) rows.push(infoRow('🕒', '営業時間', nonEmpty(data.hours)));
  if (nonEmpty(data.phone)) rows.push(infoRow('📞', '電話', nonEmpty(data.phone)));
  if (nonEmpty(data.address)) rows.push(infoRow('📍', '住所', nonEmpty(data.address)));
  if (rows.length > 0) body.push({ type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: rows });

  const buttons: Record<string, unknown>[] = [];
  const push = (label: string, url: string | undefined, primary: boolean) => {
    const u = nonEmpty(url);
    if (!u) return;
    const b = buttonComponent({ key: label, label, url: u }, accent, primary);
    if (b) buttons.push(b);
  };
  push('予約する', data.booking_url, true);
  const phoneDigits = nonEmpty(data.phone).replace(/[^\d+]/g, '');
  if (phoneDigits) push('電話する', `tel:${phoneDigits}`, buttons.length === 0);
  push('地図を開く', data.map_url, buttons.length === 0);
  push('公式サイト', data.website_url, buttons.length === 0);

  const hero = heroImage(data.image_url);
  return {
    type: 'bubble',
    size: 'mega',
    ...(hero ? { hero } : {}),
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: '20px' },
    ...(buttons.length > 0 ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons, paddingAll: '16px' } } : {}),
  };
}

function optionalButton(btn: FlexButtonInput | null | undefined, accent: string): Record<string, unknown> | null {
  if (!btn || !nonEmpty(btn.label) || !nonEmpty(btn.url)) return null;
  return buttonComponent(btn, accent, true);
}

export function buildCouponCardFlex(data: CouponCardData): FlexContainer | null {
  const title = nonEmpty(data.title);
  const highlight = nonEmpty(data.highlight);
  if (!title && !highlight) return null;
  const accent = color(data.color);
  const body: Record<string, unknown>[] = [];
  if (title) body.push({ type: 'text', text: title, size: 'sm', color: accent, weight: 'bold', wrap: true });
  if (highlight) body.push({ type: 'text', text: highlight, size: '3xl', weight: 'bold', color: TEXT_DARK, wrap: true, margin: title ? 'sm' : 'none' });
  const description = nonEmpty(data.description);
  if (description) body.push({ type: 'text', text: description, size: 'sm', color: '#555555', wrap: true, margin: 'md' });
  const rows: Record<string, unknown>[] = [];
  if (nonEmpty(data.expires)) rows.push(infoRow('⏰', '有効期限', nonEmpty(data.expires)));
  if (nonEmpty(data.conditions)) rows.push(infoRow('📝', '条件', nonEmpty(data.conditions)));
  if (rows.length > 0) {
    body.push({ type: 'separator', margin: 'lg', color: '#eeeeee' });
    body.push({ type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: rows });
  }
  const code = nonEmpty(data.code);
  if (code) {
    body.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      paddingAll: '12px',
      backgroundColor: '#f5f5f5',
      cornerRadius: 'md',
      borderWidth: 'normal',
      borderColor: accent,
      contents: [
        { type: 'text', text: 'ご提示コード', size: 'xxs', color: TEXT_MUTED, align: 'center' },
        { type: 'text', text: code, size: 'xl', weight: 'bold', color: TEXT_DARK, align: 'center', margin: 'xs' },
      ],
    });
  }
  const button = optionalButton(data.button, accent);
  const hero = heroImage(data.image_url);
  return {
    type: 'bubble',
    size: 'mega',
    ...(hero ? { hero } : {}),
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: '20px' },
    ...(button ? { footer: { type: 'box', layout: 'vertical', contents: [button], paddingAll: '16px' } } : {}),
  };
}

export function buildNoticeCardFlex(data: NoticeCardData): FlexContainer | null {
  const title = nonEmpty(data.title);
  const text = nonEmpty(data.body);
  if (!title && !text) return null;
  const accent = color(data.color);
  const headerContents: Record<string, unknown>[] = [];
  if (nonEmpty(data.label)) headerContents.push({ type: 'text', text: nonEmpty(data.label), size: 'xs', color: '#ffffffcc' });
  headerContents.push({ type: 'text', text: textOrSpace(title), size: 'lg', weight: 'bold', color: '#ffffff', wrap: true, margin: nonEmpty(data.label) ? 'xs' : 'none' });
  const body: Record<string, unknown>[] = [];
  if (nonEmpty(data.date)) body.push({ type: 'text', text: nonEmpty(data.date), size: 'xs', color: TEXT_MUTED });
  if (text) body.push({ type: 'text', text, size: 'sm', color: TEXT_DARK, wrap: true, margin: nonEmpty(data.date) ? 'md' : 'none' });
  const button = optionalButton(data.button, accent);
  const hero = heroImage(data.image_url);
  return {
    type: 'bubble',
    size: 'mega',
    header: { type: 'box', layout: 'vertical', contents: headerContents, paddingAll: '16px', backgroundColor: accent },
    ...(hero ? { hero } : {}),
    body: { type: 'box', layout: 'vertical', contents: body.length ? body : [{ type: 'text', text: ' ' }], paddingAll: '20px' },
    ...(button ? { footer: { type: 'box', layout: 'vertical', contents: [button], paddingAll: '16px' } } : {}),
  };
}

export function buildMenuListFlex(data: MenuListData): FlexContainer | null {
  const items = (data.items ?? []).filter((i) => nonEmpty(i.name)).slice(0, LINE_FLEX_MENU_LIST_MAX);
  const title = nonEmpty(data.title);
  if (items.length === 0 && !title) return null;
  const accent = color(data.color);
  const body: Record<string, unknown>[] = [];
  if (title) body.push({ type: 'text', text: title, size: 'lg', weight: 'bold', color: TEXT_DARK, wrap: true });
  const rows: Record<string, unknown>[] = items.map((item) => {
    const left: Record<string, unknown>[] = [{ type: 'text', text: nonEmpty(item.name), size: 'sm', color: TEXT_DARK, wrap: true }];
    if (nonEmpty(item.note)) left.push({ type: 'text', text: nonEmpty(item.note), size: 'xs', color: TEXT_MUTED, wrap: true });
    return {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'box', layout: 'vertical', contents: left, flex: 1 },
        { type: 'text', text: textOrSpace(nonEmpty(item.price)), size: 'sm', weight: 'bold', color: accent, align: 'end', flex: 0, gravity: 'center' },
      ],
      paddingTop: '8px',
      paddingBottom: '8px',
    };
  });
  const list: Record<string, unknown>[] = [];
  rows.forEach((r, i) => {
    if (i > 0) list.push({ type: 'separator', color: '#eeeeee' });
    list.push(r);
  });
  if (list.length > 0) body.push({ type: 'box', layout: 'vertical', contents: list, margin: title ? 'md' : 'none' });
  if (nonEmpty(data.footnote)) body.push({ type: 'text', text: nonEmpty(data.footnote), size: 'xxs', color: TEXT_MUTED, wrap: true, margin: 'md' });
  const button = optionalButton(data.button, accent);
  return {
    type: 'bubble',
    size: 'mega',
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: '20px' },
    ...(button ? { footer: { type: 'box', layout: 'vertical', contents: [button], paddingAll: '16px' } } : {}),
  };
}

function staffBubble(item: StaffCarouselItem, data: StaffCarouselData): FlexContainer | null {
  const name = nonEmpty(item.name);
  if (!name) return null;
  const accent = color(data.color);
  const body: Record<string, unknown>[] = [{ type: 'text', text: name, size: 'md', weight: 'bold', color: TEXT_DARK, wrap: true }];
  if (nonEmpty(item.role)) body.push({ type: 'text', text: nonEmpty(item.role), size: 'xs', color: accent, wrap: true, margin: 'xs' });
  if (nonEmpty(item.comment)) body.push({ type: 'text', text: nonEmpty(item.comment), size: 'sm', color: '#555555', wrap: true, margin: 'md' });
  const btnInput: FlexButtonInput | null = item.button && nonEmpty(item.button.label) && nonEmpty(item.button.url)
    ? item.button
    : nonEmpty(data.button_label) && nonEmpty(data.button_url)
      ? { key: 'common', label: data.button_label as string, url: data.button_url as string }
      : null;
  const button = btnInput ? buttonComponent(btnInput, accent, true) : null;
  const hero = heroImage(item.image_url, '1:1');
  return {
    type: 'bubble',
    size: 'kilo',
    ...(hero ? { hero } : {}),
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: '16px' },
    ...(button ? { footer: { type: 'box', layout: 'vertical', contents: [button], paddingAll: '12px' } } : {}),
  };
}

export function buildStaffCarouselFlex(data: StaffCarouselData): FlexContainer | null {
  const bubbles = (data.items ?? []).map((i) => staffBubble(i, data)).filter((b): b is FlexContainer => !!b).slice(0, LINE_FLEX_CAROUSEL_MAX);
  if (bubbles.length === 0) return null;
  return bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
}

export function buildStepsCardFlex(data: StepsCardData): FlexContainer | null {
  const steps = (data.steps ?? []).filter((s) => nonEmpty(s.title)).slice(0, LINE_FLEX_STEPS_MAX);
  const title = nonEmpty(data.title);
  if (steps.length === 0 && !title) return null;
  const accent = color(data.color);
  const body: Record<string, unknown>[] = [];
  if (title) body.push({ type: 'text', text: title, size: 'lg', weight: 'bold', color: TEXT_DARK, wrap: true });
  const stepBoxes: Record<string, unknown>[] = steps.map((s, i) => {
    const texts: Record<string, unknown>[] = [{ type: 'text', text: nonEmpty(s.title), size: 'sm', weight: 'bold', color: TEXT_DARK, wrap: true }];
    if (nonEmpty(s.text)) texts.push({ type: 'text', text: nonEmpty(s.text), size: 'xs', color: TEXT_MUTED, wrap: true, margin: 'xs' });
    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          width: '28px',
          height: '28px',
          cornerRadius: '14px',
          backgroundColor: accent,
          justifyContent: 'center',
          alignItems: 'center',
          flex: 0,
          contents: [{ type: 'text', text: String(i + 1), size: 'sm', weight: 'bold', color: '#ffffff', align: 'center' }],
        },
        { type: 'box', layout: 'vertical', contents: texts, flex: 1 },
      ],
    };
  });
  if (stepBoxes.length > 0) body.push({ type: 'box', layout: 'vertical', spacing: 'lg', contents: stepBoxes, margin: title ? 'lg' : 'none' });
  const button = optionalButton(data.button, accent);
  return {
    type: 'bubble',
    size: 'mega',
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: '20px' },
    ...(button ? { footer: { type: 'box', layout: 'vertical', contents: [button], paddingAll: '16px' } } : {}),
  };
}

export function buildTemplateFlex(template: LineFlexTemplate, data: LineFlexTemplateData): FlexContainer | null {
  switch (template) {
    case 'booking_card':
      return buildBookingCardFlex(data as BookingCardData);
    case 'menu_carousel':
      return buildMenuCarouselFlex(data as MenuCarouselData);
    case 'store_card':
      return buildStoreCardFlex(data as StoreCardData);
    case 'coupon_card':
      return buildCouponCardFlex(data as CouponCardData);
    case 'notice_card':
      return buildNoticeCardFlex(data as NoticeCardData);
    case 'menu_list':
      return buildMenuListFlex(data as MenuListData);
    case 'staff_carousel':
      return buildStaffCarouselFlex(data as StaffCarouselData);
    case 'steps_card':
      return buildStepsCardFlex(data as StepsCardData);
    case 'scenario':
      return buildScenarioFlex(data as ScenarioData);
    default:
      return null;
  }
}

/** 送信に使う contents。JSON を直接編集していればそれを優先 */
export function resolveFlexContents(msg: { template: LineFlexTemplate; data: LineFlexTemplateData; flex_override?: FlexContainer | null }): FlexContainer | null {
  if (msg.flex_override && typeof msg.flex_override === 'object') return msg.flex_override;
  return buildTemplateFlex(msg.template, msg.data);
}

// ---------------------------------------------------------------------------
// 計測リンク
// ---------------------------------------------------------------------------

export function trackingUrl(baseUrl: string, messageId: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/go/${messageId}/${key}`;
}

/**
 * contents 内の uri アクション（https のみ。tel: は対象外）を計測リンクに置き換える。
 * 戻り値の links は「キー → 本来の URL」。既に計測リンクになっているものはそのまま。startKey = キーの開始番号（この次から）
 */
export function instrumentFlexLinks(contents: FlexContainer, baseUrl: string, messageId: string, startKey = 0): { contents: FlexContainer; links: Record<string, string> } {
  const cloned = JSON.parse(JSON.stringify(contents)) as FlexContainer;
  const links: Record<string, string> = {};
  const prefix = trackingUrl(baseUrl, messageId, '');
  let n = startKey; // 追加の Flex（JSON）は main の続き番号から（/go/{id}/{key} は数字のキーのみ）
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.type === 'uri' && typeof obj.uri === 'string' && /^https:\/\//i.test(obj.uri) && !obj.uri.startsWith(prefix)) {
      n += 1;
      const key = String(n);
      links[key] = obj.uri;
      obj.uri = trackingUrl(baseUrl, messageId, key);
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(cloned);
  return { contents: cloned, links };
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

export function validateFlexContents(contents: unknown): string | null {
  if (!contents || typeof contents !== 'object' || Array.isArray(contents)) return 'Flex の内容が空です。見出しや本文を入力してください';
  const c = contents as Record<string, unknown>;
  if (c.type === 'carousel') {
    const items = c.contents;
    if (!Array.isArray(items) || items.length === 0) return 'カルーセルにカードが 1 枚もありません';
    if (items.length > LINE_FLEX_CAROUSEL_MAX) return `カルーセルのカードは ${LINE_FLEX_CAROUSEL_MAX} 枚までです`;
    if (items.some((b) => !b || typeof b !== 'object' || (b as Record<string, unknown>).type !== 'bubble')) return 'カルーセルの中身は bubble だけにしてください';
  } else if (c.type !== 'bubble') {
    return 'contents の type は bubble か carousel にしてください';
  }
  return null;
}

export function normalizeKeywords(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,、，]/) : [];
  const out: string[] = [];
  for (const v of list) {
    const k = typeof v === 'string' ? v.trim() : '';
    if (!k || k.length > LINE_FLEX_KEYWORD_LEN_MAX) continue;
    if (out.some((x) => x.toLowerCase() === k.toLowerCase())) continue;
    out.push(k);
    if (out.length >= LINE_FLEX_KEYWORD_MAX) break;
  }
  return out;
}

export function matchesKeyword(keywords: ReadonlyArray<string>, text: string): boolean {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return false;
  return keywords.some((k) => k.trim().toLowerCase() === t);
}

export function buildLinePayload(altText: string, contents: FlexContainer): Record<string, unknown> {
  const alt = (altText ?? '').trim().slice(0, LINE_FLEX_ALT_TEXT_MAX) || 'メッセージが届いています';
  return { type: 'flex', altText: alt, contents };
}

/** JSON のバイト数（UTF-8） */
export function payloadBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

// ---------------------------------------------------------------------------
// 既定値・下書き
// ---------------------------------------------------------------------------

export function defaultTemplateData(template: LineFlexTemplate, accent?: string): LineFlexTemplateData {
  const c = isHex(accent) ? accent : LINE_FLEX_DEFAULT_COLOR;
  switch (template) {
    case 'booking_card':
      return { image_url: '', title: 'ご予約はこちらから', text: '24 時間いつでも LINE から予約できます。\n空き状況を見ながら日時をお選びください。', buttons: [{ key: 'b1', label: '予約する', url: '' }], color: c } as BookingCardData;
    case 'menu_carousel':
      return { items: [], color: c, button_label: '予約する', button_url: '' } as MenuCarouselData;
    case 'store_card':
      return { image_url: '', name: '', hours: '', phone: '', address: '', map_url: '', website_url: '', booking_url: '', color: c } as StoreCardData;
    case 'coupon_card':
      return { image_url: '', title: 'LINE 友だち限定クーポン', highlight: '10% OFF', description: 'このメッセージをご来店時にスタッフへご提示ください。', expires: '', conditions: '他のクーポンとの併用不可', code: '', button: { key: 'b1', label: '予約する', url: '' }, color: c } as CouponCardData;
    case 'notice_card':
      return { label: 'お知らせ', title: '', date: '', body: '', image_url: '', button: null, color: c } as NoticeCardData;
    case 'menu_list':
      return { title: 'メニュー・料金', items: [], footnote: '※ 価格は税込です', button: { key: 'b1', label: '予約する', url: '' }, color: c } as MenuListData;
    case 'staff_carousel':
      return { items: [], button_label: 'このスタッフで予約', button_url: '', color: c } as StaffCarouselData;
    case 'steps_card':
      return {
        title: 'ご利用の流れ',
        steps: [
          { key: 's1', title: 'LINE で予約', text: '下のボタンから希望のメニューと日時を選びます' },
          { key: 's2', title: '予約確認メッセージが届く', text: '前日にはリマインドもお送りします' },
          { key: 's3', title: 'ご来店', text: '受付でお名前をお伝えください' },
        ],
        button: { key: 'b1', label: '予約する', url: '' },
        color: c,
      } as StepsCardData;
    case 'scenario':
      return defaultScenarioData(c);
    default:
      return {} as Record<string, never>;
  }
}

type FormLike = {
  config?: {
    basic_info?: { liff_id?: string };
    menu_structure?: {
      categories?: Array<{ menus?: Array<{ id?: string; name?: string; price?: number; duration?: number; description?: string; image?: string; image_url?: string }> }>;
    };
  } | null;
} | null | undefined;

export function formLiffUrl(form: FormLike): string {
  const liff = nonEmpty(form?.config?.basic_info?.liff_id);
  return liff ? `https://liff.line.me/${liff}` : '';
}

/** 予約フォームのメニュー構成からカルーセルの下書き（先頭 12 件） */
export function menuCarouselFromForm(form: FormLike, base?: MenuCarouselData): MenuCarouselData {
  const items: MenuCarouselItem[] = [];
  for (const cat of form?.config?.menu_structure?.categories ?? []) {
    for (const m of cat.menus ?? []) {
      if (!nonEmpty(m.name)) continue;
      items.push({
        key: nonEmpty(m.id) || `m${items.length + 1}`,
        name: nonEmpty(m.name),
        price: typeof m.price === 'number' && m.price > 0 ? `¥${m.price.toLocaleString('ja-JP')}` : '',
        duration: typeof m.duration === 'number' && m.duration > 0 ? `${m.duration}分` : '',
        description: nonEmpty(m.description),
        image_url: isHttpsImage(m.image) ? nonEmpty(m.image) : isHttpsImage(m.image_url) ? nonEmpty(m.image_url) : '',
        button: null,
      });
      if (items.length >= LINE_FLEX_CAROUSEL_MAX) break;
    }
    if (items.length >= LINE_FLEX_CAROUSEL_MAX) break;
  }
  return {
    ...(base ?? (defaultTemplateData('menu_carousel') as MenuCarouselData)),
    items,
    button_label: nonEmpty(base?.button_label) || '予約する',
    button_url: formLiffUrl(form) || nonEmpty(base?.button_url),
  };
}

/** 予約フォームのメニュー構成から料金表（リスト）の下書き（先頭 15 件） */
export function menuListFromForm(form: FormLike, base?: MenuListData): MenuListData {
  const items: MenuListData['items'] = [];
  for (const cat of form?.config?.menu_structure?.categories ?? []) {
    for (const m of cat.menus ?? []) {
      if (!nonEmpty(m.name)) continue;
      items.push({
        key: nonEmpty(m.id) || `m${items.length + 1}`,
        name: nonEmpty(m.name),
        price: typeof m.price === 'number' && m.price > 0 ? `¥${m.price.toLocaleString('ja-JP')}` : '',
        note: typeof m.duration === 'number' && m.duration > 0 ? `${m.duration}分` : '',
      });
      if (items.length >= LINE_FLEX_MENU_LIST_MAX) break;
    }
    if (items.length >= LINE_FLEX_MENU_LIST_MAX) break;
  }
  const b = base ?? (defaultTemplateData('menu_list') as MenuListData);
  return { ...b, items, button: b.button && nonEmpty(b.button.url) ? b.button : { key: 'b1', label: b.button?.label || '予約する', url: formLiffUrl(form) } };
}

type StoreLike = { name?: string; phone?: string | null; address?: string | null; website_url?: string | null; logo_url?: string | null; theme_color?: string | null } | null | undefined;

/** 店舗情報からの店舗紹介カードの下書き */
export function storeCardFromStore(store: StoreLike, bookingUrl?: string, base?: StoreCardData): StoreCardData {
  const address = nonEmpty(store?.address);
  return {
    ...(base ?? (defaultTemplateData('store_card', store?.theme_color ?? undefined) as StoreCardData)),
    name: nonEmpty(store?.name),
    phone: nonEmpty(store?.phone),
    address,
    map_url: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '',
    website_url: nonEmpty(store?.website_url),
    image_url: isHttpsImage(store?.logo_url) ? nonEmpty(store?.logo_url) : nonEmpty(base?.image_url),
    booking_url: nonEmpty(bookingUrl) || nonEmpty(base?.booking_url),
  };
}

/** 一覧などに出す短い要約（ボタン数・カード数） */
export function describeFlexContents(contents: FlexContainer | null): string {
  if (!contents) return '内容なし';
  if (contents.type === 'carousel') {
    const n = Array.isArray(contents.contents) ? contents.contents.length : 0;
    return `カード ${n} 枚`;
  }
  return 'カード 1 枚';
}
