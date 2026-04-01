'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { getAppEnvironment, isLocal, shouldSkipAuth } from '@/lib/env';
import type { Store } from '@/types/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import Image from 'next/image';
import { Search, Plus, LogOut, Store as StoreIcon, ExternalLink, Lock, Settings, Calendar, HelpCircle } from 'lucide-react';

const ADMIN_EMAILS = [
  'wakuwakusystemsharing@gmail.com',
  // 'admin@wakuwakusystemsharing.com',
  // 'manager@wakuwakusystemsharing.com'
];

export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [filteredStores, setFilteredStores] = useState<Store[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddStore, setShowAddStore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // パスワードリセット関連の状態
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [passwordResetForm, setPasswordResetForm] = useState({ password: '', confirmPassword: '' });
  const [passwordResetError, setPasswordResetError] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  // 新しいStore用の状態
  const [newStore, setNewStore] = useState({
    name: '',
    owner_name: '',
    owner_email: '',
    phone: '',
    address: '',
    description: '',
    website_url: '',
    line_channel_access_token: ''
  });

  const loadStores = useCallback(async () => {
    try {
      const response = await fetch('/api/stores');
      if (response.ok) {
        const data = await response.json();
        const loadedStores = data.stores || [];
        setStores(loadedStores);
        setFilteredStores(loadedStores);
      } else {
        console.error('Failed to load stores');
      }
    } catch (error) {
      console.error('Error loading stores:', error);
    } finally {
      setLoading(false);
    }
  }, []);


  // 検索クエリでフィルタリング
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredStores(stores);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = stores.filter(store => 
      store.name.toLowerCase().includes(query) ||
      store.owner_name.toLowerCase().includes(query) ||
      store.owner_email.toLowerCase().includes(query) ||
      (store.phone && store.phone.toLowerCase().includes(query)) ||
      (store.address && store.address.toLowerCase().includes(query))
    );
    setFilteredStores(filtered);
  }, [searchQuery, stores]);

  // URLパラメータからパスワードリセット情報を取得
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // ハッシュフラグメントからパラメータを取得
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    
    const error = params.get('error');
    const errorCode = params.get('error_code');
    const errorDescription = params.get('error_description');
    const accessToken = params.get('access_token');
    const type = params.get('type');
    
    // エラーがある場合
    if (error) {
      setPasswordResetError(
        errorDescription || 
        (errorCode === 'otp_expired' ? 'パスワードリセットリンクの有効期限が切れています。再度リセットをリクエストしてください。' : 
         error === 'access_denied' ? 'アクセスが拒否されました。' : 
         'パスワードリセットに失敗しました。')
      );
      // エラー表示後、ハッシュをクリア
      window.history.replaceState(null, '', '/admin');
    }
    
    // パスワードリセットトークンがある場合
    if (accessToken && type === 'recovery') {
      setResetToken(accessToken);
      setShowPasswordReset(true);
      // トークンをクリア
      window.history.replaceState(null, '', '/admin');
    }
  }, []);

  // 認証チェック
  useEffect(() => {
    // ローカル環境のみ認証をスキップ
    if (shouldSkipAuth()) {
        const dummyUser = {
        id: 'dev-user',
          email: 'dev@localhost',
          aud: 'authenticated',
          role: 'authenticated',
          created_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {}
        } as User;
        
        setUser(dummyUser);
        loadStores();
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
        // まず、クッキーからセッション情報を取得を試みる
        let session = null;
        let currentUser = null;
        
        try {
          const verifyResponse = await fetch('/api/auth/verify', {
            method: 'GET',
            credentials: 'include',
          });
          
          if (verifyResponse.ok) {
            const verifyData = await verifyResponse.json();
            // verifyエンドポイントはトークンがない場合も200を返す（user: null）
            if (verifyData.user && verifyData.accessToken) {
              // クッキーから取得したトークンでユーザー情報を取得
              // セッションとして扱うために、一時的なセッションオブジェクトを作成
              currentUser = {
                id: verifyData.user.id,
                email: verifyData.user.email,
                aud: 'authenticated',
                role: 'authenticated',
                created_at: new Date().toISOString(),
                app_metadata: {},
                user_metadata: {}
              } as User;
              
              // セッションオブジェクトも作成（アクセストークンを含む）
              session = {
                access_token: verifyData.accessToken,
                refresh_token: '',
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                token_type: 'bearer',
                user: currentUser
              } as any;
            }
            // verifyData.userがnullの場合は、localStorageからセッションを確認する
          }
        } catch (error) {
          console.log('Verify endpoint error, checking localStorage session:', error);
        }
        
        // クッキーからセッションが取得できなかった場合、localStorageから取得を試みる
        if (!session) {
          const { data: { session: localSession } } = await supabase.auth.getSession();
          session = localSession;
          currentUser = session?.user ?? null;
        }

        // サービス管理者でない場合、店舗管理者ページにリダイレクト（サインアウトしない）
        if (currentUser && !ADMIN_EMAILS.includes(currentUser.email || '')) {
          // 店舗管理者の場合、自分の店舗の管理者ページにリダイレクト
          const supabaseClient = getSupabaseClient();
          if (supabaseClient) {
            // ユーザーがアクセス権限を持つ店舗を取得
            const { data: storeAdmins } = await (supabaseClient as any)
              .from('store_admins')
              .select('store_id')
              .limit(1);

            if (storeAdmins && storeAdmins.length > 0) {
              const firstStoreId = (storeAdmins[0] as { store_id: string }).store_id;
              router.push(`/${firstStoreId}/admin`);
              return;
            }
          }

          // 店舗管理者として登録されていない場合のみサインアウト
          await supabase.auth.signOut();
          if (isMounted) {
            setUser(null);
            setLoginError('このアカウントにはアクセス権限がありません。');
          }
        } else {
          if (isMounted) {
            setUser(currentUser);
          }
          if (currentUser && session) {
            try {
              // クッキーにアクセストークンを設定（まだ設定されていない場合）
              await fetch('/api/auth/set-cookie', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ accessToken: session.access_token }),
              });
            } catch (error) {
              console.error('Failed to set cookie:', error);
            }
            await loadStores();
          } else if (isMounted) {
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const nextUser = session?.user ?? null;

      // サービス管理者でない場合、店舗管理者ページにリダイレクト（サインアウトしない）
      if (nextUser && !ADMIN_EMAILS.includes(nextUser.email || '')) {
        // 店舗管理者の場合、自分の店舗の管理者ページにリダイレクト
        const { data: storeAdmins } = await (supabase as any)
          .from('store_admins')
          .select('store_id')
          .limit(1);

        if (storeAdmins && storeAdmins.length > 0) {
          const firstStoreId = (storeAdmins[0] as { store_id: string }).store_id;
          router.push(`/${firstStoreId}/admin`);
          return;
        }

        // 店舗管理者として登録されていない場合のみサインアウト
        supabase.auth.signOut();
        setUser(null);
        setLoginError('このアカウントにはアクセス権限がありません。');
      } else {
        setUser(nextUser);
        if (nextUser && session) {
          try {
            await fetch('/api/auth/set-cookie', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify({ accessToken: session.access_token }),
            });
          } catch (error) {
            console.error('Failed to set cookie:', error);
          }
          loadStores();
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadStores, router]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // ローカル環境のみログイン処理をスキップ
    if (shouldSkipAuth()) {
      return;
    }
    
    setIsLoggingIn(true);
    setLoginError('');

    if (!ADMIN_EMAILS.includes(loginForm.email)) {
      setLoginError('このアカウントにはアクセス権限がありません');
      setIsLoggingIn(false);
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoginError('認証サービスに接続できません');
      setIsLoggingIn(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password,
    });

    if (error) {
      setLoginError('メールアドレスまたはパスワードが正しくありません');
      setIsLoggingIn(false);
      return;
    }

    if (data.session) {
      try {
        await fetch('/api/auth/set-cookie', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ accessToken: data.session.access_token }),
        });
      } catch (error) {
        console.error('Failed to set cookie:', error);
      }
    }
    
    setIsLoggingIn(false);
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
      document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  };

  // パスワードリセット処理
  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsResettingPassword(true);
    setPasswordResetError('');

    if (passwordResetForm.password !== passwordResetForm.confirmPassword) {
      setPasswordResetError('パスワードが一致しません');
      setIsResettingPassword(false);
      return;
    }

    if (passwordResetForm.password.length < 6) {
      setPasswordResetError('パスワードは6文字以上である必要があります');
      setIsResettingPassword(false);
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setPasswordResetError('認証サービスに接続できません');
      setIsResettingPassword(false);
      return;
    }

    try {
      // トークンを使ってセッションを確立
      if (resetToken) {
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: resetToken,
          refresh_token: '',
        });

        if (sessionError || !sessionData.session) {
          setPasswordResetError('セッションの確立に失敗しました。リンクが無効または期限切れです。');
          setIsResettingPassword(false);
          return;
        }
      }

      // パスワードを更新
      const { error: updateError } = await supabase.auth.updateUser({
        password: passwordResetForm.password,
      });

      if (updateError) {
        setPasswordResetError(updateError.message || 'パスワードの更新に失敗しました');
        setIsResettingPassword(false);
        return;
      }

      // 成功メッセージを表示
      toast({
        title: '成功',
        description: 'パスワードが正常に更新されました。ログインしてください。',
      });

      // フォームをリセット
      setPasswordResetForm({ password: '', confirmPassword: '' });
      setShowPasswordReset(false);
      setResetToken(null);
      
      // ログイン画面に戻る
      router.push('/admin');
    } catch (error) {
      console.error('Password reset error:', error);
      setPasswordResetError('パスワードの更新に失敗しました');
    } finally {
      setIsResettingPassword(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadStores();
    }
  }, [user, loadStores]);


  const resetNewStore = () => {
    setNewStore({
      name: '',
      owner_name: '',
      owner_email: '',
      phone: '',
      address: '',
      description: '',
      website_url: '',
      line_channel_access_token: ''
    });
  };

  const handleCreateStore = async () => {
    if (!newStore.name || !newStore.owner_name) {
      toast({
        title: 'エラー',
        description: '必須項目を入力してください（店舗名、オーナー名）',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const env = getAppEnvironment();
      let token = '';

      if (env !== 'local' && supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token || '';
        
        if (!token) {
          toast({
            title: 'エラー',
            description: 'セッションが切れています。再ログインしてください。',
            variant: 'destructive',
          });
          setSubmitting(false);
          return;
        }
      }

      const response = await fetch('/api/stores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify(newStore),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '不明なエラー' }));
        throw new Error(errorData.error || `店舗の追加に失敗しました (${response.status})`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '店舗の追加に失敗しました');
      }

      await loadStores();
      resetNewStore();
      setShowAddStore(false);
      toast({
        title: '成功',
        description: `店舗「${result.store.name}」を作成しました`,
      });
    } catch (error) {
      console.error('店舗追加エラー:', error);
      toast({
        title: 'エラー',
        description: error instanceof Error ? error.message : '店舗の追加に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStoreClick = (storeId: string) => {
    router.push(`/admin/${storeId}`);
  };

  // ローディング画面
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  // パスワードリセット画面
  if (showPasswordReset) {
    return (
      <div className="admin-page min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-border">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/20">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">パスワードリセット</CardTitle>
            <CardDescription>新しいパスワードを設定してください</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">新しいパスワード</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={6}
                  value={passwordResetForm.password}
                  onChange={(e) => setPasswordResetForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="6文字以上"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">パスワード（確認）</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={6}
                  value={passwordResetForm.confirmPassword}
                  onChange={(e) => setPasswordResetForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="パスワードを再入力"
                />
              </div>

              {passwordResetError && (
                <div className="text-sm text-destructive text-center">{passwordResetError}</div>
              )}

              <Button type="submit" className="w-full" disabled={isResettingPassword}>
                {isResettingPassword ? '更新中...' : 'パスワードを更新'}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setShowPasswordReset(false);
                  setResetToken(null);
                  setPasswordResetForm({ password: '', confirmPassword: '' });
                  setPasswordResetError('');
                }}
              >
                キャンセル
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 未認証時のログイン画面
  if (!user) {
    return (
      <div className="admin-page min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          {/* ブランドヘッダー */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-2">
              <Image src="/icon.png" alt="NAS ロゴ" width={64} height={64} priority />
            </div>
            <h1 className="text-2xl font-bold text-foreground">サービス管理者</h1>
            <p className="text-sm text-muted-foreground">NAS 管理コンソール</p>
          </div>
        <Card className="border-border">
          <CardHeader className="text-center">
            <CardTitle className="text-lg">ログイン</CardTitle>
            <CardDescription>許可されたアカウントのみアクセス可能</CardDescription>
          </CardHeader>
          <CardContent>
            {passwordResetError && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive text-center">{passwordResetError}</p>
              </div>
            )}
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={loginForm.email}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                  
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                />
              </div>

              {loginError && (
                <div className="text-sm text-destructive text-center">{loginError}</div>
              )}

              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? 'ログイン中...' : 'ログイン'}
              </Button>
            </form>

          </CardContent>
        </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page min-h-screen bg-background">
      {/* ── ナビゲーションバー ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/icon.png" alt="NAS ロゴ" width={28} height={28} />
            <span className="font-semibold text-foreground text-sm">NAS</span>
            <Badge className="bg-violet-600 hover:bg-violet-600 text-white border-0 text-xs px-2 py-0.5 cursor-default">
              サービス管理者
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden sm:block text-xs text-muted-foreground mr-2">{user?.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/admin/help')}
              className="text-muted-foreground hover:text-foreground text-xs h-8"
              title="セットアップガイド"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/admin/reservations')}
              className="text-muted-foreground hover:text-foreground text-xs h-8"
            >
              全予約一覧
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
              aria-label="ログアウト"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-6">
        {/* ── ページヘッダー ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">店舗一覧</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {stores.length > 0 ? `${stores.length} 店舗が登録されています` : '店舗を追加してください'}
            </p>
          </div>
          <Button
            onClick={() => setShowAddStore(!showAddStore)}
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
          >
            <Plus className="mr-2 h-4 w-4" />
            {showAddStore ? 'キャンセル' : '新しい店舗を追加'}
          </Button>
        </div>

        {/* ── 店舗追加フォーム ── */}
        {showAddStore && (
          <Card className="border-primary/30 bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold">新しい店舗を追加</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => { e.preventDefault(); handleCreateStore(); }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">店舗名 <span className="text-destructive">*</span></Label>
                    <Input id="name" type="text" value={newStore.name}
                      onChange={(e) => setNewStore({...newStore, name: e.target.value})}
                      placeholder="例：美容室B（大阪店）" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="owner_name">オーナー名 <span className="text-destructive">*</span></Label>
                    <Input id="owner_name" type="text" value={newStore.owner_name}
                      onChange={(e) => setNewStore({...newStore, owner_name: e.target.value})}
                      placeholder="例：佐藤花子" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="owner_email">メールアドレス</Label>
                    <Input id="owner_email" type="email" value={newStore.owner_email}
                      onChange={(e) => setNewStore({...newStore, owner_email: e.target.value})}
                      placeholder="例：sato@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">電話番号</Label>
                    <Input id="phone" type="tel" value={newStore.phone}
                      onChange={(e) => setNewStore({...newStore, phone: e.target.value})}
                      placeholder="例：06-1234-5678" />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="address">住所</Label>
                    <Input id="address" type="text" value={newStore.address}
                      onChange={(e) => setNewStore({...newStore, address: e.target.value})}
                      placeholder="例：大阪府大阪市中央区1-2-3" />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="website_url">ウェブサイトURL</Label>
                    <Input id="website_url" type="url" value={newStore.website_url}
                      onChange={(e) => setNewStore({...newStore, website_url: e.target.value})}
                      placeholder="例：https://beauty-b.example.com" />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="description">店舗説明</Label>
                    <textarea
                      id="description"
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={newStore.description}
                      onChange={(e) => setNewStore({...newStore, description: e.target.value})}
                      placeholder="店舗の特徴やサービス内容を入力してください" />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="line_channel_access_token">LINE チャネルアクセストークン（任意）</Label>
                    <Input id="line_channel_access_token" type="password"
                      value={newStore.line_channel_access_token}
                      onChange={(e) => setNewStore({...newStore, line_channel_access_token: e.target.value})}
                      placeholder="LINE Developers で取得したチャネルアクセストークン"
                      autoComplete="off" />
                    <p className="text-xs text-muted-foreground">Webhook・リマインドで使用します。後から追加可能です。</p>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={submitting} className="bg-primary hover:bg-primary/90">
                    {submitting ? '作成中...' : '店舗を作成'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowAddStore(false)}>
                    キャンセル
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── 検索バー ── */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="店舗名、オーナー名、メールアドレスで検索..."
            className="pl-10 bg-card border-border"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchQuery('')}
              aria-label="検索クリア"
            >
              ✕
            </Button>
          )}
        </div>
        {searchQuery && (
          <p className="text-sm text-muted-foreground -mt-2">
            {filteredStores.length} 件ヒット
          </p>
        )}

        {/* ── 店舗カードグリッド ── */}
        {filteredStores.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {searchQuery ? (
              <div className="space-y-2">
                <p>「{searchQuery}」に一致する店舗が見つかりませんでした</p>
                <Button variant="link" onClick={() => setSearchQuery('')} className="text-primary">
                  検索をクリア
                </Button>
              </div>
            ) : (
              <p>まだ店舗が登録されていません。上のボタンから追加してください。</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredStores.map(store => (
              <Card
                key={store.id}
                className="cursor-pointer border-border bg-card hover:border-primary/40 hover:bg-accent transition-all duration-200 group"
                onClick={() => handleStoreClick(store.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <StoreIcon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                          {store.name}
                        </CardTitle>
                        <CardDescription className="text-xs font-mono mt-0.5">ID: {store.id}</CardDescription>
                      </div>
                    </div>
                    {store.google_calendar_id && (
                      <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0" title="カレンダー連携済み">
                        <Calendar className="h-3 w-3 text-green-500" />
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-2">
                      <span className="text-muted-foreground text-xs w-14 shrink-0">オーナー</span>
                      <span className="text-foreground text-xs truncate">{store.owner_name}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground text-xs w-14 shrink-0">メール</span>
                      <span className="text-foreground text-xs truncate">{store.owner_email}</span>
                    </div>
                    {store.phone && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground text-xs w-14 shrink-0">電話</span>
                        <span className="text-foreground text-xs">{store.phone}</span>
                      </div>
                    )}
                    {store.address && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground text-xs w-14 shrink-0">住所</span>
                        <span className="text-foreground text-xs truncate">{store.address}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); router.push(`/admin/${store.id}`); }}
                      className="flex-1 h-7 text-xs border-border hover:border-primary/50 hover:bg-primary hover:text-primary-foreground"
                    >
                      <Settings className="mr-1 h-3 w-3" />
                      管理
                    </Button>
                    {store.google_calendar_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); window.open(`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(store.google_calendar_id ?? '')}`, '_blank'); }}
                        className="flex-1 h-7 text-xs border-border hover:border-primary/50 hover:bg-primary hover:text-primary-foreground"
                      >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        カレンダー
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); router.push(`/${store.id}/admin`); }}
                      className="flex-1 h-7 text-xs border-border hover:border-green-600 hover:bg-green-600 hover:text-white"
                    >
                      <StoreIcon className="mr-1 h-3 w-3" />
                      店舗管理者
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
