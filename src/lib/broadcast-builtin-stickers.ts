/**
 * 配信の「スタンプ・素材」に最初から入っているスタンプ（全店舗共通）。
 *
 * - 画像は `public/broadcast-stickers/{file}.png`（送信用 800px）と `{file}_s.png`（一覧・プレビュー用 320px）。
 *   オリジナルの白いねこのキャラクター（Codex の画像生成で作成し、文字は後から合成）。
 * - DB には入れない。ID は `builtin:{file}` で固定（配信の下書きがこの ID を持つので、ファイル名は変えない）。
 * - URL はサイト内のパス（`/broadcast-stickers/…`）。送信用メッセージを作るときに
 *   `resolveStickerUrl(url, origin)` で https の絶対 URL にする（LINE はサイト外から画像を取りに来る）。
 * - スタンプを増やすときは、画像 2 枚を置いて `BUILTIN_STICKERS` に 1 行足す。
 */
import type { BroadcastSticker } from '@/types/broadcast';

export type StickerGenreId = 'greeting' | 'notice' | 'season';
/** 絞り込みの選択肢（all = すべて / store = 店舗で追加した画像） */
export type StickerFilterId = 'all' | StickerGenreId | 'store';

export const STICKER_GENRES: ReadonlyArray<{ id: StickerGenreId; label: string }> = [
  { id: 'greeting', label: 'あいさつ' },
  { id: 'notice', label: 'お知らせ' },
  { id: 'season', label: '季節・お祝い' },
];

export const BUILTIN_STICKER_DIR = '/broadcast-stickers';
export const BUILTIN_STICKER_PREFIX = 'builtin:';

export const BUILTIN_STICKERS: ReadonlyArray<{ file: string; label: string; genre: StickerGenreId }> = [
  { file: 'thanks', label: 'ありがとうございます', genre: 'greeting' },
  { file: 'welcome', label: 'お待ちしております', genre: 'greeting' },
  { file: 'please', label: 'よろしくお願いします', genre: 'greeting' },
  { file: 'otsukare', label: 'おつかれさまです', genre: 'greeting' },
  { file: 'available', label: '空きあります', genre: 'notice' },
  { file: 'booking', label: 'ご予約受付中', genre: 'notice' },
  { file: 'news', label: 'お知らせ', genre: 'notice' },
  { file: 'campaign', label: 'キャンペーン', genre: 'notice' },
  { file: 'congrats', label: 'おめでとうございます', genre: 'season' },
  { file: 'season', label: '季節のごあいさつ', genre: 'season' },
];

/** 最初から入っているスタンプの一覧（共通 = store_id null） */
export function listBuiltinStickers(): BroadcastSticker[] {
  return BUILTIN_STICKERS.map((s, i) => ({
    id: `${BUILTIN_STICKER_PREFIX}${s.file}`,
    store_id: null,
    label: s.label,
    url: `${BUILTIN_STICKER_DIR}/${s.file}.png`,
    preview_url: `${BUILTIN_STICKER_DIR}/${s.file}_s.png`,
    sort: i,
    genre: s.genre,
  }));
}

export function isBuiltinStickerId(id: string): boolean {
  return id.startsWith(BUILTIN_STICKER_PREFIX);
}

/**
 * スタンプの画像 URL を、LINE に渡せる絶対 URL にする。
 * サイト内のパス（最初から入っているスタンプ）は origin を前に付ける。それ以外はそのまま。
 */
export function resolveStickerUrl(url: string | null | undefined, origin: string): string {
  const u = (url || '').trim();
  if (!u) return '';
  if (u.startsWith(`${BUILTIN_STICKER_DIR}/`)) return `${origin.replace(/\/+$/, '')}${u}`;
  return u;
}

/** そのスタンプが絞り込みに合うか */
export function matchesStickerFilter(sticker: Pick<BroadcastSticker, 'store_id' | 'genre'>, filter: StickerFilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'store') return !!sticker.store_id;
  return !sticker.store_id && sticker.genre === filter;
}

/** 絞り込みの選択肢（1 件も無いジャンルは出さない。「すべて」は常に先頭） */
export function stickerFilterOptions(stickers: ReadonlyArray<Pick<BroadcastSticker, 'store_id' | 'genre'>>): Array<{ id: StickerFilterId; label: string; count: number }> {
  const out: Array<{ id: StickerFilterId; label: string; count: number }> = [{ id: 'all', label: 'すべて', count: stickers.length }];
  for (const g of STICKER_GENRES) {
    const count = stickers.filter((s) => matchesStickerFilter(s, g.id)).length;
    if (count > 0) out.push({ id: g.id, label: g.label, count });
  }
  const own = stickers.filter((s) => matchesStickerFilter(s, 'store')).length;
  if (own > 0) out.push({ id: 'store', label: '店舗で追加', count: own });
  return out;
}
