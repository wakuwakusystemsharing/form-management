/**
 * 予約フォームのメニュー欄の見出し文言（純粋ロジック。クライアント / サーバー共通）。
 *
 * - `menu_heading`: メニュー欄の見出し（既定「メニューをお選びください」）
 * - `options_heading`: メニュー直下のオプション欄・カテゴリー共通オプション欄の見出し（既定「オプション」）
 *
 * 保存先は `config.menu_structure.display_options`。空文字 / 未設定 / 空白のみは既定文言を使う。
 * 編集 UI はメニュー構成 → 「カテゴリー・メニュー」の右の「見出しの文言を変更」。
 *
 * 見出しの下に表示するテキスト / 画像（`menu_heading_text` / `menu_heading_image` / `menu_heading_order`、
 * `options_heading_*`）もここで正規化する（`resolveMenuHeadingContents`）。
 */
import type { FormConfig } from '@/types/form';

export const DEFAULT_MENU_HEADING = 'メニューをお選びください';
export const DEFAULT_OPTIONS_HEADING = 'オプション';
export const MENU_HEADING_MAX = 40;
/** 見出しの下のテキストの最大文字数（色タグを含む） */
export const HEADING_CONTENT_TEXT_MAX = 1000;

export type HeadingContentOrder = 'text_image' | 'image_text';
export const HEADING_CONTENT_ORDER_OPTIONS: Array<{ value: HeadingContentOrder; label: string }> = [
  { value: 'text_image', label: 'テキスト → 画像' },
  { value: 'image_text', label: '画像 → テキスト' },
];

/** 見出しの下に表示する内容（正規化済み。text / image は空なら出さない） */
export interface HeadingContent {
  text: string;
  image: string;
  order: HeadingContentOrder;
}

export interface MenuHeadingContents {
  menu: HeadingContent;
  options: HeadingContent;
}

export interface MenuHeadings {
  menu_heading: string;
  options_heading: string;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MENU_HEADING_MAX) : '';
}

/** 設定値を既定文言で補完して返す */
export function resolveMenuHeadings(config: Pick<FormConfig, 'menu_structure'> | undefined | null): MenuHeadings {
  const opts = config?.menu_structure?.display_options;
  return {
    menu_heading: clean(opts?.menu_heading) || DEFAULT_MENU_HEADING,
    options_heading: clean(opts?.options_heading) || DEFAULT_OPTIONS_HEADING,
  };
}

function cleanContentText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, HEADING_CONTENT_TEXT_MAX) : '';
}

/** 画像 URL は http(s) のみ（生成 HTML に埋め込むため） */
function cleanImageUrl(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\//i.test(url) ? url : '';
}

function cleanOrder(value: unknown): HeadingContentOrder {
  return value === 'image_text' ? 'image_text' : 'text_image';
}

/** 見出しの下に表示するテキスト / 画像を正規化して返す */
export function resolveMenuHeadingContents(config: Pick<FormConfig, 'menu_structure'> | undefined | null): MenuHeadingContents {
  const opts = config?.menu_structure?.display_options;
  return {
    menu: {
      text: cleanContentText(opts?.menu_heading_text),
      image: cleanImageUrl(opts?.menu_heading_image),
      order: cleanOrder(opts?.menu_heading_order),
    },
    options: {
      text: cleanContentText(opts?.options_heading_text),
      image: cleanImageUrl(opts?.options_heading_image),
      order: cleanOrder(opts?.options_heading_order),
    },
  };
}
