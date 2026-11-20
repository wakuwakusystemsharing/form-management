'use client';

/**
 * スタンプのジャンル切り替え（すべて / あいさつ / お知らせ / 季節・お祝い / 店舗で追加）。
 * 「スタンプ・素材」の一覧と、配信メッセージの「＋ スタンプ」の選択欄で共通に使う。
 */
import React from 'react';
import { stickerFilterOptions, type StickerFilterId } from '@/lib/broadcast-builtin-stickers';
import type { BroadcastSticker } from '@/types/broadcast';

export default function StickerFilterChips({
  stickers,
  value,
  onChange,
}: {
  stickers: BroadcastSticker[];
  value: StickerFilterId;
  onChange: (value: StickerFilterId) => void;
}) {
  const options = stickerFilterOptions(stickers);
  // ジャンルが 1 つしか無いときは切り替えを出さない
  if (options.length <= 2) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-slot="sticker-filter" role="tablist" aria-label="スタンプのジャンル">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full border px-3 py-1 text-xs ${value === o.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
        >
          {o.label}
          <span className={`ml-1 text-[10px] ${value === o.id ? 'opacity-80' : 'text-muted-foreground'}`}>{o.count}</span>
        </button>
      ))}
    </div>
  );
}
