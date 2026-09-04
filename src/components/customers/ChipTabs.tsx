'use client';

import * as React from 'react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export interface ChipTabItem {
  value: string;
  label: string;
  /** 件数バッジ（0 も表示） */
  count?: number;
}

interface ChipTabsListProps {
  items: ChipTabItem[];
  className?: string;
  /** PC で均等幅にする（スマホは常にチップ幅・横スクロール） */
  desktopGrid?: boolean;
}

/**
 * 横スクロールできるチップ形のタブ列（Tabs の TabsList / TabsTrigger の薄いラッパー）。
 * - スマホ: 収まらないときは横スクロール（スクロールバー非表示、端でスナップ）
 * - 装飾は既存の data-slot="tabs-list" / "tabs-trigger" に任せる（標準 / M3E 共通）
 * Tabs の Root は呼び出し側が持つ（value / onValueChange をそのまま使える）。
 */
export function ChipTabsList({ items, className, desktopGrid = false }: ChipTabsListProps) {
  return (
    <TabsList
      className={cn(
        'flex h-auto w-full items-stretch justify-start gap-1 overflow-x-auto overscroll-x-contain snap-x snap-mandatory p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        desktopGrid && 'md:grid md:overflow-visible',
        className
      )}
      style={desktopGrid ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` } : undefined}
    >
      {items.map((item) => (
        <TabsTrigger
          key={item.value}
          value={item.value}
          className="shrink-0 snap-start min-h-10 px-3.5 text-sm whitespace-nowrap md:min-h-9"
        >
          {item.label}
          {typeof item.count === 'number' && (
            <span className="ml-1 rounded-full bg-black/10 px-1.5 text-[11px] leading-5 tabular-nums data-[state=active]:bg-white/25">
              {item.count}
            </span>
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

interface ChipFilterProps<T extends string> {
  items: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * 単一選択のチップ列（絞り込み用。Tabs ではなくボタン）。
 */
export function ChipFilter<T extends string>({ items, value, onChange, ariaLabel, className }: ChipFilterProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'flex gap-2 overflow-x-auto overscroll-x-contain snap-x py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-slot="status-chip"
            data-active={active ? 'true' : undefined}
            onClick={() => onChange(item.value)}
            className={cn(
              'shrink-0 snap-start min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
