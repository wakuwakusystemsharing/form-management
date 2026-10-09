'use client';

/**
 * 寄せ書きウォール: 見どころまとめ（案 7）。週ごとの件数と、直近 30 日によく出る言葉
 * 本文と日時だけから集計（投稿者情報は使わない）。言葉をタップすると「付箋の確認」をその語で絞り込む
 */
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WallInsightsResponse } from '@/types/wall';

export default function WallInsightsCard({ storeId, refreshKey = 0, onPickWord }: { storeId: string; refreshKey?: number; onPickWord?: (word: string) => void }) {
  const [data, setData] = useState<WallInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/insights`, { credentials: 'include', cache: 'no-store' })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '取得に失敗しました'); return j; })
      .then((json) => { if (!cancelled) { setData(json.insights); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '取得に失敗しました'); });
    return () => { cancelled = true; };
  }, [storeId, refreshKey]);

  const max = Math.max(1, ...(data?.weeks.map((w) => w.count) ?? [1]));

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">見どころまとめ</CardTitle>
        <CardDescription>週ごとの付箋の数と、直近 30 日の付箋によく出る言葉です。言葉を押すと、その言葉を含む付箋だけを「付箋の確認」に表示します。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <p className="text-sm text-muted-foreground">読み込み中…</p>}
        {data && (
          <>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">週ごとの付箋の数（直近 8 週・月曜始まり）</p>
              <div className="flex h-24 items-end gap-1.5" role="img" aria-label="週ごとの付箋の数">
                {data.weeks.map((w) => (
                  <div key={w.week_start} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${w.week_start} の週: ${w.count} 枚`}>
                    <span className="text-[10px] text-muted-foreground">{w.count}</span>
                    <div className="w-full rounded-t bg-[rgb(55,114,58)]/80" style={{ height: `${Math.max(2, Math.round((w.count / max) * 64))}px` }} />
                    <span className="text-[10px] text-muted-foreground">{w.week_start.slice(5).replace('-', '/')}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">よく出る言葉（直近 30 日・公開中 {data.total_30d} 枚）</p>
              {data.words.length === 0 ? (
                <p className="text-sm text-muted-foreground">まだ十分な付箋がありません。</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.words.map((w) => (
                    <button
                      key={w.word}
                      type="button"
                      data-slot="status-chip"
                      onClick={() => onPickWord?.(w.word)}
                      className="rounded-full border bg-background px-3 py-1 text-sm hover:bg-muted"
                      title={`この言葉を含む付箋を表示`}
                    >
                      {w.word} <span className="text-xs text-muted-foreground">{w.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
