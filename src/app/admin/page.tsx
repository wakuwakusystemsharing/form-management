'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { getAppEnvironment } from '@/lib/env';
import type { Store } from '@/types/store';

const ADMIN_EMAILS = [
  'wakuwakusystemsharing@gmail.com',
  // 'admin@wakuwakusystemsharing.com',
  // 'manager@wakuwakusystemsharing.com'
];

export default function AdminPage() {
  const router = useRouter();
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

  // 新しいStore用の状態
  const [newStore, setNewStore] = useState({
    name: '',
    owner_name: '',
    owner_email: '',
    phone: '',
    address: '',
    description: '',
    website_url: ''
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

  // 認証チェック
  useEffect(() => {
    const env = getAppEnvironment();
    
    // ローカル環境でもSupabase接続を試みる（環境変数が設定されている場合）
    // 環境変数が設定されていない場合は認証をスキップ
    const supabase = getSupabaseClient();
    if (!supabase) {
      // ローカル環境でSupabase接続できない場合は認証をスキップ
      if (env === 'local') {
        const dummyUser = {
          id: 'local-dev-user',
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
      setLoading(false);
      return;
    }

    let isMounted = true;

    const initialize = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user ?? null;

        if (currentUser && !ADMIN_EMAILS.includes(currentUser.email || '')) {
          await supabase.auth.signOut();
          if (isMounted) {
            setUser(null);
          }
        } else {
          if (isMounted) {
            setUser(currentUser);
          }
          if (currentUser) {
            await loadStores();
          } else if (isMounted) {
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;

      if (nextUser && !ADMIN_EMAILS.includes(nextUser.email || '')) {
        supabase.auth.signOut();
        setUser(null);
      } else {
        setUser(nextUser);
        if (nextUser) {
          loadStores();
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadStores]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
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

    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password,
    });

    if (error) {
      setLoginError('メールアドレスまたはパスワードが正しくありません');
    }
    setIsLoggingIn(false);
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  useEffect(() => {
    if (user) {
      loadStores();
    }
  }, [user, loadStores]);

  // ローディング画面
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">読み込み中...</div>
      </div>
    );
  }

  // 未認証時のログイン画面
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
        <div className="max-w-md mx-auto px-4 py-16">
          <div className="bg-white rounded-lg shadow-lg p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">サービス管理者ログイン</h1>
              <p className="text-gray-600">LINE予約フォーム管理システム</p>
            </div>

            <form onSubmit={handleSignIn} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  メールアドレス
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={loginForm.email}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="wakuwakusystemsharing@gmail.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  パスワード
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {loginError && (
                <div className="text-red-600 text-sm text-center">{loginError}</div>
              )}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoggingIn ? 'ログイン中...' : 'ログイン'}
              </button>
            </form>

            <div className="mt-6 text-xs text-gray-500 text-center">
              <p>許可されたアカウントのみアクセス可能</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const resetNewStore = () => {
    setNewStore({
      name: '',
      owner_name: '',
      owner_email: '',
      phone: '',
      address: '',
      description: '',
      website_url: ''
    });
  };

  const handleCreateStore = async () => {
    if (!newStore.name || !newStore.owner_name || !newStore.owner_email) {
      alert('必須項目を入力してください（店舗名、オーナー名、メールアドレス）');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const env = getAppEnvironment();
      let token = '';

      // staging/production 環境では認証トークン取得
      if (env !== 'local' && supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token || '';
        
        if (!token) {
          alert('セッションが切れています。再ログインしてください。');
          setSubmitting(false);
          return;
        }
      }

      console.log('[Client] Sending POST to /api/stores');
      const response = await fetch('/api/stores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify(newStore),
      });

      console.log('[Client] Response:', response.status, response.url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '不明なエラー' }));
        console.error('[Client] Error response:', errorData);
        throw new Error(errorData.error || `店舗の追加に失敗しました (${response.status})`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '店舗の追加に失敗しました');
      }

      // 成功: 店舗リストを再読み込み
      await loadStores();
      resetNewStore();
      setShowAddStore(false);
      alert(`店舗「${result.store.name}」を作成しました`);
    } catch (error) {
      console.error('店舗追加エラー:', error);
      alert(error instanceof Error ? error.message : '店舗の追加に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStoreClick = (storeId: string) => {
    router.push(`/admin/${storeId}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* ヘッダー */}
        <div className="bg-gray-800 rounded-lg shadow-sm p-6 mb-6 border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-100 mb-2">
                サービス管理者ページ
              </h1>
              <p className="text-gray-400">
                店舗の管理を行います。店舗をクリックして詳細管理ページに移動できます。
              </p>
              <p className="text-gray-500 text-sm mt-1">
                ログイン中: {user?.email}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/admin/reservations')}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors font-medium"
              >
                全予約一覧
              </button>
              <button
                onClick={handleSignOut}
                className="bg-gray-700 text-gray-100 px-4 py-2 rounded-md hover:bg-gray-600 transition-colors font-medium border border-gray-500"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>

        {/* 店舗管理セクション */}
        <div className="bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-600">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-100">店舗管理</h2>
            <button 
              onClick={() => setShowAddStore(!showAddStore)}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors font-medium"
            >
              {showAddStore ? 'キャンセル' : '+ 新しい店舗を追加'}
            </button>
          </div>

          {/* 検索バー */}
          <div className="mb-6">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="店舗名、オーナー名、メールアドレスで検索..."
                className="w-full pl-10 pr-4 py-3 bg-gray-700 border border-gray-500 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-200"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {searchQuery && (
              <p className="mt-2 text-sm text-gray-400">
                {filteredStores.length}件の店舗が見つかりました
              </p>
            )}
          </div>

          {/* 店舗追加フォーム */}
          {showAddStore && (
            <div className="bg-gray-700 rounded-lg shadow-sm p-6 mb-6 border border-gray-500">
              <h3 className="text-lg font-semibold mb-4 text-gray-100">新しい店舗を追加</h3>
              <form 
                onSubmit={(e) => { 
                  e.preventDefault(); 
                  handleCreateStore(); 
                }}
              >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    店舗名 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                    value={newStore.name}
                    onChange={(e) => setNewStore({...newStore, name: e.target.value})}
                    placeholder="例：美容室B（大阪店）"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    オーナー名 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                    value={newStore.owner_name}
                    onChange={(e) => setNewStore({...newStore, owner_name: e.target.value})}
                    placeholder="例：佐藤花子"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    メールアドレス <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                    value={newStore.owner_email}
                    onChange={(e) => setNewStore({...newStore, owner_email: e.target.value})}
                    placeholder="例：sato@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    電話番号
                  </label>
                  <input
                    type="tel"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                    value={newStore.phone}
                    onChange={(e) => setNewStore({...newStore, phone: e.target.value})}
                    placeholder="例：06-1234-5678"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    住所
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                    value={newStore.address}
                    onChange={(e) => setNewStore({...newStore, address: e.target.value})}
                    placeholder="例：大阪府大阪市中央区1-2-3"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    ウェブサイトURL
                  </label>
                  <input
                    type="url"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                    value={newStore.website_url}
                    onChange={(e) => setNewStore({...newStore, website_url: e.target.value})}
                    placeholder="例：https://beauty-b.example.com"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    店舗説明
                  </label>
                  <textarea
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400 h-20"
                    value={newStore.description}
                    onChange={(e) => setNewStore({...newStore, description: e.target.value})}
                    placeholder="店舗の特徴やサービス内容を入力してください"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button 
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-700"
                >
                  {submitting ? '作成中...' : '店舗を作成'}
                </button>
                <button 
                  type="button"
                  onClick={() => setShowAddStore(false)}
                  className="px-6 py-2 bg-gray-600 text-gray-200 rounded-md hover:bg-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-700"
                >
                  キャンセル
                </button>
              </div>
              </form>
            </div>
          )}

          {/* 店舗一覧 */}
          <div className="space-y-4">
            {filteredStores.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                {searchQuery ? (
                  <>
                    「{searchQuery}」に一致する店舗が見つかりませんでした。
                    <button
                      onClick={() => setSearchQuery('')}
                      className="ml-2 text-cyan-400 hover:text-cyan-300 underline"
                    >
                      検索をクリア
                    </button>
                  </>
                ) : (
                  'まだ店舗が登録されていません。上のボタンから新しい店舗を追加してください。'
                )}
              </div>
            ) : (
              filteredStores.map(store => (
                <div 
                  key={store.id} 
                  onClick={() => handleStoreClick(store.id)}
                  className="bg-gray-700 rounded-lg shadow-sm p-6 cursor-pointer hover:bg-gray-600 transition-colors border border-gray-500"
                >
                  <div className="mb-4">
                    <h3 className="text-xl font-semibold text-gray-100 mb-2">
                      {store.name} 
                      <span className="text-sm text-gray-400 ml-2">({store.id})</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-300">
                      <p><span className="font-medium text-gray-200">オーナー:</span> {store.owner_name}</p>
                      <p><span className="font-medium text-gray-200">メール:</span> {store.owner_email}</p>
                      {store.phone && <p><span className="font-medium text-gray-200">電話:</span> {store.phone}</p>}
                      {store.address && <p><span className="font-medium text-gray-200">住所:</span> {store.address}</p>}
                    </div>
                    {store.website_url && (
                      <p className="text-sm text-gray-300 mt-2">
                        <span className="font-medium text-gray-200">サイト:</span> 
                        <a 
                          href={store.website_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-cyan-400 hover:text-cyan-300 hover:underline ml-1"
                        >
                          {store.website_url}
                        </a>
                      </p>
                    )}
                    {store.description && (
                      <p className="text-sm text-gray-300 mt-2">
                        <span className="font-medium text-gray-200">説明:</span> {store.description}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-3">
                      クリックして詳細管理ページへ
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
