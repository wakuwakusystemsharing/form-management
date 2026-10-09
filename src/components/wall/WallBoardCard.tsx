'use client';

/**
 * 寄せ書きウォール: ボードの一覧カード（予約 / アンケート / 抽選フォームの一覧カードと同じ見た目）
 * 1 店舗 1 ボードなので 1 枚だけ。「編集」で設定モーダルを開く
 */
import React from 'react';
import { Copy, Edit, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WALL_MODERATION_LABELS } from '@/lib/wall-themes';
import { wallPageUrl } from './WallSettingsEditor';
import type { WallBoardSettings, WallStats } from '@/types/wall';

export interface WallBoardCardProps {
  storeId: string;
  settings: WallBoardSettings | null;
  stats?: WallStats | null;
  onEdit: () => void;
  onCopy: (text: string) => void;
}

export default function WallBoardCard({ storeId, settings, stats, onEdit, onCopy }: WallBoardCardProps) {
  if (!settings) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          <span data-slot="loading" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent align-middle" /> 読み込み中…
        </CardContent>
      </Card>
    );
  }
  const pageUrl = wallPageUrl(storeId);
  const liffUrl = settings.liff_id ? `https://liff.line.me/${settings.liff_id}` : '';
  const moderationLabel = WALL_MODERATION_LABELS[settings.moderation].split('（')[0];

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="truncate font-medium">📌 {settings.theme.title || 'みんなの寄せ書き'}</h3>
              <Badge variant={settings.enabled ? 'default' : 'secondary'} className="shrink-0">{settings.enabled ? '公開中' : '非公開'}</Badge>
              <Badge variant="outline" className="shrink-0">{moderationLabel}</Badge>
              <Badge variant="outline" className="shrink-0">1 日 {settings.daily_max} 枚まで</Badge>
              {settings.empathy_enabled && <Badge variant="outline" className="shrink-0">わかる！ ON</Badge>}
              {!settings.liff_id && <Badge variant="outline" className="shrink-0 border-orange-500 text-orange-600">LIFF ID 未設定</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {settings.theme.subtitle}
              {stats && ` ／ 直近 7 日の投稿 ${stats.week_posts} ／ 承認待ち ${stats.pending} ／ 通報で確認待ち ${stats.review}`}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">店舗ID: {storeId}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Edit className="mr-2 h-4 w-4" />編集
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
          <span className="shrink-0 text-[11px] text-muted-foreground">ページの URL</span>
          <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{pageUrl}</code>
          <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0" onClick={() => window.open(pageUrl, '_blank')} title="開く">
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0" onClick={() => onCopy(pageUrl)} title="コピー">
            <Copy className="h-3 w-3" />
          </Button>
        </div>
        {liffUrl && (
          <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
            <span className="shrink-0 text-[11px] text-muted-foreground">公式LINE設定用URL</span>
            <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{liffUrl}</code>
            <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0" onClick={() => onCopy(liffUrl)} title="コピー">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
