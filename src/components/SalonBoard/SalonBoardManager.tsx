'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RefreshCw,
  Check,
  X,
  Eye,
  EyeOff,
  Loader2,
  Link as LinkIcon,
  Users,
  Menu as MenuIcon,
  Calendar,
  Settings,
  AlertCircle,
} from 'lucide-react';
import type { SalonBoardCredentials } from '@/types/salon-board';

interface SalonBoardManagerProps {
  storeId: string;
}

export default function SalonBoardManager({ storeId }: SalonBoardManagerProps) {
  const { toast } = useToast();

  // 認証情報
  const [credentials, setCredentials] = useState<SalonBoardCredentials | null>(null);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  // フォーム入力
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [hotpepperId, setHotpepperId] = useState('');
  const [salonBoardSalonId, setSalonBoardSalonId] = useState('');

  // 操作状態
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingMenus, setSyncingMenus] = useState(false);
  const [syncingStaff, setSyncingStaff] = useState(false);

  // 同期結果
  const [syncedMenus, setSyncedMenus] = useState<any[]>([]);
  const [syncedStaff, setSyncedStaff] = useState<any[]>([]);

  // 認証情報を取得
  useEffect(() => {
    fetchCredentials();
  }, [storeId]);

  const fetchCredentials = async () => {
    try {
      setLoadingCredentials(true);
      const res = await fetch(`/api/stores/${storeId}/salon-board/credentials`);
      if (res.ok) {
        const data = await res.json();
        setCredentials(data);
        if (data) {
          setHotpepperId(data.hotpepper_salon_id || '');
          setSalonBoardSalonId(data.salon_board_salon_id || '');
        }
      }
    } catch (error) {
      console.error('Failed to fetch credentials:', error);
    } finally {
      setLoadingCredentials(false);
    }
  };

  // 認証情報を保存
  const handleSaveCredentials = async () => {
    if (!loginId.trim() || !password.trim()) {
      toast({
        title: 'エラー',
        description: 'ログインIDとパスワードは必須です',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const method = credentials ? 'PUT' : 'POST';
      const res = await fetch(`/api/stores/${storeId}/salon-board/credentials`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login_id: loginId,
          password: password,
          hotpepper_salon_id: hotpepperId || null,
          salon_board_salon_id: salonBoardSalonId || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCredentials(data.credentials);
        setLoginId('');
        setPassword('');
        toast({
          title: '成功',
          description: '認証情報を保存しました',
        });
      } else {
        const error = await res.json();
        toast({
          title: 'エラー',
          description: error.error || '保存に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'エラー',
        description: '保存に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // 接続テスト
  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/salon-board/test-connection`, {
        method: 'POST',
      });

      const data = await res.json();

      if (data.success) {
        toast({
          title: '接続成功',
          description: `サロンボードに正常に接続できました (${data.duration_ms}ms)`,
        });
        // 認証情報を再取得して状態を更新
        fetchCredentials();
      } else {
        toast({
          title: '接続失敗',
          description: data.error || '接続に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'エラー',
        description: '接続テストに失敗しました',
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  // メニュー同期（スクレイピング）
  const handleSyncMenus = async () => {
    setSyncingMenus(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/salon-board/sync/menus`, {
        method: 'POST',
      });

      const data = await res.json();

      if (data.success) {
        setSyncedMenus(data.menus || []);
        toast({
          title: '同期成功',
          description: `${data.items_synced}件のメニューを取得しました`,
        });
      } else {
        toast({
          title: '同期失敗',
          description: data.error || 'メニュー同期に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'エラー',
        description: 'メニュー同期に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setSyncingMenus(false);
    }
  };

  // スタッフ同期（スクレイピング）
  const handleSyncStaff = async () => {
    setSyncingStaff(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/salon-board/sync/staff`, {
        method: 'POST',
      });

      const data = await res.json();

      if (data.success) {
        setSyncedStaff(data.stylists || []);
        toast({
          title: '同期成功',
          description: `${data.items_synced}件のスタッフを取得しました`,
        });
      } else {
        toast({
          title: '同期失敗',
          description: data.error || 'スタッフ同期に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'エラー',
        description: 'スタッフ同期に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setSyncingStaff(false);
    }
  };

  // 接続状態のバッジ
  const getConnectionBadge = () => {
    if (!credentials) {
      return <Badge variant="outline">未設定</Badge>;
    }

    switch (credentials.connection_status) {
      case 'connected':
        return <Badge className="bg-green-500">接続済み</Badge>;
      case 'failed':
        return <Badge variant="destructive">接続失敗</Badge>;
      case 'expired':
        return <Badge variant="secondary">期限切れ</Badge>;
      default:
        return <Badge variant="outline">未確認</Badge>;
    }
  };

  if (loadingCredentials) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">HPB管理</h2>
          <p className="text-muted-foreground">ホットペッパービューティー / サロンボード連携</p>
        </div>
        {getConnectionBadge()}
      </div>

      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-2" />
            設定
          </TabsTrigger>
          <TabsTrigger value="sync" disabled={!credentials || credentials.connection_status !== 'connected'}>
            <RefreshCw className="h-4 w-4 mr-2" />
            同期
          </TabsTrigger>
          <TabsTrigger value="data" disabled={syncedMenus.length === 0 && syncedStaff.length === 0}>
            <MenuIcon className="h-4 w-4 mr-2" />
            データ
          </TabsTrigger>
        </TabsList>

        {/* 設定タブ */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="h-5 w-5" />
                サロンボード認証情報
              </CardTitle>
              <CardDescription>
                サロンボードへのログイン情報を設定します。情報は暗号化して保存されます。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {credentials && (
                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">接続状態:</span>
                    {getConnectionBadge()}
                  </div>
                  {credentials.last_connection_test_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">最終テスト:</span>
                      <span className="text-sm">
                        {new Date(credentials.last_connection_test_at).toLocaleString('ja-JP')}
                      </span>
                    </div>
                  )}
                  {credentials.last_connection_error && (
                    <div className="flex items-start gap-2 mt-2 p-2 bg-destructive/10 rounded">
                      <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                      <span className="text-sm text-destructive">{credentials.last_connection_error}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="login_id">ログインID *</Label>
                  <Input
                    id="login_id"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    placeholder={credentials ? '（変更する場合のみ入力）' : 'ログインIDを入力'}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">パスワード *</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={credentials ? '（変更する場合のみ入力）' : 'パスワードを入力'}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hotpepper_id">ホットペッパーID</Label>
                  <Input
                    id="hotpepper_id"
                    value={hotpepperId}
                    onChange={(e) => setHotpepperId(e.target.value)}
                    placeholder="例: H000123456"
                  />
                  <p className="text-xs text-muted-foreground">
                    ホットペッパーの店舗ID（空き日程取得に使用）
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="salonboard_id">サロンボードサロンID</Label>
                  <Input
                    id="salonboard_id"
                    value={salonBoardSalonId}
                    onChange={(e) => setSalonBoardSalonId(e.target.value)}
                    placeholder="例: SB000123456"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button onClick={handleSaveCredentials} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {credentials ? '更新' : '保存'}
                </Button>
                {credentials && (
                  <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
                    {testing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    接続テスト
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 同期タブ */}
        <TabsContent value="sync" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MenuIcon className="h-5 w-5" />
                  メニュー同期
                </CardTitle>
                <CardDescription>
                  サロンボードからメニュー情報を取得します
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleSyncMenus}
                  disabled={syncingMenus}
                  className="w-full"
                >
                  {syncingMenus ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  メニューを同期
                </Button>
                {syncedMenus.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {syncedMenus.length}件のメニューを取得済み
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  スタッフ同期
                </CardTitle>
                <CardDescription>
                  サロンボードからスタッフ情報を取得します
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleSyncStaff}
                  disabled={syncingStaff}
                  className="w-full"
                >
                  {syncingStaff ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  スタッフを同期
                </Button>
                {syncedStaff.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {syncedStaff.length}件のスタッフを取得済み
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* データタブ */}
        <TabsContent value="data" className="space-y-4">
          {syncedMenus.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>取得したメニュー ({syncedMenus.length}件)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {syncedMenus.map((menu, index) => (
                    <div key={index} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{menu.title || menu.name}</span>
                        <span className="text-sm text-muted-foreground">{menu.price}</span>
                      </div>
                      {menu.description && (
                        <p className="text-sm text-muted-foreground mt-1">{menu.description}</p>
                      )}
                      {menu.treatment_time && (
                        <p className="text-xs text-muted-foreground mt-1">所要時間: {menu.treatment_time}分</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {syncedStaff.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>取得したスタッフ ({syncedStaff.length}件)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {syncedStaff.map((staff, index) => (
                    <div key={index} className="p-3 border rounded-lg flex items-center gap-3">
                      {staff.image_url ? (
                        <img
                          src={staff.image_url}
                          alt={staff.name}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <Users className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{staff.name}</div>
                        {staff.name_kana && (
                          <div className="text-xs text-muted-foreground">{staff.name_kana}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {syncedMenus.length === 0 && syncedStaff.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                まだデータを同期していません。「同期」タブからデータを取得してください。
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
