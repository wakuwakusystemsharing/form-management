'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { CredentialsForm } from './CredentialsForm';
import { ConnectionStatus } from './ConnectionStatus';
import { SyncSettings } from './SyncSettings';
import { SyncLogList } from './SyncLogList';
import { MenuList } from './MenuList';
import { StylistList } from './StylistList';
import type {
  SalonBoardCredentials,
  SalonBoardCredentialsInput,
  SalonBoardMenu,
  SalonBoardStylist,
  SalonBoardSyncLog,
} from '@/types/salon-board';

interface SalonBoardSettingsProps {
  storeId: string;
}

export function SalonBoardSettings({ storeId }: SalonBoardSettingsProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [credentials, setCredentials] = useState<SalonBoardCredentials | null>(null);
  const [menus, setMenus] = useState<SalonBoardMenu[]>([]);
  const [stylists, setStylists] = useState<SalonBoardStylist[]>([]);
  const [syncLogs, setSyncLogs] = useState<SalonBoardSyncLog[]>([]);
  const [isSyncingMenus, setIsSyncingMenus] = useState(false);
  const [isSyncingStylists, setIsSyncingStylists] = useState(false);

  // 認証情報を取得
  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch(`/api/stores/${storeId}/salon-board/credentials`);
      if (res.ok) {
        const data = await res.json();
        setCredentials(data);
      }
    } catch (error) {
      console.error('Failed to fetch credentials:', error);
    }
  }, [storeId]);

  // メニューを取得
  const fetchMenus = useCallback(async () => {
    try {
      const res = await fetch(`/api/stores/${storeId}/salon-board/menus?show_hidden=true`);
      if (res.ok) {
        const data = await res.json();
        setMenus(data);
      }
    } catch (error) {
      console.error('Failed to fetch menus:', error);
    }
  }, [storeId]);

  // スタッフを取得
  const fetchStylists = useCallback(async () => {
    try {
      const res = await fetch(`/api/stores/${storeId}/salon-board/stylists?show_hidden=true`);
      if (res.ok) {
        const data = await res.json();
        setStylists(data);
      }
    } catch (error) {
      console.error('Failed to fetch stylists:', error);
    }
  }, [storeId]);

  // 同期ログを取得
  const fetchSyncLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/stores/${storeId}/salon-board/sync-logs?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setSyncLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Failed to fetch sync logs:', error);
    }
  }, [storeId]);

  // 初期データ取得
  useEffect(() => {
    const fetchAll = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchCredentials(),
        fetchMenus(),
        fetchStylists(),
        fetchSyncLogs(),
      ]);
      setIsLoading(false);
    };
    fetchAll();
  }, [fetchCredentials, fetchMenus, fetchStylists, fetchSyncLogs]);

  // 認証情報を保存
  const handleSaveCredentials = async (input: SalonBoardCredentialsInput) => {
    const isNew = !credentials;
    const method = isNew ? 'POST' : 'PUT';

    const res = await fetch(`/api/stores/${storeId}/salon-board/credentials`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const error = await res.json();
      toast({
        title: 'エラー',
        description: error.error || '認証情報の保存に失敗しました',
        variant: 'destructive',
      });
      throw new Error(error.error);
    }

    const data = await res.json();
    setCredentials(data.credentials);
    toast({
      title: '保存完了',
      description: '認証情報を保存しました',
    });
  };

  // 接続テスト
  const handleTestConnection = async () => {
    const res = await fetch(`/api/stores/${storeId}/salon-board/test-connection`, {
      method: 'POST',
    });

    if (!res.ok) {
      const error = await res.json();
      toast({
        title: '接続テスト失敗',
        description: error.error || '接続テストに失敗しました',
        variant: 'destructive',
      });
      await fetchCredentials();
      return false;
    }

    const data = await res.json();
    await fetchCredentials();

    if (data.success) {
      toast({
        title: '接続成功',
        description: 'サロンボードへの接続に成功しました',
      });
    } else {
      toast({
        title: '接続失敗',
        description: data.error || '接続に失敗しました',
        variant: 'destructive',
      });
    }

    return data.success;
  };

  // 同期設定を更新
  const handleUpdateSyncSettings = async (
    settings: Partial<{
      sync_enabled: boolean;
      auto_sync_reservations: boolean;
      auto_sync_cancellations: boolean;
    }>
  ) => {
    const res = await fetch(`/api/stores/${storeId}/salon-board/credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });

    if (!res.ok) {
      const error = await res.json();
      toast({
        title: 'エラー',
        description: error.error || '設定の更新に失敗しました',
        variant: 'destructive',
      });
      throw new Error(error.error);
    }

    const data = await res.json();
    setCredentials(data.credentials);
    toast({
      title: '設定を更新しました',
    });
  };

  // メニュー同期（注: 実際のスクレイピングは別途実装が必要）
  const handleSyncMenus = async () => {
    setIsSyncingMenus(true);
    try {
      // 現時点では、外部からPOSTされたデータを保存するAPIのみ
      // 実際のスクレイピング処理は別途実装が必要
      toast({
        title: '同期機能',
        description: 'メニュー同期は外部サービスからのデータ連携で行われます',
      });
      await fetchMenus();
      await fetchSyncLogs();
    } finally {
      setIsSyncingMenus(false);
    }
  };

  // スタッフ同期
  const handleSyncStylists = async () => {
    setIsSyncingStylists(true);
    try {
      toast({
        title: '同期機能',
        description: 'スタッフ同期は外部サービスからのデータ連携で行われます',
      });
      await fetchStylists();
      await fetchSyncLogs();
    } finally {
      setIsSyncingStylists(false);
    }
  };

  // メニュー表示切替
  const handleToggleMenuVisibility = async (menuId: string, isHidden: boolean) => {
    const res = await fetch(`/api/stores/${storeId}/salon-board/menus`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_id: menuId, is_hidden: isHidden }),
    });

    if (!res.ok) {
      toast({
        title: 'エラー',
        description: '更新に失敗しました',
        variant: 'destructive',
      });
      return;
    }

    setMenus((prev) =>
      prev.map((m) => (m.id === menuId ? { ...m, is_hidden: isHidden } : m))
    );
  };

  // スタッフ表示切替
  const handleToggleStylistVisibility = async (stylistId: string, isHidden: boolean) => {
    const res = await fetch(`/api/stores/${storeId}/salon-board/stylists`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stylist_id: stylistId, is_hidden: isHidden }),
    });

    if (!res.ok) {
      toast({
        title: 'エラー',
        description: '更新に失敗しました',
        variant: 'destructive',
      });
      return;
    }

    setStylists((prev) =>
      prev.map((s) => (s.id === stylistId ? { ...s, is_hidden: isHidden } : s))
    );
  };

  // メニューの最終同期日時を取得
  const menuLastSyncedAt = menus.length > 0
    ? menus.reduce((latest, m) => {
        if (!m.last_synced_at) return latest;
        if (!latest) return m.last_synced_at;
        return new Date(m.last_synced_at) > new Date(latest) ? m.last_synced_at : latest;
      }, null as string | null)
    : null;

  // スタッフの最終同期日時を取得
  const stylistLastSyncedAt = stylists.length > 0
    ? stylists.reduce((latest, s) => {
        if (!s.last_synced_at) return latest;
        if (!latest) return s.last_synced_at;
        return new Date(s.last_synced_at) > new Date(latest) ? s.last_synced_at : latest;
      }, null as string | null)
    : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">サロンボード連携</h2>
        <p className="text-muted-foreground">
          ホットペッパー サロンボードとの連携設定を管理します
        </p>
      </div>

      <Tabs defaultValue="connection" className="space-y-4">
        <TabsList>
          <TabsTrigger value="connection">接続設定</TabsTrigger>
          <TabsTrigger value="menus">メニュー・クーポン</TabsTrigger>
          <TabsTrigger value="stylists">スタッフ</TabsTrigger>
          <TabsTrigger value="logs">同期履歴</TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="space-y-4">
          <ConnectionStatus
            credentials={credentials}
            onTestConnection={handleTestConnection}
            isLoading={isLoading}
          />
          <CredentialsForm
            storeId={storeId}
            credentials={credentials}
            onSave={handleSaveCredentials}
            isLoading={isLoading}
          />
          <SyncSettings
            credentials={credentials}
            onUpdate={handleUpdateSyncSettings}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="menus">
          <MenuList
            menus={menus}
            onSync={handleSyncMenus}
            onToggleVisibility={handleToggleMenuVisibility}
            lastSyncedAt={menuLastSyncedAt}
            isLoading={isLoading}
            isSyncing={isSyncingMenus}
          />
        </TabsContent>

        <TabsContent value="stylists">
          <StylistList
            stylists={stylists}
            onSync={handleSyncStylists}
            onToggleVisibility={handleToggleStylistVisibility}
            lastSyncedAt={stylistLastSyncedAt}
            isLoading={isLoading}
            isSyncing={isSyncingStylists}
          />
        </TabsContent>

        <TabsContent value="logs">
          <SyncLogList
            logs={syncLogs}
            onRefresh={fetchSyncLogs}
            isLoading={isLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
