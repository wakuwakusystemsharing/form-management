/**
 * 寄せ書きウォールの世界観（店舗ごとのパラメータ）と設定の正規化 — 純粋ロジック（クライアントでも使う）
 *
 * 構造・コードは店舗ごとに分岐させず、theme の値を CSS 変数に展開するだけで見た目を変える。
 * プリセットを増やすときは WALL_THEME_PRESETS に 1 件足す。
 * 背景の質感は画像ファイルを使わず、SVG（feTurbulence）の data URI で作る（LINE 内ブラウザでも軽く、追加の通信が無い）。
 */
import { normalizeWallDailyMax } from './wall-rules';
import type {
  WallAccessMode,
  WallBoardSettings,
  WallFont,
  WallModeration,
  WallNotePin,
  WallNoteShape,
  WallNoteTexture,
  WallTheme,
  WallThemePreset,
} from '@/types/wall';

export interface WallPresetDef {
  id: WallThemePreset;
  label: string;
  /** ボードの背景（CSS background。複数レイヤー可） */
  background: string;
  /** 背景色のみ（上書き時の基準・色見本用） */
  base_color: string;
  /** ボード上の文字色（見出しなど） */
  text_color: string;
  /** 付箋の影 */
  shadow: string;
  /** ボードの縁（額縁）。'' = 無し */
  frame: string;
  /** 縁の太さ（px） */
  frame_width: number;
}

