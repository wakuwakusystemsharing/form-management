/**
 * 公式 LINE のリッチメニュー（トーク画面の下に出るメニュー）の純粋ロジック
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 7 章
 *
 * - ボタンの範囲は「画像全体に対する割合」（0〜1）で持ち、LINE に送るときに実寸（px）へ直す
 *   （画面では小さく表示して編集し、実物は幅 2500px のため）
 * - DB にも画面にも LINE にも触らない（Vitest の対象）
 *
 * LINE の決まり（2026-11 に公式ドキュメントで確認）:
 *   画像 = JPEG / PNG・1MB まで・幅 800〜2500px・高さ 250px 以上・横 ÷ 縦 が 1.45 以上
 *   ボタン（areas）= 20 個まで / メニューを開くバーの文言 = 14 文字まで
 *   作ったメニューは書き換えられない（画像の差し替えも不可）→ 変えるときは作り直して差し替える
 */

import { isRuleEmpty, normalizeRichMenuRule, type RichMenuRule } from '@/lib/line-rich-menu-rules';

export type RichMenuSize = 'large' | 'small';

export const RICH_MENU_SIZES: Record<RichMenuSize, { width: number; height: number; label: string; description: string }> = {
  large: { width: 2500, height: 1686, label: '大', description: '縦に広いメニュー（2500×1686）。ボタンを 6 個くらい置くとき' },
  small: { width: 2500, height: 843, label: '小', description: '横長のメニュー（2500×843）。ボタンを 2〜3 個置くとき' },
};

export const RICH_MENU_LIMITS = {
  /** 管理用の名前 */
  nameMax: 40,
  /** メニューを開くバーの文言（LINE の上限） */
  chatBarTextMax: 14,
  /** ボタンの数（LINE の上限） */
  areasMax: 20,
  /** 画像の大きさ（LINE の上限） */
  imageMaxBytes: 1024 * 1024,
  /** 「文字を送る」の文字数（LINE の上限は 300。誤って長文を入れないように短くしている） */
  messageTextMax: 100,
  /** 「応答メッセージを返す」で、この画面に書ける文章の長さ */
  replyTextMax: 1000,
  uriMax: 1000,
  /** ボタンの最小の大きさ（画像全体に対する割合）。小さすぎると指で押せない */
  minAreaRatio: 0.05,
  /** 1 店舗が持てるメニューの数（LINE の上限 1000 より十分小さくする） */
  menusMax: 20,
} as const;

export const DEFAULT_CHAT_BAR_TEXT = 'メニュー';

/**
 * 「文字を送る」で一覧から選べる、このシステムの予約語。
 * 手で打つと 1 文字違いで反応しないので、選ぶだけにする（Webhook が完全一致で受け取る言葉）
 */
export const RICH_MENU_KEYWORDS: Array<{ text: string; label: string; description: string }> = [
  { text: '予約確認', label: '予約確認', description: 'これからの予約を一覧で返します' },
  { text: '予約を変更', label: '予約を変更', description: '日時・メニューの変更の案内を返します' },
  { text: '予約をキャンセル', label: '予約をキャンセル', description: '予約のキャンセルの案内を返します' },
  { text: '空き待ち確認', label: '空き待ち確認', description: '登録中の空き待ちを一覧で返します' },
];

/**
 * 前は「キャンセル」を一覧に出していたが、Webhook が受け取る言葉は「予約をキャンセル」。
 * 保存済みのメニューを読むときに、新しい言葉に直す
 */
export const LEGACY_RICH_MENU_KEYWORDS: Record<string, string> = { キャンセル: '予約をキャンセル' };

/** 「応答メッセージを返す」の返し方（text = この画面で書いた文章 / message = 「LINE メッセージ」で作ったもの） */
export type RichMenuReplyMode = 'text' | 'message';

/** ボタンを押したときの動き */
export type RichMenuAction =
  | { type: 'form'; form_id: string } // 予約フォームを開く（反映のときに URL にする）
  | { type: 'uri'; uri: string } // 任意の URL を開く
  // 文字を送る。silent = true のときは、お客様のトークに文字を出さずに、送られたのと同じ動きをする（LINE には postback として出す）
  | { type: 'message'; text: string; silent?: boolean }
  // 応答メッセージを返す（お客様のトークには何も出さない。返す内容は、押されたときにこのシステムが保存済みのメニューから読む）
  | { type: 'reply'; mode: RichMenuReplyMode; text: string; message_id: string }
  | { type: 'switch'; menu_id: string } // 別のメニューに切り替える（タブのように行き来する。反映のときに LINE の名札にする）
  | { type: 'none' }; // 何もしない（飾りの部分。LINE には送らない）

export const RICH_MENU_ACTION_LABELS: Record<RichMenuAction['type'], string> = {
  form: '予約フォームを開く',
  uri: 'URL を開く',
  message: '文字を送る',
  reply: '応答メッセージを返す（トークに文字を出さない）',
  switch: '別のメニューに切り替える',
  none: '何もしない',
};

/** ボタン 1 つ。x / y / w / h は画像全体に対する割合（0〜1） */
export interface RichMenuArea {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: RichMenuAction;
}

export type RichMenuStatus = 'draft' | 'publishing' | 'published' | 'failed';

export const RICH_MENU_STATUS_LABELS: Record<RichMenuStatus, string> = {
  draft: '下書き',
  publishing: '反映の途中',
  published: '反映中',
  failed: '反映に失敗',
};

