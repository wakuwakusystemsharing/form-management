'use client';

import React from 'react';
import type { LotteryFormWithStats } from '@/types/lottery';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getBaseUrl } from '@/lib/env';
import { Copy, CopyPlus, Edit, ExternalLink, Eye, History, Trash2 } from 'lucide-react';

interface LotteryFormListProps {
  storeId: string;
  forms: LotteryFormWithStats[];
  onEdit: (form: LotteryFormWithStats) => void;
  onDuplicate?: (form: LotteryFormWithStats) => void;
  onDelete?: (form: LotteryFormWithStats) => void;
  onHistory?: (form: LotteryFormWithStats) => void;
  onCopy: (text: string) => void;
  duplicatingId?: string | null;
  emptyText?: string;
}

const DEFERRED_STATUS_LABEL: Record<string, string> = {
  accepting: '応募受付中',
  closed: '締切済み',
  drawn: '仮当選',
  notified: '確定・通知済み',
};

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return `${t.getMonth() + 1}/${t.getDate()}`;
}

/** 抽選フォームの一覧カード（テナント側・店舗管理者側で共用） */
export default function LotteryFormList({
  storeId,
  forms,
  onEdit,
  onDuplicate,
  onDelete,
  onHistory,
  onCopy,
  duplicatingId,
  emptyText = 'まだ抽選フォームが作成されていません',
}: LotteryFormListProps) {
  if (forms.length === 0) {
    return <p className="text-center text-muted-foreground py-8">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {forms.map((form) => {
        const config = form.config;
        const deployInfo = form.static_deploy;
        let formUrl = deployInfo?.deploy_url || deployInfo?.storage_url || `/preview/${storeId}/lotteries/${form.id}`;
        if (formUrl.startsWith('/') && !formUrl.startsWith('//')) formUrl = `${getBaseUrl()}${formUrl}`;
        const period = config.basic_info.period;
        const periodText = period?.start_at || period?.end_at
          ? `${formatDate(period?.start_at)}${period?.start_at && period?.end_at ? ' 〜 ' : ''}${period?.end_at ? (period?.start_at ? formatDate(period.end_at) : `〜 ${formatDate(period.end_at)}`) : ''}`
          : '';
        const winRate = form.stats.entries > 0 ? Math.round((form.stats.wins / form.stats.entries) * 100) : 0;
        const isDeferred = config.lottery_type === 'deferred';

        return (
          <Card key={form.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-medium truncate">🎯 {config.basic_info.title || '抽選フォーム'}</h3>
                    <Badge variant="outline" className="shrink-0">{isDeferred ? '後日抽選' : '即時抽選'}</Badge>
                    <Badge variant={form.status === 'active' ? 'default' : 'secondary'} className="shrink-0">
                      {form.status === 'active' ? '公開中' : form.status === 'paused' ? '一時停止' : '非公開'}
                    </Badge>
                    {isDeferred && (
                      <Badge variant="outline" className="shrink-0 text-blue-700 border-blue-400">{DEFERRED_STATUS_LABEL[form.deferred_draw_status] || form.deferred_draw_status}</Badge>
                    )}
                    {periodText && <Badge variant="outline" className="shrink-0">{isDeferred ? `締切 ${formatDate(period?.end_at)}` : periodText}</Badge>}
                    {!config.basic_info.liff_id && <Badge variant="outline" className="shrink-0 text-orange-600 border-orange-500">LIFF ID 未設定</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isDeferred ? '応募' : '参加'} {form.stats.entries} ／ 当選 {form.stats.wins}{!isDeferred && form.stats.entries > 0 ? `（${winRate}%）` : ''} ／ 引換 {form.stats.redeemed}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {config.prizes.map((p) => {
                      const used = form.stats.prize_counts[p.id] ?? 0;
                      const remain = p.stock === null || p.stock === undefined ? '∞' : `残り${Math.max(0, p.stock - used)}`;
                      return `${p.name} ${remain}`;
                    }).join(' ・ ')}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">ID: {form.id}</p>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  {onHistory && (
                    <Button size="sm" variant="outline" onClick={() => onHistory(form)} title="操作履歴">
                      <History className="mr-2 h-4 w-4" />履歴
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onEdit(form)}>
                    <Edit className="mr-2 h-4 w-4" />編集
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => window.open(`/preview/${storeId}/lotteries/${form.id}`, '_blank')}>
                    <Eye className="mr-2 h-4 w-4" />プレビュー
                  </Button>
                  {onDuplicate && (
                    <Button size="sm" variant="outline" onClick={() => onDuplicate(form)} disabled={duplicatingId === form.id}>
                      <CopyPlus className="mr-2 h-4 w-4" />{duplicatingId === form.id ? '複製中...' : '複製'}
                    </Button>
                  )}
                  {onDelete && (
                    <Button size="sm" variant="destructive" onClick={() => onDelete(form)}>
                      <Trash2 className="mr-2 h-4 w-4" />削除
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                <code className="text-xs text-muted-foreground truncate flex-1 min-w-0">{formUrl}</code>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => window.open(formUrl, '_blank')} title="開く">
                  <ExternalLink className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => onCopy(formUrl)} title="コピー">
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              {config.basic_info.liff_id && (
                <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                  <span className="text-[11px] text-muted-foreground shrink-0">公式LINE設定用URL</span>
                  <code className="text-xs text-muted-foreground truncate flex-1 min-w-0">{`https://liff.line.me/${config.basic_info.liff_id}`}</code>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => onCopy(`https://liff.line.me/${config.basic_info.liff_id}`)} title="コピー">
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
