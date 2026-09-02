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

/**
 * 初回描画前に <html data-ui> を付けるインラインスクリプト（src/app/layout.tsx で使用）。
 * 店舗管理画面（/{storeId}/admin）以外では何もしない。
 */
export const UI_STYLE_INIT_SCRIPT = `(function(){try{var p=location.pathname;if(!/^\\/[^/]+\\/admin(\\/|$)/.test(p)||p.indexOf('/master-admin')===0||p.indexOf('/tenant/')===0)return;var s=localStorage.getItem(${JSON.stringify(UI_STYLE_STORAGE_KEY)});if(s!=='standard'&&s!=='m3e')s='auto';var m=s==='m3e'||(s==='auto'&&window.innerWidth<=${UI_STYLE_MOBILE_MAX_WIDTH});if(m)document.documentElement.setAttribute('data-ui','m3e');}catch(e){}})();`;