export interface LineRichMenu {
  id: string;
  store_id: string;
  name: string;
  size: RichMenuSize;
  image_url: string;
  areas: RichMenuArea[];
  chat_bar_text: string;
  /** トーク画面を開いたとき、最初からメニューを開いておくか */
  open_by_default: boolean;
  status: RichMenuStatus;
  /** LINE 側の ID（反映したとき） */
  line_rich_menu_id: string | null;
  /** 全員向けにしているか */
  is_default: boolean;
  /** 反映したあとに内容を変えたか（変えただけでは公式 LINE には出ない） */
  dirty: boolean;
  /** お客様ごとのメニューの条件（null = 全員向け / 切り替え先のメニュー） */
  rule: RichMenuRule | null;
  last_error: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 画面から保存する内容 */
export interface RichMenuInput {
  name: string;
  size: RichMenuSize;
  image_url: string;
  areas: RichMenuArea[];
  chat_bar_text: string;
  open_by_default: boolean;
  /** お客様ごとのメニューの条件（null / 省略 = 全員向け） */
  rule?: RichMenuRule | null;
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** 割合を小数 4 桁に丸める（保存する値を安定させる） */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function isRichMenuSize(value: unknown): value is RichMenuSize {
  return value === 'large' || value === 'small';
}

export function normalizeRichMenuAction(value: unknown): RichMenuAction {
  const rec = asRecord(value);
  if (rec.type === 'form') return { type: 'form', form_id: typeof rec.form_id === 'string' ? rec.form_id.trim() : '' };
  if (rec.type === 'uri') return { type: 'uri', uri: typeof rec.uri === 'string' ? rec.uri.trim() : '' };
  if (rec.type === 'message') {
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    return { type: 'message', text: LEGACY_RICH_MENU_KEYWORDS[text] ?? text, ...(rec.silent === true ? { silent: true } : {}) };
  }
  if (rec.type === 'reply') {
    return { type: 'reply', mode: rec.mode === 'message' ? 'message' : 'text', text: typeof rec.text === 'string' ? rec.text.trim() : '', message_id: typeof rec.message_id === 'string' ? rec.message_id.trim() : '' };
  }
  if (rec.type === 'switch') return { type: 'switch', menu_id: typeof rec.menu_id === 'string' ? rec.menu_id.trim() : '' };
  return { type: 'none' };
}

/** 範囲を画像の中に収める（はみ出したぶんは切り詰める） */
export function normalizeRichMenuArea(value: unknown, index = 0): RichMenuArea {
  const rec = asRecord(value);
  const x = clamp01(rec.x);
  const y = clamp01(rec.y);
  const w = Math.max(0, Math.min(1 - x, clamp01(rec.w)));
  const h = Math.max(0, Math.min(1 - y, clamp01(rec.h)));
  const id = typeof rec.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(rec.id) ? rec.id : `a${index + 1}`;
  return { id, x: round4(x), y: round4(y), w: round4(w), h: round4(h), action: normalizeRichMenuAction(rec.action) };
}

export function normalizeRichMenuAreas(value: unknown): RichMenuArea[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map((v, i) => {
    const area = normalizeRichMenuArea(v, i);
    // ID が重なったら振り直す（画面の選択・並びに使うため）
    let id = area.id;
    for (let n = 2; seen.has(id); n++) id = `${area.id}_${n}`;
    seen.add(id);
    return { ...area, id };
  });
}

export function normalizeRichMenuInput(value: unknown): RichMenuInput {
  const rec = asRecord(value);
  const chat = typeof rec.chat_bar_text === 'string' ? rec.chat_bar_text.trim() : '';
  return {
    name: typeof rec.name === 'string' ? rec.name.trim() : '',
    size: isRichMenuSize(rec.size) ? rec.size : 'large',
    image_url: typeof rec.image_url === 'string' ? rec.image_url.trim() : '',
    areas: normalizeRichMenuAreas(rec.areas),
    chat_bar_text: chat || DEFAULT_CHAT_BAR_TEXT,
    open_by_default: rec.open_by_default !== false,
    rule: normalizeRichMenuRule(rec.rule),
  };
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

/** 2 つの範囲が重なっているか（辺が接しているだけなら重なりではない） */
export function areasOverlap(a: Pick<RichMenuArea, 'x' | 'y' | 'w' | 'h'>, b: Pick<RichMenuArea, 'x' | 'y' | 'w' | 'h'>): boolean {
  const eps = 0.0005; // 丸めの誤差で「接しているだけ」を重なりにしない
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

/** http / https の URL か（LINE のリッチメニューから開けるもの。tel: と line: も通す） */
export function isRichMenuUri(value: string): boolean {
  if (/^https:\/\/[^\s]+$/i.test(value) || /^http:\/\/[^\s]+$/i.test(value)) return true;
  return /^tel:[0-9+\-]{3,20}$/.test(value) || /^https:\/\/line\.me\/[^\s]+$/i.test(value);
}

function actionError(action: RichMenuAction, label: string, formIds: Set<string> | null, menuIds: Set<string> | null = null, selfId: string | null = null, messageIds: Set<string> | null = null): string | null {
  if (action.type === 'reply') {
    if (action.mode === 'message') {
      if (!action.message_id) return `${label}: 返す LINE メッセージを選んでください`;
      if (messageIds && !messageIds.has(action.message_id)) return `${label}: 選んだ LINE メッセージが見つかりません（削除された可能性があります）。選び直してください`;
      return null;
    }
    if (!action.text) return `${label}: 返す文章を入力してください`;
    if (action.text.length > RICH_MENU_LIMITS.replyTextMax) return `${label}: 返す文章が長すぎます（${RICH_MENU_LIMITS.replyTextMax} 文字まで）`;
    return null;
  }
  if (action.type === 'switch') {
    if (!action.menu_id) return `${label}: 切り替え先のメニューを選んでください`;
    if (selfId && action.menu_id === selfId) return `${label}: 切り替え先に、このメニュー自身は選べません`;
    if (menuIds && !menuIds.has(action.menu_id)) return `${label}: 切り替え先のメニューが見つかりません（削除された可能性があります）。選び直してください`;
    return null;
  }
  if (action.type === 'form') {
    if (!action.form_id) return `${label}: 開く予約フォームを選んでください`;
    if (formIds && !formIds.has(action.form_id)) return `${label}: 選んだ予約フォームが見つかりません（削除された可能性があります）。選び直してください`;
    return null;
  }
  if (action.type === 'uri') {
    if (!action.uri) return `${label}: 開く URL を入力してください`;
    if (action.uri.length > RICH_MENU_LIMITS.uriMax) return `${label}: URL が長すぎます（${RICH_MENU_LIMITS.uriMax} 文字まで）`;
    if (!isRichMenuUri(action.uri)) return `${label}: URL は https:// か http:// で始まるもの（電話は tel:）を入力してください`;
    return null;
  }
  if (action.type === 'message') {
    if (!action.text) return `${label}: 送る文字を入力してください`;
    if (action.text.length > RICH_MENU_LIMITS.messageTextMax) return `${label}: 送る文字が長すぎます（${RICH_MENU_LIMITS.messageTextMax} 文字まで）`;
    return null;
  }
  return null;
}

/**
 * 内容を確かめる。問題があれば日本語の文言の一覧を返す（空 = 問題なし）。
 * - 下書きの保存: 名前・バーの文言・ボタンの数と重なりだけ（作りかけでも保存できる）
 * - forPublish: 画像と、ボタンの動き（URL・フォーム・文字）も確かめる
 */
export function validateRichMenu(input: RichMenuInput, opts: { forPublish?: boolean; formIds?: Iterable<string> | null; menuIds?: Iterable<string> | null; selfId?: string | null; messageIds?: Iterable<string> | null } = {}): string[] {
  const errors: string[] = [];
  if (!input.name) errors.push('名前を入力してください');
  else if (input.name.length > RICH_MENU_LIMITS.nameMax) errors.push(`名前は ${RICH_MENU_LIMITS.nameMax} 文字までにしてください`);
  if ([...input.chat_bar_text].length > RICH_MENU_LIMITS.chatBarTextMax) errors.push(`メニューバーの文言は ${RICH_MENU_LIMITS.chatBarTextMax} 文字までにしてください`);
  if (input.areas.length > RICH_MENU_LIMITS.areasMax) errors.push(`ボタンは ${RICH_MENU_LIMITS.areasMax} 個までにしてください`);

  input.areas.forEach((area, i) => {
    if (area.w < RICH_MENU_LIMITS.minAreaRatio || area.h < RICH_MENU_LIMITS.minAreaRatio) errors.push(`ボタン ${i + 1}: 範囲が小さすぎます。もう少し大きくしてください`);
  });
  for (let i = 0; i < input.areas.length; i++) {
    for (let j = i + 1; j < input.areas.length; j++) {
      if (areasOverlap(input.areas[i], input.areas[j])) errors.push(`ボタン ${i + 1} と ボタン ${j + 1} の範囲が重なっています。重ならないように動かしてください`);
    }
  }

  if (opts.forPublish) {
    if (!input.image_url) errors.push('画像を選んでください');
    const formIds = opts.formIds ? new Set(opts.formIds) : null;
    const menuIds = opts.menuIds ? new Set(opts.menuIds) : null;
    const messageIds = opts.messageIds ? new Set(opts.messageIds) : null;
    const active = input.areas.filter((a) => a.action.type !== 'none');
    if (active.length === 0) errors.push('押したときの動きを設定したボタンを 1 つ以上作ってください');
    if (input.rule) {
      if (isRuleEmpty(input.rule)) errors.push('だれに出すかの条件を 1 つ以上選んでください（全員に出すときは「全員」を選びます）');
      // 切り替えは、お客様 1 人ずつにメニューを付け替える仕組みなので、条件での出し分けと両立しない
      if (input.areas.some((a) => a.action.type === 'switch')) errors.push('お客様ごとのメニューでは、「別のメニューに切り替える」は使えません。ほかの動きに変えてください');
    }
    input.areas.forEach((area, i) => {
      const e = actionError(area.action, `ボタン ${i + 1}`, formIds, menuIds, opts.selfId ?? null, messageIds);
      if (e) errors.push(e);
    });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// LINE に送る形
// ---------------------------------------------------------------------------

export interface RichMenuBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 割合 → 実寸（px）。端数は四捨五入し、画像からはみ出さないようにする。
 * 右端・下端は「開始 + 大きさ」を先に丸めてから引くので、隣り合うボタンのあいだにすき間や重なりができない
 */
export function areaToBounds(area: Pick<RichMenuArea, 'x' | 'y' | 'w' | 'h'>, size: RichMenuSize): RichMenuBounds {
  const { width, height } = RICH_MENU_SIZES[size];
  const left = Math.max(0, Math.min(width - 1, Math.round(area.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(area.y * height)));
  const right = Math.max(left + 1, Math.min(width, Math.round((area.x + area.w) * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round((area.y + area.h) * height)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export type RichMenuObjectResult = { ok: true; object: Record<string, unknown> } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// 文字を出さずに動くボタン（postback）
// ---------------------------------------------------------------------------

/** 文字を出さずに「送られたのと同じ動き」をするボタンの data の先頭（続きは、送ったことにする文字） */
export const RICH_MENU_COMMAND_PREFIX = 'rmc:';
/** 応答メッセージを返すボタンの data の先頭（続きは メニュー ID:ボタン ID） */
export const RICH_MENU_REPLY_PREFIX = 'rma:';

export type RichMenuPostback = { kind: 'command'; text: string } | { kind: 'reply'; menuId: string; areaId: string };

export function buildRichMenuCommandData(text: string): string {
  return `${RICH_MENU_COMMAND_PREFIX}${text}`;
}

export function buildRichMenuReplyData(menuId: string, areaId: string): string {
  return `${RICH_MENU_REPLY_PREFIX}${menuId}:${areaId}`;
}

/** リッチメニューのボタン（postback）の data を読む。ほかの data（切り替え = rm:switch:… など）は null */
export function parseRichMenuPostback(data: unknown): RichMenuPostback | null {
  if (typeof data !== 'string') return null;
  if (data.startsWith(RICH_MENU_COMMAND_PREFIX)) {
    const text = data.slice(RICH_MENU_COMMAND_PREFIX.length).trim();
    return text ? { kind: 'command', text } : null;
  }
  if (data.startsWith(RICH_MENU_REPLY_PREFIX)) {
    const m = /^([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,40})$/.exec(data.slice(RICH_MENU_REPLY_PREFIX.length));
    return m ? { kind: 'reply', menuId: m[1], areaId: m[2] } : null;
  }
  return null;
}

/**
 * LINE の「リッチメニューを作る」に送る内容を組み立てる。
 * - 「文字を送る」で文字を出さない設定のボタン・「応答メッセージを返す」は postback にする（displayText を付けない = トークに何も出ない）
 *   「応答メッセージを返す」は、どのメニューのどのボタンかを data に入れるので menuId が要る
 * - 「何もしない」のボタンは送らない
 * - 「予約フォームを開く」は resolveFormUrl で URL にする（開けないフォームがあれば失敗）
 * - 「別のメニューに切り替える」は resolveAlias で LINE の名札にする（名札が無ければ失敗）
 */
export function buildRichMenuObject(input: RichMenuInput, resolveFormUrl: (formId: string) => string | null, resolveAlias: (menuId: string) => string | null = () => null, opts: { menuId?: string | null } = {}): RichMenuObjectResult {
  const areas: Array<Record<string, unknown>> = [];
  for (let i = 0; i < input.areas.length; i++) {
    const area = input.areas[i];
    const bounds = areaToBounds(area, input.size);
    const label = `ボタン ${i + 1}`;
    if (area.action.type === 'none') continue;
    if (area.action.type === 'reply') {
      if (!opts.menuId) return { ok: false, error: `${label}: 応答メッセージのボタンは、メニューを保存してから反映してください` };
      areas.push({ bounds, action: { type: 'postback', label, data: buildRichMenuReplyData(opts.menuId, area.id) } });
    } else if (area.action.type === 'message') {
      if (area.action.silent) areas.push({ bounds, action: { type: 'postback', label: area.action.text.slice(0, 20), data: buildRichMenuCommandData(area.action.text) } });
      else areas.push({ bounds, action: { type: 'message', label: area.action.text.slice(0, 20), text: area.action.text } });
    } else if (area.action.type === 'uri') {
      areas.push({ bounds, action: { type: 'uri', label, uri: area.action.uri } });
    } else if (area.action.type === 'switch') {
      const alias = resolveAlias(area.action.menu_id);
      if (!alias) return { ok: false, error: `${label}: 切り替え先のメニューが見つかりません。選び直してください` };
      areas.push({ bounds, action: { type: 'richmenuswitch', label, richMenuAliasId: alias, data: `rm:switch:${alias}` } });
    } else {
      const url = resolveFormUrl(area.action.form_id);
      if (!url) return { ok: false, error: `${label}: 選んだ予約フォームを開く URL がありません（LINE フォームは LIFF ID の設定、Web フォームは公開が必要です）` };
      areas.push({ bounds, action: { type: 'uri', label, uri: url } });
    }
  }
  if (areas.length === 0) return { ok: false, error: '押したときの動きを設定したボタンを 1 つ以上作ってください' };
  const size = RICH_MENU_SIZES[input.size];
  return {
    ok: true,
    object: {
      size: { width: size.width, height: size.height },
      selected: input.open_by_default,
      name: input.name.slice(0, 300),
      chatBarText: [...input.chat_bar_text].slice(0, RICH_MENU_LIMITS.chatBarTextMax).join(''),
      areas,
    },
  };
}

// ---------------------------------------------------------------------------
// 画像
// ---------------------------------------------------------------------------

export interface ImageInfo {
  type: 'jpeg' | 'png';
  width: number;
  height: number;
}

/** JPEG / PNG の先頭から、形式と大きさ（px）を読む。読めなければ null */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  // PNG: 8 バイトの印 + IHDR（幅・高さは 16〜23 バイト目）
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return width > 0 && height > 0 ? { type: 'png', width, height } : null;
  }
  // JPEG: SOF（0xC0〜0xCF。0xC4 / 0xC8 / 0xCC を除く）の中に高さ・幅がある
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        return width > 0 && height > 0 ? { type: 'jpeg', width, height } : null;
      }
      // 長さを持たない印（RSTn・SOI・EOI・TEM）
      if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
        i += 2;
        continue;
      }
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

/** LINE に送る前に、画像が決まりに合っているかを確かめる。問題があれば文言を返す */
export function checkRichMenuImage(bytes: Uint8Array, size: RichMenuSize): string | null {
  if (bytes.length === 0) return '画像を読み込めませんでした。画像を選び直してください';
  if (bytes.length > RICH_MENU_LIMITS.imageMaxBytes) return '画像が 1MB を超えています。画像を選び直してください';
  const info = readImageInfo(bytes);
  if (!info) return '画像は JPEG か PNG にしてください。画像を選び直してください';
  const want = RICH_MENU_SIZES[size];
  if (info.width !== want.width || info.height !== want.height) {
    return `画像の大きさがメニューの大きさ（${want.width}×${want.height}）と合っていません。画像を選び直してください`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 反映の進み具合・エラーの文言
// ---------------------------------------------------------------------------

/** 「反映の途中」のまま止まったとみなす時間（これを過ぎたら、もう一度反映できる） */
export const PUBLISHING_STALE_MS = 2 * 60 * 1000;

/** いま反映を始めてよいか（別の反映が進んでいる最中は false） */
export function canStartPublish(menu: Pick<LineRichMenu, 'status' | 'updated_at'>, now: Date = new Date()): boolean {
  if (menu.status !== 'publishing') return true;
  const t = Date.parse(menu.updated_at);
  return Number.isNaN(t) || now.getTime() - t > PUBLISHING_STALE_MS;
}

/** LINE からのエラー → 画面に出す文言 */
export function describeLineRichMenuError(status: number, body: string): string {
  if (status === 401 || status === 403) return 'LINE のチャネルアクセストークンを確認してください（無効か、権限がありません）';
  if (status === 429) return 'LINE への通信が混み合っています。少し待ってから、もう一度お試しください';
  if (status === 0) return 'LINE と通信できませんでした。少し待ってから、もう一度お試しください';
  let message = '';
  try {
    const json = JSON.parse(body) as { message?: unknown; details?: Array<{ message?: unknown; property?: unknown }> };
    const details = Array.isArray(json.details) ? json.details.map((d) => [d?.property, d?.message].filter(Boolean).join(': ')).filter(Boolean).join(' / ') : '';
    message = [typeof json.message === 'string' ? json.message : '', details].filter(Boolean).join(' — ');
  } catch {
    message = body.slice(0, 200);
  }
  return `LINE に断られました（${status}）${message ? `: ${message}` : ''}`;
}

/**
 * LINE のいまの設定と、このシステムの記録が食い違っているか。
 * - recorded: このシステムが「全員向け」にしたメニューの LINE 側の ID（無ければ null）
 * - actual: LINE がいま全員向けにしているメニューの ID（無ければ null。ほかの場所で設定されたものは 'other'）
 */
export function detectExternalChange(recorded: string | null, actual: string | null | 'other'): 'none' | 'replaced' | 'removed' | 'other_set' {
  if (recorded) {
    if (actual === recorded) return 'none';
    return actual === null ? 'removed' : 'replaced';
  }
  return actual ? 'other_set' : 'none';
}

export const EXTERNAL_CHANGE_MESSAGES: Record<Exclude<ReturnType<typeof detectExternalChange>, 'none'>, string> = {
  replaced: 'ほかの場所（公式 LINE の管理画面や別のツール）で、全員向けのメニューが変更されています。このメニューを出すには、もう一度「反映する」を押してください。',
  removed: 'ほかの場所で、全員向けのメニューが外されています。このメニューを出すには、もう一度「反映する」を押してください。',
  other_set: 'このシステム以外で設定した全員向けのメニューが、公式 LINE に出ています。ここで「反映する」を押すと、そのメニューの代わりにこちらが表示されます。',
};

// ---------------------------------------------------------------------------
// 画面での範囲の編集（画像の上でドラッグして 作る / 動かす / 大きさを変える）
// 位置はすべて画像全体に対する割合（0〜1）
// ---------------------------------------------------------------------------

/** 位置を合わせる刻み（割合）。1% 刻みにして、ボタン同士をぴったり並べやすくする */
export const AREA_SNAP = 0.01;

function snap(n: number): number {
  return round4(Math.round(n / AREA_SNAP) * AREA_SNAP);
}

type Rect = Pick<RichMenuArea, 'x' | 'y' | 'w' | 'h'>;

/** ドラッグの始点と終点 → 範囲（どの向きに引いても同じ。画像の中に収め、刻みに合わせる） */
export function rectFromDrag(x1: number, y1: number, x2: number, y2: number): Rect {
  const left = snap(clamp01(Math.min(x1, x2)));
  const top = snap(clamp01(Math.min(y1, y2)));
  const right = snap(clamp01(Math.max(x1, x2)));
  const bottom = snap(clamp01(Math.max(y1, y2)));
  return { x: left, y: top, w: round4(right - left), h: round4(bottom - top) };
}

/** 範囲を動かす（大きさはそのまま。画像の外には出ない） */
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  const x = snap(Math.max(0, Math.min(1 - rect.w, rect.x + dx)));
  const y = snap(Math.max(0, Math.min(1 - rect.h, rect.y + dy)));
  return { x: Math.min(x, round4(1 - rect.w)), y: Math.min(y, round4(1 - rect.h)), w: rect.w, h: rect.h };
}

/** 右下の角を引いて大きさを変える（左上は動かない。最小の大きさより小さくならず、画像の外には出ない） */
export function resizeRect(rect: Rect, dw: number, dh: number): Rect {
  const min = RICH_MENU_LIMITS.minAreaRatio;
  const w = snap(Math.max(min, Math.min(1 - rect.x, rect.w + dw)));
  const h = snap(Math.max(min, Math.min(1 - rect.y, rect.h + dh)));
  return { x: rect.x, y: rect.y, w: Math.min(w, round4(1 - rect.x)), h: Math.min(h, round4(1 - rect.y)) };
}

/** 作るのに十分な大きさか（押しただけ・小さすぎるドラッグでは作らない） */
export function isUsableRect(rect: Rect): boolean {
  return rect.w >= RICH_MENU_LIMITS.minAreaRatio && rect.h >= RICH_MENU_LIMITS.minAreaRatio;
}

/** ほかのボタンと重なっているか（動かしている最中に赤く見せるため） */
export function overlapsOthers(areas: RichMenuArea[], id: string, rect: Rect): boolean {
  return areas.some((a) => a.id !== id && areasOverlap(a, rect));
}

/** まだ使っていない ID */
export function nextAreaId(areas: Array<Pick<RichMenuArea, 'id'>>): string {
  const used = new Set(areas.map((a) => a.id));
  for (let n = areas.length + 1; ; n++) {
    if (!used.has(`a${n}`)) return `a${n}`;
  }
}

/** ボタンの動きを 1 行で（一覧に出す） */
export function describeRichMenuAction(action: RichMenuAction, formName: (id: string) => string | null, menuName: (id: string) => string | null = () => null, messageName: (id: string) => string | null = () => null): string {
  if (action.type === 'switch') return action.menu_id ? `メニューを切り替える: ${menuName(action.menu_id) || '（削除されたメニュー）'}` : 'メニューを切り替える（未選択）';
  if (action.type === 'form') return action.form_id ? `予約フォームを開く: ${formName(action.form_id) || '（削除されたフォーム）'}` : '予約フォームを開く（未選択）';
  if (action.type === 'uri') return action.uri ? `URL を開く: ${action.uri}` : 'URL を開く（未入力）';
  if (action.type === 'message') return action.text ? (action.silent ? `「${action.text}」の返事を返す（トークに文字を出さない）` : `「${action.text}」と送る`) : '文字を送る（未入力）';
  if (action.type === 'reply') {
    if (action.mode === 'message') return action.message_id ? `応答メッセージを返す: ${messageName(action.message_id) || '（削除された LINE メッセージ）'}` : '応答メッセージを返す（未選択）';
    return action.text ? `応答メッセージを返す: ${action.text.length > 30 ? `${action.text.slice(0, 30)}…` : action.text}` : '応答メッセージを返す（未入力）';
  }
  return '何もしない';
}

// ---------------------------------------------------------------------------
// 分割の型（③-2）: 型を選ぶだけで、ボタンの範囲がきれいに並ぶ
// ---------------------------------------------------------------------------

export interface RichMenuLayout {
  id: string;
  label: string;
  /** この型を使える大きさ */
  sizes: RichMenuSize[];
  /** 範囲（画像全体に対する割合）。左上から右下の順 */
  rects: Array<Pick<RichMenuArea, 'x' | 'y' | 'w' | 'h'>>;
}

const T = 1 / 3;
const cols = (n: number, y: number, h: number) => Array.from({ length: n }, (_, i) => ({ x: i / n, y, w: 1 / n, h }));

/** 公式 LINE の管理画面にある型と同じ並び */
export const RICH_MENU_LAYOUTS: RichMenuLayout[] = [
  { id: 'l6', label: '6 分割（3 × 2）', sizes: ['large'], rects: [...cols(3, 0, 0.5), ...cols(3, 0.5, 0.5)] },
  { id: 'l4', label: '4 分割（2 × 2）', sizes: ['large'], rects: [...cols(2, 0, 0.5), ...cols(2, 0.5, 0.5)] },
  { id: 'l1-3', label: '上 1 つ + 下 3 つ', sizes: ['large'], rects: [{ x: 0, y: 0, w: 1, h: 0.5 }, ...cols(3, 0.5, 0.5)] },
  { id: 'l1-2', label: '上 1 つ + 下 2 つ', sizes: ['large'], rects: [{ x: 0, y: 0, w: 1, h: 0.5 }, ...cols(2, 0.5, 0.5)] },
  { id: 'lside', label: '左に大きく 1 つ + 右に 2 つ', sizes: ['large'], rects: [{ x: 0, y: 0, w: 2 * T, h: 1 }, { x: 2 * T, y: 0, w: T, h: 0.5 }, { x: 2 * T, y: 0.5, w: T, h: 0.5 }] },
  { id: 'lrows', label: '上下 2 つ', sizes: ['large'], rects: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] },
  { id: 'c3', label: '3 分割（横に 3 つ）', sizes: ['small'], rects: cols(3, 0, 1) },
  { id: 'c1-2', label: '左 1/3 + 右 2/3', sizes: ['small'], rects: [{ x: 0, y: 0, w: T, h: 1 }, { x: T, y: 0, w: 2 * T, h: 1 }] },
  { id: 'c2-1', label: '左 2/3 + 右 1/3', sizes: ['small'], rects: [{ x: 0, y: 0, w: 2 * T, h: 1 }, { x: 2 * T, y: 0, w: T, h: 1 }] },
  { id: 'c2', label: '2 分割（左右）', sizes: ['large', 'small'], rects: cols(2, 0, 1) },
  { id: 'c1', label: '全体で 1 つ', sizes: ['large', 'small'], rects: [{ x: 0, y: 0, w: 1, h: 1 }] },
];

export function layoutsForSize(size: RichMenuSize): RichMenuLayout[] {
  return RICH_MENU_LAYOUTS.filter((l) => l.sizes.includes(size));
}

/**
 * 型を当てはめる。いまのボタンの動きは、上から順に新しい範囲へ引き継ぐ
 * （6 分割 → 3 分割のように数が減るときは、あふれたぶんの動きは捨てる）
 */
export function applyRichMenuLayout(layoutId: string, size: RichMenuSize, current: RichMenuArea[]): RichMenuArea[] | null {
  const layout = RICH_MENU_LAYOUTS.find((l) => l.id === layoutId && l.sizes.includes(size));
  if (!layout) return null;
  return normalizeRichMenuAreas(layout.rects.map((rect, i) => ({ id: `a${i + 1}`, ...rect, action: current[i]?.action ?? { type: 'none' } })));
}

/** 型を当てはめると、動きの入ったボタンが消えるか（確認を出すため） */
export function layoutDropsActions(layoutId: string, size: RichMenuSize, current: RichMenuArea[]): number {
  const layout = RICH_MENU_LAYOUTS.find((l) => l.id === layoutId && l.sizes.includes(size));
  if (!layout) return 0;
  return current.slice(layout.rects.length).filter((a) => a.action.type !== 'none').length;
}

// ---------------------------------------------------------------------------
// タブ切り替え（③-2）: ボタンを押すと、別のメニューに切り替わる
// LINE の決まり: 切り替え先のメニューに「名札」（エイリアス。32 文字まで・英小文字 / 数字 / _ / -）を付け、
// ボタンにはその名札を書く。名札は、画像を入れたメニューにしか付けられない
// ---------------------------------------------------------------------------

/** このシステムが付ける名札の先頭の印（掃除のとき、この印の付いた名札だけを消す） */
export const RICH_MENU_ALIAS_PREFIX = 'nasrsv-';
/** 1 回の反映でまとめて出せるメニューの数（切り替えでつながっているもの） */
export const SWITCH_GROUP_MAX = 5;

/**
 * 名札を作る。反映のたびに新しい名札にする（古い名札を書き換えない = 反映の途中で失敗しても、いま出ているメニューの切り替えが壊れない）
 * stamp は反映の時刻などから作った英小文字と数字（9 文字まで）
 */
export function buildRichMenuAliasId(menuId: string, stamp: string): string {
  const id = menuId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'menu';
  const s = stamp.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 9) || '0';
  return `${RICH_MENU_ALIAS_PREFIX}${id}-${s}`;
}

/** そのメニューから、切り替えのボタンで行けるメニューの ID */
export function switchTargetsOf(menu: Pick<LineRichMenu, 'areas'>): string[] {
  const ids: string[] = [];
  for (const a of menu.areas) {
    if (a.action.type === 'switch' && a.action.menu_id && !ids.includes(a.action.menu_id)) ids.push(a.action.menu_id);
  }
  return ids;
}

/**
 * 反映するメニューと、そこから切り替えでつながっているメニューをまとめる（最初が反映するメニュー）。
 * 切り替え先が見つからない・数が多すぎるときは error
 */
export function collectSwitchGroup<M extends Pick<LineRichMenu, 'id' | 'name' | 'areas'>>(rootId: string, menus: M[]): { ok: true; group: M[] } | { ok: false; error: string } {
  const byId = new Map(menus.map((m) => [m.id, m]));
  const root = byId.get(rootId);
  if (!root) return { ok: false, error: 'リッチメニューが見つかりません' };
  const group: M[] = [root];
  for (let i = 0; i < group.length; i++) {
    for (const targetId of switchTargetsOf(group[i])) {
      if (group.some((m) => m.id === targetId)) continue;
      const target = byId.get(targetId);
      if (!target) return { ok: false, error: `「${group[i].name}」の切り替え先のメニューが見つかりません（削除された可能性があります）。選び直してください` };
      group.push(target);
      if (group.length > SWITCH_GROUP_MAX) return { ok: false, error: `切り替えでつなげられるメニューは ${SWITCH_GROUP_MAX} 個までです` };
    }
  }
  return { ok: true, group };
}

/** そのメニューを切り替え先にしているメニュー（一覧で「◯◯ から切り替え」と出す・削除の前に知らせる） */
export function menusSwitchingTo<M extends Pick<LineRichMenu, 'id' | 'areas'>>(menuId: string, menus: M[]): M[] {
  return menus.filter((m) => m.id !== menuId && switchTargetsOf(m).includes(menuId));
}

// ---------------------------------------------------------------------------
// タブ付きメニューをまとめて作る
// ---------------------------------------------------------------------------
//
// タブで切り替わるメニューは、LINE の上では「メニューを枚数ぶん作り、それぞれの画像の上の帯に
// タブの絵を描いて、帯の各ボタンに『別のメニューに切り替える』を付ける」ことで作る。
// これを手で組むのは手間（メニューを 1 つずつ作る → 全部ができてから、たがいに切り替え先を選ぶ）なので、
// タブの名前を入れるだけで、つながった下書きを枚数ぶん作る。

/** 画像の上の、タブの帯の高さ（画像全体に対する割合） */
export const TAB_SET_STRIP_RATIO: Record<RichMenuSize, number> = { large: 0.15, small: 0.25 };
export const TAB_SET_MIN = 2;

export interface RichMenuTabSetInput {
  size: RichMenuSize;
  /** タブの名前（= 作るメニューの名前）。左から順 */
  tabs: string[];
  chat_bar_text: string;
}

export function normalizeRichMenuTabSetInput(value: unknown): RichMenuTabSetInput {
  const rec = asRecord(value);
  const tabs = Array.isArray(rec.tabs) ? rec.tabs.map((t) => (typeof t === 'string' ? t.trim() : '')) : [];
  const bar = typeof rec.chat_bar_text === 'string' ? rec.chat_bar_text.trim() : '';
  return { size: isRichMenuSize(rec.size) ? rec.size : 'large', tabs, chat_bar_text: bar || DEFAULT_CHAT_BAR_TEXT };
}

export function validateRichMenuTabSetInput(input: RichMenuTabSetInput): string[] {
  const errors: string[] = [];
  if (input.tabs.length < TAB_SET_MIN) errors.push(`タブは ${TAB_SET_MIN} 個以上にしてください`);
  if (input.tabs.length > SWITCH_GROUP_MAX) errors.push(`タブは ${SWITCH_GROUP_MAX} 個までにしてください`);
  input.tabs.forEach((name, i) => {
    if (!name) errors.push(`タブ ${i + 1} の名前を入力してください`);
    else if (name.length > RICH_MENU_LIMITS.nameMax) errors.push(`タブ ${i + 1} の名前は ${RICH_MENU_LIMITS.nameMax} 文字までにしてください`);
  });
  if (new Set(input.tabs.filter(Boolean)).size !== input.tabs.filter(Boolean).length) errors.push('同じ名前のタブがあります。別の名前にしてください');
  if ([...input.chat_bar_text].length > RICH_MENU_LIMITS.chatBarTextMax) errors.push(`メニューバーの文言は ${RICH_MENU_LIMITS.chatBarTextMax} 文字までにしてください`);
  return errors;
}

/**
 * タブ付きメニューの 1 枚ぶんのボタン。
 * 上の帯を枚数で等分し、ほかのタブには「別のメニューに切り替える」、自分のタブには「何もしない」を入れる。
 * 帯の下は、あとで自由に分けられるよう、「何もしない」の大きなボタンを 1 つ置く
 * @param index このメニューが左から何番目か（0 始まり）
 * @param menuIds 全部のメニューの ID（左から順）
 */
export function buildTabSetAreas(size: RichMenuSize, index: number, menuIds: string[]): RichMenuArea[] {
  const strip = TAB_SET_STRIP_RATIO[size];
  const count = menuIds.length;
  const areas: RichMenuArea[] = menuIds.map((menuId, i) => {
    // 右端を先に丸めてから引くので、となりのタブとのあいだにすき間も重なりもできない
    const left = round4(i / count);
    const right = i === count - 1 ? 1 : round4((i + 1) / count);
    return { id: `tab${i + 1}`, x: left, y: 0, w: round4(right - left), h: strip, action: i === index ? { type: 'none' } : { type: 'switch', menu_id: menuId } };
  });
  areas.push({ id: 'body1', x: 0, y: strip, w: 1, h: round4(1 - strip), action: { type: 'none' } });
  return areas;
}

// ---------------------------------------------------------------------------
// ボタンを自由に置く（足す・8 方向から大きさを変える・となりに寄せる・数字で合わせる・マス目で作る）
// ---------------------------------------------------------------------------

/** 大きさを変えるつまみの位置（n = 上 / s = 下 / w = 左 / e = 右） */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** つまみを引いて大きさを変える（引いていない側の辺は動かない。最小の大きさより小さくならず、画像の外には出ない） */
export function resizeRectBy(rect: Rect, handle: ResizeHandle, dx: number, dy: number): Rect {
  const min = RICH_MENU_LIMITS.minAreaRatio;
  let left = rect.x;
  let top = rect.y;
  let right = round4(rect.x + rect.w);
  let bottom = round4(rect.y + rect.h);
  if (handle.includes('w')) left = snap(Math.max(0, Math.min(right - min, rect.x + dx)));
  if (handle.includes('e')) right = snap(Math.max(left + min, Math.min(1, right + dx)));
  if (handle.includes('n')) top = snap(Math.max(0, Math.min(bottom - min, rect.y + dy)));
  if (handle.includes('s')) bottom = snap(Math.max(top + min, Math.min(1, bottom + dy)));
  return { x: round4(left), y: round4(top), w: round4(right - left), h: round4(bottom - top) };
}

/** となりのボタンの辺・画像の端に、これより近づいたら吸い付く（画像全体に対する割合） */
export const AREA_MAGNET = 0.015;

function nearest(value: number, candidates: number[]): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d <= AREA_MAGNET && (best === null || d < Math.abs(best - value))) best = c;
  }
  return best;
}

/**
 * 動かしている / 大きさを変えている範囲を、ほかのボタンの辺と画像の端に吸い付ける
 * （ぴったり並べるのを手でやるのは難しいため。すき間のない並びを作りやすくする）
 * @param handle 'move' = 動かしている（大きさは変えない）/ つまみ = その辺だけを寄せる
 */
export function magnetRect(rect: Rect, others: Rect[], handle: ResizeHandle | 'move'): Rect {
  const xs = [0, 1, ...others.flatMap((o) => [o.x, round4(o.x + o.w)])];
  const ys = [0, 1, ...others.flatMap((o) => [o.y, round4(o.y + o.h)])];
  let left = rect.x;
  let top = rect.y;
  let right = round4(rect.x + rect.w);
  let bottom = round4(rect.y + rect.h);
  if (handle === 'move') {
    // 左右どちらかの辺が寄れば、範囲ごと動かす（近いほうを優先）
    const l = nearest(left, xs);
    const r = nearest(right, xs);
    const dx = l !== null && (r === null || Math.abs(l - left) <= Math.abs(r - right)) ? l - left : r !== null ? r - right : 0;
    const t = nearest(top, ys);
    const b = nearest(bottom, ys);
    const dy = t !== null && (b === null || Math.abs(t - top) <= Math.abs(b - bottom)) ? t - top : b !== null ? b - bottom : 0;
    const x = Math.max(0, Math.min(round4(1 - rect.w), round4(left + dx)));
    const y = Math.max(0, Math.min(round4(1 - rect.h), round4(top + dy)));
    return { x, y, w: rect.w, h: rect.h };
  }
  const min = RICH_MENU_LIMITS.minAreaRatio;
  if (handle.includes('w')) left = nearest(left, xs.filter((v) => v <= right - min)) ?? left;
  if (handle.includes('e')) right = nearest(right, xs.filter((v) => v >= left + min)) ?? right;
  if (handle.includes('n')) top = nearest(top, ys.filter((v) => v <= bottom - min)) ?? top;
  if (handle.includes('s')) bottom = nearest(bottom, ys.filter((v) => v >= top + min)) ?? bottom;
  return { x: round4(left), y: round4(top), w: round4(right - left), h: round4(bottom - top) };
}

/**
 * 新しいボタンを置ける、空いている場所を探す（「ボタンを足す」用）。
 * 画像の 1/4 の大きさから始め、入らなければ小さくして探す。どこにも入らなければ null
 */
export function findFreeRect(areas: Rect[]): Rect | null {
  for (const size of [0.25, 0.2, 0.15, 0.1, RICH_MENU_LIMITS.minAreaRatio]) {
    const step = 0.05;
    for (let y = 0; y <= 1 - size + 1e-9; y = round4(y + step)) {
      for (let x = 0; x <= 1 - size + 1e-9; x = round4(x + step)) {
        const rect = { x: round4(x), y: round4(y), w: size, h: size };
        if (!areas.some((a) => areasOverlap(a, rect))) return rect;
      }
    }
  }
  return null;
}

export const GRID_COLS_MAX = 6;
export const GRID_ROWS_MAX = 4;

/**
 * マス目で作る: 横 cols × 縦 rows に等分したボタンを作る（左上から右へ、上から下へ）。
 * いまのボタンの動きは、上から順に引き継ぐ。数が合わない・多すぎるときは null
 */
export function buildGridAreas(cols: number, rows: number, current: RichMenuArea[] = []): RichMenuArea[] | null {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > GRID_COLS_MAX || rows > GRID_ROWS_MAX) return null;
  if (cols * rows > RICH_MENU_LIMITS.areasMax) return null;
  const edge = (i: number, n: number) => (i === n ? 1 : round4(i / n));
  const areas: RichMenuArea[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = edge(c, cols);
      const y = edge(r, rows);
      areas.push({ id: `a${i + 1}`, x, y, w: round4(edge(c + 1, cols) - x), h: round4(edge(r + 1, rows) - y), action: current[i]?.action ?? { type: 'none' } });
    }
  }
  return areas;
}

export type RectField = 'x' | 'y' | 'w' | 'h';

/**
 * 位置・大きさを数字（%）で直す。画像の中に収め、最小の大きさより小さくしない。
 * 位置を変えても大きさは変えない（はみ出すぶんだけ位置を戻す）
 */
export function setRectField(rect: Rect, field: RectField, percent: number): Rect {
  if (!Number.isFinite(percent)) return rect;
  const v = Math.round(percent * 10) / 1000;
  const min = RICH_MENU_LIMITS.minAreaRatio;
  if (field === 'x') return { ...rect, x: round4(Math.max(0, Math.min(1 - rect.w, v))) };
  if (field === 'y') return { ...rect, y: round4(Math.max(0, Math.min(1 - rect.h, v))) };
  if (field === 'w') return { ...rect, w: round4(Math.max(min, Math.min(1 - rect.x, v))) };
  return { ...rect, h: round4(Math.max(min, Math.min(1 - rect.y, v))) };
}

/** 割合 → 画面に出す %（小数 1 桁まで） */
export function rectPercent(n: number): number {
  return Math.round(n * 1000) / 10;
}
