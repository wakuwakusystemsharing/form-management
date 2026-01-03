'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw, Loader2, User } from 'lucide-react';
import type { SalonBoardStylist } from '@/types/salon-board';

interface StylistListProps {
  stylists: SalonBoardStylist[];
  onSync: () => Promise<void>;
  onToggleVisibility: (stylistId: string, isHidden: boolean) => Promise<void>;
  lastSyncedAt?: string | null;
  isLoading?: boolean;
  isSyncing?: boolean;
}

export function StylistList({
  stylists,
  onSync,
  onToggleVisibility,
  lastSyncedAt,
  isLoading = false,
  isSyncing = false,
}: StylistListProps) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleToggleVisibility = async (stylistId: string, currentHidden: boolean) => {
    setTogglingId(stylistId);
    try {
      await onToggleVisibility(stylistId, !currentHidden);
    } finally {
      setTogglingId(null);
    }
  };

  const visibleCount = stylists.filter((s) => !s.is_hidden).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>スタッフ</CardTitle>
            <CardDescription>
              サロンボードから同期したスタッフ情報（{visibleCount}/{stylists.length}名表示中）
              {lastSyncedAt && (
                <span className="ml-2">
                  （最終同期: {new Date(lastSyncedAt).toLocaleString('ja-JP')}）
                </span>
              )}
            </CardDescription>
          </div>
          <Button onClick={onSync} disabled={isLoading || isSyncing}>
            {isSyncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                同期中...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                同期
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {stylists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <User className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground">
              スタッフ情報はまだ同期されていません
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={onSync}
              disabled={isSyncing}
            >
              今すぐ同期
            </Button>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">画像</TableHead>
                  <TableHead>名前</TableHead>
                  <TableHead>カナ</TableHead>
                  <TableHead className="w-[100px]">指名料</TableHead>
                  <TableHead className="w-[80px] text-center">表示</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stylists.map((stylist) => (
                  <TableRow key={stylist.id} className={stylist.is_hidden ? 'opacity-50' : ''}>
                    <TableCell>
                      {stylist.image_url ? (
                        <div className="relative h-12 w-12 overflow-hidden rounded-full">
                          <Image
                            src={stylist.image_url}
                            alt={stylist.name}
                            fill
                            className="object-cover"
                            sizes="48px"
                          />
                        </div>
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                          <User className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">
                        {stylist.custom_name || stylist.name}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {stylist.custom_name_kana || stylist.name_kana || '-'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {stylist.nomination_fee
                        ? `¥${stylist.nomination_fee.toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!stylist.is_hidden}
                        onCheckedChange={() =>
                          handleToggleVisibility(stylist.id, stylist.is_hidden)
                        }
                        disabled={isLoading || togglingId === stylist.id}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
