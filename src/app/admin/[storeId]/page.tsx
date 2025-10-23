'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Store } from '@/types/store';
import { Form } from '@/types/form';
import FormEditModal from '@/components/FormEditor/FormEditModal';
import MenuStructureEditor from '@/components/FormEditor/MenuStructureEditor';
import BusinessRulesEditor from '@/components/FormEditor/BusinessRulesEditor';
import { getPublicFormUrl, getPreviewUrl } from '@/lib/form-url-helper';

// テンプレート定義
const FORM_TEMPLATES = {
  basic: {
    name: '📝 ベーシック',
    description: 'シンプルなメニュー選択のみ',
    config: {
      basic_info: {
        show_gender_selection: false
      },
      menu_structure: {
        structure_type: 'simple',
        categories: [
          {
            id: 'cat1',
            name: 'メニュー',
            menus: [
              {
                id: 'menu1',
                name: 'カット',
                price: 3000,
                duration: 60,
                description: 'スタンダードカット'
              }
            ]
          }
        ]
      },
      ui_settings: {
        show_visit_count: false,
        show_coupon_selection: false,
        show_repeat_booking: false
      }
    }
  },
  standard: {
    name: '👫 スタンダード',
    description: '性別選択 + 来店回数 + クーポン',
    config: {
      basic_info: {
        show_gender_selection: true
      },
      menu_structure: {
        structure_type: 'simple',
        categories: [
          {
            id: 'cat1',
            name: 'メニュー',
            menus: [
              {
                id: 'menu1',
                name: 'カット',
                price: 3000,
                duration: 60,
                description: 'スタンダードカット',
                target_gender: ['male', 'female']
              }
            ]
          }
        ]
      },
      ui_settings: {
        show_visit_count: true,
        show_coupon_selection: true,
        show_repeat_booking: false
      }
    }
  },
  premium: {
    name: '⭐ プレミアム',
    description: '性別選択 + サブメニュー + オプション',
    config: {
      basic_info: {
        show_gender_selection: true
      },
      menu_structure: {
        structure_type: 'category',
        categories: [
          {
            id: 'cat1',
            name: 'カット',
            menus: [
              {
                id: 'menu1',
                name: 'スタンダードカット',
                price: 3000,
                duration: 60,
                description: '基本的なカット',
                target_gender: ['male', 'female'],
                has_submenu: true,
                sub_menu_items: [
                  { name: 'ショート', price: 3000, duration: 60 },
                  { name: 'ミディアム', price: 3500, duration: 70 },
                  { name: 'ロング', price: 4000, duration: 80 }
                ]
              }
            ]
          }
        ]
      },
      ui_settings: {
        show_visit_count: false,
        show_coupon_selection: false,
        show_repeat_booking: false
      }
    }
  },
  complete: {
    name: '🚀 コンプリート',
    description: 'すべての機能（性別、サブメニュー、オプション、来店回数、クーポン）',
    config: {
      basic_info: {
        show_gender_selection: true
      },
      menu_structure: {
        structure_type: 'category',
        categories: [
          {
            id: 'cat1',
            name: 'カット',
            menus: [
              {
                id: 'menu1',
                name: 'スタンダードカット',
                price: 3000,
                duration: 60,
                description: '基本的なカット',
                target_gender: ['male', 'female'],
                has_submenu: true,
                sub_menu_items: [
                  { name: 'ショート', price: 3000, duration: 60 },
                  { name: 'ミディアム', price: 3500, duration: 70 },
                  { name: 'ロング', price: 4000, duration: 80 }
                ]
              }
            ]
          },
          {
            id: 'cat2',
            name: 'オプション',
            menus: [
              {
                id: 'option1',
                name: 'シャンプー',
                price: 500,
                duration: 15,
                description: '基本シャンプー',
                target_gender: ['male', 'female']
              }
            ]
          }
        ]
      },
      ui_settings: {
        show_visit_count: true,
        show_coupon_selection: true,
        show_repeat_booking: false
      }
    }
  },
  ultimate: {
    name: '💎 アルティメット',
    description: '最上位版（前回予約機能も含む）',
    config: {
      basic_info: {
        show_gender_selection: true
      },
      menu_structure: {
        structure_type: 'category',
        categories: [
          {
            id: 'cat1',
            name: 'カット',
            menus: [
              {
                id: 'menu1',
                name: 'プレミアムカット',
                price: 5000,
                duration: 90,
                description: '上質なカット体験',
                target_gender: ['male', 'female'],
                has_submenu: true,
                sub_menu_items: [
                  { name: 'ショート', price: 5000, duration: 90 },
                  { name: 'ミディアム', price: 5500, duration: 100 },
                  { name: 'ロング', price: 6000, duration: 110 }
                ]
              }
            ]
          },
          {
            id: 'cat2',
            name: 'カラー',
            menus: [
              {
                id: 'color1',
                name: 'フルカラー',
                price: 8000,
                duration: 120,
                description: '全体カラーリング',
                target_gender: ['male', 'female']
              }
            ]
          },
          {
            id: 'cat3',
            name: 'オプション',
            menus: [
              {
                id: 'option1',
                name: 'ヘッドスパ',
                price: 2000,
                duration: 30,
                description: 'リラックスヘッドスパ',
                target_gender: ['male', 'female']
              }
            ]
          }
        ]
      },
      ui_settings: {
        show_visit_count: true,
        show_coupon_selection: true,
        show_repeat_booking: true
      }
    }
  }
};

