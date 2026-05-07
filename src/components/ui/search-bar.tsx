'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * 共通検索バー。Search アイコン + Input + クリア (×) ボタン。
 * デバウンスは利用側で `useDebounce` を使うこと。
 */
export function SearchBar({
  value,
  onChange,
  placeholder = '名前 / メール / 電話番号で検索…',
  className,
  ariaLabel = '検索',
}: SearchBarProps) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        className="pl-10 pr-10"
      />
      {value.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="検索をクリア"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
