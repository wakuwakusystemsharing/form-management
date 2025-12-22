'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';

const ADMIN_EMAILS = [
  'wakuwakusystemsharing@gmail.com',
  'admin@wakuwakusystemsharing.com',
  'manager@wakuwakusystemsharing.com'
];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaStep, setMfaStep] = useState<'login' | 'mfa-challenge'>('login');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  // 既にログイン済みの場合はリダイレクト
  useEffect(() => {
    const env = getAppEnvironment();
    if (env === 'local') {
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && ADMIN_EMAILS.includes(session.user.email || '')) {
        // MFAレベルをチェック
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData?.currentLevel === 'aal2' || !aalData?.nextLevel) {
          router.push(redirect);
        }
      }
    };

    checkSession();
  }, [router, redirect]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const env = getAppEnvironment();
      
      // ローカル環境では認証をスキップ
      if (env === 'local') {
        router.push(redirect);
        return;
      }

      if (!ADMIN_EMAILS.includes(email)) {
        setError('このアカウントにはアクセス権限がありません');
        setLoading(false);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        setError('認証サービスに接続できません');
        setLoading(false);
        return;
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        console.error('Sign in error:', signInError);
        setError('メールアドレスまたはパスワードが正しくありません');
        setLoading(false);
        return;
      }

      // ログイン成功後、セッションを確認
      if (!signInData.session) {
        setError('セッションの取得に失敗しました');
        setLoading(false);
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
            setLoading(false);
            return;
          }
        }
      }

      // セッションからアクセストークンを取得してCookieに設定
      const accessToken = signInData.session.access_token;
      console.log('[Login] Access token received:', accessToken ? 'Yes' : 'No');
      
      if (accessToken) {
        try {
          console.log('[Login] Setting cookie...');
          const cookieResponse = await fetch('/api/auth/set-cookie', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ accessToken }),
          });

          console.log('[Login] Cookie response status:', cookieResponse.status);

          if (!cookieResponse.ok) {
            const errorText = await cookieResponse.text();
            console.error('[Login] Cookie設定に失敗:', cookieResponse.status, errorText);
            setError('Cookie設定に失敗しました。ページを再読み込みしてください。');
            setLoading(false);
            return;
          }
          
          const cookieData = await cookieResponse.json();
          console.log('[Login] Cookie設定成功:', cookieData);
          
          // Cookie設定成功後、少し待ってからリダイレクト
          // これにより、Cookieが確実に設定される
          await new Promise(resolve => setTimeout(resolve, 100));
          
          console.log('[Login] Redirecting to:', redirect);
          window.location.href = redirect;
        } catch (cookieError) {
          console.error('[Login] Cookie設定エラー:', cookieError);
          setError('Cookie設定に失敗しました。ページを再読み込みしてください。');
          setLoading(false);
          return;
        }
      } else {
        console.error('[Login] アクセストークンが見つかりません');
        setError('アクセストークンの取得に失敗しました');
        setLoading(false);
        return;
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleMFAVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!mfaFactorId) {
        setError('MFA設定が見つかりません');
        setLoading(false);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        setError('認証サービスに接続できません');
        setLoading(false);
        return;
      }

      // チャレンジ作成（TOTPの場合）
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });

      if (challengeError || !challengeData) {
        setError('MFAチャレンジの作成に失敗しました');
        setLoading(false);
        return;
      }

      // コード検証
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaCode,
      });

      if (verifyError) {
        setError('認証コードが正しくありません');
        setLoading(false);
        return;
      }

      // セッションをリフレッシュ
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError || !session) {
        setError('セッションの更新に失敗しました');
        setLoading(false);
        return;
      }
      
      // MFAレベルを再確認
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      
      // MFAが完了しているか確認
      if (!session.user || aalData?.currentLevel !== 'aal2') {
        setError('MFA認証が完了していません');
        setLoading(false);
        return;
      }
      
      // アクセストークンをCookieに設定
      const accessToken = session.access_token;
      if (accessToken) {
        try {
          const cookieResponse = await fetch('/api/auth/set-cookie', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ accessToken }),
          });

          if (!cookieResponse.ok) {
            const errorText = await cookieResponse.text();
            console.error('Cookie設定に失敗:', cookieResponse.status, errorText);
            setError('Cookie設定に失敗しました。ページを再読み込みしてください。');
            setLoading(false);
            return;
          }
          
          console.log('Cookie設定成功（MFA後）');
        } catch (cookieError) {
          console.error('Cookie設定エラー:', cookieError);
          setError('Cookie設定に失敗しました。ページを再読み込みしてください。');
          setLoading(false);
          return;
        }
      } else {
        setError('アクセストークンの取得に失敗しました');
        setLoading(false);
        return;
      }
      
      // Cookie設定完了後、フルページリロードでリダイレクト
      window.location.href = redirect;
    } catch (err) {
      console.error('MFA verify error:', err);
      setError('MFA認証に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // MFAチャレンジ画面
  if (mfaStep === 'mfa-challenge') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-8 text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">二要素認証</h1>
              <p className="text-blue-100">認証アプリのコードを入力してください</p>
            </div>

            <div className="p-8">
              <form onSubmit={handleMFAVerify} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    認証コード
                  </label>
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoFocus
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-2xl tracking-widest"
                  />
                  <p className="mt-2 text-xs text-gray-400 text-center">
                    Google Authenticator、1Password、Authyなどの認証アプリから6桁のコードを入力してください
                  </p>
                </div>

                {error && (
                  <div className="p-4 bg-red-900/50 border border-red-600 rounded-lg">
                    <p className="text-red-200 text-sm text-center">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || mfaCode.length !== 6}
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold py-3 px-4 rounded-lg hover:from-blue-700 hover:to-cyan-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {loading ? '認証中...' : '認証'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => {
                    setMfaStep('login');
                    setMfaCode('');
                    setError(null);
                  }}
                  className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                >
                  ← ログインに戻る
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 通常のログイン画面
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-8 text-center">
            <h1 className="text-3xl font-bold text-white mb-2">
              店舗管理者ログイン
            </h1>
            <p className="text-blue-100">
              予約フォーム管理システム
            </p>
          </div>

          {/* Login Form */}
          <div className="p-8">
            {error && (
              <div className="mb-6 p-4 bg-red-900/50 border border-red-600 rounded-lg">
                <p className="text-red-200 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="wakuwakusystemsharing@gmail.com"
                  required
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  パスワード
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold py-3 px-4 rounded-lg hover:from-blue-700 hover:to-cyan-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    ログイン中...
                  </span>
                ) : (
                  'ログイン'
                )}
              </button>
            </form>

            {/* Footer */}
            <div className="mt-6 pt-6 border-t border-gray-700">
              <p className="text-center text-sm text-gray-400">
                パスワードをお忘れの場合は、<br />
                サービス管理者にお問い合わせください
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-white text-lg">読み込み中...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
