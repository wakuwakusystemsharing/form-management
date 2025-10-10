'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Store } from '@/types/store';

export default function AdminPage() {
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
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

  useEffect(() => {
    loadStores();
  }, []);

  const loadStores = async () => {
    try {
      const response = await fetch('/api/stores');
      if (response.ok) {
        const data = await response.json();
        setStores(data);
      } else {
        console.error('Failed to load stores');
      }
    } catch (error) {
      console.error('Error loading stores:', error);
    } finally {
      setLoading(false);
    }
  };

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
      const response = await fetch('/api/stores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newStore),
      });

      if (response.ok) {
        const store = await response.json();
        alert(`店舗「${store.name}」を作成しました（ID: ${store.id}）`);
        loadStores();
        resetNewStore();
        setShowAddStore(false);
      } else {
        const error = await response.json();
        alert(`エラー: ${error.error}`);
      }
    } catch (error) {
      console.error('Error creating store:', error);
      alert('店舗作成に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStoreClick = (storeId: string) => {
    router.push(`/admin/${storeId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-lg text-gray-400">読み込み中...</div>
      </div>
    );
  }

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
            </div>
            <button
              onClick={() => router.push('/admin/reservations')}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              全予約一覧
            </button>
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
                  onClick={handleCreateStore}
                  disabled={submitting}
                  className="px-6 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-700"
                >
                  {submitting ? '作成中...' : '店舗を作成'}
                </button>
                <button 
                  onClick={() => setShowAddStore(false)}
                  className="px-6 py-2 bg-gray-600 text-gray-200 rounded-md hover:bg-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-700"
                >
                  キャンセル
                </button>
              </div>
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
