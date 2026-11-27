'use client';

/**
 * 料金の「幅」と「自由に書く表示」の入力欄（メニュー / サブメニュー / オプション / カテゴリー共通オプション / オプションのオプション）
 * - 上限（円）: 料金より大きい金額を入れると、フォームに「¥5,000〜¥7,000」と出る
 * - 料金の表示（自由入力）: 入れると、金額の代わりにその文字を出す（例: ¥5,000〜 / 要相談）
 * 合計金額・売上の計算には「料金（円）」（下限）を使う。純粋ロジックは src/lib/price-range.ts
 */
import React from 'react';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import { PRICE_LABEL_MAX, itemPriceText } from '@/lib/price-range';

interface Props {
  /** 料金（円）の入力値（カンマ入りでもよい） */
  price: string | number;
  /** 上限（円）の入力値（数字の文字列。空 = 幅なし） */
  priceMax: string;
  priceLabel: string;
  onChange: (patch: { priceMax?: string; priceLabel?: string }) => void;
  /** true = オプション（表示の例に「+」を付ける） */
  plus?: boolean;
  /** 料金 0 のときにフォームに出る文字（メニューオプションの「無料」） */
  zeroText?: string;
  hidePrice?: boolean;
  theme?: ThemeType;
  compact?: boolean;
}

const digits = (v: string | number): number => {
  const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const withCommas = (v: string): string => {
  const n = digits(v);
  return n > 0 ? n.toLocaleString('ja-JP') : '';
};

export default function PriceRangeFields({ price, priceMax, priceLabel, onChange, plus = false, zeroText = '', hidePrice = false, theme = 'dark', compact = false }: Props) {
  const themeClasses = getThemeClasses(theme);
  const min = digits(price);
  const max = digits(priceMax);
  const invalid = max > 0 && max <= min;
  const preview = itemPriceText({ price: min, price_max: max, price_label: priceLabel }, { plus, zeroText });
  const input = `w-full rounded-md ${compact ? 'px-2 py-1.5 text-sm' : 'px-3 py-2'} ${themeClasses.input}`;
  const labelCls = compact ? `text-xs ${themeClasses.text.secondary}` : `block text-sm ${themeClasses.label} mb-1`;

  return (
    <div className="space-y-2" data-slot="price-range-fields">
      <div className="grid grid-cols-2 gap-2 sm:gap-4">
        <label className={labelCls}>
          料金の上限（円・任意）
          <input
            type="text"
            inputMode="numeric"
            value={withCommas(priceMax)}
            onChange={(e) => onChange({ priceMax: digits(e.target.value) > 0 ? String(digits(e.target.value)) : '' })}
            placeholder="例: 7,000"
            className={`mt-0.5 ${input}`}
          />
        </label>
        <label className={labelCls}>
          料金の表示（自由入力・任意）
          <input
            type="text"
            value={priceLabel}
            maxLength={PRICE_LABEL_MAX}
            onChange={(e) => onChange({ priceLabel: e.target.value })}
            placeholder="例: ¥5,000〜 / 要相談"
            className={`mt-0.5 ${input}`}
          />
        </label>
      </div>
      <p className={`text-xs ${themeClasses.text.tertiary}`}>
        上限を入れると「¥5,000〜¥7,000」のように幅で表示します。自由入力に文字を入れると、金額の代わりにその文字を表示します。合計金額は「料金〜上限」の幅で出し、売上は「料金（円）」の金額で数えます。
      </p>
      {invalid && <p className="text-xs text-red-500">上限は「料金（円）」より大きい金額にしてください（このままでは幅は表示されません）。</p>}
      <p className={`text-xs ${themeClasses.text.secondary}`} data-slot="price-range-preview">
        フォームでの表示：{hidePrice ? '（料金を非表示）' : preview || '（表示なし）'}
      </p>
    </div>
  );
}
