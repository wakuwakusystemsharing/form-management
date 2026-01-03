'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { SalonBoardCredentials } from '@/types/salon-board';

interface SyncSettingsProps {
  credentials: SalonBoardCredentials | null;
  onUpdate: (settings: Partial<{
    sync_enabled: boolean;
    auto_sync_reservations: boolean;
    auto_sync_cancellations: boolean;
  }>) => Promise<void>;
  isLoading?: boolean;
}

export function SyncSettings({
  credentials,
  onUpdate,
  isLoading = false,
}: SyncSettingsProps) {
  const [isUpdating, setIsUpdating] = useState<string | null>(null);

  const handleToggle = async (
    key: 'sync_enabled' | 'auto_sync_reservations' | 'auto_sync_cancellations',
    value: boolean
  ) => {
    if (!credentials) return;

    setIsUpdating(key);
    try {
      await onUpdate({ [key]: value });
    } finally {
      setIsUpdating(null);
    }
  };

  if (!credentials) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>同期設定</CardTitle>
          <CardDescription>認証情報を登録すると同期設定が可能になります</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            先に認証情報を登録してください。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>同期設定</CardTitle>
        <CardDescription>
          サロンボードとの自動同期設定を管理します
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="sync_enabled">同期を有効化</Label>
            <p className="text-sm text-muted-foreground">
              サロンボードとの連携機能全体を有効/無効にします
            </p>
          </div>
          <Switch
            id="sync_enabled"
            checked={credentials.sync_enabled}
            onCheckedChange={(checked: boolean) => handleToggle('sync_enabled', checked)}
            disabled={isLoading || isUpdating !== null}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto_sync_reservations">予約の自動同期</Label>
            <p className="text-sm text-muted-foreground">
              LINEからの新規予約を自動的にサロンボードに登録します
            </p>
          </div>
          <Switch
            id="auto_sync_reservations"
            checked={credentials.auto_sync_reservations}
            onCheckedChange={(checked: boolean) => handleToggle('auto_sync_reservations', checked)}
            disabled={isLoading || isUpdating !== null || !credentials.sync_enabled}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto_sync_cancellations">キャンセルの自動同期</Label>
            <p className="text-sm text-muted-foreground">
              予約のキャンセルを自動的にサロンボードに反映します
            </p>
          </div>
          <Switch
            id="auto_sync_cancellations"
            checked={credentials.auto_sync_cancellations}
            onCheckedChange={(checked: boolean) => handleToggle('auto_sync_cancellations', checked)}
            disabled={isLoading || isUpdating !== null || !credentials.sync_enabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}
