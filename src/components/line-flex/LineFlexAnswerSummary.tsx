'use client';

/**
 * LINE メッセージの分岐ボタンの「回答の集計」（一覧のプレビュー編集の下に出す）
 * 質問ごとに、選択肢を選んだ人数と押された回数を棒で表示する。個人は出さない（顧客詳細の LINE タブで見る）
 */
import React, { useEffect, useState } from 'react';
import type { BranchAnswerSummary } from '@/lib/line-flex-branch';

export default function LineFlexAnswerSummary({ storeId, messageId, version }: { storeId: string; messageId: string; version?: string }) {
  const [summary, setSummary] = useState<BranchAnswerSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/line-messages/${messageId}/answers`, { credentials: 'include', cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json.summary) {
          setSummary(json.summary as BranchAnswerSummary);
          setFailed(false);
        } else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, messageId, version]);

  if (failed) return <p className="text-xs text-muted-foreground">回答の集計を取得できませんでした。</p>;
  if (!summary) return <p className="text-xs text-muted-foreground">回答の集計を読み込み中…</p>;

  return (
    <div className="space-y-2 rounded-lg border p-3 text-xs" data-slot="flex-answer-summary">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">回答の集計</span>
        <span className="text-muted-foreground tabular-nums">ボタンを押した人 {summary.respondents} 人 ・ 押された回数 {summary.taps} 回</span>
      </div>
      {summary.groups.map((g, gi) => {
        const max = Math.max(1, ...g.choices.map((c) => c.users));
        return (
          <div key={`${g.question}_${gi}`} className="space-y-1">
            <p className="font-medium">{g.question || '次のメッセージを送るボタン'}</p>
            <ul className="space-y-1">
              {g.choices.map((c) => (
                <li key={c.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-2">
                  <span className={`truncate ${c.removed ? 'text-muted-foreground' : ''}`} title={c.label}>{c.label}{c.removed ? '（削除済み）' : ''}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-[#06C755]" style={{ width: `${(c.users / max) * 100}%` }} />
                  </span>
                  <span className="tabular-nums text-muted-foreground">{c.users} 人（{c.taps} 回）</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">同じ人が何度押しても「人」は 1 人と数えます。誰が何を選んだかは、顧客詳細の「LINE」タブで見られます。</p>
    </div>
  );
}
