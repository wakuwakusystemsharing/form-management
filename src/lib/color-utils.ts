// フォームデザイン用の色計算ユーティリティ

// 参考デザインのアクセント色（シャンパンゴールド）。
// メインカラー #1b2a4e（ダークネイビー）の補色に 彩度47% / 明度56% を適用した色と一致する
const DEFAULT_ACCENT = '#c5a059';

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; }
  else if (hh < 2) { r = x; g = c; }
  else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; }
  else if (hh < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * テーマカラーに調和するアクセント色を自動生成する（同色系）。
 * テーマカラーと同じ色相に 彩度47% / 明度56% を適用した明るいトーンを返すため、
 * どんなRGB指定でも全体が統一感のある1トーンにまとまる。
 * 無彩色（グレー・黒・白など）は同系の明るいグレー、不正な値はシャンパンゴールドにフォールバック。
 */
export function computeAccentColor(themeColor: string): string {
  const rgb = hexToRgb(themeColor);
  if (!rgb) return DEFAULT_ACCENT;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.03) return '#9a9a9a'; // ほぼ無彩色 → 同系の明るいグレー
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  if (s < 0.12) return '#9a9a9a'; // 彩度が低く色相が不安定 → 同系の明るいグレー
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return hslToHex(h, 0.47, 0.56);
}
