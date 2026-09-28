'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle, Info } from 'lucide-react';
import { getStoreAdminGuide } from '@/lib/store-admin-guide';

const STORAGE_PREFIX = 'store_admin_guide_open_';

function readOpenState(tab: string): boolean {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + tab);
    return v === null ? true : v === '1'; // 初回は開いた状態
  } catch {
    return true;
  }
}

function writeOpenState(tab: string, open: boolean) {
  try {
    localStorage.setItem(STORAGE_PREFIX + tab, open ? '1' : '0');
  } catch {
    // localStorage が使えない環境では記憶しない
  }
}

interface StoreAdminGuideProps {
  tab: string;
  className?: string;
}

/**
 * 各タブの冒頭に出す「このページの使い方」カード。
 * 初回は開いた状態で表示し、閉じるとこの端末では閉じたまま（ヘッダーの「使い方」でいつでも開ける）。
 * 文言は src/lib/store-admin-guide.ts で管理する
 */
export default function StoreAdminGuide({ tab, className = '' }: StoreAdminGuideProps) {
  // タブが変わったら開閉状態を読み直す（key でマウントし直す）
  return <StoreAdminGuideInner key={tab} tab={tab} className={className} />;
}

function StoreAdminGuideInner({ tab, className = '' }: StoreAdminGuideProps) {
  const guide = getStoreAdminGuide(tab);
  // 店舗管理者ページは認証後にクライアントで描画されるため、初期値で localStorage を読んでよい
  const [open, setOpen] = useState(() => readOpenState(tab));
  if (!guide) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeOpenState(tab, next);
  };

  return (
    <section
      data-slot="guide"
      aria-label="このページの使い方"
      className={`rounded-lg border border-[rgb(244,144,49)]/40 bg-orange-50/70 ${className}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <HelpCircle className="h-4 w-4 text-[rgb(200,100,10)] shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-[rgb(200,100,10)]">このページの使い方</span>
          {!open && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">{guide.intro}</span>
          )}
        </span>
        <span className="flex items-center gap-1 text-xs text-[rgb(200,100,10)] shrink-0">
          {open ? '閉じる' : '開く'}
          {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-sm text-gray-800">{guide.intro}</p>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {guide.items.map((item) => (
              <div key={item.title} className="text-sm">
                <dt className="font-medium text-gray-900">{item.title}</dt>
                <dd className="text-gray-700 leading-relaxed">{item.text}</dd>
              </div>
            ))}
          </dl>
          {guide.tips && guide.tips.length > 0 && (
            <ul className="text-xs text-gray-700 space-y-1 border-t border-[rgb(244,144,49)]/30 pt-2">
              {guide.tips.map((tip) => (
                <li key={tip} className="flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[rgb(200,100,10)]" aria-hidden="true" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** セクション見出しの下に出す 1 行ヒント（薄い文字 + i アイコン） */
export function GuideHint({ text, className = '' }: { text: string; className?: string }) {
  return (
    <p data-slot="guide-hint" className={`flex items-start gap-1.5 text-xs text-muted-foreground ${className}`}>
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
