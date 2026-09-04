'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fetchWithAuth } from '@/lib/client-auth';
import { normalizeTags, TAGS_MAX_COUNT, TAG_MAX_LENGTH } from '@/lib/customer-chart';
import { Plus, X } from 'lucide-react';

interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  /** 「よく使うタグ」候補を取得する店舗 ID（省略時は候補を出さない） */
  storeId?: string;
  disabled?: boolean;
}

/**
 * 顧客タグの入力。テキスト + Enter / 「追加」で追加、× で削除。
 * 店舗の顧客に付いているタグを候補（よく使うタグ）としてタップで追加できる。
 */
export default function TagInput({ id, value, onChange, storeId, disabled = false }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/stores/${storeId}/customers/tags`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const tags = Array.isArray(json.tags) ? json.tags.map((t: { tag: string }) => t.tag) : [];
        if (!cancelled) setSuggestions(tags.slice(0, 20));
      } catch (e) {
        console.error('Failed to fetch tag suggestions:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const add = (raw: string) => {
    const next = normalizeTags([...value, raw]);
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };
  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const full = value.length >= TAGS_MAX_COUNT;
  const visibleSuggestions = suggestions.filter((s) => !value.includes(s)).slice(0, 12);

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="設定中のタグ">
          {value.map((tag) => (
            <li key={tag} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 pl-2.5 pr-1 py-0.5 text-sm">
              <span className="max-w-[12rem] truncate">{tag}</span>
              <button
                type="button"
                onClick={() => remove(tag)}
                disabled={disabled}
                aria-label={`タグ「${tag}」を削除`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted active:bg-muted"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter で追加（IME 変換中の Enter は無視）
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (draft.trim()) add(draft);
            }
          }}
          placeholder={full ? `タグは ${TAGS_MAX_COUNT} 個までです` : '例: 指名:田中、平日希望'}
          maxLength={TAG_MAX_LENGTH}
          disabled={disabled || full}
          autoComplete="off"
          enterKeyHint="done"
          className="flex-1 min-w-0"
        />
        <Button type="button" variant="outline" className="h-11 md:h-10 shrink-0" onClick={() => add(draft)} disabled={disabled || full || !draft.trim()}>
          <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
          追加
        </Button>
      </div>
      {visibleSuggestions.length > 0 && !full && (
        <div className="space-y-1">
          <p className="text-[11px] leading-4 text-muted-foreground">よく使うタグ（タップで追加）</p>
          <div className="flex flex-wrap gap-1.5">
            {visibleSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                disabled={disabled}
                className="rounded-full border border-dashed px-2.5 py-1 text-xs min-h-8 hover:bg-accent active:bg-accent"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] leading-4 text-muted-foreground">
        1 タグ {TAG_MAX_LENGTH} 文字・{TAGS_MAX_COUNT} 個まで。電話番号など個人を特定できる情報はタグに入れないでください
      </p>
    </div>
  );
}
