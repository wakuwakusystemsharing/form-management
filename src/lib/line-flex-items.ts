/**
 * LINE メッセージ（Flex）に「追加のメッセージ」を付けてまとめて送る純粋ロジック（DB / LINE API 非依存）
 *
 * 1 件の LINE メッセージは、テンプレートで作った Flex（main）に加えて テキスト / 画像 / 動画 / Flex（JSON）/
 * 保存済みの別の LINE メッセージ（ref）を最大 5 通まで自由な順番で並べられる（LINE の 1 回の送信上限 = 5 通）。
 * - items … 編集画面で並べた順番（main はちょうど 1 つ）
 * - payloads … 保存時にサーバーで組み立てた送信用メッセージの配列。Webhook / Edge Function はこれをそのまま送る
 *   （ref は参照先の Flex 本体 1 通に展開。参照先が変わったら参照元の payloads も作り直す）
 */
import type { FlexContainer } from '@/types/line-flex';
import { instrumentFlexLinks, payloadBytes, LINE_FLEX_MAX_JSON_BYTES, LINE_FLEX_ALT_TEXT_MAX, validateFlexContents } from '@/lib/line-flex-templates';

export const LINE_FLEX_ITEMS_MAX = 5;
export const LINE_FLEX_ATTACH_MAX = 4; // 差し込み先（予約確認など）は本体 1 通 + 4 通まで
export const LINE_TEXT_MESSAGE_MAX = 5000;

export type LineFlexItemType = 'main' | 'text' | 'image' | 'video' | 'flex' | 'ref';

export type LineFlexItem =
  | { key: string; type: 'main' }
  | { key: string; type: 'text'; text: string }
  | { key: string; type: 'image'; url: string; preview_url?: string }
  | { key: string; type: 'video'; url: string; preview_url: string }
  | { key: string; type: 'flex'; alt_text: string; contents: FlexContainer | null }
  | { key: string; type: 'ref'; message_id: string };

export const LINE_FLEX_ITEM_LABELS: Record<LineFlexItemType, string> = {
  main: 'Flex Message（上の「内容」で作ったもの）',
  text: 'テキスト',
  image: '画像',
  video: '動画',
  flex: 'Flex Message（JSON）',
  ref: '保存済みの LINE メッセージ',
};

const KEY_RE = /^[a-z0-9_-]{1,24}$/i;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function isHttps(v: string): boolean {
  return /^https:\/\/\S+$/i.test(v);
}

/**
 * 保存データ（未知の形も含む）を items に整える。main がちょうど 1 つになるようにし、5 通を超える分は捨てる
 * 空（旧データ）なら [main] だけ
 */
export function normalizeLineFlexItems(raw: unknown): LineFlexItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: LineFlexItem[] = [];
  let hasMain = false;
  let n = 0;
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const key = KEY_RE.test(str(o.key)) ? str(o.key) : `k${++n}`;
    switch (o.type) {
      case 'main':
        if (hasMain) continue;
        hasMain = true;
        out.push({ key, type: 'main' });
        break;
      case 'text':
        out.push({ key, type: 'text', text: str(o.text).slice(0, LINE_TEXT_MESSAGE_MAX) });
        break;
      case 'image':
        out.push({ key, type: 'image', url: str(o.url).trim(), preview_url: str(o.preview_url).trim() || undefined });
        break;
      case 'video':
        out.push({ key, type: 'video', url: str(o.url).trim(), preview_url: str(o.preview_url).trim() });
        break;
      case 'flex':
        out.push({ key, type: 'flex', alt_text: str(o.alt_text), contents: o.contents && typeof o.contents === 'object' && !Array.isArray(o.contents) ? (o.contents as FlexContainer) : null });
        break;
      case 'ref':
        out.push({ key, type: 'ref', message_id: str(o.message_id) });
        break;
      default:
        break;
    }
  }
  if (!hasMain) out.unshift({ key: 'main', type: 'main' });
  if (out.length <= LINE_FLEX_ITEMS_MAX) return out;
  const mainIdx = out.findIndex((x) => x.type === 'main');
  if (mainIdx < LINE_FLEX_ITEMS_MAX) return out.slice(0, LINE_FLEX_ITEMS_MAX);
  // main が後ろに追いやられていたら、他を削って main を残す
  return [...out.filter((x) => x.type !== 'main').slice(0, LINE_FLEX_ITEMS_MAX - 1), out[mainIdx]];
}

