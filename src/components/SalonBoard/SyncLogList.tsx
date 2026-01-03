'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { SalonBoardSyncLog } from '@/types/salon-board';

interface SyncLogListProps {
  logs: SalonBoardSyncLog[];
  onRefresh: () => Promise<void>;
  isLoading?: boolean;
}

const syncTypeLabels: Record<string, string> = {
  reservation_create: '予約登録',
  reservation_cancel: '予約キャンセル',
  reservation_modify: '予約変更',
  menu_sync: 'メニュー同期',
  stylist_sync: 'スタッフ同期',
  availability_fetch: '空き日程取得',
};

const statusConfig = {
  pending: { label: '処理中', variant: 'secondary' as const },
  success: { label: '成功', variant: 'default' as const },
  failed: { label: '失敗', variant: 'destructive' as const },
  retry: { label: 'リトライ待ち', variant: 'outline' as const },
};

const directionLabels = {
  outbound: '送信',
  inbound: '受信',
};

export function SyncLogList({
  logs,
  onRefresh,
  isLoading = false,
}: SyncLogListProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>同期履歴</CardTitle>
            <CardDescription>
              サロンボードとの同期処理の履歴を確認できます
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-muted-foreground">
              同期履歴はまだありません
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>件数</TableHead>
                  <TableHead>詳細</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const statusCfg = statusConfig[log.status];
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">
                        {new Date(log.started_at).toLocaleString('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {syncTypeLabels[log.sync_type] || log.sync_type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {directionLabels[log.sync_direction]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusCfg.variant}>
                          {statusCfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.items_synced !== null ? `${log.items_synced}件` : '-'}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        {log.error_message ? (
                          <span className="text-xs text-destructive truncate block">
                            {log.error_message}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
