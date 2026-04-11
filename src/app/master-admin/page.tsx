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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Search, Plus, LogOut, Store as StoreIcon, Building2, Trash2, Shield, Users, ChevronLeft, Copy, ExternalLink } from 'lucide-react';

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  admin_count: number;
  store_count: number;
}

interface SystemAdmin {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export default function MasterAdminPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stores');

  // ログイン関連
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // テナント作成
  const [showAddOrg, setShowAddOrg] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: '', slug: '' });
  const [submitting, setSubmitting] = useState(false);

  // テナント詳細（管理者管理）
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [orgAdmins, setOrgAdmins] = useState<SystemAdmin[]>([]);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ email: '', name: '', password: '' });

  // フィルター
  const [searchQuery, setSearchQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState('all');

  const loadData = useCallback(async () => {
    try {
      const [storesRes, orgsRes] = await Promise.all([
        fetch('/api/stores', { credentials: 'include' }),
        fetch('/api/master-admin/organizations', { credentials: 'include' }),
      ]);

      if (storesRes.ok) {
        const data = await storesRes.json();
        setStores(data.stores || []);
      }
      if (orgsRes.ok) {
        const data = await orgsRes.json();
        setOrganizations(data.organizations || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrgAdmins = async (orgId: string) => {
    const res = await fetch(`/api/master-admin/organizations/${orgId}/admins`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      setOrgAdmins(data.admins || []);
    }
  };

  // 認証チェック
  useEffect(() => {
    if (shouldSkipAuth()) {
      setUser({
        id: 'dev-user', email: 'dev@localhost', aud: 'authenticated',
        role: 'authenticated', created_at: new Date().toISOString(),
        app_metadata: {}, user_metadata: {}
      } as User);
      loadData();
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) { setLoading(false); return; }

    let isMounted = true;

    const initialize = async () => {
      try {
        let currentUser: User | null = null;
        let session: any = null;

        try {
          const verifyResponse = await fetch('/api/auth/verify', { method: 'GET', credentials: 'include' });
          if (verifyResponse.ok) {
            const verifyData = await verifyResponse.json();
            if (verifyData.user && verifyData.accessToken) {
              currentUser = {
                id: verifyData.user.id, email: verifyData.user.email,
                aud: 'authenticated', role: 'authenticated',
                created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}
              } as User;
              session = { access_token: verifyData.accessToken, user: currentUser };
            }
          }
        } catch {}

        if (!session) {
          const { data: { session: localSession } } = await supabase.auth.getSession();
          session = localSession;
          currentUser = session?.user ?? null;
        }

        if (currentUser) {
          const roleRes = await fetch('/api/auth/role', { credentials: 'include' });
          if (roleRes.ok) {
            const roleData = await roleRes.json();
            if (roleData.role !== 'master') {
              if (roleData.role === 'system' && roleData.orgSlug) {
                router.push(`/tenant/${roleData.orgSlug}/admin`);
              } else {
                router.push('/');
              }
              return;
            }
          }

          if (isMounted) setUser(currentUser);
          if (session) {
            try {
              await fetch('/api/auth/set-cookie', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'include', body: JSON.stringify({ accessToken: session.access_token }),
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
    if (!supabase) { setLoginError('認証システムに接続できません'); setIsLoggingIn(false); return; }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginForm.email, password: loginForm.password });
      if (error) { setLoginError('メールアドレスまたはパスワードが正しくありません'); return; }

      if (data.session) {
        await fetch('/api/auth/set-cookie', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify({ accessToken: data.session.access_token }),
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
    } catch { setLoginError('ログインに失敗しました'); } finally { setIsLoggingIn(false); }
  };

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    await fetch('/api/auth/set-cookie', { method: 'DELETE', credentials: 'include' });
    setUser(null);
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/master-admin/organizations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(newOrg),
      });
      if (res.ok) {
        toast({ title: 'テナントを作成しました' });
        setShowAddOrg(false);
        setNewOrg({ name: '', slug: '' });
        loadData();
      } else {
        const data = await res.json();
        toast({ title: 'エラー', description: data.error, variant: 'destructive' });
      }
    } catch { toast({ title: 'エラー', description: '作成に失敗しました', variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  const handleDeleteOrg = async (orgId: string, orgName: string) => {
    if (!confirm(`テナント「${orgName}」を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/master-admin/organizations/${orgId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        toast({ title: 'テナントを削除しました' });
        loadData();
      } else {
        const data = await res.json();
        toast({ title: 'エラー', description: data.error, variant: 'destructive' });
      }
    } catch { toast({ title: 'エラー', description: '削除に失敗しました', variant: 'destructive' }); }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/master-admin/organizations/${selectedOrg.id}/admins`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(newAdmin),
      });
      if (res.ok) {
        toast({ title: '管理者を追加しました' });
        setShowAddAdmin(false);
        setNewAdmin({ email: '', name: '', password: '' });
        loadOrgAdmins(selectedOrg.id);
        loadData();
      } else {
        const data = await res.json();
        toast({ title: 'エラー', description: data.error, variant: 'destructive' });
      }
    } catch { toast({ title: 'エラー', description: '追加に失敗しました', variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  const handleDeleteAdmin = async (userId: string, email: string) => {
    if (!selectedOrg || !confirm(`${email} をこのテナントから削除しますか？`)) return;
    try {
      const res = await fetch(`/api/master-admin/organizations/${selectedOrg.id}/admins/${userId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        toast({ title: '管理者を削除しました' });
        loadOrgAdmins(selectedOrg.id);
        loadData();
      } else {
        const data = await res.json();
        toast({ title: 'エラー', description: data.error, variant: 'destructive' });
      }
    } catch { toast({ title: 'エラー', description: '削除に失敗しました', variant: 'destructive' }); }
  };

  // フィルタリング
  const filteredStores = stores.filter(store => {
    const matchesSearch = !searchQuery.trim() || [store.name, store.owner_name, store.owner_email]
      .some(f => f?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesOrg = orgFilter === 'all' || (store as any).org_id === orgFilter;
    return matchesSearch && matchesOrg;
  });

  // 認証チェック中はローディング表示（ログインフォームのフラッシュ防止）
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

  // ログイン画面（認証チェック完了後、未ログインの場合のみ表示）
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Shield className="h-8 w-8 text-purple-600 mx-auto mb-2" />
            <CardTitle className="text-2xl">マスター管理者ログイン</CardTitle>
            <CardDescription>マスター管理者アカウントでログインしてください</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <Label htmlFor="email">メールアドレス</Label>
                <Input id="email" type="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="password">パスワード</Label>
                <Input id="password" type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required />
              </div>
              {loginError && <p className="text-sm text-red-600">{loginError}</p>}
              <Button type="submit" className="w-full" disabled={isLoggingIn}>{isLoggingIn ? 'ログイン中...' : 'ログイン'}</Button>
            </form>
          </CardContent>
        </Card>
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
              <LogOut className="h-4 w-4 mr-1" />ログアウト
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="stores"><StoreIcon className="h-4 w-4 mr-2" />全店舗 ({stores.length})</TabsTrigger>
            <TabsTrigger value="tenants"><Building2 className="h-4 w-4 mr-2" />テナント管理 ({organizations.length})</TabsTrigger>
          </TabsList>

          {/* 全店舗タブ */}
          <TabsContent value="stores">
            <div className="flex gap-4 mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="店舗名、オーナー名で検索..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
              </div>
              <Select value={orgFilter} onValueChange={setOrgFilter}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="テナントで絞り込み" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべてのテナント</SelectItem>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>{org.name} ({org.store_count}店舗)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredStores.map((store) => {
                const org = organizations.find(o => o.id === (store as any).org_id);
                return (
                  <Card key={store.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push(`/tenant/${org?.slug || 'default'}/admin/${store.id}`)}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{store.name}</CardTitle>
                        <Badge variant="outline" className="text-xs font-mono">{store.id}</Badge>
                      </div>
                      <CardDescription>{store.owner_name}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        {org && <Badge variant="secondary" className="text-xs">{org.name}</Badge>}
                        <span className="text-xs text-muted-foreground">{new Date(store.created_at).toLocaleDateString('ja-JP')}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {filteredStores.length === 0 && (
                <p className="text-muted-foreground col-span-full text-center py-8">店舗が見つかりません</p>
              )}
            </div>
          </TabsContent>

          {/* テナント管理タブ */}
          <TabsContent value="tenants">
            {selectedOrg ? (
              /* テナント詳細: 管理者一覧 */
              <div>
                <Button variant="ghost" size="sm" onClick={() => { setSelectedOrg(null); setOrgAdmins([]); }} className="mb-4">
                  <ChevronLeft className="h-4 w-4 mr-1" />テナント一覧に戻る
                </Button>

                <Card className="mb-6">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>{selectedOrg.name}</CardTitle>
                        <CardDescription>{selectedOrg.store_count}店舗</CardDescription>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-muted-foreground">ログインURL:</span>
                          <code className="text-xs bg-muted px-2 py-1 rounded">/tenant/{selectedOrg.slug}/admin</code>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/tenant/${selectedOrg.slug}/admin`);
                            toast({ title: 'URLをコピーしました' });
                          }}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => window.open(`/tenant/${selectedOrg.slug}/admin`, '_blank')}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Button onClick={() => setShowAddAdmin(true)}>
                        <Plus className="h-4 w-4 mr-2" />管理者を追加
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>名前</TableHead>
                          <TableHead>メールアドレス</TableHead>
                          <TableHead>登録日</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orgAdmins.map((admin) => (
                          <TableRow key={admin.id}>
                            <TableCell className="font-medium">{admin.name || '-'}</TableCell>
                            <TableCell>{admin.email}</TableCell>
                            <TableCell>{new Date(admin.created_at).toLocaleDateString('ja-JP')}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteAdmin(admin.user_id, admin.email)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {orgAdmins.length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">管理者がまだ登録されていません</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            ) : (
              /* テナント一覧 */
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">テナント一覧</h2>
                  <Button onClick={() => setShowAddOrg(true)}>
                    <Plus className="h-4 w-4 mr-2" />テナントを作成
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {organizations.map((org) => (
                    <Card key={org.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setSelectedOrg(org); loadOrgAdmins(org.id); }}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{org.name}</CardTitle>
                          <Badge variant="outline" className="text-xs font-mono">{org.slug}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{org.admin_count}名</span>
                          <span className="flex items-center gap-1"><StoreIcon className="h-3.5 w-3.5" />{org.store_count}店舗</span>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">/tenant/{org.slug}/admin</code>
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(`${window.location.origin}/tenant/${org.slug}/admin`);
                            toast({ title: 'URLをコピーしました' });
                          }}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => {
                            e.stopPropagation();
                            window.open(`/tenant/${org.slug}/admin`, '_blank');
                          }}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-xs text-muted-foreground">{new Date(org.created_at).toLocaleDateString('ja-JP')}</span>
                          <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                            onClick={(e) => { e.stopPropagation(); handleDeleteOrg(org.id, org.name); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {organizations.length === 0 && (
                    <p className="text-muted-foreground col-span-full text-center py-8">テナントがまだ作成されていません</p>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* テナント作成ダイアログ */}
      <Dialog open={showAddOrg} onOpenChange={setShowAddOrg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>テナントを作成</DialogTitle>
            <DialogDescription>新しいテナント（組織）を作成します</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOrg} className="space-y-4">
            <div>
              <Label htmlFor="org-name">テナント名 *</Label>
              <Input id="org-name" value={newOrg.name} onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })} placeholder="例: 代理店A" required />
            </div>
            <div>
              <Label htmlFor="org-slug">スラッグ（URL用） *</Label>
              <Input id="org-slug" value={newOrg.slug} onChange={(e) => setNewOrg({ ...newOrg, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                placeholder="例: agency-a" required />
              <p className="text-xs text-muted-foreground mt-1">URLに使用: /tenant/{newOrg.slug || 'xxx'}/admin</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddOrg(false)}>キャンセル</Button>
              <Button type="submit" disabled={submitting}>{submitting ? '作成中...' : '作成'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 管理者追加ダイアログ */}
      <Dialog open={showAddAdmin} onOpenChange={setShowAddAdmin}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>管理者を追加</DialogTitle>
            <DialogDescription>{selectedOrg?.name} にシステム管理者を追加します</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAdmin} className="space-y-4">
            <div>
              <Label htmlFor="admin-email">メールアドレス *</Label>
              <Input id="admin-email" type="email" value={newAdmin.email} onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="admin-name">名前</Label>
              <Input id="admin-name" value={newAdmin.name} onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="admin-password">パスワード</Label>
              <Input id="admin-password" type="password" value={newAdmin.password} onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} placeholder="空欄の場合は自動生成" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddAdmin(false)}>キャンセル</Button>
              <Button type="submit" disabled={submitting}>{submitting ? '追加中...' : '追加'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
