'use client';

import { useState, useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';

interface MFAFactor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  phone?: string;
}

interface MFASettingsProps {
  onClose?: () => void;
}

export default function MFASettings({ onClose }: MFASettingsProps) {
  const [factors, setFactors] = useState<MFAFactor[]>([]);
  const [hasMFA, setHasMFA] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollType, setEnrollType] = useState<'totp' | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [secret, setSecret] = useState<string | null>(null);

  const loadMFASettings = async () => {
    try {
      const env = getAppEnvironment();
      if (env === 'local') {
        setLoading(false);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        setError('認証サービスに接続できません');
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('セッションが切れています。再ログインしてください。');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/auth/mfa', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error('MFA設定の取得に失敗しました');
      }

      const data = await response.json();
      const allFactors = data.factors?.totp || [];
      setFactors(allFactors);
      setHasMFA(data.factors?.totp && data.factors.totp.length > 0);
    } catch (err) {
      console.error('MFA設定取得エラー:', err);
      setError(err instanceof Error ? err.message : 'MFA設定の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMFASettings();
  }, []);

  const handleEnroll = async () => {
    setError(null);
    setEnrolling(true);
    setEnrollType('totp');

    try {
      const env = getAppEnvironment();
      if (env === 'local') {
        setError('ローカル環境ではMFAを有効化できません');
        setEnrolling(false);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        setError('認証サービスに接続できません');
        setEnrolling(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('セッションが切れています。再ログインしてください。');
        setEnrolling(false);
        return;
      }

      const response = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          factorType: 'totp',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'MFAの有効化に失敗しました');
      }

      const data = await response.json();
      setFactorId(data.factorId);
      setQrCode(data.qrCode);
      setSecret(data.secret);
    } catch (err) {
      console.error('MFA有効化エラー:', err);
      setError(err instanceof Error ? err.message : 'MFAの有効化に失敗しました');
    } finally {
      setEnrolling(false);
    }
  };

  const handleVerify = async () => {
    if (!factorId || !verifyCode) {
      setError('認証コードを入力してください');
      return;
    }

    setError(null);
    setVerifying(true);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError('認証サービスに接続できません');
        setVerifying(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('セッションが切れています。再ログインしてください。');
        setVerifying(false);
        return;
      }

      const response = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          factorId,
          code: verifyCode,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '認証コードが正しくありません');
      }

      // 成功: 設定を再読み込み
      setQrCode(null);
      setFactorId(null);
      setSecret(null);
      setVerifyCode('');
      setEnrollType(null);
      await loadMFASettings();
    } catch (err) {
      console.error('MFA検証エラー:', err);
      setError(err instanceof Error ? err.message : 'MFA検証に失敗しました');
    } finally {
      setVerifying(false);
    }
  };


  const handleUnenroll = async (targetFactorId: string) => {
    if (!confirm('MFAを無効化してもよろしいですか？')) {
      return;
    }

    setError(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError('認証サービスに接続できません');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('セッションが切れています。再ログインしてください。');
        return;
      }

      const response = await fetch(`/api/auth/mfa?factorId=${targetFactorId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'MFAの無効化に失敗しました');
      }

      // 成功: 設定を再読み込み
      await loadMFASettings();
    } catch (err) {
      console.error('MFA無効化エラー:', err);
      setError(err instanceof Error ? err.message : 'MFAの無効化に失敗しました');
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-800 rounded-lg border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-100">二要素認証（MFA）設定</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/50 border border-red-600 rounded-lg">
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}

      {/* MFA有効化中（QRコード表示） */}
      {enrollType && factorId && (
        <div className="mb-6 p-4 bg-gray-700 rounded-lg border border-gray-600">
          <h3 className="text-lg font-medium text-gray-100 mb-4">認証アプリでQRコードをスキャン</h3>
          
          <div className="flex flex-col items-center mb-4">
            {qrCode && (
              <div 
                className="bg-white p-4 rounded-lg mb-4"
                dangerouslySetInnerHTML={{ __html: qrCode }}
              />
            )}
            {secret && (
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-2">QRコードが読み取れない場合:</p>
                <code className="text-xs bg-gray-600 text-gray-200 px-3 py-2 rounded break-all">
                  {secret}
                </code>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                認証コードを入力して確認
              </label>
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-2 bg-gray-600 border border-gray-500 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-xl tracking-widest"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleVerify}
                disabled={verifying || verifyCode.length !== 6}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {verifying ? '確認中...' : '確認'}
              </button>
              <button
                onClick={() => {
                  setQrCode(null);
                  setFactorId(null);
                  setSecret(null);
                  setVerifyCode('');
                  setEnrollType(null);
                  setError(null);
                }}
                className="px-4 py-2 bg-gray-600 text-gray-200 rounded-lg hover:bg-gray-500 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MFA設定一覧 */}
      <div className="mb-6">
        <h3 className="text-lg font-medium text-gray-100 mb-4">
          {hasMFA ? '有効なMFA設定' : 'MFAは有効化されていません'}
        </h3>

        {factors.length === 0 ? (
          <p className="text-gray-400 text-sm mb-4">
            二要素認証を有効化すると、ログイン時に認証アプリのコードが必要になります。
          </p>
        ) : (
          <div className="space-y-3">
            {factors.map((factor) => (
              <div
                key={factor.id}
                className="p-4 bg-gray-700 rounded-lg border border-gray-600 flex items-center justify-between"
              >
                <div>
                  <p className="text-gray-100 font-medium">
                    {factor.friendly_name || '認証アプリ'}
                  </p>
                  <p className="text-sm text-gray-400">
                    TOTP (認証アプリ)
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    ステータス: {factor.status === 'verified' ? '有効' : factor.status}
                  </p>
                </div>
                <button
                  onClick={() => handleUnenroll(factor.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                >
                  無効化
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MFA有効化ボタン */}
      {!enrollType && (
        <button
          onClick={handleEnroll}
          disabled={enrolling}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {enrolling ? '設定中...' : hasMFA ? '追加の認証アプリを登録' : 'MFAを有効化'}
        </button>
      )}

      <div className="mt-6 pt-6 border-t border-gray-700">
        <p className="text-xs text-gray-400">
          <strong>推奨される認証アプリ:</strong> Google Authenticator、1Password、Authy、Microsoft Authenticator
        </p>
      </div>
    </div>
  );
}

