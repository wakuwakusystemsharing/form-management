'use client';

import { useSyncExternalStore } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  getUiStyle,
  setUiStyle,
  UI_STYLE_CHANGE_EVENT,
  UI_STYLE_DEFAULT,
  UI_STYLE_OPTIONS,
  UI_STYLE_STORAGE_KEY,
  type UiStyle,
} from '@/lib/ui-style';
import { Smartphone, Monitor, Sparkles } from 'lucide-react';

const ICONS: Record<UiStyle, typeof Smartphone> = {
  auto: Smartphone,
  standard: Monitor,
  m3e: Sparkles,
};

// localStorage + 同一タブ内の変更イベントを購読（SSR 時は既定値）
function subscribe(callback: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === UI_STYLE_STORAGE_KEY) callback();
  };
  window.addEventListener(UI_STYLE_CHANGE_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(UI_STYLE_CHANGE_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}
const getServerSnapshot = () => UI_STYLE_DEFAULT;

/**
 * 店舗管理画面の「表示設定」カード（設定タブ用）
 * 端末ごとの設定なので localStorage に保存され、他の管理者には影響しない
 */
export default function UiStyleSettings() {
  const style = useSyncExternalStore(subscribe, getUiStyle, getServerSnapshot);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">表示設定</CardTitle>
        <CardDescription>
          この端末での管理画面の見た目を選べます（設定はこの端末にのみ保存されます）
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="表示スタイル" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {UI_STYLE_OPTIONS.map((opt) => {
            const Icon = ICONS[opt.value];
            const checked = style === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setUiStyle(opt.value)}
                data-slot="ui-style-option"
                className={cn(
                  'text-left rounded-lg border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  checked
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'hover:bg-accent'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  <span className="font-medium">{opt.label}</span>
                </div>
                <p className="text-sm text-muted-foreground">{opt.description}</p>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
