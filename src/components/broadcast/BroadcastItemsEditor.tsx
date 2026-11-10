'use client';

/**
 * 配信で送るメッセージの並び（最大 5 通）を編集する
 * 保存済みの LINE メッセージ / テキスト / 画像 / 動画 / スタンプ / Flex（JSON）を足して ↑↓ で並べ替える
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BROADCAST_ITEM_LABELS, BROADCAST_ITEMS_MAX, BROADCAST_NAME_TOKEN } from '@/lib/broadcast-items';
import { LINE_TEXT_MESSAGE_MAX } from '@/lib/line-flex-items';
import type { BroadcastItem, BroadcastSticker } from '@/types/broadcast';
import type { LineFlexMessage } from '@/types/line-flex';

export type ItemJsonState = Record<string, { text: string; error: string | null }>;

function rowKey(): string {
  return Math.random().toString(36).slice(2, 8);
}

const ADD_BUTTONS: Array<{ type: BroadcastItem['type']; label: string }> = [
  { type: 'ref', label: '＋ 保存済みの LINE メッセージ' },
  { type: 'text', label: '＋ テキスト' },
  { type: 'image', label: '＋ 画像' },
  { type: 'video', label: '＋ 動画' },
  { type: 'sticker', label: '＋ スタンプ' },
  { type: 'flex', label: '＋ Flex（JSON）' },
];

function newItem(type: BroadcastItem['type']): BroadcastItem {
  const key = rowKey();
  switch (type) {
    case 'text':
      return { key, type, text: '' };
    case 'image':
      return { key, type, url: '' };
    case 'video':
      return { key, type, url: '', preview_url: '' };
    case 'flex':
      return { key, type, alt_text: '', contents: null };
    case 'sticker':
      return { key, type, sticker_id: '' };
    default:
      return { key, type: 'ref', message_id: '' };
  }
}

function move<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

function ImageField({ slot, value, uploading, onUpload, onChange }: { slot: string; value: string | undefined; uploading: string | null; onUpload: (slot: string, file: File, current: string | undefined) => void; onChange: (url: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="h-16 w-24 rounded border object-cover" />
      ) : (
        <span className="text-xs text-muted-foreground">画像は未設定です</span>
      )}
      <label className="inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-xs hover:bg-muted">
        {uploading === slot ? 'アップロード中…' : value ? '画像を変更' : '画像をアップロード'}
        <input
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          disabled={uploading === slot}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(slot, f, value);
            e.target.value = '';
          }}
        />
      </label>
      {value && <button type="button" className="text-xs text-destructive hover:underline" onClick={() => onChange('')}>削除</button>}
      <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="https:// の画像 URL を直接入力でも可" className="h-8 min-w-[12rem] flex-1 text-xs" />
    </div>
  );
}

export default function BroadcastItemsEditor({
  items,
  onChange,
  messages,
  stickers,
  uploading,
  onUpload,
  jsonState,
  onJsonChange,
  disabled,
}: {
  items: BroadcastItem[];
  onChange: (items: BroadcastItem[]) => void;
  /** 同じ店舗の保存済み LINE メッセージ */
  messages: LineFlexMessage[];
  stickers: BroadcastSticker[];
  uploading: string | null;
  onUpload: (slot: string, file: File, current: string | undefined, apply: (url: string) => void) => void;
  jsonState: ItemJsonState;
  onJsonChange: (key: string, text: string) => void;
  disabled?: boolean;
}) {
  const update = (key: string, patch: Partial<BroadcastItem>) => onChange(items.map((x) => (x.key === key ? ({ ...x, ...patch } as BroadcastItem) : x)));
  const insertName = (key: string, text: string) => update(key, { text: `${text}${BROADCAST_NAME_TOKEN}` } as Partial<BroadcastItem>);

  return (
    <div className="space-y-2" data-slot="broadcast-items">
      {items.length === 0 && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs">下のボタンから、送るメッセージを追加してください（最大 {BROADCAST_ITEMS_MAX} 通。上から順に届きます）。</p>}
      {items.map((item, i) => (
        <div key={item.key} className="space-y-2 rounded border p-2" data-slot="broadcast-item">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-bold">{i + 1}</span>
            <span className="text-xs font-medium">{BROADCAST_ITEM_LABELS[item.type]}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={disabled || i === 0} onClick={() => onChange(move(items, i, -1))}>↑</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={disabled || i === items.length - 1} onClick={() => onChange(move(items, i, 1))}>↓</Button>
              <button type="button" disabled={disabled} className="text-xs text-destructive hover:underline disabled:opacity-50" onClick={() => onChange(items.filter((x) => x.key !== item.key))}>削除</button>
            </div>
          </div>

          {item.type === 'ref' && (
            <div className="space-y-1">
              {messages.length === 0 ? (
                <p className="text-xs text-muted-foreground">保存済みの LINE メッセージがありません（店舗ページの「LINE メッセージ」タブで作成できます）</p>
              ) : (
                <Select value={item.message_id} disabled={disabled} onValueChange={(v) => update(item.key, { message_id: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="LINE メッセージを選ぶ" /></SelectTrigger>
                  <SelectContent>
                    {messages.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground">その LINE メッセージの内容（Flex と、追加したテキスト・画像など）がそのまま入ります。ボタンのタップ数は LINE メッセージ側で数えます</p>
            </div>
          )}

          {item.type === 'text' && (
            <div className="space-y-1">
              <Textarea value={item.text} maxLength={LINE_TEXT_MESSAGE_MAX} rows={4} disabled={disabled} onChange={(e) => update(item.key, { text: e.target.value })} placeholder={`例: ${BROADCAST_NAME_TOKEN}さん、いつもありがとうございます。`} className="text-xs" />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={disabled} onClick={() => insertName(item.key, item.text)}>お名前を差し込む {BROADCAST_NAME_TOKEN}</Button>
                <span className="text-[11px] text-muted-foreground">{BROADCAST_NAME_TOKEN} は送るときにお客様の名前（無ければ LINE の表示名、それも無ければ「お客様」）に置き換わります</span>
              </div>
            </div>
          )}

          {item.type === 'image' && (
            <div className="space-y-1">
              <ImageField slot={`item_${item.key}`} value={item.url} uploading={uploading} onUpload={(slot, f, cur) => onUpload(slot, f, cur, (url) => update(item.key, { url }))} onChange={(url) => update(item.key, { url })} />
              <p className="text-[11px] text-muted-foreground">JPEG / PNG（5MB まで）</p>
            </div>
          )}

          {item.type === 'video' && (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">動画の URL（https:// の mp4 ファイル。YouTube などのページ URL は不可）</Label>
                <Input value={item.url} disabled={disabled} onChange={(e) => update(item.key, { url: e.target.value })} placeholder="https://…/movie.mp4" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">サムネイル画像（必須）</Label>
                <ImageField slot={`thumb_${item.key}`} value={item.preview_url} uploading={uploading} onUpload={(slot, f, cur) => onUpload(slot, f, cur, (url) => update(item.key, { preview_url: url }))} onChange={(url) => update(item.key, { preview_url: url })} />
              </div>
            </div>
          )}

          {item.type === 'sticker' && (
            <div className="space-y-1">
              {stickers.length === 0 ? (
                <p className="text-xs text-muted-foreground">スタンプがまだありません。「スタンプ・素材」タブで画像を追加できます</p>
              ) : (
                <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                  {stickers.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={disabled}
                      title={s.label}
                      onClick={() => update(item.key, { sticker_id: s.id })}
                      className={`rounded-lg border-2 p-0.5 ${item.sticker_id === s.id ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.preview_url || s.url} alt={s.label} className="h-16 w-16 rounded object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">スタンプは画像メッセージとして届きます</p>
            </div>
          )}

          {item.type === 'flex' && (
            <div className="space-y-1">
              <Input value={item.alt_text} maxLength={400} disabled={disabled} onChange={(e) => update(item.key, { alt_text: e.target.value })} placeholder="通知に出る文（空なら「メッセージが届いています」）" className="h-8 text-xs" />
              <Textarea value={jsonState[item.key]?.text ?? ''} disabled={disabled} onChange={(e) => onJsonChange(item.key, e.target.value)} rows={6} spellCheck={false} className="font-mono text-[11px]" placeholder='{"type":"bubble", ...}' />
              {jsonState[item.key]?.error ? <p className="text-xs text-destructive">{jsonState[item.key].error}</p> : <p className="text-[11px] text-muted-foreground">Flex Message Simulator などで作った JSON（bubble / carousel）を貼り付け。ボタンのタップ数を数えます</p>}
            </div>
          )}
        </div>
      ))}

      {items.length < BROADCAST_ITEMS_MAX ? (
        <div className="flex flex-wrap items-center gap-1">
          {ADD_BUTTONS.map((b) => (
            <Button key={b.type} type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={disabled} onClick={() => onChange([...items, newItem(b.type)])}>{b.label}</Button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">1 回に送れるのは {BROADCAST_ITEMS_MAX} 通までです（LINE の仕様）</p>
      )}
    </div>
  );
}