/** SVG を CSS の url() に入れられる形にする */
function svgUrl(svg: string): string {
  const body = svg.replace(/\s+/g, ' ').trim().replace(/#/g, '%23').replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E');
  return `url("data:image/svg+xml;utf8,${body}")`;
}

const SVG_NS = "xmlns='http://www.w3.org/2000/svg'";

/** コルク: 細かい粒 + 大きめのまだら */
const CORK_TEXTURE = svgUrl(`<svg ${SVG_NS} width='240' height='240'>
  <filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 0.36  0 0 0 0 0.22  0 0 0 0 0.08  0 0 0 0.75 0'/></filter>
  <filter id='b'><feTurbulence type='fractalNoise' baseFrequency='0.08' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 0.92  0 0 0 0 0.75  0 0 0 0.35 0'/></filter>
  <rect width='240' height='240' fill='#c99a62'/>
  <rect width='240' height='240' filter='url(#b)'/>
  <rect width='240' height='240' filter='url(#g)'/>
</svg>`);

/** 木目: 横方向に伸ばしたノイズ + 板の継ぎ目 */
const WOOD_TEXTURE = svgUrl(`<svg ${SVG_NS} width='320' height='160'>
  <filter id='w'><feTurbulence type='fractalNoise' baseFrequency='0.012 0.22' numOctaves='3' seed='11'/><feColorMatrix values='0 0 0 0 0.30  0 0 0 0 0.16  0 0 0 0 0.05  0 0 0 0.55 0'/></filter>
  <rect width='320' height='160' fill='#a9734a'/>
  <rect width='320' height='160' filter='url(#w)'/>
  <rect y='0' width='320' height='2' fill='rgba(40,20,5,0.45)'/>
  <rect y='158' width='320' height='2' fill='rgba(255,230,200,0.12)'/>
</svg>`);

/** ホワイトボード: ごく薄いマーカーの消し跡 */
const WHITEBOARD_TEXTURE = svgUrl(`<svg ${SVG_NS} width='400' height='400'>
  <filter id='s'><feTurbulence type='fractalNoise' baseFrequency='0.02' numOctaves='2' seed='5'/><feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.5  0 0 0 0 0.6  0 0 0 0.07 0'/></filter>
  <rect width='400' height='400' fill='#f7f8f7'/>
  <rect width='400' height='400' filter='url(#s)'/>
</svg>`);

/** 黒板: チョークの粉 + 消し跡 */
const CHALKBOARD_TEXTURE = svgUrl(`<svg ${SVG_NS} width='300' height='300'>
  <filter id='d'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='9'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 0.95  0 0 0 0.09 0'/></filter>
  <filter id='e'><feTurbulence type='fractalNoise' baseFrequency='0.015 0.04' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.08 0'/></filter>
  <rect width='300' height='300' fill='#2f4a3d'/>
  <rect width='300' height='300' filter='url(#e)'/>
  <rect width='300' height='300' filter='url(#d)'/>
</svg>`);

export const WALL_THEME_PRESETS: WallPresetDef[] = [
  {
    id: 'cork',
    label: 'コルクボード',
    base_color: '#c99a62',
    background: `radial-gradient(ellipse at 50% 40%, rgba(255,235,200,0.10), rgba(60,30,5,0.22) 100%), ${CORK_TEXTURE} 0 0/240px 240px, #c99a62`,
    text_color: '#3b2a17',
    shadow: '0 6px 12px rgba(60,35,10,0.30)',
    frame: 'linear-gradient(180deg, #7a5230, #5a3a1f)',
    frame_width: 10,
  },
  {
    id: 'wood',
    label: '木目',
    base_color: '#a9734a',
    background: `linear-gradient(180deg, rgba(255,240,220,0.06), rgba(30,15,0,0.18)), ${WOOD_TEXTURE} 0 0/320px 160px, #a9734a`,
    text_color: '#fff6ea',
    shadow: '0 6px 12px rgba(40,20,5,0.34)',
    frame: '',
    frame_width: 0,
  },
  {
    id: 'paper',
    label: 'ホワイトボード',
    base_color: '#f7f8f7',
    background: `linear-gradient(115deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.025) 100%), ${WHITEBOARD_TEXTURE} 0 0/400px 400px, #f7f8f7`,
    text_color: '#2f3237',
    shadow: '0 4px 10px rgba(0,0,0,0.16)',
    frame: 'linear-gradient(180deg, #d9dcdf, #aeb3b8)',
    frame_width: 8,
  },
  {
    id: 'chalkboard',
    label: '黒板',
    base_color: '#2f4a3d',
    background: `radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.05), rgba(0,0,0,0.25) 100%), ${CHALKBOARD_TEXTURE} 0 0/300px 300px, #2f4a3d`,
    text_color: '#f3f6f0',
    shadow: '0 6px 14px rgba(0,0,0,0.42)',
    frame: 'linear-gradient(180deg, #9a7047, #6e4b2a)',
    frame_width: 10,
  },
];

export const WALL_FONTS: Array<{ id: WallFont; label: string; family: string; google?: string }> = [
  { id: 'rounded', label: '丸ゴシック', family: '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Kosugi Maru", sans-serif', google: 'M+PLUS+Rounded+1c:wght@500;700' },
  { id: 'standard', label: '標準', family: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif', google: 'Noto+Sans+JP:wght@400;700' },
  { id: 'handwriting', label: '手書き風', family: '"Klee One", "Yomogi", cursive', google: 'Klee+One:wght@600' },
];

export const WALL_NOTE_SHAPES: Array<{ id: WallNoteShape; label: string; description: string }> = [
  { id: 'square', label: '正方形', description: '定番の付箋' },
  { id: 'rounded', label: '角丸', description: 'やわらかい印象' },
  { id: 'landscape', label: '横長', description: 'メッセージカード風' },
];

export const WALL_NOTE_PINS: Array<{ id: WallNotePin; label: string }> = [
  { id: 'pin', label: '押しピン' },
  { id: 'tape', label: 'マスキングテープ' },
  { id: 'magnet', label: 'マグネット' },
  { id: 'none', label: 'なし' },
];

export const WALL_NOTE_TEXTURES: Array<{ id: WallNoteTexture; label: string }> = [
  { id: 'plain', label: '無地' },
  { id: 'lined', label: '罫線' },
  { id: 'grid', label: '方眼' },
];

export const DEFAULT_NOTE_COLORS = ['#fff3a3', '#ffd1dc', '#cdeefd', '#d6f5c9', '#ffd9a8'];
export const DEFAULT_NOTE_TEXT_COLOR = '#3a3226';

export const DEFAULT_WALL_THEME: WallTheme = {
  preset: 'cork',
  background_color: '',
  note_colors: DEFAULT_NOTE_COLORS,
  font: 'rounded',
  note_shape: 'square',
  note_pin: 'pin',
  note_texture: 'plain',
  note_text_color: '',
  title: 'みんなの寄せ書き',
  subtitle: 'お店への感想を匿名で貼れます',
  placeholder: '例: スタッフさんがとても親切でした！また来ます',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function str(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim().slice(0, max);
  return t || fallback;
}

function pick<T extends string>(v: unknown, list: readonly { id: T }[], fallback: T): T {
  return list.some((x) => x.id === v) ? (v as T) : fallback;
}

/** theme を既定値で補完・検証する（不正な色は捨てる。色は 3〜8 色、足りなければ既定色） */
export function normalizeWallTheme(raw: unknown): WallTheme {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const colors = Array.isArray(r.note_colors)
    ? [...new Set(r.note_colors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase()))].slice(0, 8)
    : [];
  return {
    preset: pick(r.preset, WALL_THEME_PRESETS, DEFAULT_WALL_THEME.preset),
    background_color: typeof r.background_color === 'string' && HEX.test(r.background_color) ? r.background_color.toLowerCase() : '',
    note_colors: colors.length >= 3 ? colors : DEFAULT_NOTE_COLORS,
    font: pick(r.font, WALL_FONTS, DEFAULT_WALL_THEME.font),
    note_shape: pick(r.note_shape, WALL_NOTE_SHAPES, DEFAULT_WALL_THEME.note_shape),
    note_pin: pick(r.note_pin, WALL_NOTE_PINS, DEFAULT_WALL_THEME.note_pin),
    note_texture: pick(r.note_texture, WALL_NOTE_TEXTURES, DEFAULT_WALL_THEME.note_texture),
    note_text_color: typeof r.note_text_color === 'string' && HEX.test(r.note_text_color) ? r.note_text_color.toLowerCase() : '',
    title: str(r.title, 40, DEFAULT_WALL_THEME.title),
    subtitle: str(r.subtitle, 80, DEFAULT_WALL_THEME.subtitle),
    placeholder: str(r.placeholder, 80, DEFAULT_WALL_THEME.placeholder),
  };
}

export const WALL_NG_WORD_MAX_LENGTH = 30;
export const WALL_NG_WORDS_MAX = 100;

/** 店舗の追加 NG ワードを正規化（前後空白除去・空 / 長すぎを除去・重複除去・最大 100 語） */
export function normalizeStoreNgWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const w of raw) {
    if (typeof w !== 'string') continue;
    const t = w.trim();
    if (!t || t.length > WALL_NG_WORD_MAX_LENGTH || out.includes(t)) continue;
    out.push(t);
    if (out.length >= WALL_NG_WORDS_MAX) break;
  }
  return out;
}

