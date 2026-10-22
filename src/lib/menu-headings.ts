/**
 * 予約フォームのメニュー欄の見出し文言（純粋ロジック。クライアント / サーバー共通）。
 *
 * - `menu_heading`: メニュー欄の見出し（既定「メニューをお選びください」）
 * - `options_heading`: メニュー直下のオプション欄・カテゴリー共通オプション欄の見出し（既定「オプション」）
 *
 * 保存先は `config.menu_structure.display_options`。空文字 / 未設定 / 空白のみは既定文言を使う。
 * 編集 UI はメニュー構成 → 「カテゴリー・メニュー」の右の「見出しの文言を変更」。
 */
import type { FormConfig } from '@/types/form';

export const DEFAULT_MENU_HEADING = 'メニューをお選びください';
export const DEFAULT_OPTIONS_HEADING = 'オプション';
export const MENU_HEADING_MAX = 40;

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
