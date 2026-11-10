import { describe, expect, it } from 'vitest';
import { APPLE_JP_FONT_CSS, buildScaledJpFontCss, clipUnicodeRangeToJapanese, FLEX_PREVIEW_FONT_STACK, flexLineHeightPx } from '@/lib/flex-preview-fonts';

describe('clipUnicodeRangeToJapanese（日本語の範囲だけ残す）', () => {
  it('ASCII・一般の記号を除き、かな・漢字・全角記号を残す', () => {
    expect(clipUnicodeRangeToJapanese('U+20, U+41-5a, U+3042, U+4e00-4e0f, U+ff01')).toBe('U+3042, U+4e00-4e0f, U+ff01');
    expect(clipUnicodeRangeToJapanese('U+0000-00FF, U+0131, U+2000-206F')).toBeNull();
  });
  it('またぐ範囲は切り詰め、ワイルドカードは範囲に直す', () => {
    expect(clipUnicodeRangeToJapanese('U+2000-30ff')).toBe('U+2e80-30ff');
    expect(clipUnicodeRangeToJapanese('U+30??')).toBe('U+3000-30ff');
    expect(clipUnicodeRangeToJapanese('U+2e80')).toBe('U+2e80');
  });
});

describe('buildScaledJpFontCss（Google の Noto Sans JP をプレビュー用に書き換える）', () => {
  const google = `
/* [118] */
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 350;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/notosansjp/v57/a.118.woff2) format('woff2');
  unicode-range: U+21-22, U+41-4d, U+3001-3002, U+3042, U+4e00;
}
/* latin */
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 350;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/notosansjp/v57/a.latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/notosansjp/v57/b.118.woff2) format('woff2');
  unicode-range: U+3042, U+4e00;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-weight: 900;
  src: url(https://fonts.gstatic.com/s/notosansjp/v57/c.woff2) format('woff2');
  unicode-range: U+3042;
}`;
  const css = buildScaledJpFontCss(google);
  const blocks = css.split('\n');

  it('日本語を含む分割だけを残し、英数字だけの分割・対象外の太さは捨てる', () => {
    expect(blocks).toHaveLength(2);
    expect(css).not.toContain('latin.woff2');
    expect(css).not.toContain('c.woff2');
  });
  it('フォント名を付け替え、350 → 400・600 → 700 にし、92% にする。英数字の範囲は除く', () => {
    expect(blocks[0]).toContain('font-family:"FlexPreviewJP"');
    expect(blocks[0]).toContain('font-weight:400');
    expect(blocks[0]).toContain('size-adjust:92%');
    expect(blocks[0]).toContain("src:url(https://fonts.gstatic.com/s/notosansjp/v57/a.118.woff2) format('woff2')");
    expect(blocks[0]).toContain('unicode-range:U+3001-3002, U+3042, U+4e00;');
    expect(blocks[1]).toContain('font-weight:700');
    expect(css).not.toContain('Noto Sans JP');
  });
  it('空・想定外の入力は空文字', () => {
    expect(buildScaledJpFontCss('')).toBe('');
    expect(buildScaledJpFontCss('body { color: red }')).toBe('');
  });
});

describe('フォントの定義', () => {
  it('Apple 用は端末のヒラギノ W3 / W6 を 92% で、日本語の範囲だけに使う', () => {
    expect(APPLE_JP_FONT_CSS).toContain('local("HiraginoSans-W3")');
    expect(APPLE_JP_FONT_CSS).toContain('local("HiraginoSans-W6")');
    expect((APPLE_JP_FONT_CSS.match(/size-adjust:92%/g) ?? []).length).toBe(2);
    expect(APPLE_JP_FONT_CSS).toContain('U+3000-30FF');
    expect(APPLE_JP_FONT_CSS).not.toMatch(/U\+00/);
  });
  it('font-family は日本語用を先頭に、英数字はシステムフォント → Inter', () => {
    expect(FLEX_PREVIEW_FONT_STACK.startsWith('"FlexPreviewJP", -apple-system')).toBe(true);
    expect(FLEX_PREVIEW_FONT_STACK).toContain('"Inter"');
  });
});

describe('flexLineHeightPx（行の高さ。実機計測に合わせる）', () => {
  it('文字サイズ × 約 1.193 を 1/3 px 単位に切り上げる', () => {
    expect(flexLineHeightPx(11)).toBeCloseTo(13.333, 2); // ラベル: 11 + 上下 3 = 19.3
    expect(flexLineHeightPx(14)).toBeCloseTo(17, 5); // ボタン: 14 + 上下 13 = 43
    expect(flexLineHeightPx(13)).toBeCloseTo(15.667, 2);
    expect(flexLineHeightPx(16)).toBeCloseTo(19.333, 2);
  });
});
