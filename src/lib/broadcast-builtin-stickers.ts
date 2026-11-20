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

export type StickerGenreId =
  | 'greeting' | 'notice' | 'season'
  | 'esthe' | 'pest' | 'seitai' | 'kawaii' | 'hair' | 'nail' | 'food' | 'stay' | 'fitness' | 'pet';
/** 絞り込みの選択肢（all = すべて / store = 店舗で追加した画像） */
export type StickerFilterId = 'all' | StickerGenreId | 'store';

export const STICKER_GENRES: ReadonlyArray<{ id: StickerGenreId; label: string }> = [
  { id: 'greeting', label: 'あいさつ' },
  { id: 'notice', label: 'お知らせ' },
  { id: 'season', label: '季節・お祝い' },
  { id: 'esthe', label: 'エステ・美容サロン' },
  { id: 'pest', label: '害虫・害獣駆除' },
  { id: 'seitai', label: '整体・整骨院' },
  { id: 'kawaii', label: 'かわいい（毎日つかえる）' },
  { id: 'hair', label: '美容室・ヘアサロン' },
  { id: 'nail', label: 'ネイル・まつげ' },
  { id: 'food', label: '飲食店・カフェ' },
  { id: 'stay', label: '旅館・宿泊' },
  { id: 'fitness', label: 'ジム・ヨガ' },
  { id: 'pet', label: 'ペットサロン・トリミング' },
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
  // エステ・美容サロン
  { file: 'esthe_relax', label: 'ごゆっくりどうぞ', genre: 'esthe' },
  { file: 'esthe_facial', label: 'フェイシャル', genre: 'esthe' },
  { file: 'esthe_tsuya', label: 'つやつや', genre: 'esthe' },
  { file: 'esthe_gohoubi', label: '自分にごほうび', genre: 'esthe' },
  { file: 'esthe_shinki', label: 'ご新規さま歓迎', genre: 'esthe' },
  { file: 'esthe_aki', label: '本日空きあります', genre: 'esthe' },
  { file: 'esthe_aroma', label: 'いい香り', genre: 'esthe' },
  { file: 'esthe_otsukare', label: 'おつかれさまでした', genre: 'esthe' },
  { file: 'esthe_mata', label: 'またお待ちしてます', genre: 'esthe' },
  { file: 'esthe_hada', label: 'お肌の調子は？', genre: 'esthe' },
  // 害虫・害獣駆除
  { file: 'pest_omakase', label: 'おまかせください', genre: 'pest' },
  { file: 'pest_chousa', label: '無料で調査します', genre: 'pest' },
  { file: 'pest_kyuu', label: 'すぐうかがいます', genre: 'pest' },
  { file: 'pest_anshin', label: 'これで安心', genre: 'pest' },
  { file: 'pest_kanryo', label: '作業完了しました', genre: 'pest' },
  { file: 'pest_tenken', label: '定期点検の時期です', genre: 'pest' },
  { file: 'pest_soudan', label: 'ご相談ください', genre: 'pest' },
  { file: 'pest_kisetsu', label: 'そろそろ対策を', genre: 'pest' },
  { file: 'pest_mamoru', label: 'おうちを守ります', genre: 'pest' },
  { file: 'pest_arigato', label: 'ご依頼ありがとう', genre: 'pest' },
  // 整体・整骨院
  { file: 'seitai_odaiji', label: 'おだいじに', genre: 'seitai' },
  { file: 'seitai_stretch', label: 'ストレッチしよう', genre: 'seitai' },
  { file: 'seitai_shisei', label: '姿勢を正しく', genre: 'seitai' },
  { file: 'seitai_muri', label: 'ムリは禁物です', genre: 'seitai' },
  { file: 'seitai_choushi', label: 'その後いかがですか', genre: 'seitai' },
  { file: 'seitai_aki', label: '本日空きあります', genre: 'seitai' },
  { file: 'seitai_katakori', label: '肩こりにご注意', genre: 'seitai' },
  { file: 'seitai_ofuro', label: '温めてくださいね', genre: 'seitai' },
  { file: 'seitai_kyuujitsu', label: '休診日のお知らせ', genre: 'seitai' },
  { file: 'seitai_mata', label: 'またいつでもどうぞ', genre: 'seitai' },
  // かわいい（毎日つかえる）
  { file: 'kawaii_ohayo', label: 'おはようございます', genre: 'kawaii' },
  { file: 'kawaii_oyasumi', label: 'おやすみなさい', genre: 'kawaii' },
  { file: 'kawaii_ok', label: '了解です！', genre: 'kawaii' },
  { file: 'kawaii_gomen', label: 'ごめんなさい', genre: 'kawaii' },
  { file: 'kawaii_yatta', label: 'やったー！', genre: 'kawaii' },
  { file: 'kawaii_daisuki', label: '大好きです', genre: 'kawaii' },
  { file: 'kawaii_ganbare', label: '応援してます', genre: 'kawaii' },
  { file: 'kawaii_wakuwaku', label: 'わくわく', genre: 'kawaii' },
  { file: 'kawaii_chotto', label: '少々お待ちください', genre: 'kawaii' },
  { file: 'kawaii_tanoshimi', label: 'お楽しみに', genre: 'kawaii' },
  // 美容室・ヘアサロン
  { file: 'hair_cut', label: 'そろそろカット？', genre: 'hair' },
  { file: 'hair_color', label: 'カラーの季節', genre: 'hair' },
  { file: 'hair_perm', label: 'ふわふわパーマ', genre: 'hair' },
  { file: 'hair_treatment', label: 'つやつやケア', genre: 'hair' },
  { file: 'hair_shampoo', label: 'すっきりシャンプー', genre: 'hair' },
  { file: 'hair_aki', label: '本日空きあります', genre: 'hair' },
  { file: 'hair_imechen', label: 'イメチェンしよう', genre: 'hair' },
  { file: 'hair_maegami', label: '前髪カットOK', genre: 'hair' },
  { file: 'hair_niau', label: 'お似合いです', genre: 'hair' },
  { file: 'hair_yoyaku', label: 'ご予約お早めに', genre: 'hair' },
  // ネイル・まつげ
  { file: 'nail_shinsaku', label: '新作デザイン', genre: 'nail' },
  { file: 'nail_kirakira', label: 'きらきら', genre: 'nail' },
  { file: 'nail_kisetsu', label: '季節のネイル', genre: 'nail' },
  { file: 'nail_off', label: 'オフだけでもOK', genre: 'nail' },
  { file: 'nail_care', label: 'ハンドケア', genre: 'nail' },
  { file: 'nail_matsuge', label: 'まつげぱっちり', genre: 'nail' },
  { file: 'nail_aki', label: '空きが出ました', genre: 'nail' },
  { file: 'nail_mochi', label: '持ちはいかが？', genre: 'nail' },
  { file: 'nail_kawaii', label: 'かわいくなあれ', genre: 'nail' },
  { file: 'nail_kae', label: 'つけかえ時期です', genre: 'nail' },
  // 飲食店・カフェ
  { file: 'food_irasshai', label: 'いらっしゃいませ', genre: 'food' },
  { file: 'food_osusume', label: '本日のおすすめ', genre: 'food' },
  { file: 'food_shinmenu', label: '新メニュー登場', genre: 'food' },
  { file: 'food_lunch', label: 'ランチやってます', genre: 'food' },
  { file: 'food_takeout', label: 'テイクアウトOK', genre: 'food' },
  { file: 'food_sweets', label: '甘いものいかが？', genre: 'food' },
  { file: 'food_seki', label: 'お席あります', genre: 'food' },
  { file: 'food_yoyaku', label: 'ご予約承ります', genre: 'food' },
  { file: 'food_gochisou', label: 'またどうぞ', genre: 'food' },
  { file: 'food_kyuujitsu', label: '本日お休みです', genre: 'food' },
  // 旅館・宿泊
  { file: 'stay_youkoso', label: 'ようこそ', genre: 'stay' },
  { file: 'stay_onsen', label: '温泉でほっこり', genre: 'stay' },
  { file: 'stay_omachi', label: 'お待ちしております', genre: 'stay' },
  { file: 'stay_gohan', label: 'ごはんも自慢です', genre: 'stay' },
  { file: 'stay_aki', label: '空室あります', genre: 'stay' },
  { file: 'stay_kisetsu', label: '季節のおすすめ', genre: 'stay' },
  { file: 'stay_oyasumi', label: 'ごゆっくり', genre: 'stay' },
  { file: 'stay_kiotsukete', label: 'お気をつけて', genre: 'stay' },
  { file: 'stay_arigato', label: 'ご宿泊ありがとう', genre: 'stay' },
  { file: 'stay_mata', label: 'またのお越しを', genre: 'stay' },
  // ジム・ヨガ
  { file: 'fitness_ganbaro', label: 'いっしょにがんばろう', genre: 'fitness' },
  { file: 'fitness_naisu', label: 'ナイスファイト', genre: 'fitness' },
  { file: 'fitness_yoga', label: '深呼吸しよう', genre: 'fitness' },
  { file: 'fitness_stretch', label: 'まずはストレッチ', genre: 'fitness' },
  { file: 'fitness_suibun', label: '水分補給を', genre: 'fitness' },
  { file: 'fitness_taiken', label: '体験受付中', genre: 'fitness' },
  { file: 'fitness_hisashi', label: 'お久しぶりです', genre: 'fitness' },
  { file: 'fitness_keizoku', label: '続けてえらい', genre: 'fitness' },
  { file: 'fitness_yasumu', label: '休むのも大事', genre: 'fitness' },
  { file: 'fitness_class', label: 'レッスンのお知らせ', genre: 'fitness' },
  // ペットサロン・トリミング
  { file: 'pet_fuwafuwa', label: 'ふわふわになったよ', genre: 'pet' },
  { file: 'pet_shampoo', label: 'シャンプーの時期です', genre: 'pet' },
  { file: 'pet_cut', label: 'カットしませんか', genre: 'pet' },
  { file: 'pet_omukae', label: 'お迎えどうぞ', genre: 'pet' },
  { file: 'pet_ganbatta', label: 'がんばりました', genre: 'pet' },
  { file: 'pet_aki', label: '空きあります', genre: 'pet' },
  { file: 'pet_tsume', label: '爪切りだけもOK', genre: 'pet' },
  { file: 'pet_natsu', label: 'サマーカット', genre: 'pet' },
  { file: 'pet_genki', label: '元気にしてますか', genre: 'pet' },
  { file: 'pet_arigato', label: 'ご利用ありがとう', genre: 'pet' },
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
