/**
 * 寄せ書きウォールの世界観（店舗ごとのパラメータ）と設定の正規化 — 純粋ロジック（クライアントでも使う）
 *
 * 構造・コードは店舗ごとに分岐させず、theme の値を CSS 変数に展開するだけで見た目を変える。
 * プリセットを増やすときは WALL_THEME_PRESETS に 1 件足す。
 */
import type { WallAccessMode, WallBoardSettings, WallFont, WallModeration, WallTheme, WallThemePreset } from '@/types/wall';

export interface WallPresetDef {
  id: WallThemePreset;
  label: string;
  /** ボードの背景（CSS background） */
  background: string;
  /** 背景色のみ（上書き時の基準・文字色の判定用） */
  base_color: string;
  /** ボード上の文字色（見出しなど） */
  text_color: string;
  /** 付箋の枠に使う影の強さ */
  shadow: string;
}

export const WALL_THEME_PRESETS: WallPresetDef[] = [
  {
    id: 'cork',
    label: 'コルクボード',
    base_color: '#c79a63',
    background: 'radial-gradient(circle at 20% 30%, rgba(0,0,0,0.06) 0 2px, transparent 3px) 0 0/22px 22px, radial-gradient(circle at 70% 60%, rgba(255,255,255,0.08) 0 2px, transparent 3px) 0 0/18px 18px, #c79a63',
    text_color: '#3b2a17',
    shadow: '0 6px 12px rgba(60,35,10,0.28)',
  },
  {
    id: 'wood',
    label: '木目',
    base_color: '#a9744a',
    background: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.05) 0 2px, transparent 2px 38px), linear-gradient(180deg, #b07d52, #9a6942)',
    text_color: '#fff8ef',
    shadow: '0 6px 12px rgba(40,20,5,0.32)',
  },
  {
    id: 'paper',
    label: 'ホワイトボード',
    base_color: '#f6f4ef',
    background: 'linear-gradient(0deg, rgba(0,0,0,0.035) 1px, transparent 1px) 0 0/100% 28px, #f6f4ef',
    text_color: '#2f2f2f',
    shadow: '0 4px 10px rgba(0,0,0,0.14)',
  },
  {
    id: 'chalkboard',
    label: '黒板',
    base_color: '#2f4a3d',
    background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.06), transparent 60%), #2f4a3d',
    text_color: '#f3f6f0',
    shadow: '0 6px 14px rgba(0,0,0,0.4)',
  },
];

export const WALL_FONTS: Array<{ id: WallFont; label: string; family: string; google?: string }> = [
  { id: 'rounded', label: '丸ゴシック', family: '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Kosugi Maru", sans-serif', google: 'M+PLUS+Rounded+1c:wght@500;700' },
  { id: 'standard', label: '標準', family: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif', google: 'Noto+Sans+JP:wght@400;700' },
  { id: 'handwriting', label: '手書き風', family: '"Klee One", "Yomogi", cursive', google: 'Klee+One:wght@600' },
];

export const DEFAULT_NOTE_COLORS = ['#fff3a3', '#ffd1dc', '#cdeefd', '#d6f5c9', '#ffd9a8'];

export const DEFAULT_WALL_THEME: WallTheme = {
  preset: 'cork',
  background_color: '',
  note_colors: DEFAULT_NOTE_COLORS,
  font: 'rounded',
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

/** theme を既定値で補完・検証する（不正な色は捨てる。色は 3〜8 色、足りなければ既定色） */
export function normalizeWallTheme(raw: unknown): WallTheme {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const preset = WALL_THEME_PRESETS.some((p) => p.id === r.preset) ? (r.preset as WallThemePreset) : DEFAULT_WALL_THEME.preset;
  const font = WALL_FONTS.some((f) => f.id === r.font) ? (r.font as WallFont) : DEFAULT_WALL_THEME.font;
  const colors = Array.isArray(r.note_colors)
    ? [...new Set(r.note_colors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase()))].slice(0, 8)
    : [];
  return {
    preset,
    background_color: typeof r.background_color === 'string' && HEX.test(r.background_color) ? r.background_color.toLowerCase() : '',
    note_colors: colors.length >= 3 ? colors : DEFAULT_NOTE_COLORS,
    font,
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

/** CSS 変数に展開する値 */
export function wallThemeVars(theme: WallTheme): { background: string; textColor: string; fontFamily: string; shadow: string; googleFont: string | null } {
  const preset = WALL_THEME_PRESETS.find((p) => p.id === theme.preset) || WALL_THEME_PRESETS[0];
  const font = WALL_FONTS.find((f) => f.id === theme.font) || WALL_FONTS[0];
  return {
    background: theme.background_color ? theme.background_color : preset.background,
    textColor: preset.text_color,
    fontFamily: font.family,
    shadow: preset.shadow,
    googleFont: font.google ?? null,
  };
}