/**
 * 追加メッセージの入力チェック。`existingIds` を渡すと ref の参照先があるかも見る（自分自身は不可）
 * 問題なければ null、あれば日本語のメッセージ
 */
export function validateLineFlexItems(items: LineFlexItem[], opts: { selfId?: string; existingIds?: ReadonlySet<string> } = {}): string | null {
  if (items.length > LINE_FLEX_ITEMS_MAX) return `1 回に送れるのは ${LINE_FLEX_ITEMS_MAX} 通までです`;
  if (items.filter((x) => x.type === 'main').length !== 1) return 'メッセージの構成が壊れています（Flex 本体が 1 つ必要です）';
  for (const [i, item] of items.entries()) {
    const err = validateLineFlexItem(item, `${i + 1} 通目`, opts);
    if (err) return err;
  }
  return null;
}

/** 1 件ぶんの入力チェック（配信機能の並びでも使う）。`at` = エラー文の先頭に付ける位置（例: 「2 通目」） */
export function validateLineFlexItem(item: LineFlexItem, at: string, opts: { selfId?: string; existingIds?: ReadonlySet<string> } = {}): string | null {
  {
    switch (item.type) {
      case 'text':
        if (!item.text.trim()) return `${at}（テキスト）の文章を入力してください`;
        if (item.text.length > LINE_TEXT_MESSAGE_MAX) return `${at}（テキスト）は ${LINE_TEXT_MESSAGE_MAX} 文字までです`;
        break;
      case 'image':
        if (!isHttps(item.url)) return `${at}（画像）の画像をアップロードするか https:// の URL を入力してください`;
        if (item.preview_url && !isHttps(item.preview_url)) return `${at}（画像）のサムネイル URL は https:// で始めてください`;
        break;
      case 'video':
        if (!isHttps(item.url)) return `${at}（動画）の動画 URL（https:// の mp4）を入力してください`;
        if (!isHttps(item.preview_url)) return `${at}（動画）のサムネイル画像が必要です（LINE の仕様）`;
        break;
      case 'flex': {
        const err = validateFlexContents(item.contents);
        if (err) return `${at}（Flex）: ${err}`;
        if (item.alt_text.length > LINE_FLEX_ALT_TEXT_MAX) return `${at}（Flex）の代替テキストは ${LINE_FLEX_ALT_TEXT_MAX} 文字までです`;
        break;
      }
      case 'ref':
        if (!item.message_id) return `${at}（保存済みメッセージ）の参照先を選んでください`;
        if (opts.selfId && item.message_id === opts.selfId) return `${at}: 自分自身は追加できません`;
        if (opts.existingIds && !opts.existingIds.has(item.message_id)) return `${at}（保存済みメッセージ）の参照先が見つかりません（削除された可能性があります）`;
        break;
      default:
        break;
    }
  }
  return null;
}

export interface BuildPayloadsArgs {
  items: LineFlexItem[];
  /** main の送信用メッセージ（計測リンク適用済み）とその links */
  mainPayload: Record<string, unknown>;
  mainLinks: Record<string, string>;
  origin: string;
  messageId: string;
  trackTaps: boolean;
  /** ref の参照先 ID → その Flex 本体の payload（無ければ飛ばす） */
  refPayloads: Record<string, Record<string, unknown> | null | undefined>;
}

/**
 * items の順番どおりに送信用メッセージの配列を作る。追加の Flex（JSON）は main の計測キーの続き番号で計測リンクにする
 * （/go/{id}/{key} は数字のキーだけ受け付ける）。ref は参照先の payload をそのまま（参照先の計測リンクのまま = 参照先で数える）
 */
