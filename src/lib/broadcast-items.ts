/**
 * 配信のメッセージの並び（純粋ロジック。DB / LINE API 非依存）
 * 仕様: docs/LINE配信機能_仕様書.md §5
 *
 * 「LINE メッセージ」タブの並び（line-flex-items.ts）から main を除き、スタンプ（画像メッセージとして送る）を足したもの。
 * - ref は保存済み LINE メッセージの送信用メッセージ（Flex 本体 + その追加メッセージ）をそのまま展開する
 * - テキストの {name} は送信時に 1 人ずつ置き換える（差し込みがある配信は multicast ではなく push）
 * - ボタンの URL は計測リンク /go/b/{broadcastId}/{key} に置き換える
 */
import type { BroadcastItem } from '@/types/broadcast';
import type { FlexContainer } from '@/types/line-flex';
import { LINE_TEXT_MESSAGE_MAX, validateLineFlexItem, type PreviewMessage } from '@/lib/line-flex-items';
import { instrumentFlexLinks, LINE_FLEX_ALT_TEXT_MAX, LINE_FLEX_MAX_JSON_BYTES, payloadBytes, validateFlexContents } from '@/lib/line-flex-templates';

export const BROADCAST_ITEMS_MAX = 5;
export const BROADCAST_NAME_MAX = 60;
export const BROADCAST_NAME_TOKEN = '{name}';
export const BROADCAST_NAME_FALLBACK = 'お客様';

export const BROADCAST_ITEM_LABELS: Record<BroadcastItem['type'], string> = {
  ref: '保存済みの LINE メッセージ',
  text: 'テキスト',
  image: '画像',
  video: '動画',
  sticker: 'スタンプ',
  flex: 'Flex Message（JSON）',
};

const KEY_RE = /^[a-z0-9_-]{1,24}$/i;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 計測リンクの ID 部分（/go/b/{broadcastId}/{key}） */
export function broadcastTrackingId(broadcastId: string): string {
  return `b/${broadcastId}`;
}

/** 保存データ（未知の形も含む）を並びに整える。5 件を超える分は捨てる */
export function normalizeBroadcastItems(raw: unknown): BroadcastItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BroadcastItem[] = [];
  let n = 0;
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const key = KEY_RE.test(str(o.key)) ? str(o.key) : `k${++n}`;
    switch (o.type) {
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
      case 'sticker':
        out.push({ key, type: 'sticker', sticker_id: str(o.sticker_id) });
        break;
      default:
        break;
    }
    if (out.length >= BROADCAST_ITEMS_MAX) break;
  }
  return out;
}

/**
 * 入力チェック。`messageIds` / `stickerIds` を渡すと参照先があるかも見る。
 * `requireContent` = 送信・予約するとき（下書き保存では 0 件でも可）
 */
export function validateBroadcastItems(
  items: BroadcastItem[],
  opts: { messageIds?: ReadonlySet<string>; stickerIds?: ReadonlySet<string>; requireContent?: boolean } = {}
): string | null {
  if (opts.requireContent && items.length === 0) return '送るメッセージを 1 つ以上追加してください';
  if (items.length > BROADCAST_ITEMS_MAX) return `1 回に送れるのは ${BROADCAST_ITEMS_MAX} 通までです`;
  for (const [i, item] of items.entries()) {
    const at = `${i + 1} 通目`;
    if (item.type === 'sticker') {
      if (!item.sticker_id) return `${at}（スタンプ）を選んでください`;
      if (opts.stickerIds && !opts.stickerIds.has(item.sticker_id)) return `${at}（スタンプ）が見つかりません（削除された可能性があります）`;
      continue;
    }
    const err = validateLineFlexItem(item, at, { existingIds: opts.messageIds });
    if (err) return err;
  }
  return null;
}

export interface BuildBroadcastPayloadsArgs {
  items: BroadcastItem[];
  /** ref の参照先 ID → その LINE メッセージの送信用メッセージ（Flex 本体 + 追加メッセージ） */
  refMessages: Record<string, Record<string, unknown>[] | null | undefined>;
  /** スタンプ ID → 画像 URL */
  stickers: Record<string, { url: string; preview_url?: string | null } | null | undefined>;
  origin: string;
  broadcastId: string;
  trackTaps: boolean;
}

/**
 * 並びの順に送信用メッセージを作る。ref を展開した合計が 5 通を超えたらエラー。
 * 追加の Flex（JSON）のボタンは計測リンクにする（ref の中身は参照先の LINE メッセージの計測リンクのまま = 参照先で数える）
 */
