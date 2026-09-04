import * as React from 'react';
import { cn } from '@/lib/utils';

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  /** 数字が長い（金額・日付）ときは小さめにする */
  size?: 'lg' | 'md';
  className?: string;
}

/**
 * 「ラベル + 数字」の小タイル。顧客詳細の統計と分析の概要で共用。
 * Card の CardHeader / CardContent の 2 段構造をやめ、1 枚で高さを抑える。
 */
export function StatTile({ label, value, size = 'lg', className }: StatTileProps) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-lg border bg-card text-card-foreground px-3 py-2.5 min-w-0 md:px-4 md:py-3', className)}
    >
      <p className="text-[11px] leading-4 text-muted-foreground truncate md:text-xs">{label}</p>
      <p
        className={cn(
          'font-bold tabular-nums truncate leading-tight mt-0.5',
          size === 'lg' ? 'text-xl md:text-2xl' : 'text-sm md:text-base'
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function StatGrid({ children, className, cols = 2 }: { children: React.ReactNode; className?: string; cols?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        'grid gap-2 md:gap-3',
        cols === 2 && 'grid-cols-2 md:grid-cols-4',
        cols === 3 && 'grid-cols-3',
        cols === 4 && 'grid-cols-2 md:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  );
}
