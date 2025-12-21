/**
 * フォーム編集画面のテーマ定義
 * サービス管理者（dark）と店舗管理者（light）で共通利用
 */

export type ThemeType = 'light' | 'dark';

export interface ThemeClasses {
  modal: string;
  modalOverlay: string;
  card: string;
  cardHeader: string;
  input: string;
  timeInput: string;
  textarea: string;
  select: string;
  label: string;
  labelSecondary: string;
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  button: {
    primary: string;
    secondary: string;
    danger: string;
    edit: string;
    delete: string;
  };
  toggle: {
    enabled: string;
    disabled: string;
  };
  highlight: string;
  emptyState: string;
  divider: string;
  badge: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    danger: string;
    cyan: string;
  };
}

export const themeClasses: Record<ThemeType, ThemeClasses> = {
  light: {
    modal: 'bg-white border border-gray-300',
    modalOverlay: 'bg-black/30 backdrop-blur-sm',
    card: 'bg-gray-50 border border-gray-200',
    cardHeader: 'bg-white border-b border-gray-200',
    input: 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent',
    timeInput: 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent [&::-webkit-calendar-picker-indicator]:filter-none [&::-webkit-calendar-picker-indicator]:cursor-pointer',
    textarea: 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent',
    select: 'bg-white border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent',
    label: 'text-gray-700 font-medium',
    labelSecondary: 'text-gray-600',
    text: {
      primary: 'text-gray-900',
      secondary: 'text-gray-600',
      tertiary: 'text-gray-500'
    },
    button: {
      primary: 'bg-cyan-600 hover:bg-cyan-700 text-white transition-colors',
      secondary: 'border border-gray-300 hover:bg-gray-50 text-gray-700 transition-colors',
      danger: 'bg-red-600 hover:bg-red-700 text-white transition-colors',
      edit: 'text-cyan-600 hover:text-cyan-700 hover:bg-cyan-50 transition-colors',
      delete: 'text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors'
    },
    toggle: {
      enabled: 'bg-cyan-600',
      disabled: 'bg-gray-300'
    },
    highlight: 'bg-cyan-50 border border-cyan-200 text-cyan-700',
    emptyState: 'bg-gray-50 border border-gray-200 text-gray-500',
    divider: 'border-gray-200',
    badge: {
      primary: 'bg-cyan-100 text-cyan-800 border border-cyan-200',
      secondary: 'bg-gray-100 text-gray-800 border border-gray-200',
      success: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
      warning: 'bg-orange-100 text-orange-800 border border-orange-200',
      danger: 'bg-red-100 text-red-800 border border-red-200',
      cyan: 'px-2 py-1 text-xs bg-cyan-100 text-cyan-800 border border-cyan-200 rounded'
    }
  },
  dark: {
    modal: 'bg-gray-800 border border-gray-700',
    modalOverlay: 'bg-black/50 backdrop-blur-sm',
    card: 'bg-gray-800 border border-gray-700',
    cardHeader: 'bg-gray-800 border-b border-gray-700',
    input: 'bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent',
    timeInput: 'bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer',
    textarea: 'bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent',
    select: 'bg-gray-700 border border-gray-600 text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent',
    label: 'text-gray-300 font-medium',
    labelSecondary: 'text-gray-400',
    text: {
      primary: 'text-gray-100',
      secondary: 'text-gray-400',
      tertiary: 'text-gray-500'
    },
    button: {
      primary: 'bg-cyan-600 hover:bg-cyan-700 text-white transition-colors',
      secondary: 'border border-gray-600 hover:bg-gray-700 text-gray-300 transition-colors',
      danger: 'bg-red-600 hover:bg-red-700 text-white transition-colors',
      edit: 'text-cyan-400 hover:text-cyan-300 hover:bg-gray-700 transition-colors',
      delete: 'text-red-400 hover:text-red-300 hover:bg-gray-700 transition-colors'
    },
    toggle: {
      enabled: 'bg-cyan-600',
      disabled: 'bg-gray-600'
    },
    highlight: 'bg-cyan-900/30 border border-cyan-700 text-cyan-300',
    emptyState: 'bg-gray-800 border border-gray-700 text-gray-400',
    divider: 'border-gray-700',
    badge: {
      primary: 'bg-cyan-900/30 text-cyan-300 border border-cyan-700',
      secondary: 'bg-gray-700 text-gray-300 border border-gray-600',
      success: 'bg-emerald-900/30 text-emerald-300 border border-emerald-700',
      warning: 'bg-orange-900/30 text-orange-300 border border-orange-700',
      danger: 'bg-red-900/30 text-red-300 border border-red-700',
      cyan: 'px-2 py-1 text-xs bg-cyan-900/30 text-cyan-300 border border-cyan-700 rounded'
    }
  }
};

/**
 * テーマに応じたクラス名を取得
 */
export function getThemeClasses(theme: ThemeType = 'dark'): ThemeClasses {
  return themeClasses[theme];
}

/**
 * 条件付きクラス名を生成するヘルパー
 */
export function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
