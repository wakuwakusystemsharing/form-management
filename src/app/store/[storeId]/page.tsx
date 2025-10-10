'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Store } from '@/types/store';

export default function StoreOwnerPage() {
  const params = useParams();
  const storeId = params.storeId as string;
  
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStore = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/stores/${storeId}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            setError('店舗が見つかりません');
          } else {
            setError('店舗の取得に失敗しました');
          }
          return;
        }
        
        const storeData = await response.json();
        setStore(storeData);
      } catch (err) {
        console.error('Store fetch error:', err);
        setError('店舗の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    if (storeId) {
      fetchStore();
    }
  }, [storeId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-lg text-gray-600">読み込み中...</div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-600 text-lg font-medium mb-4">
            {error || '店舗が見つかりません'}
          </div>
          <p className="text-gray-600 mb-6">
            お手数ですが、正しいURLでアクセスしてください。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {store.name} - 店舗管理
          </h1>
          <p className="text-gray-600">
            {store.owner_name}様の店舗管理ページ
          </p>
        </div>

        {/* ダッシュボード */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          {/* 今日の予約 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">今日の予約</h3>
            <div className="text-3xl font-bold text-blue-600 mb-1">0</div>
            <p className="text-sm text-gray-600">件の予約があります</p>
          </div>

          {/* 今月の予約 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">今月の予約</h3>
            <div className="text-3xl font-bold text-green-600 mb-1">0</div>
            <p className="text-sm text-gray-600">件の予約がありました</p>
          </div>

          {/* 売上 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">今月の売上</h3>
            <div className="text-3xl font-bold text-purple-600 mb-1">¥0</div>
            <p className="text-sm text-gray-600">予定売上</p>
          </div>
        </div>

        {/* メニュー */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* 予約管理 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">予約管理</h3>
            <div className="space-y-3">
              <button className="w-full text-left p-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
                <div className="font-medium text-blue-900">今日の予約を確認</div>
                <div className="text-sm text-blue-700">本日の予約一覧を表示</div>
              </button>
              <button className="w-full text-left p-3 bg-green-50 rounded-lg hover:bg-green-100 transition-colors">
                <div className="font-medium text-green-900">予約履歴</div>
                <div className="text-sm text-green-700">過去の予約を確認</div>
              </button>
              <button className="w-full text-left p-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors">
                <div className="font-medium text-purple-900">売上レポート</div>
                <div className="text-sm text-purple-700">月次・年次売上を確認</div>
              </button>
            </div>
          </div>

          {/* 設定 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">設定</h3>
            <div className="space-y-3">
              <button className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className="font-medium text-gray-900">営業時間設定</div>
                <div className="text-sm text-gray-700">営業日・営業時間を変更</div>
              </button>
              <button className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className="font-medium text-gray-900">メニュー管理</div>
                <div className="text-sm text-gray-700">サービスメニュー・料金設定</div>
              </button>
              <button className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className="font-medium text-gray-900">店舗情報変更</div>
                <div className="text-sm text-gray-700">連絡先・住所等を変更</div>
              </button>
            </div>
          </div>
        </div>

        {/* 最近の予約 */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">最近の予約</h3>
          <div className="text-center py-8 text-gray-500">
            <div className="text-lg font-medium mb-2">
              まだ予約がありません
            </div>
            <p className="text-sm">
              予約が入ると、こちらに表示されます。
            </p>
          </div>
        </div>

        {/* 店舗情報 */}
        <div className="mt-6 bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">店舗情報</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium text-gray-700">店舗ID:</span> {store.id}
            </div>
            <div>
              <span className="font-medium text-gray-700">オーナー:</span> {store.owner_name}
            </div>
            <div>
              <span className="font-medium text-gray-700">メール:</span> {store.owner_email}
            </div>
            <div>
              <span className="font-medium text-gray-700">電話:</span> {store.phone || '未設定'}
            </div>
            {store.address && (
              <div className="md:col-span-2">
                <span className="font-medium text-gray-700">住所:</span> {store.address}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
