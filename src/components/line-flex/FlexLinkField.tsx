'use client';

/**
 * ボタンを押したときの動きを選ぶ入力欄（LINE メッセージの編集で共通）
 * - 「URL を開く」: https:// / tel: の入力 + 予約フォームの URL を入れるプルダウン
 * - 「次のメッセージを送る」: 保存済みの LINE メッセージを選ぶ + 選んだお客様に付けるタグ
 *   （値は `next:{メッセージID}?tags=…`。src/lib/line-flex-branch.ts）
 */
import React, { useState } from 'react';
import TagInput from '@/components/customers/TagInput';
import { nextLink, NEXT_LINK_PREFIX, parseNextLink } from '@/lib/line-flex-branch';

export interface FlexLinkTarget {
  id: string;
  name: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 予約フォームの URL の候補 */
  formUrls: Array<{ name: string; url: string }>;
  /** 次に送れる LINE メッセージ（自分自身は除いて渡す） */
  targets: FlexLinkTarget[];
  /** タグの候補を出す店舗（省略時は候補なし） */
  storeId?: string;
  /** 指定すると、この条件を満たす URL だけを確定する（途中の入力で内容を壊さない） */
  validUrl?: (v: string) => boolean;
  placeholder?: string;
}

const inputClass = 'h-8 w-full rounded-md border bg-background px-2 text-xs';

export default function FlexLinkField({ value, onChange, formUrls, targets, storeId, validUrl, placeholder = 'https://… または tel:0312345678' }: Props) {
  const isNext = (v: string) => v.startsWith(NEXT_LINK_PREFIX);
  const [mode, setMode] = useState<'url' | 'next'>(isNext(value) ? 'next' : 'url');
  const [draft, setDraft] = useState(isNext(value) ? '' : value);
  const [seen, setSeen] = useState(value);
  // 外から値が変わったら（元に戻す・別のボタンを選んだ）手元の表示も合わせる
  if (seen !== value) {
    setSeen(value);
    setMode(isNext(value) ? 'next' : 'url');
    setDraft(isNext(value) ? '' : value);
  }
  const commit = (v: string) => {
    setSeen(v);
    onChange(v);
  };
  const next = parseNextLink(value);
  const urlOk = !validUrl || validUrl(draft);

  return (
    <div className="space-y-1" data-slot="flex-link-field">
      <select
        value={mode}
        className="h-8 w-full rounded-md border bg-background px-1 text-xs"
        onChange={(e) => {
          const m = e.target.value as 'url' | 'next';
          setMode(m);
          // 切り替えただけでは内容を変えない（リンク先 / メッセージを選んだ時点で確定する）
          if (m === 'url') setDraft(isNext(value) ? '' : value);
        }}
      >
        <option value="url">押したら URL を開く（予約フォーム・電話など）</option>
        <option value="next">押したら次のメッセージを送る（分岐）</option>
      </select>
      {mode === 'url' ? (
        <>
          <input
            value={draft}
            placeholder={placeholder}
            className={`${inputClass} ${urlOk ? '' : 'border-destructive'}`}
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v);
              if (!validUrl || validUrl(v)) commit(v);
            }}
          />
          {formUrls.length > 0 && (
            <select
              value=""
              className="h-7 w-full rounded-md border bg-background px-1 text-[11px]"
              onChange={(e) => {
                if (!e.target.value) return;
                setDraft(e.target.value);
                commit(e.target.value);
              }}
            >
              <option value="">予約フォームの URL を入れる…</option>
              {formUrls.map((f) => (
                <option key={f.url} value={f.url}>{f.name}</option>
              ))}
            </select>
          )}
        </>
      ) : targets.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">この店舗に、次に送れる保存済みの LINE メッセージがまだありません。先に送りたいメッセージを作って保存してください。</p>
      ) : (
        <>
          <select value={next?.messageId ?? ''} className="h-8 w-full rounded-md border bg-background px-1 text-xs" onChange={(e) => e.target.value && commit(nextLink(e.target.value, next?.tags ?? []))}>
            <option value="">送る LINE メッセージを選ぶ…</option>
            {next && !targets.some((t) => t.id === next.messageId) && <option value={next.messageId}>（削除されたメッセージ）</option>}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {next && (
            <div className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground">押したお客様に付けるタグ（任意。配信の絞り込みに使えます）</p>
              <TagInput value={next.tags} onChange={(tags) => commit(nextLink(next.messageId, tags))} storeId={storeId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
