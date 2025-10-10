'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Form } from '@/types/form';

export default function CustomerFormPage() {
  const params = useParams();
  const formId = params.formId as string;
  
  // プレビューモードの検出（URLパラメータから）
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  // フォーム送信データ
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    message: '',
    gender: '',
    visitCount: '',
    couponUsage: '',
    selectedMenus: {} as Record<string, string[]>,
    selectedSubMenus: {} as Record<string, string>, // メニューIDに対する選択されたサブメニューID
    selectedMenuOptions: {} as Record<string, string[]>, // メニューIDに対するオプションID配列
    selectedDate: '',
    selectedTime: ''
  });

  // サブメニューアコーディオンの開閉状態
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set());

  // カレンダー用の状態
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = new Date();
    return getWeekStart(today);
  });
  const [selectedDateTime, setSelectedDateTime] = useState<Date | null>(null);

  // 週の開始日を取得（月曜日）
  function getWeekStart(date: Date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 月曜日を週の開始とする
    return new Date(d.setDate(diff));
  }

  // プレビューモード検出とフォーム取得（統合）
  useEffect(() => {
    const fetchForm = async () => {
      try {
        setLoading(true);
        
        // プレビューモードの検出
        const urlParams = new URLSearchParams(window.location.search);
        const previewMode = urlParams.get('preview') === 'true';
        setIsPreviewMode(previewMode);
        
        // プレビューモードでない場合はアクセス不可
        if (!previewMode) {
          setError('このページは直接アクセスできません');
          setLoading(false);
          return;
        }
        
        const response = await fetch(`/api/forms/${formId}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            setError('フォームが見つかりません');
          } else {
            setError('フォームの取得に失敗しました');
          }
          return;
        }
        
        const formData = await response.json();
        
        // フォームデータの正規化
        const normalizedForm = normalizeFormData(formData);
        
        // プレビューモードでは全てのステータスのフォームを表示
        setForm(normalizedForm);
      } catch (err) {
        console.error('Form fetch error:', err);
        setError('フォームの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    if (formId) {
      fetchForm();
    }
  }, [formId]);

  // フォームデータ正規化関数
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function normalizeFormData(form: any): Form {
    // configが存在しない場合は作成
    if (!form.config) {
      form.config = {} as Form['config'];
    }
    
    // basic_infoの正規化
    if (!form.config.basic_info) {
      form.config.basic_info = {
        form_name: form.form_name || 'フォーム',
        store_name: form.store_name || '',
        theme_color: form.ui_settings?.theme_color || '#3B82F6',
        liff_id: form.liff_id || form.line_settings?.liff_id || ''
      };
    }
    
    // ui_settingsの正規化
    if (!form.config.ui_settings) {
      form.config.ui_settings = form.ui_settings || {};
    }
    
    // menu_structureの正規化
    if (!form.config.menu_structure) {
      form.config.menu_structure = form.menu_structure || { categories: [] };
    }
    
    // menu_structure.display_optionsの正規化
    if (!form.config.menu_structure.display_options) {
      form.config.menu_structure.display_options = {
        show_price: true,
        show_duration: true,
        show_description: true
      };
    }
    
    // gender_selectionの正規化
    if (!form.config.gender_selection) {
      form.config.gender_selection = {
        enabled: false,
        required: false,
        options: [
          { value: 'male', label: '男性' },
          { value: 'female', label: '女性' }
        ]
      };
    }
    
    // calendar_settingsの正規化
    if (!form.config.calendar_settings) {
      form.config.calendar_settings = form.business_rules || {
        advance_booking_days: 30
      };
    }
    
    return form as Form;
  }

  // ローカルストレージに選択内容を保存
  const saveSelectionToStorage = useCallback(() => {
    if (!form) return;
    
    const selectionData = {
      formId: form.id,
      selectedMenus: formData.selectedMenus,
      selectedSubMenus: formData.selectedSubMenus,
      selectedMenuOptions: formData.selectedMenuOptions,
      gender: formData.gender,
      visitCount: formData.visitCount,
      couponUsage: formData.couponUsage,
      timestamp: Date.now()
    };
    
    localStorage.setItem(`booking_${form.id}`, JSON.stringify(selectionData));
  }, [form, formData]);

  // ローカルストレージから選択内容を復元
  const handleRepeatBooking = () => {
    if (!form) return;
    
    const savedData = localStorage.getItem(`booking_${form.id}`);
    if (!savedData) {
      alert('前回のメニューが見つかりません💦');
      return;
    }

    try {
      const selectionData = JSON.parse(savedData);
      
      // データが1週間以内のもののみ復元
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      if (selectionData.timestamp < oneWeekAgo) {
        alert('前回のメニューデータが古いため復元できません');
        return;
      }

      // フォームデータを復元
      setFormData(prev => ({
        ...prev,
        selectedMenus: selectionData.selectedMenus || {},
        selectedSubMenus: selectionData.selectedSubMenus || {},
        selectedMenuOptions: selectionData.selectedMenuOptions || {},
        gender: selectionData.gender || '',
        visitCount: selectionData.visitCount || '',
        couponUsage: selectionData.couponUsage || ''
      }));

      // サブメニューのアコーディオンを展開
      const expandedSet = new Set<string>();
      Object.entries(selectionData.selectedSubMenus || {}).forEach(([menuId, subMenuId]) => {
        if (subMenuId) {
          expandedSet.add(menuId);
        }
      });
      setExpandedMenus(expandedSet);

      // カレンダーセクションにスクロール
      setTimeout(() => {
        const calendarElement = document.querySelector('.calendar-container');
        if (calendarElement) {
          calendarElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);

      alert('前回のメニューを復元しました！');
    } catch (error) {
      console.error('Failed to restore previous selection:', error);
      alert('前回のメニューの復元に失敗しました');
    }
  };

  const handleMenuSelection = (categoryId: string, menuId: string, isMultiple: boolean) => {
    if (isMultiple) {
      const currentSelection = formData.selectedMenus[categoryId] || [];
      const newSelection = currentSelection.includes(menuId)
        ? currentSelection.filter(id => id !== menuId)
        : [...currentSelection, menuId];
      
      // メニューが選択解除された場合、そのメニューのオプションとサブメニューもクリア
      if (currentSelection.includes(menuId) && !newSelection.includes(menuId)) {
        setFormData(prev => ({
          ...prev,
          selectedMenus: {
            ...prev.selectedMenus,
            [categoryId]: newSelection
          },
          selectedSubMenus: {
            ...prev.selectedSubMenus,
            [menuId]: ''
          },
          selectedMenuOptions: {
            ...prev.selectedMenuOptions,
            [menuId]: []
          }
        }));
      } else {
        // メニューが新しく選択された場合、デフォルトオプションを自動選択
        if (!currentSelection.includes(menuId) && newSelection.includes(menuId) && form) {
          const menu = form.config.menu_structure.categories
            .find(cat => cat.id === categoryId)?.menus
            .find(m => m.id === menuId);
          
          const defaultOptions = menu?.options?.filter(opt => opt.is_default).map(opt => opt.id) || [];
          
          setFormData(prev => {
            const newFormData = {
              ...prev,
              selectedMenus: {
                ...prev.selectedMenus,
                [categoryId]: newSelection
              },
              selectedMenuOptions: {
                ...prev.selectedMenuOptions,
                [menuId]: defaultOptions
              }
            };
            // 選択内容をローカルストレージに保存
            setTimeout(() => saveSelectionToStorage(), 100);
            return newFormData;
          });
        } else {
          setFormData(prev => {
            const newFormData = {
              ...prev,
              selectedMenus: {
                ...prev.selectedMenus,
                [categoryId]: newSelection
              }
            };
            // 選択内容をローカルストレージに保存
            setTimeout(() => saveSelectionToStorage(), 100);
            return newFormData;
          });
        }
      }
    } else {
      // シングル選択の場合、他のメニューのオプションとサブメニューもクリア
      const currentSelection = formData.selectedMenus[categoryId] || [];
      const clearedOptions = { ...formData.selectedMenuOptions };
      const clearedSubMenus = { ...formData.selectedSubMenus };
      currentSelection.forEach(id => {
        if (id !== menuId) {
          clearedOptions[id] = [];
          clearedSubMenus[id] = '';
        }
      });

      // 新しく選択されたメニューのデフォルトオプションを自動選択
      if (form) {
        const menu = form.config.menu_structure.categories
          .find(cat => cat.id === categoryId)?.menus
          .find(m => m.id === menuId);
        
        const defaultOptions = menu?.options?.filter(opt => opt.is_default).map(opt => opt.id) || [];
        clearedOptions[menuId] = defaultOptions;
      }

      setFormData(prev => {
        const newFormData = {
          ...prev,
          selectedMenus: {
            ...prev.selectedMenus,
            [categoryId]: [menuId]
          },
          selectedSubMenus: clearedSubMenus,
          selectedMenuOptions: clearedOptions
        };
        // 選択内容をローカルストレージに保存
        setTimeout(() => saveSelectionToStorage(), 100);
        return newFormData;
      });
    }
  };

  const handleSubMenuSelection = (menuId: string, subMenuId: string) => {
    setFormData(prev => {
      // 既に選択されているサブメニューと同じものをクリックした場合は選択解除
      const isCurrentlySelected = prev.selectedSubMenus[menuId] === subMenuId;
      
      const newFormData = {
        ...prev,
        selectedSubMenus: {
          ...prev.selectedSubMenus,
          [menuId]: isCurrentlySelected ? '' : subMenuId
        }
      };
      
      // 選択内容をローカルストレージに保存
      setTimeout(() => saveSelectionToStorage(), 100);
      return newFormData;
    });
  };

  const toggleMenuExpansion = (menuId: string) => {
    const newExpanded = new Set(expandedMenus);
    if (newExpanded.has(menuId)) {
      newExpanded.delete(menuId);
    } else {
      newExpanded.add(menuId);
    }
    setExpandedMenus(newExpanded);
  };

  const handleMenuOptionSelection = (menuId: string, optionId: string, isChecked: boolean) => {
    const currentOptions = formData.selectedMenuOptions[menuId] || [];
    const newOptions = isChecked
      ? [...currentOptions, optionId]
      : currentOptions.filter(id => id !== optionId);
    
    setFormData(prev => {
      const newFormData = {
        ...prev,
        selectedMenuOptions: {
          ...prev.selectedMenuOptions,
          [menuId]: newOptions
        }
      };
      // 選択内容をローカルストレージに保存
      setTimeout(() => saveSelectionToStorage(), 100);
      return newFormData;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form) return;
    
    // バリデーション
    if (!formData.name.trim()) {
      alert('お名前を入力してください');
      return;
    }
    
    if (!formData.phone.trim()) {
      alert('電話番号を入力してください');
      return;
    }
    
    if (!formData.selectedDate) {
      alert('ご希望日を選択してください');
      return;
    }
    
    if (!formData.selectedTime) {
      alert('ご希望時間を選択してください');
      return;
    }

    // 性別が必須の場合のチェック
    if (form.config.gender_selection.enabled && form.config.gender_selection.required && !formData.gender) {
      alert('性別を選択してください');
      return;
    }

    // 確認画面を表示
    setShowConfirmation(true);
  };

  const handleConfirmSubmit = async () => {
    if (!form) return;

    setSubmitting(true);
    
    try {
      // GAS エンドポイントに送信
      if (form.config.gas_endpoint) {
        const response = await fetch(form.config.gas_endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            formId: form.id,
            storeId: form.store_id,
            customerData: formData,
            submittedAt: new Date().toISOString()
          }),
        });
        
        if (response.ok) {
          setSubmitted(true);
          setShowConfirmation(false);
        } else {
          throw new Error('送信に失敗しました');
        }
      } else {
        // GASエンドポイントが未設定の場合は成功として扱う（デモ用）
        setSubmitted(true);
        setShowConfirmation(false);
      }
    } catch (error) {
      console.error('Submit error:', error);
      alert('送信に失敗しました。しばらく経ってから再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };



  // 週の日付配列を生成
  const getWeekDates = (weekStart: Date) => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  // 営業時間に基づいて時間選択肢を生成
  const getAvailableTimeSlots = (date?: Date) => {
    if (!form || (!formData.selectedDate && !date)) return [];
    
    const targetDate = date || new Date(formData.selectedDate);
    const selectedDayOfWeek = targetDate.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[selectedDayOfWeek] as keyof typeof form.config.calendar_settings.business_hours;
    const businessHours = form.config.calendar_settings.business_hours[dayName];
    
    if (businessHours.closed) return [];
    
    const timeSlots = [];
    const openTime = parseInt(businessHours.open.split(':')[0]);
    const closeTime = parseInt(businessHours.close.split(':')[0]);
    
    for (let hour = openTime; hour < closeTime; hour++) {
      timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
      if (hour + 0.5 < closeTime) {
        timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
      }
    }
    
    return timeSlots;
  };

  // カレンダーのセル選択
  const handleDateTimeSelect = (date: Date, time: string) => {
    const dateTime = new Date(date);
    const [hours, minutes] = time.split(':').map(Number);
    dateTime.setHours(hours, minutes, 0, 0);
    
    setSelectedDateTime(dateTime);
    setFormData(prev => ({
      ...prev,
      selectedDate: date.toISOString().split('T')[0],
      selectedTime: time
    }));
  };

  // 週の移動
  const navigateWeek = (direction: 'prev' | 'next') => {
    const newWeekStart = new Date(currentWeekStart);
    newWeekStart.setDate(currentWeekStart.getDate() + (direction === 'next' ? 7 : -7));
    setCurrentWeekStart(newWeekStart);
  };

  // 月の移動
  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentWeekStart);
    newDate.setMonth(currentWeekStart.getMonth() + (direction === 'next' ? 1 : -1));
    setCurrentWeekStart(getWeekStart(newDate));
  };

  // メニューが選択されているかチェック
  const isMenuSelected = () => {
    // 通常のメニューが選択されているかチェック
    const hasSelectedMenus = Object.values(formData.selectedMenus).some(menuIds => menuIds.length > 0);
    
    // サブメニューが選択されているかチェック
    const hasSelectedSubMenus = Object.values(formData.selectedSubMenus).some(subMenuId => subMenuId !== '');
    
    return hasSelectedMenus || hasSelectedSubMenus;
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
          <p className="text-gray-600 mb-6">
            お手数ですが、正しいURLでアクセスしてください。
          </p>
        </div>
      </div>
    );
  }

  // 予約完了画面
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              ご予約を承りました
            </h1>
            <p className="text-gray-600 mb-6">
              この度はご予約いただき、ありがとうございます。<br />
              確認のご連絡を順次お送りいたします。
            </p>
            <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
              <h3 className="font-semibold text-gray-900 mb-2">予約内容</h3>
              <div className="space-y-2 text-sm">
                <div><span className="font-medium">お名前:</span> {formData.name}</div>
                <div><span className="font-medium">電話番号:</span> {formData.phone}</div>
                <div><span className="font-medium">ご希望日時:</span> {formData.selectedDate} {formData.selectedTime}</div>
                {form.config.gender_selection.enabled && formData.gender && (
                  <div><span className="font-medium">性別:</span> {form.config.gender_selection.options.find(opt => opt.value === formData.gender)?.label}</div>
                )}
                {form.config.visit_count_selection?.enabled && formData.visitCount && (
                  <div><span className="font-medium">ご来店回数:</span> {form.config.visit_count_selection.options.find(opt => opt.value === formData.visitCount)?.label}</div>
                )}
                {form.config.coupon_selection?.enabled && formData.couponUsage && (
                  <div><span className="font-medium">{form.config.coupon_selection.coupon_name ? `${form.config.coupon_selection.coupon_name}クーポン` : 'クーポン'}:</span> {form.config.coupon_selection.options.find(opt => opt.value === formData.couponUsage)?.label}</div>
                )}
                {Object.keys(formData.selectedMenus).length > 0 && (
                  <div>
                    <span className="font-medium">選択メニュー:</span>
                    <div className="ml-4">
                      {Object.entries(formData.selectedMenus).map(([categoryId, menuIds]) => {
                        const category = form.config.menu_structure.categories.find(c => c.id === categoryId);
                        return (
                          <div key={categoryId}>
                            {menuIds.map(menuId => {
                              const menu = category?.menus.find(m => m.id === menuId);
                              return menu ? (
                                <div key={menuId}>• {menu.name} {menu.price ? `(¥${menu.price.toLocaleString()})` : ''}</div>
                              ) : null;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {formData.message && (
                  <div><span className="font-medium">メッセージ:</span> {formData.message}</div>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setSubmitted(false);
                setFormData({
                  name: '',
                  phone: '',
                  message: '',
                  gender: '',
                  visitCount: '',
                  couponUsage: '',
                  selectedMenus: {},
                  selectedSubMenus: {},
                  selectedMenuOptions: {},
                  selectedDate: '',
                  selectedTime: ''
                });
              }}
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
            >
              新しい予約をする
            </button>
          </div>
        </div>

        {/* 予約確認モーダル */}
        {showConfirmation && (
          <div className="fixed inset-0 bg-white/20 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">予約内容をご確認ください</h3>
                
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between">
                    <span className="text-gray-600">お名前</span>
                    <span className="font-medium">{formData.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">電話番号</span>
                    <span className="font-medium">{formData.phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">ご希望日時</span>
                    <span className="font-medium">{formData.selectedDate} {formData.selectedTime}</span>
                  </div>
                  
                  {form.config.gender_selection.enabled && formData.gender && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">性別</span>
                      <span className="font-medium">
                        {form.config.gender_selection.options.find(opt => opt.value === formData.gender)?.label}
                      </span>
                    </div>
                  )}
                  
                  {form.config.visit_count_selection?.enabled && formData.visitCount && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">ご来店回数</span>
                      <span className="font-medium">
                        {form.config.visit_count_selection.options.find(opt => opt.value === formData.visitCount)?.label}
                      </span>
                    </div>
                  )}
                  
                  {form.config.coupon_selection?.enabled && formData.couponUsage && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">
                        {form.config.coupon_selection.coupon_name 
                          ? `${form.config.coupon_selection.coupon_name}クーポン`
                          : 'クーポン'
                        }
                      </span>
                      <span className="font-medium">
                        {form.config.coupon_selection.options.find(opt => opt.value === formData.couponUsage)?.label}
                      </span>
                    </div>
                  )}
                  
                  {Object.keys(formData.selectedMenus).length > 0 && (
                    <div>
                      <span className="text-gray-600">選択メニュー</span>
                      <div className="mt-1">
                        {Object.entries(formData.selectedMenus).map(([categoryId, menuIds]) => {
                          const category = form.config.menu_structure.categories.find(c => c.id === categoryId);
                          return (
                            <div key={categoryId} className="ml-4">
                              {menuIds.map(menuId => {
                                const menu = category?.menus.find(m => m.id === menuId);
                                return menu ? (
                                  <div key={menuId} className="text-sm font-medium">
                                    • {menu.name} {menu.price ? `(¥${menu.price.toLocaleString()})` : ''}
                                  </div>
                                ) : null;
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  {formData.message && (
                    <div>
                      <span className="text-gray-600">メッセージ</span>
                      <p className="mt-1 text-sm bg-gray-50 p-2 rounded">{formData.message}</p>
                    </div>
                  )}
                </div>
                
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowConfirmation(false)}
                    className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                    disabled={submitting}
                  >
                    修正する
                  </button>
                  <button
                    onClick={handleConfirmSubmit}
                    disabled={submitting}
                    className="flex-1 px-4 py-2 rounded-md text-white font-medium disabled:opacity-50"
                    style={{ backgroundColor: form.config.basic_info.theme_color }}
                  >
                    {submitting ? '送信中...' : '予約確定'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* プレビューモードバナー */}
        {isPreviewMode && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-blue-800">
                  プレビューモード
                </h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>
                    これはプレビュー表示です。実際のフォームと同じ見た目・動作を確認できます。
                  </p>
                </div>
                <div className="mt-3">
                  <button
                    onClick={() => window.close()}
                    className="text-sm font-medium text-blue-800 hover:text-blue-900 underline"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ヘッダー */}
        <div 
          className="rounded-lg shadow-sm p-6 mb-6 text-white"
          style={{ backgroundColor: form.config?.basic_info?.theme_color || '#3B82F6' }}
        >
          <h1 className="text-2xl font-bold mb-2">
            {form.config?.basic_info?.form_name || 'フォーム'}
          </h1>
          <p className="opacity-90">
            {form.config?.basic_info?.store_name || 'ご予約フォーム'}
          </p>
        </div>

        {/* 前回と同じメニューで予約するボタン */}
        {form.config.ui_settings?.show_repeat_booking && (
          <div className="mb-6 text-center">
            <button
              type="button"
              onClick={handleRepeatBooking}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              <span className="mr-2">🔁</span>
              前回と同じメニューで予約する
            </button>
          </div>
        )}

        {/* カレンダー用のスタイル */}
        <style jsx>{`
          .calendar-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            position: relative;
            width: 100%;
          }

          .current-month-container {
            display: flex;
            justify-content: center;
            align-items: center;
            width: 100%;
          }

          .month-button-container,
          .week-button-container {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
          }

          .calendar table {
            table-layout: fixed;
          }

          .calendar th,
          .calendar td {
            font-size: 12px;
            text-align: center;
            padding: 4px;
            vertical-align: middle;
            box-sizing: border-box;
            border: 2px solid #696969;
          }

          .calendar th:first-child,
          .calendar td:first-child {
            width: 17%;
            font-size: 12px;
          }

          .calendar td.selected {
            background-color: #13ca5e !important;
            color: #fff !important;
          }

          @media (max-width: 768px) {
            .calendar th,
            .calendar td {
              font-size: 10px;
              padding: 2px;
            }
          }
        `}</style>

        {/* 予約フォーム */}
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">ご予約内容</h2>
          
          {/* お客様名 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              お名前 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* 電話番号 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              電話番号 <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          
          {/* 性別選択 */}
          {form.config?.gender_selection?.enabled && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                性別 {form.config?.gender_selection?.required && <span className="text-red-500">*</span>}
              </label>
              <div className="flex space-x-4">
                {form.config?.gender_selection?.options?.map((option, optionIndex) => (
                  <button
                    key={option.value || `gender-${optionIndex}`}
                    type="button"
                    onClick={() => setFormData(prev => {
                      const newFormData = { ...prev, gender: option.value };
                      setTimeout(() => saveSelectionToStorage(), 100);
                      return newFormData;
                    })}
                    className={`flex-1 py-3 px-4 border-2 rounded-md font-medium transition-all duration-200 ${
                      formData.gender === option.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ご来店回数選択 */}
          {form.config?.visit_count_selection?.enabled && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ご来店回数 {form.config?.visit_count_selection?.required && <span className="text-red-500">*</span>}
              </label>
              <div className="flex space-x-4">
                {form.config?.visit_count_selection?.options?.map((option, optionIndex) => (
                  <button
                    key={option.value || `visit-${optionIndex}`}
                    type="button"
                    onClick={() => setFormData(prev => {
                      const newFormData = { ...prev, visitCount: option.value };
                      setTimeout(() => saveSelectionToStorage(), 100);
                      return newFormData;
                    })}
                    className={`flex-1 py-3 px-4 border-2 rounded-md font-medium transition-all duration-200 ${
                      formData.visitCount === option.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* クーポン利用有無選択 */}
          {form.config?.coupon_selection?.enabled && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {form.config?.coupon_selection?.coupon_name 
                  ? `${form.config.coupon_selection.coupon_name}クーポン利用有無`
                  : 'クーポン利用有無'
                }
              </label>
              <div className="flex space-x-4">
                {form.config?.coupon_selection?.options?.map((option, optionIndex) => (
                  <button
                    key={option.value || `coupon-${optionIndex}`}
                    type="button"
                    onClick={() => setFormData(prev => {
                      const newFormData = { ...prev, couponUsage: option.value };
                      setTimeout(() => saveSelectionToStorage(), 100);
                      return newFormData;
                    })}
                    className={`flex-1 py-3 px-4 border-2 rounded-md font-medium transition-all duration-200 ${
                      formData.couponUsage === option.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* メニュー選択 */}
          {form.config?.menu_structure?.categories && form.config.menu_structure.categories.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                メニューをお選びください
              </label>
              <div className="space-y-4">
                {form.config.menu_structure.categories.map((category, categoryIndex) => (
                  <div key={category.id || categoryIndex} className="border border-gray-200 rounded-lg p-4">
                    <div className="space-y-2">
                      {category.menus
                        .filter((menu) => {
                          // 性別選択が無効の場合は、全てのメニューを表示
                          if (!form.config?.gender_selection?.enabled) {
                            return true;
                          }
                          
                          // 性別が選択されていない場合は、性別条件なしのメニューのみ表示
                          if (!formData.gender) {
                            return !menu.gender_filter || menu.gender_filter === 'both';
                          }
                          
                          // 性別が選択されている場合は、その性別に対応するメニューを表示
                          return menu.gender_filter === 'both' || 
                                 menu.gender_filter === formData.gender ||
                                 !menu.gender_filter;
                        })
                        .map((menu, menuIndex) => (
                        <div key={`${category.id}-${menu.id || menuIndex}`} className="space-y-3">
                          {/* メニューがサブメニューを持つ場合 */}
                          {menu.has_submenu && menu.sub_menu_items && menu.sub_menu_items.length > 0 ? (
                            <div>
                              <button
                                type="button"
                                onClick={() => toggleMenuExpansion(menu.id)}
                                className={`w-full flex items-center justify-between p-3 border-2 rounded-md font-medium transition-all duration-200 focus:outline-none ${
                                  expandedMenus.has(menu.id) 
                                    ? 'border-blue-500 bg-blue-50 text-blue-700' 
                                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-center">
                                  <svg 
                                    className={`mr-2 h-5 w-5 transform transition-transform ${
                                      expandedMenus.has(menu.id) ? 'rotate-90' : ''
                                    }`}
                                    fill="none" 
                                    stroke="currentColor" 
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                  <div>
                                    <div className="text-left">{menu.name}</div>
                                    {menu.description && (
                                      <div className="text-sm opacity-70 text-left">{menu.description}</div>
                                    )}
                                  </div>
                                </div>
                                <div className="text-sm opacity-70">
                                  サブメニューを選択
                                </div>
                              </button>

                              {/* サブメニューのアコーディオン展開部分 */}
                              {expandedMenus.has(menu.id) && (
                                <div className="ml-6 mt-3 space-y-2 border-l-2 border-blue-200 pl-4">
                                  <div className="text-sm font-medium text-gray-700 mb-3">サブメニューを選択してください</div>
                                  {menu.sub_menu_items.map((subMenu, subIndex) => {
                                    // idがない場合はindexを使用
                                    const subMenuId = subMenu.id || `submenu-${subIndex}`;
                                    return (
                                    <button
                                      key={`${menu.id}-${subMenuId}`}
                                      type="button"
                                      onClick={() => handleSubMenuSelection(menu.id, subMenuId)}
                                      className={`w-full flex items-center justify-between p-3 border-2 rounded-md font-medium transition-all duration-200 ${
                                        formData.selectedSubMenus[menu.id] === subMenuId
                                          ? 'border-green-500 bg-green-50 text-green-700'
                                          : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                                      }`}
                                    >
                                      <div>
                                        <div className="text-left">{subMenu.name}</div>
                                        {subMenu.description && (
                                          <div className="text-sm opacity-70 text-left">{subMenu.description}</div>
                                        )}
                                      </div>
                                      <div className="text-right ml-4">
                                        {form.config?.menu_structure?.display_options?.show_price && (
                                          <div className="font-semibold">¥{subMenu.price.toLocaleString()}</div>
                                        )}
                                        {form.config?.menu_structure?.display_options?.show_duration && (
                                          <div className="text-sm opacity-70">{subMenu.duration}分</div>
                                        )}
                                      </div>
                                    </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ) : (
                            /* 通常のメニュー表示 - ボタンクリック形式 */
                            <button
                              type="button"
                              onClick={() => handleMenuSelection(category.id, menu.id, category.selection_mode === 'multiple')}
                              className={`w-full flex items-center justify-between p-3 border-2 rounded-md font-medium transition-all duration-200 ${
                                formData.selectedMenus[category.id]?.includes(menu.id)
                                  ? 'border-green-500 bg-green-50 text-green-700'
                                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                              }`}
                            >
                              <div>
                                <div className="text-left">{menu.name}</div>
                                {menu.description && (
                                  <div className="text-sm opacity-70 text-left">{menu.description}</div>
                                )}
                              </div>
                              <div className="text-right ml-4">
                                {form.config?.menu_structure?.display_options?.show_price && menu.price !== undefined && (
                                  <div className="font-semibold">¥{menu.price.toLocaleString()}</div>
                                )}
                                {form.config?.menu_structure?.display_options?.show_duration && menu.duration !== undefined && (
                                  <div className="text-sm opacity-70">{menu.duration}分</div>
                                )}
                              </div>
                            </button>
                          )}
                          
                          {/* メニューオプション（サブメニューを使わない場合のみ表示） */}
                          {!menu.has_submenu && menu.options && menu.options.length > 0 && 
                           formData.selectedMenus[category.id]?.includes(menu.id) && (
                            <div className="ml-6 pl-4 border-l-2 border-green-200 space-y-2">
                              <div className="text-sm font-medium text-gray-700 mb-3">オプション</div>
                              {menu.options.map((option, optionIndex) => (
                                <button
                                  key={`${menu.id}-${option.id || optionIndex}`}
                                  type="button"
                                  onClick={() => handleMenuOptionSelection(menu.id, option.id, !formData.selectedMenuOptions[menu.id]?.includes(option.id))}
                                  className={`w-full flex items-center justify-between p-2 border-2 rounded-md text-sm font-medium transition-all duration-200 ${
                                    formData.selectedMenuOptions[menu.id]?.includes(option.id)
                                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                                      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                                  }`}
                                >
                                  <div className="flex items-center">
                                    <div>
                                      <div className="text-left">
                                        {option.name}
                                        {option.is_default && (
                                          <span className="ml-2 px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded">
                                            おすすめ
                                          </span>
                                        )}
                                      </div>
                                      {option.description && (
                                        <div className="text-xs opacity-70 text-left">{option.description}</div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right ml-2">
                                    {form.config.menu_structure.display_options.show_price && (
                                      <div className="font-medium">
                                        {option.price > 0 ? `+¥${option.price.toLocaleString()}` : '無料'}
                                      </div>
                                    )}
                                    {form.config.menu_structure.display_options.show_duration && option.duration > 0 && (
                                      <div className="text-xs opacity-70">+{option.duration}分</div>
                                    )}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 希望日時 - メニューが選択された場合のみ表示 */}
          {isMenuSelected() && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                希望日時 <span className="text-red-500">*</span>
              </label>
              <div className="text-sm text-gray-600 mb-3">
                ※メニューを選択すると空き状況のカレンダーが表示されます
              </div>
            
            <div className="calendar-container">
              {/* 現在の月表示 */}
              <div className="current-month-container mb-4">
                <span className="current-month text-lg font-bold text-gray-700">
                  {currentWeekStart.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}
                </span>
              </div>

              {/* 月移動ボタン */}
              <div className="month-button-container mb-3">
                <button 
                  type="button"
                  onClick={() => navigateMonth('prev')}
                  className="month-button px-5 py-2 bg-gray-700 text-white border-none rounded cursor-pointer hover:bg-gray-800"
                >
                  前月
                </button>
                <button 
                  type="button"
                  onClick={() => navigateMonth('next')}
                  className="month-button px-5 py-2 bg-gray-700 text-white border-none rounded cursor-pointer hover:bg-gray-800"
                >
                  翌月
                </button>
              </div>

              {/* 週移動ボタン */}
              <div className="week-button-container mb-3">
                <button 
                  type="button"
                  onClick={() => navigateWeek('prev')}
                  className="week-button px-5 py-2 bg-gray-700 text-white border-none rounded cursor-pointer hover:bg-gray-800"
                >
                  前週
                </button>
                <button 
                  type="button"
                  onClick={() => navigateWeek('next')}
                  className="week-button px-5 py-2 bg-gray-700 text-white border-none rounded cursor-pointer hover:bg-gray-800"
                >
                  翌週
                </button>
              </div>

              {/* カレンダーテーブル */}
              <div className="calendar bg-white border border-gray-300 rounded shadow-sm overflow-hidden">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-center p-2 bg-gray-100 border border-gray-400 text-xs">時間</th>
                      {getWeekDates(currentWeekStart).map((date, index) => (
                        <th key={index} className="text-center p-2 bg-gray-100 border border-gray-400 text-xs">
                          {date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                          <br />
                          ({['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* 時間帯ごとの行を生成 */}
                    {(() => {
                      const timeSlots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', 
                                        '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'];
                      return timeSlots.map((time) => (
                        <tr key={time}>
                          <td className="text-center p-1 border border-gray-400 text-xs bg-gray-50 font-medium">
                            {time}
                          </td>
                          {getWeekDates(currentWeekStart).map((date, dateIndex) => {
                            const availableSlots = getAvailableTimeSlots(date);
                            const isAvailable = availableSlots.includes(time);
                            const isSelected = selectedDateTime && 
                              selectedDateTime.toDateString() === date.toDateString() &&
                              selectedDateTime.toTimeString().slice(0, 5) === time;
                            const isPast = new Date() > new Date(date.getFullYear(), date.getMonth(), date.getDate(), 
                              parseInt(time.split(':')[0]), parseInt(time.split(':')[1]));
                            
                            return (
                              <td 
                                key={dateIndex}
                                onClick={() => isAvailable && !isPast ? handleDateTimeSelect(date, time) : null}
                                className={`text-center p-1 border border-gray-400 text-xs cursor-pointer ${
                                  isSelected 
                                    ? 'bg-green-500 text-white' 
                                    : isAvailable && !isPast
                                      ? 'hover:bg-gray-200 bg-white'
                                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                {isAvailable && !isPast ? '○' : '×'}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          )}

          {/* メッセージ */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              メッセージ（任意）
            </label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 予約内容確認 */}
          {(formData.name || formData.phone || formData.selectedDate || Object.keys(formData.selectedMenus).length > 0 || Object.keys(formData.selectedSubMenus).length > 0) && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold text-gray-900">ご予約内容</h3>
                <button
                  type="button"
                  onClick={() => {
                    // スクロールして上部に戻る
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-100"
                >
                  編集
                </button>
              </div>
              
              <div className="space-y-2 text-sm">
                {formData.name && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">お名前:</span>
                    <span className="font-medium">{formData.name}</span>
                  </div>
                )}
                
                {formData.phone && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">電話番号:</span>
                    <span className="font-medium">{formData.phone}</span>
                  </div>
                )}
                
                {form.config.gender_selection.enabled && formData.gender && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">性別:</span>
                    <span className="font-medium">
                      {form.config.gender_selection.options.find(opt => opt.value === formData.gender)?.label}
                    </span>
                  </div>
                )}
                
                {form.config.visit_count_selection?.enabled && formData.visitCount && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">ご来店回数:</span>
                    <span className="font-medium">
                      {form.config.visit_count_selection.options.find(opt => opt.value === formData.visitCount)?.label}
                    </span>
                  </div>
                )}
                
                {form.config.coupon_selection?.enabled && formData.couponUsage && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">
                      {form.config.coupon_selection.coupon_name 
                        ? `${form.config.coupon_selection.coupon_name}クーポン`
                        : 'クーポン'
                      }:
                    </span>
                    <span className="font-medium">
                      {form.config.coupon_selection.options.find(opt => opt.value === formData.couponUsage)?.label}
                    </span>
                  </div>
                )}
                
                {formData.selectedDate && formData.selectedTime && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">ご希望日時:</span>
                    <span className="font-medium">{formData.selectedDate} {formData.selectedTime}</span>
                  </div>
                )}
                
                {/* 通常のメニュー表示 */}
                {Object.keys(formData.selectedMenus).length > 0 && (
                  <div>
                    <span className="text-gray-600">選択メニュー:</span>
                    <div className="ml-4 mt-1">
                      {Object.entries(formData.selectedMenus).map(([categoryId, menuIds]) => {
                        const category = form.config.menu_structure.categories.find(c => c.id === categoryId);
                        return (
                          <div key={categoryId}>
                            {menuIds.map(menuId => {
                              const menu = category?.menus.find(m => m.id === menuId);
                              return menu ? (
                                <div key={menuId} className="text-sm">
                                  • {menu.name} 
                                  {menu.price ? ` (¥${menu.price.toLocaleString()})` : ''}
                                  {menu.duration ? ` • ${menu.duration}分` : ''}
                                </div>
                              ) : null;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {/* サブメニューの表示 */}
                {Object.entries(formData.selectedSubMenus).some(([, subMenuId]) => subMenuId !== '') && (
                  <div>
                    <span className="text-gray-600">選択サブメニュー:</span>
                    <div className="ml-4 mt-1">
                      {Object.entries(formData.selectedSubMenus).map(([menuId, subMenuId]) => {
                        if (!subMenuId) return null;
                        
                        // メニューを探す
                        let parentMenu = null;
                        let subMenu = null;
                        
                        for (const category of form.config.menu_structure.categories) {
                          const foundMenu = category.menus.find(m => m.id === menuId);
                          if (foundMenu && foundMenu.sub_menu_items) {
                            parentMenu = foundMenu;
                            // idで検索、なければindexベースのIDで検索
                            subMenu = foundMenu.sub_menu_items.find((sm, idx) => {
                              const smId = sm.id || `submenu-${idx}`;
                              return smId === subMenuId;
                            });
                            break;
                          }
                        }
                        
                        return subMenu ? (
                          <div key={`${menuId}-${subMenuId}`} className="text-sm">
                            • {parentMenu?.name} - {subMenu.name}
                            {subMenu.price ? ` (¥${subMenu.price.toLocaleString()})` : ''}
                            {subMenu.duration ? ` • ${subMenu.duration}分` : ''}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
                
                {formData.message && (
                  <div>
                    <span className="text-gray-600">メッセージ:</span>
                    <div className="ml-4 mt-1 text-sm">{formData.message}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 予約ボタン */}
          <button
            type="submit"
            disabled={submitting || getAvailableTimeSlots().length === 0}
            className="w-full py-3 rounded-md text-white font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            style={{ backgroundColor: form.config.basic_info.theme_color }}
          >
            {submitting ? '送信中...' : getAvailableTimeSlots().length === 0 ? '選択した日は定休日です' : 'ご予約内容を確認する'}
          </button>
        </form>
      </div>
    </div>
  );
}
