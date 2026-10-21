'use client';

 
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Form } from '@/types/form';
import BusinessRulesEditor from '@/components/FormEditor/Reservation/BusinessRulesEditor';
import MenuStructureEditor from '@/components/FormEditor/Reservation/MenuStructureEditor';

import { getReservationFormName } from '@/lib/form-display-name';
// フォーム構造の互換性を保つためのヘルパー関数
function getFormName(form: Form): string {
  return getReservationFormName(form);
}

function getFormConfig(form: Form) {
  // 新しい簡易フォーム形式の場合、config構造を模擬
  if ((form as any).form_name && !form.config) {
    return {
      basic_info: {
        form_name: (form as any).form_name || 'フォーム',
        theme_color: (form as any).basic_info?.theme_color || '#3B82F6',
        store_name: (form as any).basic_info?.store_name || '',
        liff_id: (form as any).basic_info?.liff_id || (form as any).line_settings?.liff_id || ''
      },
      gender_selection: (form as any).basic_info?.show_gender_selection ? {
        enabled: true,
        required: false,
        options: [
          { value: 'male', label: '男性' },
          { value: 'female', label: '女性' }
        ]
      } : { enabled: false, required: false, options: [] },
      visit_count_selection: {
        enabled: (form as any).ui_settings?.show_visit_count || false,
        required: false,
        options: []
      },
      coupon_selection: {
        enabled: (form as any).ui_settings?.show_coupon_selection || false,
        coupon_name: '',
        options: []
      },
      menu_structure: (form as any).menu_structure || { categories: [] },
      calendar_settings: (form as any).business_rules || {},
      ui_settings: (form as any).ui_settings || {}
    };
  }
  return form.config;
}

