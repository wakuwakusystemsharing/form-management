/**
 * 店舗管理画面の表示スタイル（標準 / Material 3 Expressive 風）
 *
 * - 端末ごとの好みなので localStorage に保存する（DB には持たない）
 * - 適用は <html data-ui="m3e"> 属性で行い、CSS 側（globals.css）で見た目を切り替える
 * - 'auto' はスマホ・タブレット幅（lg 未満 = 1024px 未満）のときだけ M3E を適用する
 * - 初回描画のちらつき防止のため、同じ判定を src/app/layout.tsx のインラインスクリプトでも行う
 *   （UI_STYLE_STORAGE_KEY / UI_STYLE_MOBILE_MAX_WIDTH を変更したら両方を更新すること）
 */

export type UiStyle = 'auto' | 'standard' | 'm3e';

export const UI_STYLE_STORAGE_KEY = 'store_admin_ui_style';
export const UI_STYLE_DEFAULT: UiStyle = 'auto';
/** Tailwind の lg ブレークポイント（1024px）未満を「スマホ・タブレット」とみなす */
export const UI_STYLE_MOBILE_MAX_WIDTH = 1023;
export const UI_STYLE_CHANGE_EVENT = 'store-admin-ui-style-change';

export const UI_STYLE_OPTIONS: { value: UiStyle; label: string; description: string }[] = [
  { value: 'auto', label: '自動（おすすめ）', description: 'スマホ・タブレットでは Material スタイル、パソコンでは標準スタイルで表示します' },
  { value: 'standard', label: '標準', description: 'すべての端末で従来の表示にします' },
  { value: 'm3e', label: 'Material スタイル', description: 'すべての端末で Material 3 Expressive 風の表示にします' },
];

export function isUiStyle(value: unknown): value is UiStyle {
  return value === 'auto' || value === 'standard' || value === 'm3e';
}

export function getUiStyle(): UiStyle {
  if (typeof window === 'undefined') return UI_STYLE_DEFAULT;
  try {
    const v = window.localStorage.getItem(UI_STYLE_STORAGE_KEY);
    return isUiStyle(v) ? v : UI_STYLE_DEFAULT;
  } catch {
    return UI_STYLE_DEFAULT;
  }
}

export function setUiStyle(style: UiStyle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UI_STYLE_STORAGE_KEY, style);
  } catch {
    // プライベートモード等で保存できない場合も表示だけは切り替える
  }
  applyUiStyle(style);
  window.dispatchEvent(new CustomEvent(UI_STYLE_CHANGE_EVENT, { detail: style }));
}

/** 設定値と画面幅から、実際に M3E を適用するかを判定 */
export function shouldApplyM3e(style: UiStyle, viewportWidth: number): boolean {
  if (style === 'm3e') return true;
  if (style === 'standard') return false;
  return viewportWidth <= UI_STYLE_MOBILE_MAX_WIDTH;
}

/** <html data-ui> を現在の設定・画面幅に合わせて更新 */
export function applyUiStyle(style: UiStyle = getUiStyle()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (shouldApplyM3e(style, window.innerWidth)) {
    root.setAttribute('data-ui', 'm3e');
  } else {
    root.removeAttribute('data-ui');
  }
}

/** 店舗管理画面を離れるときに属性を外す（他の管理画面に影響させない） */
export function clearUiStyle(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute('data-ui');
}

/* ------------------------------------------------------------------
 * ダイナミックカラー: 店舗テーマカラーをシードに M3 のカラーロールを生成
 * （@material/material-color-utilities は未導入のため HSL ベースの近似。
 *   トーン（明度）は固定し、色相はシードから、彩度はシードの彩度に応じて弱める）
 * ------------------------------------------------------------------ */
export type M3PaletteVars = Record<string, string>;

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let v = m[1];
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h: Math.round(h), s: s * 100, l: l * 100 };
}

/**
 * シード色から M3 カラーロール（HSL トリプレット文字列）を生成。
 * 無効な色や無彩色に近い色の場合は null（既定のオレンジパレットを使う）
 */
export function computeM3Palette(seedHex: string | null | undefined): M3PaletteVars | null {
  if (!seedHex) return null;
  const hsl = hexToHsl(seedHex);
  if (!hsl || hsl.s < 8) return null;
  const h = hsl.h;
  // 彩度係数: 淡い色ほどパレットも控えめに（0.35〜1.0）
  const k = Math.min(1, Math.max(0.35, hsl.s / 90));
  const c = (sat: number, light: number) => `${h} ${Math.round(sat * k)}% ${light}%`;
  return {
    '--md-primary': c(100, 30),
    '--md-on-primary': '0 0% 100%',
    '--md-primary-container': c(100, 87),
    '--md-on-primary-container': c(100, 9),
    '--md-secondary-container': c(70, 88),
    '--md-on-secondary-container': c(60, 10),
    '--md-surface': c(100, 98),
    '--md-surface-container-lowest': '0 0% 100%',
    '--md-surface-container-low': c(100, 95),
    '--md-surface-container': c(67, 93),
    '--md-surface-container-high': c(50, 90),
    '--md-surface-container-highest': c(40, 88),
    '--md-on-surface': c(15, 11),
    '--md-on-surface-variant': c(17, 28),
    '--md-outline': c(11, 47),
    '--md-outline-variant': c(29, 78),
  };
}

const M3_PALETTE_KEYS = [
  '--md-primary', '--md-on-primary', '--md-primary-container', '--md-on-primary-container',
  '--md-secondary-container', '--md-on-secondary-container', '--md-surface',
  '--md-surface-container-lowest', '--md-surface-container-low', '--md-surface-container',
  '--md-surface-container-high', '--md-surface-container-highest', '--md-on-surface',
  '--md-on-surface-variant', '--md-outline', '--md-outline-variant',
];

/** 店舗テーマカラーから生成したパレットを <html> のインラインスタイルに適用（null で既定に戻す） */
export function applyM3Palette(seedHex: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  const palette = computeM3Palette(seedHex);
  M3_PALETTE_KEYS.forEach((k) => style.removeProperty(k));
  if (!palette) return;
  Object.entries(palette).forEach(([k, v]) => style.setProperty(k, v));
}

/**
 * 初回描画前に <html data-ui> を付けるインラインスクリプト（src/app/layout.tsx で使用）。
 * 店舗管理画面（/{storeId}/admin）以外では何もしない。
 */
export const UI_STYLE_INIT_SCRIPT = `(function(){try{var p=location.pathname;if(!/^\\/[^/]+\\/admin(\\/|$)/.test(p)||p.indexOf('/master-admin')===0||p.indexOf('/tenant/')===0)return;var s=localStorage.getItem(${JSON.stringify(UI_STYLE_STORAGE_KEY)});if(s!=='standard'&&s!=='m3e')s='auto';var m=s==='m3e'||(s==='auto'&&window.innerWidth<=${UI_STYLE_MOBILE_MAX_WIDTH});if(m)document.documentElement.setAttribute('data-ui','m3e');}catch(e){}})();`;
