'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Form } from '@/types/form';

export default function PreviewFormPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.storeId as string;
  const formId = params.formId as string;
  
  // プレビューモードは常に有効
  const isPreviewMode = true;
  
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

  // プレビューモードでフォーム取得
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

    if (formId && storeId) {
      fetchForm();
    }
  }, [formId, storeId]);

  // フォームデータの正規化関数
  function normalizeFormData(form: Form): Form {
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
      form.config.calendar_settings = (form as any).business_rules || {
        advance_booking_days: 30
      };
    }
    
    // business_hoursの構造を正規化（古い形式から新しい形式へ）
    if (form.config.calendar_settings.business_hours) {
      const hours = form.config.calendar_settings.business_hours as any;
      
      // 古い形式 {start: '09:00', end: '18:00'} を検出
      if (hours.start && hours.end && !hours.monday) {
        // 新しい形式に変換
        const defaultHours = {
          open: hours.start || '09:00',
          close: hours.end || '18:00',
          closed: false
        };
        
        form.config.calendar_settings.business_hours = {
          monday: { ...defaultHours },
          tuesday: { ...defaultHours },
          wednesday: { ...defaultHours },
          thursday: { ...defaultHours },
          friday: { ...defaultHours },
          saturday: { ...defaultHours },
          sunday: { ...defaultHours, closed: true }
        } as any;
      }
      
      // business_hoursが存在しない場合はデフォルト値を設定
      if (!hours.monday) {
        const defaultHours = {
          open: '09:00',
          close: '18:00',
          closed: false
        };
        
        form.config.calendar_settings.business_hours = {
          monday: { ...defaultHours },
          tuesday: { ...defaultHours },
          wednesday: { ...defaultHours },
          thursday: { ...defaultHours },
          friday: { ...defaultHours },
          saturday: { ...defaultHours },
          sunday: { ...defaultHours, closed: true }
        } as any;
      }
    } else {
      // business_hoursが完全に存在しない場合
      const defaultHours = {
        open: '09:00',
        close: '18:00',
        closed: false
      };
      
      form.config.calendar_settings.business_hours = {
        monday: { ...defaultHours },
        tuesday: { ...defaultHours },
        wednesday: { ...defaultHours },
        thursday: { ...defaultHours },
        friday: { ...defaultHours },
        saturday: { ...defaultHours },
        sunday: { ...defaultHours, closed: true }
      } as any;
    }
    
    return form as Form;
  }

  // 残りのロジックは既存のフォームページと同じため、
  // 簡略化のため、プレビューモードのバナーとエラー表示のみ実装
  
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

  // プレビューモードでは、既存のフォームページと同じUIを表示
  // 実際の実装では、/form/[formId]/page.tsx のコンポーネントをインポートして再利用
  return (
    <div className="min-h-screen bg-gray-50">
      {/* プレビューモードバナー */}
      <div className="bg-blue-50 border-b border-blue-200 p-4">
        <div className="max-w-2xl mx-auto flex items-start">
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
                onClick={() => router.back()}
                className="text-sm font-medium text-blue-800 hover:text-blue-900 underline"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* フォーム表示 */}
      <div className="max-w-2xl mx-auto py-8 px-4">
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

        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-gray-600 text-center">
            プレビュー機能は現在開発中です。<br />
            実際のフォーム表示は /form/{formId}?preview=true でご確認ください。
          </p>
        </div>
      </div>
    </div>
  );
}

