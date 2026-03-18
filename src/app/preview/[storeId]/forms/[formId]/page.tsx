'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Form } from '@/types/form';
import { normalizeForm } from '@/lib/form-normalizer';

export default function PreviewFormPage() {
  const params = useParams();
  const storeId = params.storeId as string;
  const formId = params.formId as string;
  
  // プレビューモードは常に有効
  const [isPreviewMode] = useState(true);
  
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
    selectedCategoryOptions: {} as Record<string, string[]>, // カテゴリーIDに対する共通オプションID配列
    customFields: {} as Record<string, string | string[]>, // カスタムフィールドの値
    selectedDate: '',
    selectedTime: '',
    // 第三希望日時モード用
    selectedDate2: '',
    selectedTime2: '',
    selectedDate3: '',
    selectedTime3: ''
  });

  // サブメニューアコーディオンの開閉状態
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set());

  // カレンダー用の状態
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = new Date();
    return getWeekStart(today);
  });
  const [selectedDateTime, setSelectedDateTime] = useState<Date | null>(null);

  // カレンダー空き状況の状態
  const [availabilityData, setAvailabilityData] = useState<any[] | null>(null);
  const [businessDays, setBusinessDays] = useState<Array<{ start: Date; end: Date }>>([]);
  const [availabilityCache, setAvailabilityCache] = useState<Record<string, { availability: any[]; businessDays: Array<{ start: Date; end: Date }> }>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 週の開始日を取得（月曜日）
  function getWeekStart(date: Date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 月曜日を週の開始とする
    return new Date(d.setDate(diff));
  }

  // 事前予約可能日数の上限日を取得（当日を含め advance_booking_days 日先の23:59:59 まで）
  const getMaxBookingDate = () => {
    const days = form?.config?.calendar_settings?.advance_booking_days ?? 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const max = new Date(today);
    max.setDate(today.getDate() + days);
    max.setHours(23, 59, 59, 999);
    return max;
  };

  const isWithinAdvanceWindow = (date: Date) => {
    const max = getMaxBookingDate();
    return date.getTime() <= max.getTime();
  };

  // プレビューモード検出とフォーム取得（統合）
  useEffect(() => {
    const fetchForm = async () => {
      try {
        setLoading(true);
        
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
        
        // 店舗IDが一致するかチェック
        if (formData.store_id !== storeId) {
          setError('アクセス権限がありません');
          return;
        }
        
        // フォームデータの正規化（共通 normalizer を使用）
        const normalizedForm = normalizeForm(formData);
        
        // プレビューモードでは全てのステータスのフォームを表示
        setForm(normalizedForm);
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

  // ローカルストレージに選択内容を保存
  const saveSelectionToStorage = useCallback(() => {
    if (!form) return;
    
    const selectionData = {
      formId: form.id,
      selectedMenus: formData.selectedMenus,
      selectedSubMenus: formData.selectedSubMenus,
      selectedMenuOptions: formData.selectedMenuOptions,
      selectedCategoryOptions: formData.selectedCategoryOptions,
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
        selectedCategoryOptions: selectionData.selectedCategoryOptions || {},
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
    const allowCrossCategory = form?.config?.menu_structure?.allow_cross_category_selection || false;
    
    if (allowCrossCategory || isMultiple) {
      // カテゴリーまたいでの複数選択が有効な場合、全カテゴリー横断で管理
      if (allowCrossCategory) {
        // 全カテゴリーから選択されたメニューIDを収集
        const allSelectedMenuIds = Object.values(formData.selectedMenus).flat();
        const isSelected = allSelectedMenuIds.includes(menuId);
        
        if (isSelected) {
          // 選択解除
          const newSelectedMenus: Record<string, string[]> = {};
          Object.entries(formData.selectedMenus).forEach(([catId, menuIds]) => {
            const filtered = menuIds.filter(id => id !== menuId);
            if (filtered.length > 0) {
              newSelectedMenus[catId] = filtered;
            }
          });
          
          setFormData(prev => ({
            ...prev,
            selectedMenus: newSelectedMenus,
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
          // 選択追加
          const currentSelection = formData.selectedMenus[categoryId] || [];
          const newSelection = [...currentSelection, menuId];
          
          // デフォルトオプションを自動選択
          const menu = form?.config.menu_structure.categories
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
            setTimeout(() => saveSelectionToStorage(), 100);
            return newFormData;
          });
        }
      } else {
        // 従来の動作（カテゴリー単位の複数選択）
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

  const handleCategoryOptionSelection = (categoryId: string, optionId: string) => {
    const current = formData.selectedCategoryOptions[categoryId] || [];
    const isSelected = current.includes(optionId);
    setFormData(prev => ({
      ...prev,
      selectedCategoryOptions: {
        ...prev.selectedCategoryOptions,
        [categoryId]: isSelected
          ? current.filter(id => id !== optionId)
          : [...current, optionId],
      },
    }));
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
    
    // 日時選択のバリデーション（モード別）
    if (form.config?.calendar_settings?.booking_mode === 'multiple_dates') {
      // 第三希望日時モード
      if (!formData.selectedDate || !formData.selectedTime) {
        alert('第一希望日時を選択してください');
        return;
      }
      if (!formData.selectedDate2 || !formData.selectedTime2) {
        alert('第二希望日時を選択してください');
        return;
      }
      if (!formData.selectedDate3 || !formData.selectedTime3) {
        alert('第三希望日時を選択してください');
        return;
      }
    } else {
      // カレンダーモード
      if (!formData.selectedDate) {
        alert('ご希望日を選択してください');
        return;
      }
      
      if (!formData.selectedTime) {
        alert('ご希望時間を選択してください');
        return;
      }
    }

    // 性別が必須の場合のチェック
    if (form.config.gender_selection.enabled && form.config.gender_selection.required && !formData.gender) {
      alert('性別を選択してください');
      return;
    }

    // カスタムフィールドのバリデーション
    if (form.config.custom_fields) {
      for (const field of form.config.custom_fields) {
        if (field.required) {
          const value = formData.customFields[field.id];
          if (!value || (Array.isArray(value) && value.length === 0) || (typeof value === 'string' && !value.trim())) {
            alert(`${field.title}を入力してください`);
            return;
          }
        }
      }
    }

    // 確認画面を表示
    setShowConfirmation(true);
  };

  const buildSelectionPayload = useCallback(() => {
    if (!form) {
      return { selectedMenus: [], selectedOptions: [] };
    }

    const selectedMenus: Array<Record<string, unknown>> = [];
    const selectedOptions: Array<Record<string, unknown>> = [];
    const categories = form.config.menu_structure?.categories || [];

    const processMenu = (category: any, menu: any, submenu: any, menuId: string) => {
      const price = submenu ? (submenu.price || 0) : (menu.price || 0);
      const duration = submenu ? (submenu.duration || 0) : (menu.duration || 0);

      selectedMenus.push({
        menu_id: menu.id,
        menu_name: menu.name || '',
        category_name: category?.name || '',
        price,
        duration,
        ...(submenu ? { submenu_id: submenu.id, submenu_name: submenu.name || '' } : {})
      });

      const optionIds = formData.selectedMenuOptions?.[menuId] || [];
      optionIds.forEach(optionId => {
        const option = menu.options?.find((o: any) => o.id === optionId);
        if (option) {
          selectedOptions.push({
            option_id: option.id,
            option_name: option.name || '',
            menu_id: menuId,
            price: option.price || 0,
            duration: option.duration || 0
          });
        }
      });
    };

    categories.forEach(category => {
      const menuIds = formData.selectedMenus[category.id] || [];
      menuIds.forEach(menuId => {
        const menu = category.menus?.find((m: any) => m.id === menuId);
        if (!menu) return;
        const subId = formData.selectedSubMenus?.[menuId];
        const submenu = subId && menu.sub_menu_items ? menu.sub_menu_items.find((s: any) => s.id === subId) : null;
        processMenu(category, menu, submenu, menuId);
      });
    });

    return { selectedMenus, selectedOptions };
  }, [form, formData]);

  const handleConfirmSubmit = async () => {
    if (!form) return;

    setSubmitting(true);
    
    try {
      const { selectedMenus, selectedOptions } = buildSelectionPayload();
      const reservationData = {
        form_id: form.id,
        store_id: form.store_id,
        customer_name: formData.name,
        customer_phone: formData.phone,
        reservation_date: formData.selectedDate,
        reservation_time: formData.selectedTime,
        message: formData.message || null,
        selected_menus: selectedMenus,
        selected_options: selectedOptions,
        customer_info: {
          gender: formData.gender || null,
          visit_count: formData.visitCount || null,
          coupon: formData.couponUsage || null,
          custom_fields: formData.customFields || {}
        }
      };

      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reservationData),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(errorText || '送信に失敗しました');
      }

      setSubmitted(true);
      setShowConfirmation(false);
    } catch (error) {
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

  // カレンダー空き状況を取得
  const fetchCalendarAvailability = useCallback(async (date: Date) => {
    if (!form?.store_id) {
      return;
    }

    const startTime = new Date(date);
    startTime.setHours(0, 0, 0, 0);
    const endTime = new Date(date);
    endTime.setDate(endTime.getDate() + 7);
    endTime.setHours(23, 59, 59, 999);

    const cacheKey = startTime.toISOString() + endTime.toISOString();

    // キャッシュを確認
    if (availabilityCache[cacheKey]) {
      setAvailabilityData(availabilityCache[cacheKey].availability);
      setBusinessDays(availabilityCache[cacheKey].businessDays);
      return;
    }

    const url = `/api/stores/${form.store_id}/calendar/availability` +
      `?start=${startTime.toISOString()}&end=${endTime.toISOString()}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      // 営業日の情報を抽出
      const businessDaysData = data.filter((event: any) => event.summary === "営業日").map((event: any) => {
        return {
          start: new Date(event.startTime),
          end: new Date(event.endTime)
        };
      });

      // データをキャッシュに保存
      const newCache = {
        ...availabilityCache,
        [cacheKey]: { availability: data, businessDays: businessDaysData }
      };
      setAvailabilityCache(newCache);
      setAvailabilityData(data);
      setBusinessDays(businessDaysData);
    } catch (error) {
      // エラーメッセージを設定
      setErrorMessage('カレンダーの空き状況を取得できませんでした。営業時間のみで判定します。');
      
      // 5秒後に自動で非表示
      setTimeout(() => setErrorMessage(null), 5000);
      
      // エラー時は空き状況データをnullにして、営業時間のみで判定
      setAvailabilityData(null);
      setBusinessDays([]);
    }
  }, [form?.store_id, availabilityCache]);

  // 営業時間に基づいて時間選択肢を生成
  const getAvailableTimeSlots = (date?: Date) => {
    if (!form || (!formData.selectedDate && !date)) return [];
    
    const targetDate = date || new Date(formData.selectedDate);
    // 予約可能期間外は空枠なし
    if (!isWithinAdvanceWindow(targetDate)) return [];
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
    
    const dateString = date.toISOString().split('T')[0];
    
    setSelectedDateTime(dateTime);
    setFormData(prev => ({
      ...prev,
      selectedDate: dateString,
      selectedTime: time
    }));
  };


  // 週の移動
  const navigateWeek = (direction: 'prev' | 'next') => {
    const newWeekStart = new Date(currentWeekStart);
    newWeekStart.setDate(currentWeekStart.getDate() + (direction === 'next' ? 7 : -7));
    // 上限週を越えないようにクランプ
    const maxWeekStart = getWeekStart(getMaxBookingDate());
    if (direction === 'next' && newWeekStart > maxWeekStart) {
      setCurrentWeekStart(maxWeekStart);
      fetchCalendarAvailability(maxWeekStart);
      return;
    }
    setCurrentWeekStart(newWeekStart);
    fetchCalendarAvailability(newWeekStart);
  };

  // 月の移動
  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentWeekStart);
    newDate.setMonth(currentWeekStart.getMonth() + (direction === 'next' ? 1 : -1));
    let nextWeekStart = getWeekStart(newDate);
    const maxWeekStart = getWeekStart(getMaxBookingDate());
    if (direction === 'next' && nextWeekStart > maxWeekStart) {
      nextWeekStart = maxWeekStart;
    }
    setCurrentWeekStart(nextWeekStart);
    fetchCalendarAvailability(nextWeekStart);
  };

  // メニューが選択されているかチェック
  const isMenuSelected = useCallback(() => {
    // 通常のメニューが選択されているかチェック
    const hasSelectedMenus = Object.values(formData.selectedMenus).some(menuIds => menuIds.length > 0);
    
    // サブメニューが選択されているかチェック
    const hasSelectedSubMenus = Object.values(formData.selectedSubMenus).some(subMenuId => subMenuId !== '');
    
    return hasSelectedMenus || hasSelectedSubMenus;
  }, [formData.selectedMenus, formData.selectedSubMenus]);

  // カレンダー表示時に空き状況を取得
  useEffect(() => {
    if (form && isMenuSelected() && form.config?.calendar_settings?.booking_mode !== 'multiple_dates') {
      fetchCalendarAvailability(currentWeekStart);
    }
  }, [form, isMenuSelected, currentWeekStart, fetchCalendarAvailability]);

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
      <div className="min-h-screen bg-gray-50 py-4 px-2 sm:py-8 sm:px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm p-6 sm:p-8 text-center">
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
                              if (!menu) return null;
                              
                              // オプション情報を取得
                              const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                              const optionTexts = selectedOptions.map(optionId => {
                                const option = menu.options?.find(o => o.id === optionId);
                                if (!option) return '';
                                let text = option.name;
                                if (option.price && option.price > 0) {
                                  text += ` (+¥${option.price.toLocaleString()})`;
                                }
                                if (option.duration && option.duration > 0) {
                                  text += ` (+${option.duration}分)`;
                                }
                                return text;
                              }).filter(Boolean);
                              
                              return (
                                <div key={menuId}>
                                  • {menu.name} {menu.price ? `(¥${menu.price.toLocaleString()})` : ''} {menu.duration ? `(${menu.duration}分)` : ''}
                                  {optionTexts.length > 0 && (
                                    <div className="ml-4 text-xs text-gray-500">
                                      + {optionTexts.join(', ')}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {Object.entries(formData.selectedSubMenus).some(([, subMenuId]) => subMenuId !== '') && (
                  <div>
                    <span className="font-medium">選択サブメニュー:</span>
                    <div className="ml-4">
                      {Object.entries(formData.selectedSubMenus).map(([menuId, subMenuId]) => {
                        if (!subMenuId) return null;
                        
                        // メニューを探す
                        let parentMenu = null;
                        let subMenu = null;
                        
                        for (const category of form.config.menu_structure.categories) {
                          const foundMenu = category.menus.find(m => m.id === menuId);
                          if (foundMenu && foundMenu.sub_menu_items) {
                            parentMenu = foundMenu;
                            subMenu = foundMenu.sub_menu_items.find((sm, idx) => {
                              const smId = sm.id || `submenu-${idx}`;
                              return smId === subMenuId;
                            });
                            break;
                          }
                        }
                        
                        if (!subMenu || !parentMenu) return null;
                        
                        // オプション情報を取得
                        const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                        const optionTexts = selectedOptions.map(optionId => {
                          const option = parentMenu.options?.find(o => o.id === optionId);
                          if (!option) return '';
                          let text = option.name;
                          if (option.price && option.price > 0) {
                            text += ` (+¥${option.price.toLocaleString()})`;
                          }
                          if (option.duration && option.duration > 0) {
                            text += ` (+${option.duration}分)`;
                          }
                          return text;
                        }).filter(Boolean);
                        
                        return (
                          <div key={`${menuId}-${subMenuId}`}>
                            • {parentMenu.name} - {subMenu.name} {subMenu.price ? `(¥${subMenu.price.toLocaleString()})` : ''} {subMenu.duration ? `(${subMenu.duration}分)` : ''}
                            {optionTexts.length > 0 && (
                              <div className="ml-4 text-xs text-gray-500">
                                + {optionTexts.join(', ')}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(() => {
                  // 合計金額と合計時間を計算
                  let totalPrice = 0;
                  let totalDuration = 0;
                  
                  // 通常メニューの合計
                  Object.entries(formData.selectedMenus).forEach(([categoryId, menuIds]) => {
                    const category = form.config.menu_structure.categories.find(c => c.id === categoryId);
                    menuIds.forEach(menuId => {
                      const menu = category?.menus.find(m => m.id === menuId);
                      if (menu) {
                        totalPrice += menu.price || 0;
                        totalDuration += menu.duration || 0;
                        // オプションの合計
                        const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                        selectedOptions.forEach(optionId => {
                          const option = menu.options?.find(o => o.id === optionId);
                          if (option) {
                            totalPrice += option.price || 0;
                            totalDuration += option.duration || 0;
                          }
                        });
                      }
                    });
                  });
                  
                  // サブメニューの合計
                  Object.entries(formData.selectedSubMenus).forEach(([menuId, subMenuId]) => {
                    if (!subMenuId) return;
                    for (const category of form.config.menu_structure.categories) {
                      const foundMenu = category.menus.find(m => m.id === menuId);
                      if (foundMenu && foundMenu.sub_menu_items) {
                        const subMenu = foundMenu.sub_menu_items.find((sm, idx) => {
                          const smId = sm.id || `submenu-${idx}`;
                          return smId === subMenuId;
                        });
                        if (subMenu) {
                          totalPrice += subMenu.price || 0;
                          totalDuration += subMenu.duration || 0;
                          // オプションの合計
                          const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                          selectedOptions.forEach(optionId => {
                            const option = foundMenu.options?.find(o => o.id === optionId);
                            if (option) {
                              totalPrice += option.price || 0;
                              totalDuration += option.duration || 0;
                            }
                          });
                        }
                        break;
                      }
                    }
                  });
                  
                  if (totalPrice > 0 || totalDuration > 0) {
                    return (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        {totalPrice > 0 && (
                          <div className="font-semibold text-base">合計金額: ¥{totalPrice.toLocaleString()}</div>
                        )}
                        {totalDuration > 0 && (
                          <div className="font-semibold text-base mt-1">合計時間: {totalDuration}分</div>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}
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
                  selectedCategoryOptions: {},
                  customFields: {},
                  selectedDate: '',
                  selectedTime: '',
                  selectedDate2: '',
                  selectedTime2: '',
                  selectedDate3: '',
                  selectedTime3: ''
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
                                if (!menu) return null;
                                
                                // オプション情報を取得
                                const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                                const optionTexts = selectedOptions.map(optionId => {
                                  const option = menu.options?.find(o => o.id === optionId);
                                  return option ? option.name : '';
                                }).filter(Boolean);
                                
                                return (
                                  <div key={menuId} className="text-sm font-medium">
                                    • {menu.name} {menu.price ? `(¥${menu.price.toLocaleString()})` : ''} {menu.duration ? `(${menu.duration}分)` : ''}
                                    {optionTexts.length > 0 && (
                                      <div className="ml-4 text-xs text-gray-500">
                                        + {optionTexts.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                );
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
                  
                  {(() => {
                    // 合計金額と合計時間を計算
                    let totalPrice = 0;
                    let totalDuration = 0;
                    
                    // 通常メニューの合計
                    Object.entries(formData.selectedMenus).forEach(([categoryId, menuIds]) => {
                      const category = form.config.menu_structure.categories.find(c => c.id === categoryId);
                      menuIds.forEach(menuId => {
                        const menu = category?.menus.find(m => m.id === menuId);
                        if (menu) {
                          totalPrice += menu.price || 0;
                          totalDuration += menu.duration || 0;
                          // オプションの合計
                          const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                          selectedOptions.forEach(optionId => {
                            const option = menu.options?.find(o => o.id === optionId);
                            if (option) {
                              totalPrice += option.price || 0;
                              totalDuration += option.duration || 0;
                            }
                          });
                        }
                      });
                    });
                    
                    // サブメニューの合計
                    Object.entries(formData.selectedSubMenus).forEach(([menuId, subMenuId]) => {
                      if (!subMenuId) return;
                      for (const category of form.config.menu_structure.categories) {
                        const foundMenu = category.menus.find(m => m.id === menuId);
                        if (foundMenu && foundMenu.sub_menu_items) {
                          const subMenu = foundMenu.sub_menu_items.find((sm, idx) => {
                            const smId = sm.id || `submenu-${idx}`;
                            return smId === subMenuId;
                          });
                          if (subMenu) {
                            totalPrice += subMenu.price || 0;
                            totalDuration += subMenu.duration || 0;
                            // オプションの合計
                            const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                            selectedOptions.forEach(optionId => {
                              const option = foundMenu.options?.find(o => o.id === optionId);
                              if (option) {
                                totalPrice += option.price || 0;
                                totalDuration += option.duration || 0;
                              }
                            });
                          }
                          break;
                        }
                      }
                    });
                    
                    if (totalPrice > 0 || totalDuration > 0) {
                      return (
                        <div className="pt-4 mt-4 border-t border-gray-200">
                          {totalPrice > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600 font-semibold">合計金額</span>
                              <span className="font-bold text-lg">¥{totalPrice.toLocaleString()}</span>
                            </div>
                          )}
                          {totalDuration > 0 && (
                            <div className="flex justify-between mt-2">
                              <span className="text-gray-600 font-semibold">合計時間</span>
                              <span className="font-bold text-lg">{totalDuration}分</span>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })()}
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
    <div className="min-h-screen bg-gray-50 py-4 px-2 sm:py-8 sm:px-4">
      <div className="max-w-2xl mx-auto">
        {/* プレビューモードバナー */}
        {isPreviewMode && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 sm:p-4">
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
          className="rounded-lg shadow-sm p-4 sm:p-6 mb-6 text-white"
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
          <div className="mb-6">
            <button
              type="button"
              onClick={handleRepeatBooking}
              className="w-full inline-flex items-center justify-center px-5 py-3 border-2 border-dashed rounded-lg text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                borderColor: form.config?.basic_info?.theme_color || '#3B82F6',
                color: form.config?.basic_info?.theme_color || '#3B82F6',
                backgroundColor: 'transparent'
              }}
              onMouseEnter={(e) => {
                const themeColor = form.config?.basic_info?.theme_color || '#3B82F6';
                e.currentTarget.style.backgroundColor = `${themeColor}15`;
                e.currentTarget.style.borderColor = themeColor;
              }}
              onMouseLeave={(e) => {
                const themeColor = form.config?.basic_info?.theme_color || '#3B82F6';
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = themeColor;
              }}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>前回と同じメニューで予約する</span>
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

          .calendar {
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
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

          .calendar th:not(:first-child) {
            font-size: 0.7rem;
            line-height: 1.3;
            word-break: keep-all;
            white-space: normal;
            min-width: 0;
            padding: 0.4rem 0.3rem;
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

            .calendar th:not(:first-child) {
              font-size: 0.55rem;
              line-height: 1.25;
              padding: 0.35rem 0.1rem;
            }
          }

          /* iPhone SE〜さらに狭い画面（LINEアプリ内など） */
          @media (max-width: 420px) {
            .calendar table {
              min-width: 420px;
            }

            .calendar th,
            .calendar td {
              font-size: 8px !important;
              padding: 2px 1px !important;
            }

            .calendar th:not(:first-child) {
              font-size: 0.45rem !important;
              line-height: 1.25 !important;
              padding: 0.25rem 0.05rem !important;
            }

            .calendar th {
              line-height: 1.1 !important;
            }

            .calendar th:first-child,
            .calendar td:first-child {
              min-width: 50px;
            }
          }
        `}</style>

        {/* 予約フォーム */}
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">ご予約内容</h2>

          {/* 注意書きバナー */}
          {form.config.basic_info?.notice && (
            <div className="mb-5 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 leading-relaxed whitespace-pre-wrap">
              {form.config.basic_info.notice}
            </div>
          )}

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

          {/* カスタムフィールド - クーポンの下、メニューの上 */}
          {form.config?.custom_fields && form.config.custom_fields.length > 0 && (
            <div className="mb-6">
              {form.config.custom_fields.map((field) => (
                <div key={field.id} className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {field.title} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {field.type === 'text' && (
                    <input
                      type="text"
                      value={(formData.customFields[field.id] as string) || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        customFields: {
                          ...prev.customFields,
                          [field.id]: e.target.value
                        }
                      }))}
                      placeholder={field.placeholder || ''}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required={field.required}
                    />
                  )}
                  {field.type === 'textarea' && (
                    <textarea
                      value={(formData.customFields[field.id] as string) || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        customFields: {
                          ...prev.customFields,
                          [field.id]: e.target.value
                        }
                      }))}
                      placeholder={field.placeholder || ''}
                      rows={4}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required={field.required}
                    />
                  )}
                  {field.type === 'radio' && field.options && (
                    <div className="flex space-x-4">
                      {field.options.map((option, optionIndex) => (
                        <button
                          key={option.value || `option-${optionIndex}`}
                          type="button"
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            customFields: {
                              ...prev.customFields,
                              [field.id]: option.value
                            }
                          }))}
                          className={`flex-1 py-3 px-4 border-2 rounded-md font-medium transition-all duration-200 ${
                            (formData.customFields[field.id] as string) === option.value
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {field.type === 'checkbox' && field.options && (
                    <div className="space-y-2">
                      {field.options.map((option, optionIndex) => (
                        <label
                          key={option.value || `option-${optionIndex}`}
                          className="flex items-center space-x-2 p-2 border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={((formData.customFields[field.id] as string[]) || []).includes(option.value)}
                            onChange={(e) => {
                              const currentValues = (formData.customFields[field.id] as string[]) || [];
                              const newValues = e.target.checked
                                ? [...currentValues, option.value]
                                : currentValues.filter(v => v !== option.value);
                              setFormData(prev => ({
                                ...prev,
                                customFields: {
                                  ...prev.customFields,
                                  [field.id]: newValues
                                }
                              }));
                            }}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="text-sm text-gray-700">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
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
                    {category.name && (
                      <h3 className="text-sm font-semibold text-gray-800 mb-3">{category.name}</h3>
                    )}
                    <div className="space-y-2">
                      {(category.menus || [])
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
                                <div className="flex items-center gap-3">
                                  {menu.image && (
                                    <div className="w-16 rounded overflow-hidden flex-shrink-0" style={{ aspectRatio: '16/9' }}>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img 
                                        src={menu.image} 
                                        alt={menu.name}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                    </div>
                                  )}
                                  <div>
                                    <svg 
                                      className={`inline-block mr-2 h-5 w-5 transform transition-transform ${
                                        expandedMenus.has(menu.id) ? 'rotate-90' : ''
                                      }`}
                                      fill="none" 
                                      stroke="currentColor" 
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    <div className="text-left inline">{menu.name}</div>
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
                                      className={`w-full text-left border-2 rounded-md font-medium transition-all duration-200 overflow-hidden ${
                                        formData.selectedSubMenus[menu.id] === subMenuId
                                          ? 'border-green-500 bg-green-50'
                                          : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50'
                                      }`}
                                    >
                                      {subMenu.image ? (
                                        // 画像がある場合：画像を上に、情報を下に配置
                                        <div className="flex flex-col">
                                          <div className="w-full rounded-t-sm overflow-hidden" style={{ aspectRatio: '16/9' }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img 
                                              src={subMenu.image} 
                                              alt={subMenu.name}
                                              className="w-full h-full object-cover"
                                              onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                              }}
                                            />
                                          </div>
                                          <div className="p-3">
                                            <div className={`font-semibold mb-1 ${formData.selectedSubMenus[menu.id] === subMenuId ? 'text-green-700' : 'text-gray-900'}`}>
                                              {subMenu.name}
                                            </div>
                                            {subMenu.description && (
                                              <div className="text-xs text-gray-600 mb-2">{subMenu.description}</div>
                                            )}
                                            <div className="flex justify-between items-center gap-2 text-sm">
                                              {subMenu.price > 0 && !subMenu.hide_price && (
                                                <div className="font-semibold">¥{subMenu.price.toLocaleString()}</div>
                                              )}
                                              {true && (
                                                <div className="text-gray-600">{subMenu.duration}分</div>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      ) : (
                                        // 画像がない場合：従来のレイアウト
                                        <div className="flex items-center justify-between p-3">
                                          <div className="flex items-center gap-3">
                                            <div>
                                              <div className={`text-left ${formData.selectedSubMenus[menu.id] === subMenuId ? 'text-green-700' : ''}`}>{subMenu.name}</div>
                                              {subMenu.description && (
                                                <div className="text-sm opacity-70 text-left">{subMenu.description}</div>
                                              )}
                                            </div>
                                          </div>
                                          <div className="text-right ml-4">
                                            {subMenu.price > 0 && !subMenu.hide_price && (
                                              <div className="font-semibold">¥{subMenu.price.toLocaleString()}</div>
                                            )}
                                            {true && (
                                              <div className="text-sm opacity-70">{subMenu.duration}分</div>
                                            )}
                                          </div>
                                        </div>
                                      )}
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
                              onClick={() => {
                                const allowCrossCategory = form.config?.menu_structure?.allow_cross_category_selection || false;
                                const isMultiple = allowCrossCategory || category.selection_mode === 'multiple';
                                handleMenuSelection(category.id, menu.id, isMultiple);
                              }}
                              className={`w-full text-left border-2 rounded-md font-medium transition-all duration-200 overflow-hidden ${
                                (() => {
                                  const allowCrossCategory = form.config?.menu_structure?.allow_cross_category_selection || false;
                                  if (allowCrossCategory) {
                                    // カテゴリーまたいでの複数選択が有効な場合、全カテゴリーから選択されたメニューIDを収集
                                    const allSelectedMenuIds = Object.values(formData.selectedMenus).flat();
                                    return allSelectedMenuIds.includes(menu.id);
                                  } else {
                                    return formData.selectedMenus[category.id]?.includes(menu.id);
                                  }
                                })()
                                  ? 'border-green-500 bg-green-50'
                                  : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50'
                              }`}
                            >
                              {menu.image ? (
                                // 画像がある場合：画像を上に、情報を下に配置
                                <div className="flex flex-col">
                                  <div className="w-full rounded-t-sm overflow-hidden" style={{ aspectRatio: '16/9' }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img 
                                      src={menu.image} 
                                      alt={menu.name}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </div>
                                  <div className="p-3">
                                    <div className={`font-semibold mb-1 ${(() => {
                                      const allowCrossCategory = form.config?.menu_structure?.allow_cross_category_selection || false;
                                      if (allowCrossCategory) {
                                        const allSelectedMenuIds = Object.values(formData.selectedMenus).flat();
                                        return allSelectedMenuIds.includes(menu.id);
                                      } else {
                                        return formData.selectedMenus[category.id]?.includes(menu.id);
                                      }
                                    })() ? 'text-green-700' : 'text-gray-900'}`}>
                                      {menu.name}
                                    </div>
                                    {menu.description && (
                                      <div className="text-xs text-gray-600 mb-2">{menu.description}</div>
                                    )}
                                    <div className="flex justify-between items-center gap-2 text-sm">
                                      {menu.price !== undefined && menu.price > 0 && !menu.hide_price && (
                                        <div className="font-semibold">¥{menu.price.toLocaleString()}</div>
                                      )}
                                      {true && menu.duration !== undefined && (
                                        <div className="text-gray-600">{menu.duration}分</div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                // 画像がない場合：従来のレイアウト
                                <div className="flex items-center justify-between p-3">
                                  <div>
                                    <div className={`text-left ${(() => {
                                      const allowCrossCategory = form.config?.menu_structure?.allow_cross_category_selection || false;
                                      if (allowCrossCategory) {
                                        const allSelectedMenuIds = Object.values(formData.selectedMenus).flat();
                                        return allSelectedMenuIds.includes(menu.id);
                                      } else {
                                        return formData.selectedMenus[category.id]?.includes(menu.id);
                                      }
                                    })() ? 'text-green-700' : ''}`}>{menu.name}</div>
                                    {menu.description && (
                                      <div className="text-sm opacity-70 text-left">{menu.description}</div>
                                    )}
                                  </div>
                                  <div className="text-right ml-4">
                                    {menu.price !== undefined && menu.price > 0 && !menu.hide_price && (
                                      <div className="font-semibold">¥{menu.price.toLocaleString()}</div>
                                    )}
                                    {true && menu.duration !== undefined && (
                                      <div className="text-sm opacity-70">{menu.duration}分</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </button>
                          )}
                          
                          {/* メニューオプション（サブメニューを使わない場合のみ表示） */}
                          {!menu.has_submenu && menu.options && menu.options.length > 0 && 
                           (() => {
                             const allowCrossCategory = form.config?.menu_structure?.allow_cross_category_selection || false;
                             if (allowCrossCategory) {
                               const allSelectedMenuIds = Object.values(formData.selectedMenus).flat();
                               return allSelectedMenuIds.includes(menu.id);
                             } else {
                               return formData.selectedMenus[category.id]?.includes(menu.id);
                             }
                           })() && (
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
                                    {!option.hide_price && (
                                      <div className="font-medium">
                                        {option.price > 0 ? `+¥${option.price.toLocaleString()}` : '無料'}
                                      </div>
                                    )}
                                    {option.duration > 0 && (
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
                    {/* カテゴリー共通オプション */}
                    {category.options && category.options.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                        <div className="text-sm font-medium text-gray-700">オプション</div>
                        {category.options.map((opt: { id?: string; name: string; description?: string; price?: number; hide_price?: boolean; duration?: number }, optIdx: number) => {
                          const optId = opt.id || `catopt-${optIdx}`;
                          const isSelected = (formData.selectedCategoryOptions[category.id] || []).includes(optId);
                          return (
                            <button
                              key={optId}
                              type="button"
                              onClick={() => handleCategoryOptionSelection(category.id, optId)}
                              className={`w-full flex items-center justify-between p-2.5 border-2 rounded-md text-left transition-all duration-150 ${
                                isSelected ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-white hover:border-gray-400'
                              }`}
                            >
                              <div>
                                <div className={`text-sm font-medium ${isSelected ? 'text-green-700' : 'text-gray-800'}`}>{opt.name}</div>
                                {opt.description && <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>}
                              </div>
                              <div className="text-right ml-3 shrink-0">
                                {(opt.price || 0) > 0 && !opt.hide_price && (
                                  <div className="text-sm font-semibold">+¥{(opt.price || 0).toLocaleString()}</div>
                                )}
                                {(opt.duration || 0) > 0 && (
                                  <div className="text-xs text-gray-500">+{opt.duration}分</div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 希望日時 - メニューが選択された場合のみ表示 */}
          {isMenuSelected() && (
            <>
              {/* カレンダーモード */}
              {(!form.config?.calendar_settings?.booking_mode || form.config.calendar_settings.booking_mode === 'calendar') && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    希望日時 <span className="text-red-500">*</span>
                  </label>
                  <div className="text-sm text-gray-600 mb-3">
                    ※メニューを選択すると空き状況のカレンダーが表示されます
                  </div>
                
                {/* エラートースト通知 */}
                {errorMessage && (
                  <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-800 rounded-lg shadow-sm transition-opacity duration-300">
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3 flex-1">
                        <p className="text-sm font-medium">{errorMessage}</p>
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setErrorMessage(null)}
                          className="inline-flex text-yellow-600 hover:text-yellow-800 focus:outline-none"
                        >
                          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
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
                  <div className="calendar bg-white border border-gray-300 rounded shadow-sm">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-center p-2 bg-gray-100 border border-gray-400 text-xs">時間</th>
                          {getWeekDates(currentWeekStart).map((date, index) => (
                            <th key={index} className="text-center bg-gray-100 border border-gray-400" style={{ fontSize: '0.7rem', lineHeight: '1.3', padding: '0.4rem 0.3rem' }}>
                              {date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                              <br style={{ lineHeight: '0.8' }} />
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
                          return timeSlots.map((time, timeIndex) => (
                            <tr key={time}>
                              <td className="text-center p-1 border border-gray-400 text-xs bg-gray-50 font-medium">
                                {time}
                              </td>
                              {getWeekDates(currentWeekStart).map((date, dateIndex) => {
                                // 空き状況の判定
                                const now = new Date();
                                // 日付をローカル時間で取得し、時間を設定
                                const slotStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 
                                  parseInt(time.split(':')[0]), parseInt(time.split(':')[1]), 0, 0);
                                // ミリ秒で比較してタイムゾーンの問題を回避
                                const isPast = slotStart.getTime() < now.getTime();
                                
                                // メニュー時間とオプション時間を計算（全選択メニューを合計）
                                let menuDuration = 0;
                                const selectedMenuIds = Object.values(formData.selectedMenus).flat();
                                selectedMenuIds.forEach(menuId => {
                                  const category = form.config.menu_structure.categories.find(c => 
                                    c.menus.some(m => m.id === menuId)
                                  );
                                  const menu = category?.menus.find(m => m.id === menuId);
                                  if (menu) {
                                    let duration = 0;
                                    if (formData.selectedSubMenus[menuId]) {
                                      // サブメニューを探す（IDがない場合はインデックスを使用）
                                      const submenu = menu.sub_menu_items?.find((s, idx) => {
                                        const smId = s.id || `submenu-${idx}`;
                                        return smId === formData.selectedSubMenus[menuId];
                                      });
                                      duration = submenu?.duration || menu.duration || 0;
                                    } else {
                                      duration = menu.duration || 0;
                                    }
                                    
                                    // オプション時間を合計
                                    const selectedOptionIds = formData.selectedMenuOptions[menuId] || [];
                                    selectedOptionIds.forEach(optionId => {
                                      const option = menu.options?.find(o => o.id === optionId);
                                      if (option) {
                                        duration += option.duration || 0;
                                      }
                                    });
                                    
                                    menuDuration += duration;
                                  }
                                });
                                
                                // 訪問回数の時間を取得
                                let visitDuration = 0;
                                if (formData.visitCount && form.config.visit_count_selection?.enabled) {
                                  const visitOption = form.config.visit_count_selection.options.find(
                                    opt => opt.value === formData.visitCount
                                  );
                                  if (visitOption?.duration) {
                                    visitDuration = visitOption.duration;
                                  }
                                }
                                
                                // 終了時間を計算
                                const slotEnd = new Date(slotStart);
                                slotEnd.setMinutes(slotStart.getMinutes() + menuDuration + visitDuration);
                                
                                // 終了時間が翌日になる場合は不可
                                const isNextDay = slotEnd.getDate() !== slotStart.getDate();
                                
                                // 18時以降に終了する予約を不可にする
                                let endsAfter18 = false;
                                if (slotEnd.getHours() === 18 && slotEnd.getMinutes() > 0) {
                                  endsAfter18 = true;
                                } else if (slotEnd.getHours() > 18) {
                                  endsAfter18 = true;
                                }
                                
                                // 営業時間チェック
                                const dayOfWeek = date.getDay();
                                const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                                const dayName = dayNames[dayOfWeek] as keyof typeof form.config.calendar_settings.business_hours;
                                const businessHours = form.config.calendar_settings.business_hours[dayName];
                                const isClosed = businessHours?.closed === true;
                                
                                let isWithinBusinessHours = true;
                                if (!isClosed && businessHours) {
                                  const timeHour = parseInt(time.split(':')[0]);
                                  const timeMinute = parseInt(time.split(':')[1]);
                                  const timeMinutes = timeHour * 60 + timeMinute;
                                  
                                  const openTime = businessHours.open || '09:00';
                                  const closeTime = businessHours.close || '18:00';
                                  const openHour = parseInt(openTime.split(':')[0]);
                                  const openMinute = parseInt(openTime.split(':')[1]);
                                  const openMinutes = openHour * 60 + openMinute;
                                  
                                  const closeHour = parseInt(closeTime.split(':')[0]);
                                  const closeMinute = parseInt(closeTime.split(':')[1]);
                                  const closeMinutes = closeHour * 60 + closeMinute;
                                  
                                  isWithinBusinessHours = timeMinutes >= openMinutes && timeMinutes < closeMinutes;
                                }
                                
                                // 予約可能期間の判定
                                const withinWindow = isWithinAdvanceWindow(date);
                                
                                // 空き状況の判定
                                let isAvailable = false;
                                
                                if (isPast || isNextDay || endsAfter18 || !withinWindow || isClosed || !isWithinBusinessHours) {
                                  isAvailable = false;
                                } else if (availabilityData && availabilityData.length > 0) {
                                  // カレンダーAPIから取得したデータがある場合
                                  const day = new Date(date);
                                  day.setHours(0, 0, 0, 0);
                                  
                                  // 営業日のイベント時間帯を取得
                                  let businessEventTimes: Array<{ start: Date; end: Date }> = [];
                                  availabilityData.forEach((slot: any) => {
                                    const eventStart = new Date(slot.startTime);
                                    const eventEnd = new Date(slot.endTime);
                                    if (eventStart.toDateString() === day.toDateString() && slot.title === "営業日") {
                                      businessEventTimes.push({ start: eventStart, end: eventEnd });
                                    }
                                  });
                                  
                                  // 営業日チェック
                                  const isBusinessDay = businessDays.some(businessDay => {
                                    const businessDayStart = new Date(businessDay.start);
                                    const businessDayEnd = new Date(businessDay.end);
                                    return slotStart >= businessDayStart && slotEnd <= businessDayEnd;
                                  });
                                  
                                  // 営業日のイベント時間内かチェック
                                  const isBusinessEventTime = businessEventTimes.some(event => {
                                    return slotStart < event.end && event.start < slotEnd;
                                  });
                                  
                                  // 予約済みイベントの数をカウント
                                  const count = availabilityData.reduce((acc: number, slot: any) => {
                                    const eventStart = new Date(slot.startTime);
                                    const eventEnd = new Date(slot.endTime);
                                    if (eventStart < slotEnd && slotStart < eventEnd && slot.title !== "営業日") {
                                      return acc + 1;
                                    }
                                    return acc;
                                  }, 0);
                                  
                                  // 空き状況の判定ロジック
                                  if (isBusinessEventTime && count > 0) {
                                    isAvailable = false;
                                  } else if (isBusinessEventTime) {
                                    isAvailable = true;
                                  } else if (businessEventTimes.length > 0) {
                                    isAvailable = false;
                                  } else if (slotStart.getDay() === 0 && !isBusinessDay && businessEventTimes.length === 0) {
                                    isAvailable = false;
                                  } else if (isBusinessDay && count === 0) {
                                    isAvailable = true;
                                  } else if (count <= 0) {
                                    isAvailable = true;
                                  } else {
                                    isAvailable = false;
                                  }
                                } else {
                                  // カレンダーAPIから取得したデータがない場合、営業時間のみで判定
                                  isAvailable = true;
                                }
                                
                                const isSelected = selectedDateTime && 
                                  selectedDateTime.toDateString() === date.toDateString() &&
                                  selectedDateTime.toTimeString().slice(0, 5) === time;
                                
                                return (
                                  <td 
                                    key={dateIndex}
                                    onClick={() => {
                                      if (isAvailable && !isPast) {
                                        handleDateTimeSelect(date, time);
                                      }
                                    }}
                                    className={`text-center p-1 border border-gray-400 text-xs ${
                                      isAvailable && !isPast ? 'cursor-pointer' : 'cursor-not-allowed'
                                    } ${
                                      isSelected 
                                        ? 'bg-green-500 text-white' 
                                        : isAvailable && !isPast
                                          ? 'hover:bg-gray-200 bg-white'
                                          : 'bg-gray-100 text-gray-400'
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

              {/* 第三希望日時モード */}
              {form.config?.calendar_settings?.booking_mode === 'multiple_dates' && (
                <div className="space-y-6 mb-6">
                  {/* 第一希望日時 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      第一希望日時 <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={formData.selectedDate}
                        onChange={(e) => setFormData(prev => ({ ...prev, selectedDate: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">日付を選択</option>
                        {/* 日付オプションを生成 */}
                        {(() => {
                          const options = [];
                          const today = new Date();
                          const settings = form.config.calendar_settings.multiple_dates_settings || {
                            date_range_days: 30,
                            exclude_weekdays: [0]
                          };
                          
                          for (let i = 0; i < settings.date_range_days; i++) {
                            const date = new Date(today);
                            date.setDate(today.getDate() + i);
                            
                            if (settings.exclude_weekdays?.includes(date.getDay())) {
                              continue;
                            }
                            
                            const dateStr = date.toISOString().split('T')[0];
                            const displayStr = date.toLocaleDateString('ja-JP', {
                              month: 'numeric',
                              day: 'numeric',
                              weekday: 'short'
                            });
                            
                            options.push(
                              <option key={dateStr} value={dateStr}>{displayStr}</option>
                            );
                          }
                          return options;
                        })()}
                      </select>
                      <select
                        value={formData.selectedTime}
                        onChange={(e) => setFormData(prev => ({ ...prev, selectedTime: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">時間を選択</option>
                        {/* 時間オプションを生成 */}
                        {(() => {
                          const settings = form.config.calendar_settings.multiple_dates_settings || {
                            start_time: '09:00',
                            end_time: '18:00',
                            time_interval: 30
                          };
                          
                          const timeSlots = [];
                          const [startHour, startMin] = settings.start_time.split(':').map(Number);
                          const [endHour, endMin] = settings.end_time.split(':').map(Number);
                          
                          let currentHour = startHour;
                          let currentMin = startMin;
                          
                          while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
                            const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
                            timeSlots.push(
                              <option key={timeStr} value={timeStr}>{timeStr}</option>
                            );
                            
                            currentMin += settings.time_interval;
                            if (currentMin >= 60) {
                              currentHour += Math.floor(currentMin / 60);
                              currentMin = currentMin % 60;
                            }
                          }
                          
                          return timeSlots;
                        })()}
                      </select>
                    </div>
                  </div>

                  {/* 第二希望日時 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      第二希望日時 <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={formData.selectedDate2}
                        onChange={(e) => setFormData(prev => ({ ...prev, selectedDate2: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">日付を選択</option>
                        {/* 同じ日付オプション */}
                        {(() => {
                          const options = [];
                          const today = new Date();
                          const settings = form.config.calendar_settings.multiple_dates_settings || {
                            date_range_days: 30,
                            exclude_weekdays: [0]
                          };
                          
                          for (let i = 0; i < settings.date_range_days; i++) {
                            const date = new Date(today);
                            date.setDate(today.getDate() + i);
                            
                            if (settings.exclude_weekdays?.includes(date.getDay())) {
                              continue;
                            }
                            
                            const dateStr = date.toISOString().split('T')[0];
                            const displayStr = date.toLocaleDateString('ja-JP', {
                              month: 'numeric',
                              day: 'numeric',
                              weekday: 'short'
                            });
                            
                            options.push(
                              <option key={dateStr} value={dateStr}>{displayStr}</option>
                            );
                          }
                          return options;
                        })()}
                      </select>
                      <select
                        value={formData.selectedTime2}
                        onChange={(e) => setFormData(prev => ({ ...prev, selectedTime2: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">時間を選択</option>
                        {/* 同じ時間オプション */}
                        {(() => {
                          const settings = form.config.calendar_settings.multiple_dates_settings || {
                            start_time: '09:00',
                            end_time: '18:00',
                            time_interval: 30
                          };
                          
                          const timeSlots = [];
                          const [startHour, startMin] = settings.start_time.split(':').map(Number);
                          const [endHour, endMin] = settings.end_time.split(':').map(Number);
                          
                          let currentHour = startHour;
                          let currentMin = startMin;
                          
                          while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
                            const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
                            timeSlots.push(
                              <option key={timeStr} value={timeStr}>{timeStr}</option>
                            );
                            
                            currentMin += settings.time_interval;
                            if (currentMin >= 60) {
                              currentHour += Math.floor(currentMin / 60);
                              currentMin = currentMin % 60;
                            }
                          }
                          
                          return timeSlots;
                        })()}
                      </select>
                    </div>
                  </div>

                  {/* 第三希望日時 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      第三希望日時 <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={formData.selectedDate3}
                        onChange={(e) => setFormData(prev => ({ ...prev, selectedDate3: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">日付を選択</option>
                        {/* 同じ日付オプション */}
                        {(() => {
                          const options = [];
                          const today = new Date();
                          const settings = form.config.calendar_settings.multiple_dates_settings || {
                            date_range_days: 30,
                            exclude_weekdays: [0]
                          };
                          
                          for (let i = 0; i < settings.date_range_days; i++) {
                            const date = new Date(today);
                            date.setDate(today.getDate() + i);
                            
                            if (settings.exclude_weekdays?.includes(date.getDay())) {
                              continue;
                            }
                            
                            const dateStr = date.toISOString().split('T')[0];
                            const displayStr = date.toLocaleDateString('ja-JP', {
                              month: 'numeric',
                              day: 'numeric',
                              weekday: 'short'
                            });
                            
                            options.push(
                              <option key={dateStr} value={dateStr}>{displayStr}</option>
                            );
                          }
                          return options;
                        })()}
                      </select>
                      <select
                        value={formData.selectedTime3}
                        onChange={(e) => setFormData(prev => ({ ...prev, selectedTime3: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">時間を選択</option>
                        {/* 同じ時間オプション */}
                        {(() => {
                          const settings = form.config.calendar_settings.multiple_dates_settings || {
                            start_time: '09:00',
                            end_time: '18:00',
                            time_interval: 30
                          };
                          
                          const timeSlots = [];
                          const [startHour, startMin] = settings.start_time.split(':').map(Number);
                          const [endHour, endMin] = settings.end_time.split(':').map(Number);
                          
                          let currentHour = startHour;
                          let currentMin = startMin;
                          
                          while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
                            const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
                            timeSlots.push(
                              <option key={timeStr} value={timeStr}>{timeStr}</option>
                            );
                            
                            currentMin += settings.time_interval;
                            if (currentMin >= 60) {
                              currentHour += Math.floor(currentMin / 60);
                              currentMin = currentMin % 60;
                            }
                          }
                          
                          return timeSlots;
                        })()}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </>
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

                {/* カスタムフィールド */}
                {form.config.custom_fields && form.config.custom_fields.length > 0 && (
                  <>
                    {form.config.custom_fields.map((field) => {
                      const value = formData.customFields[field.id];
                      if (
                        value === undefined ||
                        value === null ||
                        (typeof value === 'string' && value.trim() === '') ||
                        (Array.isArray(value) && value.length === 0)
                      ) {
                        return null;
                      }

                      const formatValue = () => {
                        if (Array.isArray(value)) {
                          const labels = value
                            .map((v) => field.options?.find((o) => o.value === v)?.label || String(v))
                            .filter(Boolean);
                          return labels.join(', ');
                        }
                        if (field.type === 'radio' && field.options) {
                          return field.options.find((o) => o.value === value)?.label || String(value);
                        }
                        return String(value);
                      };

                      return (
                        <div key={field.id} className="flex justify-between">
                          <span className="text-gray-600">{field.title}:</span>
                          <span className="font-medium">{formatValue()}</span>
                        </div>
                      );
                    })}
                  </>
                )}
                
                {/* 日時表示（モード別） */}
                {form.config?.calendar_settings?.booking_mode === 'multiple_dates' ? (
                  <>
                    {formData.selectedDate && formData.selectedTime && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">第一希望日時:</span>
                        <span className="font-medium">{formData.selectedDate} {formData.selectedTime}</span>
                      </div>
                    )}
                    {formData.selectedDate2 && formData.selectedTime2 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">第二希望日時:</span>
                        <span className="font-medium">{formData.selectedDate2} {formData.selectedTime2}</span>
                      </div>
                    )}
                    {formData.selectedDate3 && formData.selectedTime3 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">第三希望日時:</span>
                        <span className="font-medium">{formData.selectedDate3} {formData.selectedTime3}</span>
                      </div>
                    )}
                  </>
                ) : (
                  formData.selectedDate && formData.selectedTime && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">ご希望日時:</span>
                      <span className="font-medium">{formData.selectedDate} {formData.selectedTime}</span>
                    </div>
                  )
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
                              if (!menu) return null;
                              
                              // オプション情報を取得
                              const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                              const optionTexts = selectedOptions.map(optionId => {
                                const option = menu.options?.find(o => o.id === optionId);
                                if (!option) return '';
                                let text = option.name;
                                if (option.price && option.price > 0) {
                                  text += ` (+¥${option.price.toLocaleString()})`;
                                }
                                if (option.duration && option.duration > 0) {
                                  text += ` (+${option.duration}分)`;
                                }
                                return text;
                              }).filter(Boolean);
                              
                              return (
                                <div key={menuId} className="text-sm">
                                  • {menu.name} 
                                  {menu.price ? ` (¥${menu.price.toLocaleString()})` : ''}
                                  {menu.duration ? ` • ${menu.duration}分` : ''}
                                  {optionTexts.length > 0 && (
                                    <div className="ml-4 text-xs text-gray-500">
                                      + {optionTexts.join(', ')}
                                    </div>
                                  )}
                                </div>
                              );
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
                        
                        if (!subMenu || !parentMenu) return null;
                        
                        // オプション情報を取得
                        const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                        const optionTexts = selectedOptions.map(optionId => {
                          const option = parentMenu.options?.find(o => o.id === optionId);
                          if (!option) return '';
                          let text = option.name;
                          if (option.price && option.price > 0) {
                            text += ` (+¥${option.price.toLocaleString()})`;
                          }
                          if (option.duration && option.duration > 0) {
                            text += ` (+${option.duration}分)`;
                          }
                          return text;
                        }).filter(Boolean);
                        
                        return (
                          <div key={`${menuId}-${subMenuId}`} className="text-sm">
                            • {parentMenu.name} - {subMenu.name}
                            {subMenu.price ? ` (¥${subMenu.price.toLocaleString()})` : ''}
                            {subMenu.duration ? ` • ${subMenu.duration}分` : ''}
                            {optionTexts.length > 0 && (
                              <div className="ml-4 text-xs text-gray-500">
                                + {optionTexts.join(', ')}
                              </div>
                            )}
                          </div>
                        );
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
                
                {(() => {
                  // 合計金額と合計時間を計算
                  let totalPrice = 0;
                  let totalDuration = 0;
                  
                  // 通常メニューの合計
                  Object.entries(formData.selectedMenus).forEach(([categoryId, menuIds]) => {
                    const category = form.config.menu_structure.categories.find(c => c.id === categoryId);
                    menuIds.forEach(menuId => {
                      const menu = category?.menus.find(m => m.id === menuId);
                      if (menu) {
                        totalPrice += menu.price || 0;
                        totalDuration += menu.duration || 0;
                        // オプションの合計
                        const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                        selectedOptions.forEach(optionId => {
                          const option = menu.options?.find(o => o.id === optionId);
                          if (option) {
                            totalPrice += option.price || 0;
                            totalDuration += option.duration || 0;
                          }
                        });
                      }
                    });
                  });
                  
                  // サブメニューの合計
                  Object.entries(formData.selectedSubMenus).forEach(([menuId, subMenuId]) => {
                    if (!subMenuId) return;
                    for (const category of form.config.menu_structure.categories) {
                      const foundMenu = category.menus.find(m => m.id === menuId);
                      if (foundMenu && foundMenu.sub_menu_items) {
                        const subMenu = foundMenu.sub_menu_items.find((sm, idx) => {
                          const smId = sm.id || `submenu-${idx}`;
                          return smId === subMenuId;
                        });
                        if (subMenu) {
                          totalPrice += subMenu.price || 0;
                          totalDuration += subMenu.duration || 0;
                          // オプションの合計
                          const selectedOptions = formData.selectedMenuOptions[menuId] || [];
                          selectedOptions.forEach(optionId => {
                            const option = foundMenu.options?.find(o => o.id === optionId);
                            if (option) {
                              totalPrice += option.price || 0;
                              totalDuration += option.duration || 0;
                            }
                          });
                        }
                        break;
                      }
                    }
                  });
                  
                  if (totalPrice > 0 || totalDuration > 0) {
                    return (
                      <div className="mt-4 pt-4 border-t border-gray-300">
                        {totalPrice > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600 font-semibold">合計金額:</span>
                            <span className="font-bold text-lg">¥{totalPrice.toLocaleString()}</span>
                          </div>
                        )}
                        {totalDuration > 0 && (
                          <div className="flex justify-between mt-2">
                            <span className="text-gray-600 font-semibold">合計時間:</span>
                            <span className="font-bold text-lg">{totalDuration}分</span>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}
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
