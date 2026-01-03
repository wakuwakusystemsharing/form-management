'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Loader2, Tag, Scissors } from 'lucide-react';
import type { SalonBoardMenu } from '@/types/salon-board';

interface MenuListProps {
  menus: SalonBoardMenu[];
  onSync: () => Promise<void>;
  onToggleVisibility: (menuId: string, isHidden: boolean) => Promise<void>;
  lastSyncedAt?: string | null;
  isLoading?: boolean;
  isSyncing?: boolean;
}

export function MenuList({
  menus,
  onSync,
  onToggleVisibility,
  lastSyncedAt,
  isLoading = false,
  isSyncing = false,
}: MenuListProps) {
  const [typeFilter, setTypeFilter] = useState<'all' | 'coupon' | 'menu'>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filteredMenus = menus.filter((menu) => {
    if (typeFilter === 'all') return true;
    return menu.type === typeFilter;
  });

  const handleToggleVisibility = async (menuId: string, currentHidden: boolean) => {
    setTogglingId(menuId);
    try {
      await onToggleVisibility(menuId, !currentHidden);
    } finally {
      setTogglingId(null);
    }
  };

  const couponCount = menus.filter((m) => m.type === 'coupon').length;
  const menuCount = menus.filter((m) => m.type === 'menu').length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>メニュー・クーポン</CardTitle>
            <CardDescription>
              サロンボードから同期したメニュー・クーポン情報
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
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Select
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(value as 'all' | 'coupon' | 'menu')}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="種別で絞り込み" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべて ({menus.length})</SelectItem>
              <SelectItem value="coupon">クーポン ({couponCount})</SelectItem>
              <SelectItem value="menu">メニュー ({menuCount})</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filteredMenus.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Scissors className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground">
              {menus.length === 0
                ? 'メニュー・クーポンはまだ同期されていません'
                : '該当するメニュー・クーポンがありません'}
            </p>
            {menus.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={onSync}
                disabled={isSyncing}
              >
                今すぐ同期
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">画像</TableHead>
                  <TableHead>タイトル</TableHead>
                  <TableHead className="w-[100px]">種別</TableHead>
                  <TableHead className="w-[120px]">価格</TableHead>
                  <TableHead className="w-[80px]">時間</TableHead>
                  <TableHead className="w-[80px] text-center">表示</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMenus.map((menu) => (
                  <TableRow key={menu.id} className={menu.is_hidden ? 'opacity-50' : ''}>
                    <TableCell>
                      {menu.image_url ? (
                        <div className="relative h-12 w-12 overflow-hidden rounded">
                          <Image
                            src={menu.image_url}
                            alt={menu.title}
                            fill
                            className="object-cover"
                            sizes="48px"
                          />
                        </div>
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-muted">
                          {menu.type === 'coupon' ? (
                            <Tag className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <Scissors className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-sm line-clamp-1">
                          {menu.custom_title || menu.title}
                        </p>
                        {menu.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {menu.custom_description || menu.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={menu.type === 'coupon' ? 'default' : 'secondary'}>
                        {menu.type === 'coupon' ? 'クーポン' : 'メニュー'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {menu.custom_price || menu.price || '-'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {menu.treatment_time ? `${menu.treatment_time}分` : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!menu.is_hidden}
                        onCheckedChange={() => handleToggleVisibility(menu.id, menu.is_hidden)}
                        disabled={isLoading || togglingId === menu.id}
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