export default function StoreDetailPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.storeId as string;
  
  const [store, setStore] = useState<Store | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingForm, setEditingForm] = useState<Form | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editModalTab, setEditModalTab] = useState<'basic' | 'menu' | 'business'>('basic');
  const [newFormData, setNewFormData] = useState({
    form_name: '',
    liff_id: '',
    gas_endpoint: '',
    template: 'basic'
  });
  const [showStoreEditModal, setShowStoreEditModal] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // 店舗情報取得
        const storeResponse = await fetch(`/api/stores/${storeId}`, {
          credentials: 'include',
        });
        if (!storeResponse.ok) {
          if (storeResponse.status === 404) {
            setError('店舗が見つかりません');
          } else {
            setError('店舗の取得に失敗しました');
          }
          return;
        }
        const storeData = await storeResponse.json();
        setStore(storeData);
        
        // フォーム一覧取得
        const formsResponse = await fetch(`/api/stores/${storeId}/forms`, {
          credentials: 'include',
        });
        if (formsResponse.ok) {
          const formsData = await formsResponse.json();
          setForms(formsData);
        }
        
      } catch (err) {
        console.error('Data fetch error:', err);
        setError('データの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    if (storeId) {
      fetchData();
    }
  }, [storeId]);

  const handleCreateForm = async () => {
    if (!newFormData.form_name.trim()) {
      alert('フォーム名を入力してください');
      return;
    }

    if (!newFormData.liff_id.trim()) {
      alert('LIFF IDを入力してください');
      return;
    }

    if (!newFormData.gas_endpoint.trim()) {
      alert('Google App Script エンドポイントを入力してください');
      return;
    }

    setSubmitting(true);
    try {
      // 選択されたテンプレートを取得
      const selectedTemplate = FORM_TEMPLATES[newFormData.template as keyof typeof FORM_TEMPLATES];
      
      const response = await fetch(`/api/stores/${storeId}/forms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          form_name: newFormData.form_name.trim(),
          liff_id: newFormData.liff_id.trim(),
          gas_endpoint: newFormData.gas_endpoint.trim(),
          template: selectedTemplate
        }),
      });

      if (response.ok) {
        const newForm = await response.json();
        setForms([...forms, newForm]);
        setNewFormData({ form_name: '', liff_id: '', gas_endpoint: '', template: 'basic' });
        setShowCreateForm(false);
        alert(`フォーム「${newForm.form_name}」を作成しました（ID: ${newForm.id}）\nテンプレート: ${selectedTemplate.name}`);
      } else {
        const error = await response.json();
        alert(`エラー: ${error.error}`);
      }
    } catch (error) {
      console.error('Form creation error:', error);
      alert('フォーム作成に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditForm = (form: Form) => {
    setEditingForm(form);
    setEditModalTab('basic');
    setShowEditModal(true);
  };

  const handleSaveEditForm = async () => {
    if (!editingForm) return;
    
    try {
      const response = await fetch(`/api/forms/${editingForm.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(editingForm),
      });

      if (response.ok) {
        const updatedForm = await response.json();
        
        // フォーム一覧を更新
        const updatedForms = forms.map(f => 
          f.id === updatedForm.id ? updatedForm : f
        );
        setForms(updatedForms);
        
        setShowEditModal(false);
        setEditingForm(null);
        alert('フォームを保存しました');
      } else {
        const error = await response.json();
        alert(`保存に失敗しました: ${error.error}`);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('保存に失敗しました');
    }
  };

  const handleEditStore = () => {
    if (store) {
      setEditingStore({ ...store });
      setShowStoreEditModal(true);
    }
  };

  const handleSaveStore = async () => {
    if (!editingStore) return;
    
    try {
      const response = await fetch(`/api/stores/${storeId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(editingStore),
      });

      if (response.ok) {
        const updatedStore = await response.json();
        setStore(updatedStore);
        setShowStoreEditModal(false);
        setEditingStore(null);
        alert('店舗情報を更新しました');
      } else {
        const error = await response.json();
        alert(`更新に失敗しました: ${error.error}`);
      }
    } catch (error) {
      console.error('Store update error:', error);
      alert('店舗情報の更新に失敗しました');
    }
  };

  const handleDeleteForm = (formId: string) => {
    setDeletingFormId(formId);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteForm = async () => {
    if (!deletingFormId) return;

    try {
      const response = await fetch(`/api/forms/${deletingFormId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        // フォーム一覧から削除
        setForms(forms.filter(form => form.id !== deletingFormId));
        setShowDeleteConfirm(false);
        setDeletingFormId(null);
        alert('フォームを削除しました');
      } else {
        const error = await response.json();
        alert(`削除に失敗しました: ${error.error}`);
      }
    } catch (error) {
      console.error('Form deletion error:', error);
      alert('フォームの削除に失敗しました');
    }
  };

  const cancelDeleteForm = () => {
    setShowDeleteConfirm(false);
    setDeletingFormId(null);
  };

  const handleDeleteStore = async () => {
    try {
      const response = await fetch(`/api/stores/${storeId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        alert('店舗を削除しました');
        router.push('/admin');
      } else {
        const error = await response.json();
        alert(`削除に失敗しました: ${error.error}`);
      }
    } catch (error) {
      console.error('Store deletion error:', error);
      alert('店舗の削除に失敗しました');
    }
  };

  const getPublicUrls = () => {
    const baseUrl = window.location.origin;
    return {
      storeManagementUrl: `${baseUrl}/${storeId}/admin`,
      formUrls: forms.map(form => {
        // static_deploy情報からURLを取得
        const deployInfo = (form as any).static_deploy;
        let formUrl = '';
        
        if (deployInfo?.deploy_url) {
          // deploy_url（プロキシURL）を最優先で使用
          formUrl = deployInfo.deploy_url;
        } else if (deployInfo?.storage_url) {
          // Storage URL（直接URL）
          formUrl = deployInfo.storage_url;
        } else if (deployInfo?.blob_url) {
          // Blob URL（旧URL）
          formUrl = deployInfo.blob_url;
        } else {
          // デプロイ情報がない場合はプレビューURL
          formUrl = `${baseUrl}/form/${form.id}?preview=true`;
        }
        
        return {
          id: form.id,
          name: (form as any).form_name || form.config?.basic_info?.form_name,
          url: formUrl,
          status: form.status,
          environment: deployInfo?.environment || 'production'
        };
      })
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">読み込み中...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-center">
              <div className="text-red-600 text-lg font-medium mb-4">
                {error || '店舗が見つかりません'}
              </div>
              <button
                onClick={() => router.back()}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const urls = getPublicUrls();

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <button
                onClick={() => router.back()}
                className="text-blue-400 hover:text-blue-300 mb-2 transition-colors"
              >
                ← 戻る
              </button>
              <h1 className="text-3xl font-bold text-gray-100">
                {store.name}
              </h1>
              <p className="text-gray-400 mt-1">店舗ID: {store.id}</p>
            </div>
            <div className="flex space-x-4">
              <button 
                onClick={() => router.push(`/${storeId}/reservations`)}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
              >
                予約一覧
              </button>
              <button 
                onClick={handleEditStore}
                className="bg-cyan-600 text-white px-4 py-2 rounded-md hover:bg-cyan-700 transition-colors"
              >
                店舗情報編集
              </button>
            </div>
          </div>
        </div>

        {/* お客様向けURL表示 */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-600">
          <h2 className="text-lg font-semibold text-cyan-400 mb-4">
            📎 お客様向けURL（LINEリッチメニュー用）
          </h2>
          
          {/* 店舗管理者ページURL */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-cyan-300 mb-2">
              店舗管理者ページ
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={urls.storeManagementUrl}
                readOnly
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-500 rounded-md text-sm text-gray-100 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
              />
              <button
                onClick={() => navigator.clipboard.writeText(urls.storeManagementUrl)}
                className="bg-cyan-600 text-white px-3 py-2 rounded-md hover:bg-cyan-500 text-sm transition-colors"
              >
                コピー
              </button>
            </div>
          </div>

          {/* フォームURL一覧 */}
          {urls.formUrls.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-cyan-300 mb-2">
                予約フォーム
              </label>
              {urls.formUrls.map((form) => (
                <div key={form.id} className="mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-cyan-300 min-w-0 flex-shrink-0">
                      {form.name} ({form.status === 'active' ? '公開中' : '非公開'})
                    </span>
                    <input
                      type="text"
                      value={form.url}
                      readOnly
                      className="flex-1 px-3 py-1 bg-gray-700 border border-gray-500 rounded-md text-sm text-gray-100 focus:border-cyan-400"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(form.url)}
                      className="bg-cyan-600 text-white px-3 py-1 rounded-md hover:bg-cyan-500 text-sm transition-colors"
                    >
                      コピー
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 店舗基本情報 */}
        <div className="bg-gray-800 rounded-lg shadow-sm p-6 mb-6 border border-gray-600">
          <h2 className="text-xl font-semibold text-gray-100 mb-4">基本情報</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                店舗名
              </label>
              <p className="text-gray-100 font-medium">{store.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                オーナー名
              </label>
              <p className="text-gray-100 font-medium">{store.owner_name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                メールアドレス
              </label>
              <p className="text-gray-100 font-medium">{store.owner_email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                電話番号
              </label>
              <p className="text-gray-100 font-medium">{store.phone || '未設定'}</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-400 mb-1">
                住所
              </label>
              <p className="text-gray-100 font-medium">{store.address || '未設定'}</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-400 mb-1">
                ウェブサイト
              </label>
              <p className="text-gray-100 font-medium">{store.website_url || '未設定'}</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-400 mb-1">
                説明
              </label>
              <p className="text-gray-100 font-medium">{store.description || '未設定'}</p>
            </div>
          </div>
        </div>

        {/* 予約フォーム管理 */}
        <div className="bg-gray-800 rounded-lg shadow-sm p-6 mb-6 border border-gray-600">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-100">予約フォーム</h2>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-500 transition-colors font-medium"
            >
              {showCreateForm ? 'キャンセル' : '新規フォーム作成'}
            </button>
          </div>

          {/* フォーム作成フォーム */}
          {showCreateForm && (
            <div className="bg-gray-700 rounded-lg p-4 mb-4 border border-gray-500">
              <h3 className="text-lg font-medium mb-3 text-gray-100">新しいフォームを作成</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    フォーム名 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={newFormData.form_name}
                    onChange={(e) => setNewFormData({...newFormData, form_name: e.target.value})}
                    placeholder="例：カット＆カラー予約フォーム"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    テンプレート選択 <span className="text-red-400">*</span>
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(FORM_TEMPLATES).map(([key, template]) => (
                      <div key={key} className="relative">
                        <input
                          type="radio"
                          id={`template-${key}`}
                          name="template"
                          value={key}
                          checked={newFormData.template === key}
                          onChange={(e) => setNewFormData({...newFormData, template: e.target.value})}
                          className="sr-only"
                        />
                        <label
                          htmlFor={`template-${key}`}
                          className={`block p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 ${
                            newFormData.template === key
                              ? 'border-emerald-500 bg-emerald-900/20 ring-2 ring-emerald-500/20'
                              : 'border-gray-500 bg-gray-700 hover:border-emerald-400 hover:bg-gray-600'
                          }`}
                        >
                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0">
                              <div className={`w-5 h-5 rounded-full border-2 ${
                                newFormData.template === key
                                  ? 'border-emerald-500 bg-emerald-500'
                                  : 'border-gray-400'
                              } flex items-center justify-center`}>
                                {newFormData.template === key && (
                                  <div className="w-2 h-2 bg-white rounded-full"></div>
                                )}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-gray-100">
                                {template.name}
                              </h4>
                              <p className="text-xs text-gray-400 mt-1">
                                {template.description}
                              </p>
                            </div>
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 p-3 bg-gray-700/50 rounded-md">
                    <h5 className="text-sm font-medium text-cyan-300 mb-2">選択中のテンプレート機能:</h5>
                    <div className="text-xs text-gray-300 space-y-1">
                      {(() => {
                        const current = FORM_TEMPLATES[newFormData.template as keyof typeof FORM_TEMPLATES];
                        const features = [];
                        if (current.config.basic_info.show_gender_selection) features.push('性別選択');
                        if (current.config.menu_structure.structure_type === 'category') features.push('カテゴリー分け');
                        if (current.config.menu_structure.categories.some((cat: any) => 
                          cat.menus.some((menu: any) => menu.has_submenu))) features.push('サブメニュー');
                        if (current.config.ui_settings.show_visit_count) features.push('来店回数選択');
                        if (current.config.ui_settings.show_coupon_selection) features.push('クーポン利用');
                        if (current.config.ui_settings.show_repeat_booking) features.push('前回予約機能');
                        return features.length > 0 ? features.join(' • ') : 'シンプル構成';
                      })()}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    LIFF ID <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={newFormData.liff_id}
                    onChange={(e) => setNewFormData({...newFormData, liff_id: e.target.value})}
                    placeholder="例：1234567890-abcdefgh"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">LINE Developersで作成したLIFF IDを入力</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Google App Script エンドポイント <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="url"
                    value={newFormData.gas_endpoint}
                    onChange={(e) => setNewFormData({...newFormData, gas_endpoint: e.target.value})}
                    placeholder="例：https://script.google.com/macros/s/xxx/exec"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">予約データ送信用のGASエンドポイント</p>
                </div>
              </div>
              <div className="flex items-center space-x-3 mt-6">
                <button
                  onClick={handleCreateForm}
                  disabled={submitting}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-700"
                >
                  {submitting ? '作成中...' : 'フォームを作成'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="bg-gray-600 text-gray-200 px-4 py-2 rounded-md hover:bg-gray-500 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-700"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* フォーム一覧 */}
          <div className="space-y-3">
            {forms.length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                まだフォームが作成されていません
              </div>
            ) : (
              forms.map((form) => (
                <div key={form.id} className="border border-gray-600 rounded-lg p-4 bg-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-100">
{(form as any).form_name || form.config?.basic_info?.form_name}
                        {form.draft_status === 'draft' && (
                          <span className="ml-2 px-2 py-1 text-xs bg-yellow-600 text-yellow-100 rounded-full">
                            下書き
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-gray-400">
                        ID: {form.id} • ステータス: {form.status === 'active' ? '公開中' : '非公開'}
                        {form.draft_status === 'draft' && ' • 未保存の変更があります'}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <button 
                        onClick={() => handleEditForm(form)}
                        className="bg-cyan-600 text-white px-3 py-1 rounded text-sm hover:bg-cyan-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        編集
                      </button>
                      <button 
                        onClick={() => handleDeleteForm(form.id)}
                        className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 予約履歴 */}
        <div className="bg-gray-900 rounded-lg shadow-sm p-6 border border-gray-700 mb-12">
          <h2 className="text-xl font-semibold text-white mb-4">最近の予約</h2>
          <div className="text-gray-400 text-center py-8">
            まだ予約がありません
          </div>
        </div>

        {/* 危険ゾーン: 店舗削除 */}
        <div className="bg-gray-800 rounded-lg border-2 border-red-600/50 p-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-red-400 mb-2">危険ゾーン</h2>
            <p className="text-gray-400 text-sm">
              この操作は取り消すことができません。店舗を削除すると、関連する全てのフォームと予約データも削除されます。
            </p>
          </div>
          <button
            onClick={() => {
              if (confirm(`店舗「${store.name}」を本当に削除しますか？\n\nこの操作は取り消せません。関連する全てのフォームと予約データも削除されます。`)) {
                handleDeleteStore();
              }
            }}
            className="bg-red-600 text-white px-6 py-3 rounded-md hover:bg-red-700 transition-colors font-medium"
          >
            この店舗を削除する
          </button>
        </div>
      </div>

      {/* フォーム編集モーダル */}
      {showEditModal && editingForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-gray-700">
            {/* モーダルヘッダー */}
            <div className="p-6 border-b border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">
                  フォーム編集: {(editingForm as any).form_name || editingForm.config?.basic_info?.form_name || 'フォーム'}
                </h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-gray-400 hover:text-gray-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* タブナビゲーション */}
              <nav className="flex space-x-8">
                <button
                  onClick={() => setEditModalTab('basic')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    editModalTab === 'basic'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  基本情報
                </button>
                <button
                  onClick={() => setEditModalTab('menu')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    editModalTab === 'menu'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  メニュー構成
                </button>
                <button
                  onClick={() => setEditModalTab('business')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    editModalTab === 'business'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  営業時間・ルール
                </button>
              </nav>
            </div>

            {/* モーダルコンテンツ */}
            <div className="flex-1 overflow-y-auto p-6">
              {editModalTab === 'basic' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      フォーム名 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={(editingForm as any).form_name || editingForm.config?.basic_info?.form_name || ''}
                      onChange={(e) => {
                        if ((editingForm as any).form_name !== undefined) {
                          // 新形式
                          setEditingForm({
                            ...editingForm,
                            form_name: e.target.value
                          } as any);
                        } else {
                          // 旧形式
                          setEditingForm({
                            ...editingForm,
                            config: {
                              ...editingForm.config,
                              basic_info: {
                                ...editingForm.config?.basic_info,
                                form_name: e.target.value
                              }
                            }
                          });
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-gray-100"
                      placeholder="例：カット＆カラー予約フォーム"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      店舗名（フォーム内表示用）
                    </label>
                    <input
                      type="text"
                      value={editingForm.config?.basic_info?.store_name || ''}
                      onChange={(e) => {
                        setEditingForm({
                          ...editingForm,
                          config: {
                            ...editingForm.config,
                            basic_info: {
                              ...editingForm.config?.basic_info,
                              store_name: e.target.value
                            }
                          }
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-gray-100"
                      placeholder="例：Hair Salon ABC"
                    />
                    <p className="text-xs text-gray-400 mt-1">フォームヘッダーに表示される店舗名</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      LIFF ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={(editingForm as any).line_settings?.liff_id || editingForm.config?.basic_info?.liff_id || ''}
                      onChange={(e) => {
                        if ((editingForm as any).line_settings !== undefined) {
                          // 新形式
                          setEditingForm({
                            ...editingForm,
                            line_settings: {
                              ...(editingForm as any).line_settings,
                              liff_id: e.target.value
                            }
                          } as any);
                        } else {
                          // 旧形式
                          setEditingForm({
                            ...editingForm,
                            config: {
                              ...editingForm.config,
                              basic_info: {
                                ...editingForm.config?.basic_info,
                                liff_id: e.target.value
                              }
                            }
                          });
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-gray-100"
                      placeholder="例：1234567890-abcdefgh"
                    />
                    <p className="text-xs text-gray-400 mt-1">LINE Developersで作成したLIFF ID</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Google App Script エンドポイント <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="url"
                      value={editingForm.config?.gas_endpoint || ''}
                      onChange={(e) => {
                        setEditingForm({
                          ...editingForm,
                          config: {
                            ...editingForm.config,
                            gas_endpoint: e.target.value
                          }
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-gray-100"
                      placeholder="例：https://script.google.com/macros/s/xxx/exec"
                    />
                    <p className="text-xs text-gray-400 mt-1">予約データ送信用のGASエンドポイント</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Google Calendar URL <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="url"
                      value={editingForm.config?.calendar_settings?.google_calendar_url || ''}
                      onChange={(e) => {
                        setEditingForm({
                          ...editingForm,
                          config: {
                            ...editingForm.config,
                            calendar_settings: {
                              ...editingForm.config?.calendar_settings,
                              google_calendar_url: e.target.value
                            }
                          }
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-gray-100"
                      placeholder="例：https://calendar.google.com/calendar/embed?src=xxx"
                      required
                    />
                    <p className="text-xs text-gray-400 mt-1">空き状況確認用のGoogleカレンダーURL</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      テーマカラー
                    </label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="color"
                        value={(editingForm as any).ui_settings?.theme_color || editingForm.config?.basic_info?.theme_color || '#3B82F6'}
                        onChange={(e) => {
                          if ((editingForm as any).ui_settings !== undefined) {
                            // 新形式
                            setEditingForm({
                              ...editingForm,
                              ui_settings: {
                                ...(editingForm as any).ui_settings,
                                theme_color: e.target.value
                              }
                            } as any);
                          } else {
                            // 旧形式
                            setEditingForm({
                              ...editingForm,
                              config: {
                                ...editingForm.config,
                                basic_info: {
                                  ...editingForm.config?.basic_info,
                                  theme_color: e.target.value
                                }
                              }
                            });
                          }
                        }}
                        className="w-20 h-10 border border-gray-500 rounded-md cursor-pointer"
                      />
                      <span className="text-sm text-gray-400">フォームのメインカラー</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      公開ステータス
                    </label>
                    <select
                      value={editingForm.status}
                      onChange={(e) => setEditingForm({
                        ...editingForm,
                        status: e.target.value as 'active' | 'inactive'
                      })}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-gray-100"
                    >
                      <option value="inactive">非公開（下書き）</option>
                      <option value="active">公開中</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      {editingForm.status === 'active' ? '顧客がフォームにアクセス可能です' : 'フォームは非公開です（管理者のみ確認可能）'}
                    </p>
                  </div>
                </div>
              )}

              {editModalTab === 'menu' && (
                <MenuStructureEditor 
                  form={editingForm}
                  onUpdate={setEditingForm}
                />
              )}

              {editModalTab === 'business' && (
                <BusinessRulesEditor 
                  form={editingForm}
                  onUpdate={setEditingForm}
                />
              )}
            </div>

            {/* モーダルフッター */}
            <div className="flex items-center justify-between p-6 border-t border-gray-700">
              <button
                onClick={() => setShowEditModal(false)}
                className="bg-gray-600 text-gray-200 px-4 py-2 rounded-md hover:bg-gray-500 transition-colors"
              >
                キャンセル
              </button>
              <div className="flex items-center space-x-3">
                <button
                  onClick={async () => {
                    // プレビューを開く
                    const previewUrl = `/form/${editingForm.id}?preview=true`;
                    window.open(previewUrl, '_blank');
                  }}
                  className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 transition-colors"
                >
                  プレビュー
                </button>
                <button
                  onClick={handleSaveEditForm}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                >
                  保存
                </button>
                <button
                  onClick={async () => {
                    if (!editingForm) return;
                    try {
                      // まず保存
                      await handleSaveEditForm();
                      
                      // 静的HTMLを再デプロイ
                      const deployResponse = await fetch(`/api/forms/${editingForm.id}/deploy`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          storeId: storeId,
                        }),
                      });
                      
                      if (deployResponse.ok) {
                        alert('静的HTMLを更新しました！');
                      } else {
                        alert('デプロイに失敗しました');
                      }
                    } catch (error) {
                      console.error('Deploy error:', error);
                      alert('デプロイに失敗しました');
                    }
                  }}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 transition-colors"
                >
                  保存＆デプロイ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 店舗編集モーダル */}
      {showStoreEditModal && editingStore && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-gray-700">
            {/* モーダルヘッダー */}
            <div className="p-6 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">
                  店舗情報編集: {editingStore.name}
                </h2>
                <button
                  onClick={() => setShowStoreEditModal(false)}
                  className="text-gray-400 hover:text-gray-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* モーダルコンテンツ */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      店舗名 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={editingStore.name}
                      onChange={(e) => setEditingStore({
                        ...editingStore,
                        name: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-gray-600 text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      オーナー名 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={editingStore.owner_name}
                      onChange={(e) => setEditingStore({
                        ...editingStore,
                        owner_name: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-gray-600 text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      メールアドレス <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      value={editingStore.owner_email}
                      onChange={(e) => setEditingStore({
                        ...editingStore,
                        owner_email: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-gray-600 text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      電話番号
                    </label>
                    <input
                      type="tel"
                      value={editingStore.phone || ''}
                      onChange={(e) => setEditingStore({
                        ...editingStore,
                        phone: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-gray-600 text-gray-100"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      住所
                    </label>
                    <input
                      type="text"
                      value={editingStore.address || ''}
                      onChange={(e) => setEditingStore({
                        ...editingStore,
                        address: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-gray-600 text-gray-100"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      ウェブサイトURL
                    </label>
                    <input
                      type="url"
                      value={editingStore.website_url || ''}
                      onChange={(e) => setEditingStore({
                        ...editingStore,
                        website_url: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-gray-600 text-gray-100"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      店舗説明
                    </label>
                    <textarea
                      rows={4}
                      value={editingStore.description || ''}
                      onChange={(e) => setEditingStore({
                        ...editingStore,
                        description: e.target.value
                      })}
                      className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-gray-600 text-gray-100"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* モーダルフッター */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-700">
              <button
                onClick={() => setShowStoreEditModal(false)}
                className="bg-gray-600 text-gray-200 px-4 py-2 rounded-md hover:bg-gray-500 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveStore}
                className="bg-cyan-600 text-white px-4 py-2 rounded-md hover:bg-cyan-700 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* フォーム編集モーダル */}
      {editingForm && (
        <FormEditModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setEditingForm(null);
          }}
          form={editingForm}
          storeId={storeId}
          onSave={async (updatedForm) => {
            const response = await fetch(`/api/forms/${updatedForm.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify(updatedForm),
            });

            if (response.ok) {
              const savedForm = await response.json();
              setForms(forms.map(f => f.id === savedForm.id ? savedForm : f));
            } else {
              throw new Error('保存に失敗しました');
            }
          }}
          theme="dark"
          userRole="service_admin"
        />
      )}

      {/* フォーム削除確認モーダル */}
      {showDeleteConfirm && deletingFormId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 border border-gray-700">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-white">フォームを削除</h3>
                  <p className="text-sm text-gray-400">この操作は取り消せません</p>
                </div>
              </div>
              
              <div className="mb-4">
                <p className="text-gray-300">
フォーム「{forms.find(f => f.id === deletingFormId) ? ((forms.find(f => f.id === deletingFormId) as any).form_name || forms.find(f => f.id === deletingFormId)?.config?.basic_info?.form_name) : ''}」を削除しますか？
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  削除すると、このフォームに関連する予約データも全て削除されます。
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={cancelDeleteForm}
                  className="bg-gray-600 text-gray-200 px-4 py-2 rounded-md hover:bg-gray-500 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={confirmDeleteForm}
                  className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors"
                >
                  削除する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