export default function FormEditPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.storeId as string;
  const formId = params.formId as string;
  
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'menu' | 'business' | 'options'>('basic');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    const fetchForm = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/forms/${formId}`);
        
        if (!response.ok) {
          setError('フォームが見つかりません');
          return;
        }
        
        const formData = await response.json();
        
        // 店舗IDが一致するかチェック
        if (formData.store_id !== storeId) {
          setError('アクセス権限がありません');
          return;
        }
        
        setForm(formData);
      } catch (err) {
        console.error('Form fetch error:', err);
        setError('フォームの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    if (formId && storeId) {
      fetchForm();
    }
  }, [formId, storeId]);

  const handleSave = async () => {
    if (!form) return;
    
    setSaveStatus('saving');
    try {
      const response = await fetch(`/api/forms/${formId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });

      if (response.ok) {
        const updatedForm = await response.json();
        setForm(updatedForm);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        const error = await response.json();
        console.error('Save error:', error);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 2000);
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  const handlePreview = () => {
    // まず保存してからプレビューを開く
    handleSave().then(() => {
      // 新しいウィンドウでプレビューを開く（統一テンプレート経由）
      window.open(`/preview/${storeId}/forms/${formId}`, '_blank');
    });
  };



  const handleVercelDeploy = async () => {
    if (!form) return;
    
    if (window.confirm('本番フォームを更新しますか？\n\n編集内容が顧客向けフォームに反映されます。')) {
      setSaveStatus('saving');
      try {
        const response = await fetch(`/api/forms/${formId}/deploy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ storeId, formId }),
        });

        if (response.ok) {
          const result = await response.json();
          setSaveStatus('saved');
          
          // フォームデータを再フェッチしてstatic_deploy情報を更新
          try {
            const refreshResponse = await fetch(`/api/forms/${formId}`);
            if (refreshResponse.ok) {
              const updatedForm = await response.json();
              setForm(updatedForm);
            }
          } catch (error) {
            console.error('Form refresh error:', error);
          }
          
          // デプロイ結果を表示
          if (result.deployUrl) {
            alert(`本番フォームを更新しました！\n\n顧客向けURL: ${result.deployUrl}\n\n変更内容が反映されました。`);
          } else {
            alert('本番フォームの更新を開始しました。\n数分後に更新が完了します。');
          }
          
          setTimeout(() => setSaveStatus('idle'), 2000);
        } else {
          const error = await response.json();
          console.error('Deploy error:', error);
          setSaveStatus('error');
          alert(`更新に失敗しました: ${error.error || error.message || '不明なエラー'}`);
          setTimeout(() => setSaveStatus('idle'), 2000);
        }
      } catch (error) {
        console.error('Deploy error:', error);
        setSaveStatus('error');
        alert('更新に失敗しました');
        setTimeout(() => setSaveStatus('idle'), 2000);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-lg text-gray-600">読み込み中...</div>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-600 text-lg font-medium mb-4">
            {error || 'フォームが見つかりません'}
          </div>
          <button
            onClick={() => router.back()}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push(`/${storeId}/admin`)}
                className="text-blue-600 hover:text-blue-800"
              >
                ← 戻る
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {getReservationFormName(form)} - 編集
                </h1>
                <div className="flex items-center space-x-2 mt-1">
                  <span className="text-sm text-gray-500">ID: {form.id}</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    form.status === 'active' 
                      ? 'text-green-600 bg-green-100' 
                      : 'text-gray-600 bg-gray-100'
                  }`}>
                    {form.status === 'active' ? '公開中' : '非公開'}
                  </span>
                  <span className="text-xs text-gray-500">※ 公開/非公開の変更はサービス管理者が行います</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={handlePreview}
                className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
              >
                プレビュー
              </button>
              <button
                onClick={handleSave}
                disabled={saveStatus === 'saving'}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saveStatus === 'saving' ? '保存中...' : '保存'}
              </button>
              <button
                onClick={handleVercelDeploy}
                disabled={saveStatus === 'saving'}
                className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 disabled:opacity-50 flex items-center space-x-2"
              >
                <span>�</span>
                <span>更新</span>
              </button>
              
              {/* デプロイ済みURL表示 */}
              {form.static_deploy && form.static_deploy.status === 'deployed' && (
                <div className="bg-green-50 px-4 py-3 rounded-md border border-green-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="text-green-600 text-sm font-medium">✅ 本番フォーム</span>
                    <span className="text-gray-500 text-xs">
                      最終更新: {new Date(form.static_deploy.deployed_at).toLocaleString('ja-JP')}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <a 
                      href={form.static_deploy.deploy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 text-sm underline break-all"
                    >
                      {form.static_deploy.deploy_url}
                    </a>
                    <button
                      onClick={() => {
                        const url = form.static_deploy?.deploy_url;
                        if (url) {
                          navigator.clipboard.writeText(url);
                          alert('URLをコピーしました');
                        }
                      }}
                      className="text-gray-500 hover:text-gray-700 text-sm p-1 flex-shrink-0"
                      title="URLをコピー"
                    >
                      📋
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* タブナビゲーション */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('basic')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'basic'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              基本情報
            </button>
            <button
              onClick={() => setActiveTab('menu')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'menu'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              メニュー構成
            </button>
            <button
              onClick={() => setActiveTab('business')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'business'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              営業時間・ルール
            </button>
            <button
              onClick={() => setActiveTab('options')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'options'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              オプション設定
            </button>
          </nav>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'basic' && (
          <div className="space-y-6">

            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">基本情報設定</h2>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    フォーム名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.config?.basic_info?.form_name || ''}
                    onChange={(e) => {
                      setForm({
                        ...form,
                        config: {
                          ...form.config,
                          basic_info: {
                            ...form.config.basic_info,
                            form_name: e.target.value
                          }
                        }
                      });
                    }}
                    placeholder="例：カット&カラー予約フォーム"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">顧客向けフォームのタイトルとして表示されます</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    店舗名
                  </label>
                  <input
                    type="text"
                    value={form.config?.basic_info?.store_name || ''}
                    onChange={(e) => {
                      setForm({
                        ...form,
                        config: {
                          ...form.config,
                          basic_info: {
                            ...form.config.basic_info,
                            store_name: e.target.value
                          }
                        }
                      });
                    }}
                    placeholder="例：美容室 A 渋谷店"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">フォームヘッダーに表示されます</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    テーマカラー
                  </label>
                  <div className="flex items-center space-x-4">
                    <input
                      type="color"
                      value={form.config?.basic_info?.theme_color || '#3B82F6'}
                      onChange={(e) => {
                        setForm({
                          ...form,
                          config: {
                            ...form.config,
                            basic_info: {
                              ...form.config.basic_info,
                              theme_color: e.target.value
                            }
                          }
                        });
                      }}
                      className="w-20 h-10 border border-gray-300 rounded-md cursor-pointer"
                    />
                    <span className="text-sm text-gray-600">{form.config?.basic_info?.theme_color || '#3B82F6'}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">ボタンやハイライトに使用されます</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'menu' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <MenuStructureEditor 
              form={form}
              onUpdate={setForm}
            />
          </div>
        )}

        {activeTab === 'business' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <BusinessRulesEditor 
              form={form}
              onUpdate={setForm}
            />
          </div>
        )}

        {activeTab === 'options' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="space-y-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">オプション設定</h2>
              
              {/* ご来店回数設定 */}
              <div className="border-b border-gray-200 pb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">ご来店回数選択</h3>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={form.config.visit_count_selection?.enabled || false}
                      onChange={(e) => {
                        const updatedForm = {
                          ...form,
                          config: {
                            ...form.config,
                            visit_count_selection: {
                              enabled: e.target.checked,
                              required: form.config.visit_count_selection?.required || false,
                              options: form.config.visit_count_selection?.options || [
                                { value: 'first', label: '初回' },
                                { value: 'repeat', label: '2回目以降' }
                              ]
                            }
                          }
                        };
                        setForm(updatedForm);
                      }}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-600">有効にする</span>
                  </label>
                </div>
                
                {form.config.visit_count_selection?.enabled && (
                  <div className="space-y-4 ml-6">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={form.config.visit_count_selection.required}
                        onChange={(e) => {
                          const updatedForm = {
                            ...form,
                            config: {
                              ...form.config,
                              visit_count_selection: {
                                ...form.config.visit_count_selection,
                                required: e.target.checked
                              }
                            }
                          };
                          setForm(updatedForm);
                        }}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-600">必須項目にする</span>
                    </label>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        選択肢の設定
                      </label>
                      <div className="space-y-2">
                        {form.config.visit_count_selection.options.map((option, index) => (
                          <div key={index} className="flex items-center space-x-2">
                            <input
                              type="text"
                              value={option.label}
                              onChange={(e) => {
                                const updatedOptions = [...form.config.visit_count_selection!.options];
                                updatedOptions[index] = { ...option, label: e.target.value };
                                const updatedForm = {
                                  ...form,
                                  config: {
                                    ...form.config,
                                    visit_count_selection: {
                                      ...form.config.visit_count_selection!,
                                      options: updatedOptions
                                    }
                                  }
                                };
                                setForm(updatedForm);
                              }}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="選択肢のテキスト"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* クーポン利用有無設定 */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">クーポン利用有無</h3>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={form.config.coupon_selection?.enabled || false}
                      onChange={(e) => {
                        const updatedForm = {
                          ...form,
                          config: {
                            ...form.config,
                            coupon_selection: {
                              enabled: e.target.checked,
                              coupon_name: form.config.coupon_selection?.coupon_name || '',
                              options: form.config.coupon_selection?.options || [
                                { value: 'use', label: '利用する' },
                                { value: 'not_use', label: '利用しない' }
                              ]
                            }
                          }
                        };
                        setForm(updatedForm);
                      }}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-600">有効にする</span>
                  </label>
                </div>
                
                {form.config.coupon_selection?.enabled && (
                  <div className="space-y-4 ml-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        クーポン名（任意）
                      </label>
                      <input
                        type="text"
                        value={form.config.coupon_selection.coupon_name || ''}
                        onChange={(e) => {
                          const updatedForm = {
                            ...form,
                            config: {
                              ...form.config,
                              coupon_selection: {
                                ...form.config.coupon_selection!,
                                coupon_name: e.target.value
                              }
                            }
                          };
                          setForm(updatedForm);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="例：2周年記念"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        設定すると「{form.config.coupon_selection.coupon_name || '[クーポン名]'}クーポン利用有無」として表示されます
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 保存状態表示 */}
      {saveStatus === 'saved' && (
        <div className="fixed bottom-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
          保存しました
        </div>
      )}
      {saveStatus === 'error' && (
        <div className="fixed bottom-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          保存に失敗しました
        </div>
      )}
    </div>
  );
}
