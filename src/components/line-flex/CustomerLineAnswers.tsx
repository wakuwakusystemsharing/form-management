'use client';

/**
 * 顧客詳細の「LINE」タブ: そのお客様が LINE メッセージの分岐ボタンで選んだ内容（新しい順）
 * GET /api/stores/{storeId}/line-messages/answers?line_user_id=
 */
import React, { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/client-auth';

interface AnswerItem {
  id: string;
  message_id: string;
  message_name: string;
  question: string;
  label: string;
  created_at: string;
}

function formatJst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function CustomerLineAnswers({ storeId, lineUserId }: { storeId: string; lineUserId: string }) {
  const [answers, setAnswers] = useState<AnswerItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/stores/${storeId}/line-messages/answers?line_user_id=${encodeURIComponent(lineUserId)}`);
        const json = await res.json().catch(() => ({}));
        if (!cancelled) setAnswers(res.ok && Array.isArray(json.answers) ? (json.answers as AnswerItem[]) : []);
      } catch {
        if (!cancelled) setAnswers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, lineUserId]);

  // 回答が 1 件も無いお客様には何も出さない（分岐を使っていない店舗で場所を取らないため）
  if (!answers || answers.length === 0) return null;

  return (
    <div className="mt-4 space-y-2" data-slot="customer-line-answers">
      <h4 className="text-sm font-medium">LINE メッセージで選んだ内容 <span className="text-xs font-normal text-muted-foreground">{answers.length} 件</span></h4>
      <ul className="space-y-1.5">
        {answers.map((a) => (
          <li key={a.id} className="rounded-md border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-medium break-words">{a.label || '（文言なし）'}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{formatJst(a.created_at)}</span>
            </div>
            <p className="text-xs text-muted-foreground break-words">
              {a.question ? `${a.question} ／ ` : ''}
              {a.message_name}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