const MODERATIONS: WallModeration[] = ['instant', 'approval'];
const ACCESS_MODES: WallAccessMode[] = ['login', 'friend_to_post', 'friend_only'];

/** ボード設定を既定値で補完する（行が無い店舗は enabled: false の既定設定） */
export function normalizeWallSettings(storeId: string, raw: unknown): WallBoardSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    store_id: storeId,
    enabled: r.enabled === true,
    liff_id: typeof r.liff_id === 'string' ? r.liff_id.trim().slice(0, 64) : '',
    moderation: MODERATIONS.includes(r.moderation as WallModeration) ? (r.moderation as WallModeration) : 'instant',
    access_mode: ACCESS_MODES.includes(r.access_mode as WallAccessMode) ? (r.access_mode as WallAccessMode) : 'login',
    daily_max: normalizeWallDailyMax(r.daily_max),
    theme: normalizeWallTheme(r.theme),
    ng_words: normalizeStoreNgWords(r.ng_words),
  };
}

export const WALL_MODERATION_LABELS: Record<WallModeration, string> = {
  instant: '即公開（貼るとすぐ表示）',
  approval: '承認制（お店が確認してから表示）',
};

export const WALL_ACCESS_MODE_LABELS: Record<WallAccessMode, string> = {
  login: 'LINE ログインのみ（友だち追加なしでも閲覧・投稿できる）',
  friend_to_post: '投稿は友だち追加が必要（閲覧は誰でも）',
  friend_only: '閲覧も投稿も友だち追加が必要',
};

export interface WallThemeVars {
  background: string;
  textColor: string;
  fontFamily: string;
  shadow: string;
  frame: string;
  frameWidth: number;
  noteTextColor: string;
  googleFont: string | null;
}

/** CSS 変数に展開する値 */
export function wallThemeVars(theme: WallTheme): WallThemeVars {
  const preset = WALL_THEME_PRESETS.find((p) => p.id === theme.preset) || WALL_THEME_PRESETS[0];
  const font = WALL_FONTS.find((f) => f.id === theme.font) || WALL_FONTS[0];
  return {
    background: theme.background_color ? theme.background_color : preset.background,
    textColor: preset.text_color,
    fontFamily: font.family,
    shadow: preset.shadow,
    frame: theme.background_color ? '' : preset.frame,
    frameWidth: theme.background_color ? 0 : preset.frame_width,
    noteTextColor: theme.note_text_color || DEFAULT_NOTE_TEXT_COLOR,
    googleFont: font.google ?? null,
  };
}