export function buildBroadcastPayloads(args: BuildBroadcastPayloadsArgs): { payloads: Record<string, unknown>[]; links: Record<string, string>; has_personalization: boolean; error: string | null } {
  const fail = (error: string) => ({ payloads: [], links: {}, has_personalization: false, error });
  const payloads: Record<string, unknown>[] = [];
  const links: Record<string, string> = {};
  let nextKey = 0;
  for (const [i, item] of args.items.entries()) {
    const at = `${i + 1} 通目`;
    switch (item.type) {
      case 'text':
        payloads.push({ type: 'text', text: item.text });
        break;
      case 'image':
        payloads.push({ type: 'image', originalContentUrl: item.url, previewImageUrl: item.preview_url || item.url });
        break;
      case 'video':
        payloads.push({ type: 'video', originalContentUrl: item.url, previewImageUrl: item.preview_url });
        break;
      case 'sticker': {
        const s = args.stickers[item.sticker_id];
        if (!s || !/^https:\/\//i.test(s.url)) return fail(`${at}（スタンプ）の画像が見つかりません`);
        payloads.push({ type: 'image', originalContentUrl: s.url, previewImageUrl: s.preview_url && /^https:\/\//i.test(s.preview_url) ? s.preview_url : s.url });
        break;
      }
      case 'flex': {
        if (!item.contents) return fail(`${at}（Flex）の内容が空です`);
        let contents = item.contents;
        if (args.trackTaps) {
          const r = instrumentFlexLinks(contents, args.origin, broadcastTrackingId(args.broadcastId), nextKey);
          contents = r.contents;
          Object.assign(links, r.links);
          nextKey += Object.keys(r.links).length;
        }
        const payload = { type: 'flex', altText: item.alt_text.trim().slice(0, LINE_FLEX_ALT_TEXT_MAX) || 'メッセージが届いています', contents };
        const bytes = payloadBytes(payload);
        if (bytes > LINE_FLEX_MAX_JSON_BYTES) return fail(`${at}の Flex が大きすぎます（${Math.round(bytes / 1024)}KB。LINE の上限は 30KB）`);
        payloads.push(payload);
        break;
      }
      case 'ref': {
        const msgs = args.refMessages[item.message_id];
        if (!msgs || msgs.length === 0) return fail(`${at}（保存済みメッセージ）の内容が見つかりません`);
        payloads.push(...msgs);
        break;
      }
      default:
        break;
    }
  }
  if (payloads.length > BROADCAST_ITEMS_MAX) {
    return fail(`合計 ${payloads.length} 通になります。1 回に送れるのは ${BROADCAST_ITEMS_MAX} 通までです（保存済みの LINE メッセージは、その追加メッセージも数えます）`);
  }
  return { payloads, links, has_personalization: payloadsHavePersonalization(payloads), error: null };
}

// ---------------------------------------------------------------------------
// 差し込み（{name}）
// ---------------------------------------------------------------------------

/** テキストメッセージに {name} があるか（Flex の中は対象外） */
export function payloadsHavePersonalization(payloads: Array<Record<string, unknown>>): boolean {
  return payloads.some((p) => p.type === 'text' && typeof p.text === 'string' && p.text.includes(BROADCAST_NAME_TOKEN));
}

/** 差し込みに使う名前: 顧客名（「未記入」は使わない）→ LINE 表示名 → 「お客様」 */
export function resolveRecipientName(c: { name?: string | null; line_display_name?: string | null }): string {
  const name = (c.name ?? '').trim();
  if (name && name !== '未記入') return name;
  const display = (c.line_display_name ?? '').trim();
  return display || BROADCAST_NAME_FALLBACK;
}

/** テキストメッセージの {name} を置き換えた新しい配列を返す（元の配列は変えない） */
export function personalizePayloads(payloads: Array<Record<string, unknown>>, vars: { name: string }): Array<Record<string, unknown>> {
  return payloads.map((p) => (p.type === 'text' && typeof p.text === 'string' ? { ...p, text: p.text.split(BROADCAST_NAME_TOKEN).join(vars.name).slice(0, LINE_TEXT_MESSAGE_MAX) } : p));
}

// ---------------------------------------------------------------------------
// プレビュー
// ---------------------------------------------------------------------------

/** 編集中の並び → プレビュー用（{name} は見本の名前に置き換える） */
export function broadcastItemsToPreview(
  items: BroadcastItem[],
  resolve: {
    ref: (id: string) => PreviewMessage[] | null;
    sticker: (id: string) => string | null;
    sampleName?: string;
  }
): PreviewMessage[] {
  const out: PreviewMessage[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'text':
        if (item.text.trim()) out.push({ type: 'text', text: item.text.split(BROADCAST_NAME_TOKEN).join(resolve.sampleName ?? '山田 花子') });
        break;
      case 'image':
        if (item.url) out.push({ type: 'image', url: item.preview_url || item.url });
        break;
      case 'video':
        if (item.url || item.preview_url) out.push({ type: 'video', previewUrl: item.preview_url, url: item.url || undefined });
        break;
      case 'sticker': {
        const url = resolve.sticker(item.sticker_id);
        if (url) out.push({ type: 'image', url });
        break;
      }
      case 'flex':
        if (item.contents && !validateFlexContents(item.contents)) out.push({ type: 'flex', contents: item.contents, altText: item.alt_text || undefined });
        break;
      case 'ref': {
        const msgs = resolve.ref(item.message_id);
        if (msgs) out.push(...msgs);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** 一覧に出す短い説明（例: 保存済み + テキスト + スタンプ） */
export function describeBroadcastItems(items: BroadcastItem[]): string {
  if (items.length === 0) return 'メッセージなし';
  const short: Record<BroadcastItem['type'], string> = { ref: '保存済み', text: 'テキスト', image: '画像', video: '動画', sticker: 'スタンプ', flex: 'Flex' };
  return items.map((x) => short[x.type]).join(' + ');
}
