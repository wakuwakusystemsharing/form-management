'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { getAppEnvironment } from '@/lib/env';
import type { Store } from '@/types/store';
import MFASettings from '@/components/MFASettings';

const ADMIN_EMAILS = [
  'wakuwakusystemsharing@gmail.com',
  // 'admin@wakuwakusystemsharing.com',
  // 'manager@wakuwakusystemsharing.com'
];

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddStore, setShowAddStore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mfaStep, setMfaStep] = useState<'login' | 'mfa-challenge'>('login');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [showMFASettings, setShowMFASettings] = useState(false);

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
        setStores(data.stores || []);
      } else {
        console.error('Failed to load stores');
      }
    } catch (error) {
      console.error('Error loading stores:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 認証チェック
  useEffect(() => {
    const env = getAppEnvironment();
    
    // ローカル環境では認証をスキップ
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

    const supabase = getSupabaseClient();
    if (!supabase) {
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
            setMfaStep('login');
            setLoading(false);
          }
          return;
        }

        if (currentUser) {
          // MFAレベルをチェック
          const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          
          if (aalData?.currentLevel === 'aal1' && aalData.nextLevel === 'aal2') {
            // MFAが必要だが完了していない場合
            const { data: factorsData } = await supabase.auth.mfa.listFactors();
            if (factorsData?.totp && factorsData.totp.length > 0) {
              if (isMounted) {
                setMfaFactorId(factorsData.totp[0].id);
                setMfaStep('mfa-challenge');
                setUser(null); // MFA完了までユーザーをnullに
                setLoading(false);
              }
              return;
            }
          }

          // MFAが完了しているか不要な場合
          if (isMounted) {
            setUser(currentUser);
            setMfaStep('login');
            await loadStores();
            setLoading(false);
          }
        } else if (isMounted) {
          setUser(null);
          setMfaStep('login');
          setLoading(false);
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
        if (isMounted) {
          setUser(null);
          setMfaStep('login');
          setLoading(false);
        }
      }
    };

    initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const nextUser = session?.user ?? null;

      if (nextUser && !ADMIN_EMAILS.includes(nextUser.email || '')) {
        supabase.auth.signOut();
        setUser(null);
        setMfaStep('login');
        return;
      }

      if (nextUser) {
        // MFAレベルをチェック
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        
        if (aalData?.currentLevel === 'aal1' && aalData.nextLevel === 'aal2') {
          // MFAが必要だが完了していない場合
          const { data: factorsData } = await supabase.auth.mfa.listFactors();
          if (factorsData?.totp && factorsData.totp.length > 0) {
            setMfaFactorId(factorsData.totp[0].id);
            setMfaStep('mfa-challenge');
            setUser(null); // MFA完了までユーザーをnullに
            return;
          }
        }

        // MFAが完了しているか不要な場合
        setUser(nextUser);
        setMfaStep('login');
        loadStores();
      } else {
        setUser(null);
        setMfaStep('login');
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

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password,
    });

    if (error) {
      setLoginError('メールアドレスまたはパスワードが正しくありません');
      setIsLoggingIn(false);
      return;
    }

    // MFAが必要かチェック
    const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    
    if (!aalError && aalData) {
      if (aalData.currentLevel === 'aal1' && aalData.nextLevel === 'aal2') {
        // MFAが必要 - TOTPのみチェック
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        
        // TOTPベースのMFAのみ
        if (factorsData?.totp && factorsData.totp.length > 0) {
          setMfaFactorId(factorsData.totp[0].id);
          setMfaStep('mfa-challenge');
          setIsLoggingIn(false);
          return;
        }
      }
    }

    setIsLoggingIn(false);
  };

  const handleMFAVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      if (!mfaFactorId) {
        setLoginError('MFA設定が見つかりません');
        setIsLoggingIn(false);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoginError('認証サービスに接続できません');
        setIsLoggingIn(false);
        return;
      }

      // チャレンジ作成（TOTPの場合）
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });

      if (challengeError || !challengeData) {
        setLoginError('MFAチャレンジの作成に失敗しました');
        setIsLoggingIn(false);
        return;
      }

      // コード検証
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaCode,
      });

      if (verifyError) {
        setLoginError('認証コードが正しくありません');
        setIsLoggingIn(false);
        return;
      }

      // セッションをリフレッシュ
      const { data: { session } } = await supabase.auth.refreshSession();
      
      // MFAレベルを再確認
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      
      // MFAが完了している場合のみユーザーを設定
      if (session?.user && aalData?.currentLevel === 'aal2') {
        setUser(session.user);
        setMfaStep('login');
        setMfaCode('');
        setMfaFactorId(null);
      } else {
        setLoginError('MFA認証が完了していません');
      }
    } catch (err) {
      console.error('MFA verify error:', err);
      setLoginError('MFA認証に失敗しました');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
      setUser(null);
      setMfaStep('login');
      setMfaCode('');
      setMfaFactorId(null);
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
    // MFAチャレンジ画面
    if (mfaStep === 'mfa-challenge') {
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
                <h1 className="text-2xl font-bold text-gray-900 mb-2">二要素認証</h1>
                <p className="text-gray-600">認証アプリのコードを入力してください</p>
              </div>

              <form onSubmit={handleMFAVerify} className="space-y-6">
                <div>
                  <label htmlFor="mfaCode" className="block text-sm font-medium text-gray-700 mb-2">
                    認証コード
                  </label>
                  <input
                    id="mfaCode"
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoFocus
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-2xl tracking-widest"
                  />
                  <p className="mt-2 text-xs text-gray-500 text-center">
                    Google Authenticator、1Password、Authyなどの認証アプリから6桁のコードを入力してください
                  </p>
                </div>

                {loginError && (
                  <div className="text-red-600 text-sm text-center">{loginError}</div>
                )}

                <button
                  type="submit"
                  disabled={isLoggingIn || mfaCode.length !== 6}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoggingIn ? '認証中...' : '認証'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => {
                    setMfaStep('login');
                    setMfaCode('');
                    setLoginError('');
                  }}
                  className="text-blue-600 hover:text-blue-700 text-sm transition-colors"
                >
                  ← ログインに戻る
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // 通常のログイン画面
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
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Need Appointment System</h1>
              <p className="text-gray-600">店舗運営にとって「Need（必要不可欠）」な予約システム</p>
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
      {/* MFA設定モーダル */}
      {showMFASettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <MFASettings onClose={() => setShowMFASettings(false)} />
          </div>
        </div>
      )}

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
                onClick={() => setShowMFASettings(true)}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors font-medium"
              >
                MFA設定
              </button>
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
          <h2 className="text-xl font-semibold text-gray-100 mb-4">店舗管理</h2>
          
          <button 
            onClick={() => setShowAddStore(!showAddStore)}
            className="mb-6 px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors font-medium"
          >
            {showAddStore ? 'キャンセル' : '+ 新しい店舗を追加'}
          </button>

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
            {stores.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                まだ店舗が登録されていません。上のボタンから新しい店舗を追加してください。
              </div>
            ) : (
              stores.map(store => (
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
