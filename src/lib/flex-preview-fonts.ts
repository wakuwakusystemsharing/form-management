/**
 * Flex プレビュー用のフォント（iPhone の LINE の見た目に寄せる）
 *
 * 実機（iPhone の LINE）を計測すると、英数字はシステムフォント（San Francisco）が指定サイズどおりに、
 * 日本語（ヒラギノ角ゴ）は**約 92% の大きさ**で描かれている（sm = 14 の全角文字の送り幅が約 12.9）。
 * 同じ大きさで描くと、日本語だけが実機より大きく・太く・横に広く見える。
 * そこで「日本語の範囲だけ」を受け持つフォント `FlexPreviewJP` を size-adjust: 92% で定義し、
 * 英数字は後ろのフォント（Apple 環境 = システムフォント / それ以外 = Inter）に任せる。
 *
 *   - Apple 環境（Mac / iPhone）: 端末のヒラギノ角ゴ W3 / W6 を使う（APPLE_JP_FONT_CSS）
 *   - それ以外（Windows など）: Google Fonts の Noto Sans JP を使う。Noto の 400 / 700 はヒラギノの W3 / W6 より太いので、
 *     350 / 600 を取得して 400 / 700 として登録する（buildScaledJpFontCss が Google の CSS を書き換える）
 */

export const FLEX_PREVIEW_JP_FAMILY = 'FlexPreviewJP';
/** 日本語の文字の大きさ（英数字に対する比率。実機計測） */
export const FLEX_PREVIEW_JP_SIZE_ADJUST = 92;
/** これ以上のコードポイントを日本語として扱う（CJK 部首・かな・漢字・全角記号）。ASCII や一般の記号は英数字側のフォントに任せる */
export const JP_RANGE_START = 0x2e80;
/** Noto Sans JP の取得（350 → regular、600 → bold として登録する） */
export const GOOGLE_JP_FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@350;600&display=swap';
export const GOOGLE_LATIN_FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';
const WEIGHT_MAP: Record<string, string> = { '350': '400', '600': '700' };

const JP_UNICODE_RANGE = 'U+2E80-2FFF, U+3000-30FF, U+3100-33FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-2FA1F';

/** Apple 環境用: 端末のヒラギノ角ゴを 92% で使う */
export const APPLE_JP_FONT_CSS = [
  ['400', ['HiraginoSans-W3', 'Hiragino Sans W3', 'HiraKakuProN-W3', 'Hiragino Kaku Gothic ProN W3']],
  ['700', ['HiraginoSans-W6', 'Hiragino Sans W6', 'HiraKakuProN-W6', 'Hiragino Kaku Gothic ProN W6']],
]
  .map(
    ([weight, names]) =>
      `@font-face{font-family:"${FLEX_PREVIEW_JP_FAMILY}";font-style:normal;font-weight:${weight};src:${(names as string[]).map((n) => `local("${n}")`).join(',')};size-adjust:${FLEX_PREVIEW_JP_SIZE_ADJUST}%;unicode-range:${JP_UNICODE_RANGE};}`
  )
  .join('\n');

/** unicode-range から JP_RANGE_START 未満を取り除く（またぐ範囲は切り詰める）。残らなければ null */
export function clipUnicodeRangeToJapanese(range: string): string | null {
  const out: string[] = [];
  for (const raw of range.split(',')) {
    const part = raw.trim();
    const m = /^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i.exec(part);
    if (!m) continue;
    // U+4?? のようなワイルドカードは範囲に直す
    const start = parseInt(m[1].replace(/\?/g, '0'), 16);
    const end = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'f'), 16);
    if (Number.isNaN(start) || Number.isNaN(end) || end < JP_RANGE_START) continue;
    const s = Math.max(start, JP_RANGE_START);
    out.push(s === end ? `U+${s.toString(16)}` : `U+${s.toString(16)}-${end.toString(16)}`);
  }
  return out.length > 0 ? out.join(', ') : null;
}

/**
 * Google Fonts の Noto Sans JP の CSS（@font-face の並び）を、プレビュー用のフォントに書き換える。
 * - font-family を FlexPreviewJP に
 * - font-weight 350 → 400、600 → 700（ヒラギノ W3 / W6 の太さに合わせる）
 * - size-adjust: 92% を追加
 * - unicode-range から英数字・一般の記号を除く（Noto の日本語の分割にも ASCII が混ざっているため。除かないと英数字まで Noto になる）
 */
export function buildScaledJpFontCss(googleCss: string): string {
  const blocks = googleCss.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const out: string[] = [];
  for (const block of blocks) {
    const rangeMatch = /unicode-range:\s*([^;]+);/.exec(block);
    const weightMatch = /font-weight:\s*(\d+)\s*;/.exec(block);
    const srcMatch = /src:\s*([^;]+);/.exec(block);
    if (!rangeMatch || !weightMatch || !srcMatch) continue;
    const weight = WEIGHT_MAP[weightMatch[1]];
    if (!weight) continue;
    const range = clipUnicodeRangeToJapanese(rangeMatch[1]);
    if (!range) continue;
    out.push(`@font-face{font-family:"${FLEX_PREVIEW_JP_FAMILY}";font-style:normal;font-weight:${weight};font-display:swap;src:${srcMatch[1].trim()};size-adjust:${FLEX_PREVIEW_JP_SIZE_ADJUST}%;unicode-range:${range};}`);
  }
  return out.join('\n');
}

/** プレビューの font-family。日本語 = FlexPreviewJP（92%）、英数字 = システムフォント（Apple）/ Inter */
export const FLEX_PREVIEW_FONT_STACK = `"${FLEX_PREVIEW_JP_FAMILY}", -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, "Hiragino Sans", "Noto Sans JP", sans-serif`;

/**
 * 文字の行の高さ（px）。iPhone のシステムフォントの自然な行高（文字サイズ × 約 1.193）を 1/3 px 単位に切り上げたもの。
 * 実機計測: ボタン（sm 14 + 上下 13）= 43 / ラベル（xxs 11 + 上下 3）= 19.3 と一致
 */
export const FLEX_LINE_HEIGHT_RATIO = 1.193;
export function flexLineHeightPx(fontSize: number): number {
  return Math.ceil(fontSize * FLEX_LINE_HEIGHT_RATIO * 3 - 1e-6) / 3;
}