export function buildLineFlexPayloads(args: BuildPayloadsArgs): { payloads: Record<string, unknown>[]; links: Record<string, string>; error: string | null } {
  const payloads: Record<string, unknown>[] = [];
  const links: Record<string, string> = { ...args.mainLinks };
  let nextKey = Object.keys(args.mainLinks).reduce((m, k) => Math.max(m, Number(k) || 0), 0);
  for (const [i, item] of args.items.entries()) {
    switch (item.type) {
      case 'main':
        payloads.push(args.mainPayload);
        break;
      case 'text':
        payloads.push({ type: 'text', text: item.text });
        break;
      case 'image':
        payloads.push({ type: 'image', originalContentUrl: item.url, previewImageUrl: item.preview_url || item.url });
        break;
      case 'video':
        payloads.push({ type: 'video', originalContentUrl: item.url, previewImageUrl: item.preview_url });
        break;
      case 'flex': {
        if (!item.contents) break;
        let contents = item.contents;
        if (args.trackTaps) {
          const r = instrumentFlexLinks(contents, args.origin, args.messageId, nextKey);
          contents = r.contents;
          Object.assign(links, r.links);
          nextKey += Object.keys(r.links).length;
        }
        const alt = item.alt_text.trim().slice(0, LINE_FLEX_ALT_TEXT_MAX) || 'メッセージが届いています';
        const payload = { type: 'flex', altText: alt, contents };
        const bytes = payloadBytes(payload);
        if (bytes > LINE_FLEX_MAX_JSON_BYTES) {
          return { payloads: [], links: {}, error: `${i + 1} 通目の Flex が大きすぎます（${Math.round(bytes / 1024)}KB。LINE の上限は 30KB）` };
        }
        payloads.push(payload);
        break;
      }
      case 'ref': {
        const p = args.refPayloads[item.message_id];
        if (p && typeof p === 'object') payloads.push(p);
        break;
      }
      default:
        break;
    }
  }
  return { payloads: payloads.slice(0, LINE_FLEX_ITEMS_MAX), links, error: null };
}

/** items が別の LINE メッセージを参照しているか（参照先が変わったときに作り直す対象の判定） */
export function lineFlexItemsReference(items: LineFlexItem[], messageId: string): boolean {
  return items.some((x) => x.type === 'ref' && x.message_id === messageId);
}

// ---------------------------------------------------------------------------
// プレビュー
// ---------------------------------------------------------------------------

export type PreviewMessage =
  | { type: 'flex'; contents: FlexContainer; altText?: string; /** この LINE メッセージの Flex 本体（プレビューで直接編集できる 1 通） */ main?: boolean }
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'video'; previewUrl: string; url?: string };

/** 送信用メッセージの配列 → プレビュー用（一覧の「プレビュー」。保存済みの payloads から） */
export function payloadsToPreview(payloads: unknown): PreviewMessage[] {
  const list = Array.isArray(payloads) ? payloads : [];
  const out: PreviewMessage[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    if (o.type === 'flex' && o.contents && typeof o.contents === 'object') out.push({ type: 'flex', contents: o.contents as FlexContainer, altText: str(o.altText) || undefined });
    else if (o.type === 'text') out.push({ type: 'text', text: str(o.text) });
    else if (o.type === 'image') out.push({ type: 'image', url: str(o.previewImageUrl) || str(o.originalContentUrl) });
    else if (o.type === 'video') out.push({ type: 'video', previewUrl: str(o.previewImageUrl), url: str(o.originalContentUrl) || undefined });
  }
  return out;
}

/** 編集中の items → プレビュー用（main は編集中の contents、ref は参照先の contents を引く） */
export function itemsToPreview(items: LineFlexItem[], mainContents: FlexContainer | null, mainAltText: string, resolveRef: (id: string) => { contents: FlexContainer | null; altText?: string } | null): PreviewMessage[] {
  const out: PreviewMessage[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'main':
        if (mainContents) out.push({ type: 'flex', contents: mainContents, altText: mainAltText || undefined, main: true });
        break;
      case 'text':
        if (item.text.trim()) out.push({ type: 'text', text: item.text });
        break;
      case 'image':
        if (item.url) out.push({ type: 'image', url: item.preview_url || item.url });
        break;
      case 'video':
        if (item.url || item.preview_url) out.push({ type: 'video', previewUrl: item.preview_url, url: item.url || undefined });
        break;
      case 'flex':
        if (item.contents && !validateFlexContents(item.contents)) out.push({ type: 'flex', contents: item.contents, altText: item.alt_text || undefined });
        break;
      case 'ref': {
        const r = resolveRef(item.message_id);
        if (r?.contents) out.push({ type: 'flex', contents: r.contents, altText: r.altText });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** 一覧に出す短い説明（例: Flex + テキスト + 画像 = 3 通） */
export function describeLineFlexItems(items: LineFlexItem[]): string {
  if (items.length <= 1) return '';
  const short: Record<LineFlexItemType, string> = { main: 'Flex', text: 'テキスト', image: '画像', video: '動画', flex: 'Flex', ref: '保存済み' };
  return `${items.map((x) => short[x.type]).join(' + ')} = ${items.length} 通`;
}
