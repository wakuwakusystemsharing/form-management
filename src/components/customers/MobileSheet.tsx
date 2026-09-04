'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** スクリーンリーダー向けの説明（画面には出さない） */
  description?: string;
  /** ヘッダー左のボタン（既定: ‹ 戻る = 閉じる） */
  leftLabel?: string;
  onLeftClick?: () => void;
  /** ヘッダー右（⋯ メニューなど） */
  headerRight?: React.ReactNode;
  /** 下部固定バー（保存ボタンなど）。指定時はスマホで sticky bottom に固定 */
  footer?: React.ReactNode;
  /** PC 表示時の最大幅 */
  desktopClassName?: string;
  children: React.ReactNode;
}

/**
 * 顧客管理用の全画面シート。
 * - スマホ（< 768px）: 画面いっぱい（100dvh）、角丸なし、固定ヘッダー + 任意の下部固定バー
 * - PC: 従来の中央ダイアログ
 * 標準 / M3E のどちらのスタイルでも同じ挙動になるよう、レイアウトは Tailwind クラスで制御する。
 * M3E 側の dialog-content 全画面ルールの padding は data-slot="mobile-sheet" で打ち消す（globals.css）。
 */
export default function MobileSheet({
  open,
  onOpenChange,
  title,
  description,
  leftLabel = '戻る',
  onLeftClick,
  headerRight,
  footer,
  desktopClassName = 'md:max-w-4xl',
  children,
}: MobileSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="mobile-sheet"
        className={cn(
          'store-admin-bg bg-gray-50 p-0 gap-0 flex flex-col overflow-hidden',
          // スマホ: 全画面
          // 高さは top/bottom の両端固定で決める（100dvh 固定だとブラウザ UI の出入りで下に隙間が出る）
          'max-md:top-0 max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:h-auto max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0',
          // PC: 従来のダイアログ
          'md:max-h-[90vh] md:rounded-lg',
          desktopClassName,
          // 既定の右上 × はヘッダー内に収める
          '[&>button[class*=absolute]]:top-3 [&>button[class*=absolute]]:right-3 [&>button[class*=absolute]]:h-9 [&>button[class*=absolute]]:w-9 [&>button[class*=absolute]]:flex [&>button[class*=absolute]]:items-center [&>button[class*=absolute]]:justify-center max-md:[&>button[class*=absolute]]:hidden'
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* 固定ヘッダー */}
        <div
          className="shrink-0 sticky top-0 z-10 flex items-center gap-1 border-b bg-white/95 backdrop-blur px-2 pt-[env(safe-area-inset-top)] min-h-14 md:px-4"
          data-slot="mobile-sheet-header"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 px-2 -ml-1 md:hidden"
            onClick={() => (onLeftClick ? onLeftClick() : onOpenChange(false))}
          >
            <ChevronLeft className="h-5 w-5 mr-0.5" aria-hidden="true" />
            {leftLabel}
          </Button>
          <div className="flex-1 min-w-0 text-center md:text-left md:pl-0">
            <DialogTitle className="text-base font-semibold truncate md:text-lg">{title}</DialogTitle>
            <DialogDescription className="sr-only">{description || title}</DialogDescription>
          </div>
          <div className="flex items-center gap-1 min-w-[2.75rem] justify-end md:mr-9">{headerRight}</div>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-slot="mobile-sheet-body">
          {children}
        </div>

        {/* 下部固定バー */}
        {footer && (
          <div
            className="shrink-0 sticky bottom-0 z-10 border-t bg-white/95 backdrop-blur px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3"
            data-slot="mobile-sheet-footer"
          >
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
