'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { shouldSkipAuth } from '@/lib/env';
import type { Store } from '@/types/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { Search, Plus, LogOut, Store as StoreIcon, Users, Trash2, Shield } from 'lucide-react';

interface SystemAdmin {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  created_at: string;
  store_count: number;
}

export default function MasterAdminPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [systemAdmins, setSystemAdmins] = useState<SystemAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stores');

  // ログイン関連
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // システム管理者追加関連
  const [showAddSystemAdmin, setShowAddSystemAdmin] = useState(false);
  const [newSystemAdmin, setNewSystemAdmin] = useState({ email: '', name: '', password: '' });
  const [submitting, setSubmitting] = useState(false);

  // 検索
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [storesRes, adminsRes] = await Promise.all([
        fetch('/api/stores', { credentials: 'include' }),
        fetch('/api/master-admin/system-admins', { credentials: 'include' }),
      ]);

      if (storesRes.ok) {
        const data = await storesRes.json();
        setStores(data.stores || []);
      }
      if (adminsRes.ok) {
        const data = await adminsRes.json();
        setSystemAdmins(data.systemAdmins || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 認証チェック
  useEffect(() => {
    if (shouldSkipAuth()) {
      setUser({
        id: 'dev-user',
        email: 'dev@localhost',
        aud: 'authenticated',
        role: 'authenticated',
        created_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {}
      } as User);
      loadData();
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const initialize = async () => {
      try {
        // クッキーからセッション確認
        let currentUser: User | null = null;
        let session: any = null;

        try {
          const verifyResponse = await fetch('/api/auth/verify', {
            method: 'GET',
            credentials: 'include',
          });
          if (verifyResponse.ok) {
            const verifyData = await verifyResponse.json();
            if (verifyData.user && verifyData.accessToken) {
              currentUser = {
                id: verifyData.user.id,
                email: verifyData.user.email,
                aud: 'authenticated',
                role: 'authenticated',
                created_at: new Date().toISOString(),
                app_metadata: {},
                user_metadata: {}
              } as User;
              session = { access_token: verifyData.accessToken, user: currentUser };
            }
          }
        } catch {
          // fall through to localStorage
        }

        if (!session) {
          const { data: { session: localSession } } = await supabase.auth.getSession();
          session = localSession;
          currentUser = session?.user ?? null;
        }

        if (currentUser) {
          // マスター管理者かチェック
          const roleRes = await fetch('/api/auth/role', { credentials: 'include' });
          if (roleRes.ok) {
            const roleData = await roleRes.json();
            if (roleData.role !== 'master') {
              // マスター管理者でない場合はリダイレクト
              if (roleData.role === 'system') {
                router.push('/admin');
              } else {
                router.push('/');
              }
              return;
            }
          }

          if (isMounted) {
            setUser(currentUser);
          }
          if (session) {
            try {
              await fetch('/api/auth/set-cookie', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ accessToken: session.access_token }),
              });
            } catch {}
            await loadData();
          }
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initialize();

    return () => { isMounted = false; };
  }, [loadData, router]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (shouldSkipAuth()) return;

    setIsLoggingIn(true);
    setLoginError('');

    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoginError('認証システムに接続できません');
      setIsLoggingIn(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.email,
        password: loginForm.password,
      });

      if (error) {
        setLoginError('メールアドレスまたはパスワードが正しくありません');
        return;
      }

      if (data.session) {
        // ロールチェック
        await fetch('/api/auth/set-cookie', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accessToken: data.session.access_token }),
        });

        const roleRes = await fetch('/api/auth/role', { credentials: 'include' });
        if (roleRes.ok) {
          const roleData = await roleRes.json();
          if (roleData.role !== 'master') {
            setLoginError('マスター管理者権限がありません');
            await supabase.auth.signOut();
            return;
          }
        }

        setUser(data.user);
        loadData();
      }
    } catch {
      setLoginError('ログインに失敗しました');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    await fetch('/api/auth/set-cookie', {
      method: 'DELETE',
      credentials: 'include',
    });
    setUser(null);
    setStores([]);
    setSystemAdmins([]);
  };

  const handleAddSystemAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/master-admin/system-admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newSystemAdmin),
      });

      if (res.ok) {
        toast({ title: 'システム管理者を追加しました' });
        setShowAddSystemAdmin(false);
        setNewSystemAdmin({ email: '', name: '', password: '' });
        loadData();
      } else {
        const data = await res.json();
        toast({ title: 'エラー', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'エラー', description: '追加に失敗しました', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSystemAdmin = async (userId: string, email: string) => {
    if (!confirm(`${email} をシステム管理者から削除しますか？`)) return;

    try {
      const res = await fetch(`/api/master-admin/system-admins/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        toast({ title: 'システム管理者を削除しました' });
        loadData();
      } else {
        const data = await res.json();
        toast({ title: 'エラー', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'エラー', description: '削除に失敗しました', variant: 'destructive' });
    }
  };

  const filteredStores = stores.filter(store => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return store.name.toLowerCase().includes(q) ||
      store.owner_name.toLowerCase().includes(q) ||
      store.owner_email.toLowerCase().includes(q);
  });

  // ログイン画面
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Shield className="h-8 w-8 text-purple-600" />
            </div>
            <CardTitle className="text-2xl">マスター管理者ログイン</CardTitle>
            <CardDescription>マスター管理者アカウントでログインしてください</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  required
                />
              </div>
              {loginError && (
                <p className="text-sm text-red-600">{loginError}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? 'ログイン中...' : 'ログイン'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
          <p className="mt-2 text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-purple-600" />
            <h1 className="text-xl font-bold">マスター管理</h1>
            <Badge className="bg-purple-100 text-purple-700 border-purple-200">Master</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{user.email}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-1" />
              ログアウト
            </Button>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="stores">
              <StoreIcon className="h-4 w-4 mr-2" />
              全店舗 ({stores.length})
            </TabsTrigger>
            <TabsTrigger value="system-admins">
              <Users className="h-4 w-4 mr-2" />
              システム管理者 ({systemAdmins.length})
            </TabsTrigger>
          </TabsList>

          {/* 全店舗タブ */}
          <TabsContent value="stores">
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="店舗名、オーナー名、メールで検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredStores.map((store) => (
                <Card
                  key={store.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => router.push(`/admin/${store.id}`)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{store.name}</CardTitle>
                      <Badge variant="outline" className="text-xs font-mono">{store.id}</Badge>
                    </div>
                    <CardDescription>{store.owner_name} / {store.owner_email}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      作成日: {new Date(store.created_at).toLocaleDateString('ja-JP')}
                    </p>
                  </CardContent>
                </Card>
              ))}
              {filteredStores.length === 0 && (
                <p className="text-muted-foreground col-span-full text-center py-8">店舗が見つかりません</p>
              )}
            </div>
          </TabsContent>

          {/* システム管理者タブ */}
          <TabsContent value="system-admins">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">システム管理者一覧</h2>
              <Button onClick={() => setShowAddSystemAdmin(true)}>
                <Plus className="h-4 w-4 mr-2" />
                システム管理者を追加
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名前</TableHead>
                      <TableHead>メールアドレス</TableHead>
                      <TableHead className="text-right">店舗数</TableHead>
                      <TableHead>登録日</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {systemAdmins.map((admin) => (
                      <TableRow key={admin.id}>
                        <TableCell className="font-medium">{admin.name || '-'}</TableCell>
                        <TableCell>{admin.email}</TableCell>
                        <TableCell className="text-right tabular-nums">{admin.store_count}</TableCell>
                        <TableCell>{new Date(admin.created_at).toLocaleDateString('ja-JP')}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteSystemAdmin(admin.user_id, admin.email)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {systemAdmins.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          システム管理者がまだ登録されていません
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* システム管理者追加ダイアログ */}
      <Dialog open={showAddSystemAdmin} onOpenChange={setShowAddSystemAdmin}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>システム管理者を追加</DialogTitle>
            <DialogDescription>新しいシステム管理者のアカウント情報を入力してください</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddSystemAdmin} className="space-y-4">
            <div>
              <Label htmlFor="admin-email">メールアドレス *</Label>
              <Input
                id="admin-email"
                type="email"
                value={newSystemAdmin.email}
                onChange={(e) => setNewSystemAdmin({ ...newSystemAdmin, email: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="admin-name">名前</Label>
              <Input
                id="admin-name"
                value={newSystemAdmin.name}
                onChange={(e) => setNewSystemAdmin({ ...newSystemAdmin, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="admin-password">パスワード</Label>
              <Input
                id="admin-password"
                type="password"
                value={newSystemAdmin.password}
                onChange={(e) => setNewSystemAdmin({ ...newSystemAdmin, password: e.target.value })}
                placeholder="空欄の場合は自動生成"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddSystemAdmin(false)}>
                キャンセル
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? '追加中...' : '追加'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
