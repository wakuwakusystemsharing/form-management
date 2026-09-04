import * as React from 'react';

/**
 * 一覧ローディング用のスケルトン（顧客カードの形）。
 * 読み込み中に一覧の高さがゼロにならず、レイアウトが跳ねないようにする。
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite" aria-label="読み込み中">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} data-slot="list-item" className="rounded-lg border p-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
            </div>
            <div className="h-5 w-12 rounded-full bg-muted" />
          </div>
          <div className="mt-2 h-3 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
