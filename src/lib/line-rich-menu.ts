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
  { text: 'キャンセル', label: 'キャンセル', description: '予約のキャンセルの案内を返します' },
  { text: '空き待ち確認', label: '空き待ち確認', description: '登録中の空き待ちを一覧で返します' },
];

/** ボタンを押したときの動き */
export type RichMenuAction =
  | { type: 'form'; form_id: string } // 予約フォームを開く（反映のときに URL にする）
  | { type: 'uri'; uri: string } // 任意の URL を開く
  | { type: 'message'; text: string } // 文字を送る
  | { type: 'none' }; // 何もしない（飾りの部分。LINE には送らない）

export const RICH_MENU_ACTION_LABELS: Record<RichMenuAction['type'], string> = {
  form: '予約フォームを開く',
  uri: 'URL を開く',
  message: '文字を送る',
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
  if (rec.type === 'message') return { type: 'message', text: typeof rec.text === 'string' ? rec.text.trim() : '' };
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

function actionError(action: RichMenuAction, label: string, formIds: Set<string> | null): string | null {
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
export function validateRichMenu(input: RichMenuInput, opts: { forPublish?: boolean; formIds?: Iterable<string> | null } = {}): string[] {
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
    const active = input.areas.filter((a) => a.action.type !== 'none');
    if (active.length === 0) errors.push('押したときの動きを設定したボタンを 1 つ以上作ってください');
    input.areas.forEach((area, i) => {
      const e = actionError(area.action, `ボタン ${i + 1}`, formIds);
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

/**
 * LINE の「リッチメニューを作る」に送る内容を組み立てる。
 * - 「何もしない」のボタンは送らない
 * - 「予約フォームを開く」は resolveFormUrl で URL にする（開けないフォームがあれば失敗）
 */
export function buildRichMenuObject(input: RichMenuInput, resolveFormUrl: (formId: string) => string | null): RichMenuObjectResult {
  const areas: Array<Record<string, unknown>> = [];
  for (let i = 0; i < input.areas.length; i++) {
    const area = input.areas[i];
    const bounds = areaToBounds(area, input.size);
    const label = `ボタン ${i + 1}`;
    if (area.action.type === 'none') continue;
    if (area.action.type === 'message') {
      areas.push({ bounds, action: { type: 'message', label: area.action.text.slice(0, 20), text: area.action.text } });
    } else if (area.action.type === 'uri') {
      areas.push({ bounds, action: { type: 'uri', label, uri: area.action.uri } });
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
export function describeRichMenuAction(action: RichMenuAction, formName: (id: string) => string | null): string {
  if (action.type === 'form') return action.form_id ? `予約フォームを開く: ${formName(action.form_id) || '（削除されたフォーム）'}` : '予約フォームを開く（未選択）';
  if (action.type === 'uri') return action.uri ? `URL を開く: ${action.uri}` : 'URL を開く（未入力）';
  if (action.type === 'message') return action.text ? `「${action.text}」と送る` : '文字を送る（未入力）';
  return '何もしない';
}
