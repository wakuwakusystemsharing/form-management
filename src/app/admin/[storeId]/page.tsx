'use client';

 
import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Store } from '@/types/store';
import { Form } from '@/types/form';
import { SurveyForm } from '@/types/survey';
import FormEditModal from '@/components/FormEditor/FormEditModal';
import StoreAdminManager from '@/components/StoreAdminManager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { getBaseUrl } from '@/lib/env';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Plus,
  FileText,
  ClipboardList,
  Calendar,
  Settings,
  ExternalLink,
  Copy,
  Store as StoreIcon,
  AlertTriangle,
  MessageCircle,
  Info
} from 'lucide-react';

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center">
      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

// アンケートテンプレート定義（既存のまま）
const SURVEY_TEMPLATES = {
  counseling: {
    name: '📋 カウンセリングシート',
    description: '初回来店時の詳細なヒアリング用',
    config: {
      questions: [
        { id: 'q1', type: 'text', title: 'ご来店日(例:西暦記載 ○年○月○日)', required: true },
        { id: 'q2', type: 'text', title: 'お名前(漢字フルネーム/ふりがな)', required: true },
        { id: 'q3', type: 'date', title: 'ご来店日(例:西暦記載 ○年○月○日)', required: true },
        { id: 'q4', type: 'date', title: '生年月日(例:西暦記載 ○年○月○日)', required: true },
        { id: 'q5', type: 'text', title: '電話番号', required: true },
        { id: 'q6', type: 'text', title: 'お住まい(都道府県/市区町村まで)', required: true },
        { id: 'q7', type: 'radio', title: 'ご職業', required: true, options: [
          { label: '会社員', value: '会社員' },
          { label: 'パート・アルバイト', value: 'パート・アルバイト' },
          { label: '学生', value: '学生' },
          { label: '専業主婦', value: '専業主婦' },
          { label: 'その他', value: 'その他' }
        ]},
        { id: 'q8', type: 'radio', title: '来店動機', required: true, options: [
          { label: 'HP', value: 'HP' },
          { label: 'Instagram', value: 'Instagram' },
          { label: 'Google等での検索', value: 'Google等での検索' },
          { label: 'ホットペッパービューティー', value: 'ホットペッパービューティー' },
          { label: '知人の紹介', value: '知人の紹介' },
          { label: '通りすがり', value: '通りすがり' },
          { label: 'その他', value: 'その他' }
        ]},
        { id: 'q9', type: 'text', title: '"知人の紹介"を選択された方は、紹介者のお名前をご記入ください。', required: false },
        { id: 'q10', type: 'radio', title: '来店頻度(ネイルサロンにどのくらいの頻度で通っているか)', required: true, options: [
          { label: '2週間に1度', value: '2週間に1度' },
          { label: '3週間に1度', value: '3週間に1度' },
          { label: '1ヵ月に1度', value: '1ヵ月に1度' },
          { label: '2〜3カ月に1度', value: '2〜3カ月に1度' }
        ]},
        { id: 'q11', type: 'radio', title: '薬品/ネイルでのアレルギー', required: true, options: [
          { label: '薬品アレルギー有り', value: '薬品アレルギー有り' },
          { label: '薬品アレルギー無し', value: '薬品アレルギー無し' }
        ]},
        { id: 'q12', type: 'radio', title: '重要項目の同意', required: true, 
          description: `①トークでのご予約の受付・変更・キャンセルについては承っておりません。全てTELにてお願いいたします😊✨ 
\n②当店では施術後の返金対応は致しかねます。気になる箇所がございましたら、お直しは施術後１週間以内のご来店ですと無料(※１週間超えてのご来店ですと本数分計算の有料)で承っておりますのでお気軽にご相談ください。
お問い合わせに関しましては、トークに詳細と合わせ状態のお写真なども添えていただけるとスムーズなやり取りとご案内ができます。
また、TELでも承っており、その場でのご案内が可能です。
※トークの場合、施術対応中などでご返信が遅くなることがございます。
\n③お持ち込みネイルのお問い合わせに関しましては、リピーター様のみ受付ており、全てこちらのLINEにてご対応させて頂きます。 ご予約される前にこちらのLINEに持ち込みデザイン画像とご要望の送信をお願い致します。持ち込みデザインについてのご相談をさせていただきます。また、施術にかかるお時間、料金、ご予約時選択するメニュー等なども合わせてご連絡させていただきます。 
\n④LINEお問い合わせのご対応時間について 営業時間中の10:00〜20:00とさせていただきます。 それ以外の時間のご返信は致しかねますことご了承を願います。 また、営業時間中につきましても施術対応中などにより返信が遅くなる場合がありますことも重ねてご了承を願います。`,
          options: [
            { label: '同意する', value: '同意する' },
            { label: '同意しない', value: '同意しない' }
          ]
        }
      ]
    }
  },
  simple: {
    name: '📝 簡易アンケート',
    description: '基本情報のみのシンプルなアンケート',
    config: {
      questions: [
        { id: 'q1', type: 'text', title: 'お名前', required: true },
        { id: 'q2', type: 'text', title: '電話番号', required: true },
        { id: 'q3', type: 'text', title: 'ご要望', required: false }
      ]
    }
  }
};

// テンプレート定義
const FORM_TEMPLATES = {
  basic: {
    name: '📝 基本',
    description: 'シンプルなメニュー選択のみ',
    config: {
      basic_info: { show_gender_selection: false },
      menu_structure: {
        structure_type: 'category_based',
        categories: [{
          id: 'cat1',
          name: 'メニュー',
          display_name: 'メニュー',
          selection_mode: 'single',
          gender_condition: 'all',
          menus: [{
            id: 'menu1',
            name: 'カット',
            price: 3000,
            duration: 60,
            description: 'スタンダードカット'
          }],
          options: []
        }],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
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
    description: '基本 + 性別選択',
    config: {
      basic_info: { show_gender_selection: true },
      menu_structure: {
        structure_type: 'category_based',
        categories: [
          {
            id: 'cat_male',
            name: 'メンズメニュー',
            display_name: 'メンズメニュー',
            selection_mode: 'single',
            gender_condition: 'male',
            menus: [{
              id: 'menu_m1',
              name: 'メンズカット',
              price: 3000,
              duration: 60,
              description: 'スタンダードカット',
              target_gender: ['male']
            }],
            options: []
          },
          {
            id: 'cat_female',
            name: 'レディースメニュー',
            display_name: 'レディースメニュー',
            selection_mode: 'single',
            gender_condition: 'female',
            menus: [{
              id: 'menu_f1',
              name: 'レディースカット',
              price: 3500,
              duration: 60,
              description: 'スタンダードカット',
              target_gender: ['female']
            }],
            options: []
          }
        ],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      },
      ui_settings: {
        show_visit_count: false,
        show_coupon_selection: false,
        show_repeat_booking: false
      }
    }
  },
  premium: {
    name: '⭐ プレミアム',
    description: 'スタンダード + サブメニュー（長さ別など）',
    config: {
      basic_info: { show_gender_selection: true },
      menu_structure: {
        structure_type: 'category_based',
        categories: [
          {
            id: 'cat_cut',
            name: 'カット',
            display_name: '◆カット◆',
            selection_mode: 'single',
            gender_condition: 'all',
            menus: [
              {
                id: 'menu_cut1',
                name: 'カット',
                price: 3000,
                duration: 60,
                description: '長さ別料金あり',
                has_submenu: true,
                sub_menu_items: [
                  { id: 'sub_short', name: 'ショート', price: 3000, duration: 60 },
                  { id: 'sub_mid', name: 'ミディアム', price: 3500, duration: 70 },
                  { id: 'sub_long', name: 'ロング', price: 4000, duration: 80 }
                ],
                options: []
              }
            ],
            options: []
          },
          {
            id: 'cat_color',
            name: 'カラー',
            display_name: '◆カラー◆',
            selection_mode: 'single',
            gender_condition: 'all',
            menus: [
              {
                id: 'menu_color1',
                name: 'フルカラー',
                price: 8000,
                duration: 120,
                description: '全体カラー',
                has_submenu: false,
                options: []
              }
            ],
            options: []
          }
        ],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      },
      ui_settings: {
        show_visit_count: false,
        show_coupon_selection: false,
        show_repeat_booking: false
      }
    }
  },
  complete: {
    name: '💎 コンプリート',
    description: 'プレミアム + オプション + 来店回数',
    config: {
      basic_info: { show_gender_selection: true },
      menu_structure: {
        structure_type: 'category_based',
        categories: [
          {
            id: 'cat_cut',
            name: 'カット',
            display_name: '◆カット◆',
            selection_mode: 'single',
            gender_condition: 'all',
            menus: [
              {
                id: 'menu_cut1',
                name: 'カット',
                price: 3000,
                duration: 60,
                description: '長さ別料金あり',
                has_submenu: true,
                sub_menu_items: [
                  { id: 'sub_short', name: 'ショート', price: 3000, duration: 60 },
                  { id: 'sub_mid', name: 'ミディアム', price: 3500, duration: 70 },
                  { id: 'sub_long', name: 'ロング', price: 4000, duration: 80 }
                ],
                options: [
                  { id: 'opt_shampoo', name: 'シャンプー込み', price: 0, duration: 15, is_default: true },
                  { id: 'opt_quick', name: 'クイック仕上げ', price: 500, duration: 10, is_default: false }
                ]
              }
            ],
            options: []
          },
          {
            id: 'cat_color',
            name: 'カラー',
            display_name: '◆カラー◆',
            selection_mode: 'single',
            gender_condition: 'all',
            menus: [
              {
                id: 'menu_color1',
                name: 'フルカラー',
                price: 8000,
                duration: 120,
                description: '全体カラー',
                has_submenu: false,
                options: [
                  { id: 'opt_tone', name: 'トーンアップ', price: 500, duration: 0, is_default: false }
                ]
              }
            ],
            options: []
          }
        ],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      },
      visit_count_selection: {
        enabled: true,
        required: false,
        options: [
          { value: 'first', label: '初回（+30分）', duration: 30 },
          { value: 'repeat', label: '2回目以降', duration: 0 }
        ]
      },
      ui_settings: {
        show_visit_count: true,
        show_coupon_selection: false,
        show_repeat_booking: false
      }
    }
  },
  ultimate: {
    name: '🚀 アルティメット',
    description: 'コンプリート + クーポン + リピート予約',
    config: {
      basic_info: { show_gender_selection: true },
      menu_structure: {
        structure_type: 'category_based',
        categories: [
          {
            id: 'cat_cut',
            name: 'カット',
            display_name: '◆カット◆',
            selection_mode: 'single',
            gender_condition: 'all',
            menus: [
              {
                id: 'menu_cut1',
                name: 'カット',
                price: 3000,
                duration: 60,
                description: '長さ別料金あり',
                has_submenu: true,
                sub_menu_items: [
                  { id: 'sub_short', name: 'ショート', price: 3000, duration: 60 },
                  { id: 'sub_mid', name: 'ミディアム', price: 3500, duration: 70 },
                  { id: 'sub_long', name: 'ロング', price: 4000, duration: 80 }
                ],
                options: [
                  { id: 'opt_shampoo', name: 'シャンプー込み', price: 0, duration: 15, is_default: true },
                  { id: 'opt_quick', name: 'クイック仕上げ', price: 500, duration: 10, is_default: false }
                ]
              }
            ],
            options: []
          },
          {
            id: 'cat_color',
            name: 'カラー',
            display_name: '◆カラー◆',
            selection_mode: 'single',
            gender_condition: 'all',
            menus: [
              {
                id: 'menu_color1',
                name: 'フルカラー',
                price: 8000,
                duration: 120,
                description: '全体カラー',
                has_submenu: false,
                options: [
                  { id: 'opt_tone', name: 'トーンアップ', price: 500, duration: 0, is_default: false }
                ]
              }
            ],
            options: []
          }
        ],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      },
      visit_count_selection: {
        enabled: true,
        required: false,
        options: [
          { value: 'first', label: '初回（+30分）', duration: 30 },
          { value: 'repeat', label: '2回目以降', duration: 0 }
        ]
      },
      ui_settings: {
        show_visit_count: true,
        show_coupon_selection: true,
        show_repeat_booking: true,
        coupon_name: '初回限定クーポン'
      }
    }
  },
  debug: {
    name: '🐛 デバッグ用（全機能・画像付き）',
    description: '性別・来店回数・クーポン・カテゴリ横断・カスタム項目・画像付きメニューを全て含むテンプレート',
    liff_id: '2008098784-5ZQ1LRn3',
    config: {
      basic_info: { show_gender_selection: true },
      menu_structure: {
        structure_type: 'category_based',
        allow_cross_category_selection: true,
        categories: [
          {
            id: 'cat_cut',
            name: 'カット',
            display_name: '◆カット◆',
            selection_mode: 'multiple',
            menus: [
              {
                id: 'menu_cut_std',
                name: 'スタンダードカット',
                price: 3000,
                duration: 60,
                description: '基本的なカットメニュー',
                image: 'https://placehold.co/400x300/e2e8f0/64748b?text=スタンダードカット',
                has_submenu: true,
                sub_menu_items: [
                  { id: 'sub_short', name: 'ショート', price: 3000, duration: 60 },
                  { id: 'sub_mid', name: 'ミディアム', price: 3500, duration: 70 },
                  { id: 'sub_long', name: 'ロング', price: 4000, duration: 80 }
                ],
                options: [
                  { id: 'opt_quick', name: 'クイック仕上げ', price: 500, duration: 10, is_default: false },
                  { id: 'opt_set', name: 'セット（シャンプー込）', price: 0, duration: 15, is_default: true }
                ]
              },
              {
                id: 'menu_cut_premium',
                name: 'プレミアムカット',
                price: 5000,
                duration: 90,
                description: 'トップスタイリストによる丁寧なカット',
                image: 'https://placehold.co/400x300/cbd5e1/475569?text=プレミアムカット',
                has_submenu: false,
                options: [
                  { id: 'opt_scalp', name: '頭皮ケア', price: 1000, duration: 15, is_default: false }
                ]
              }
            ],
            options: []
          },
          {
            id: 'cat_color',
            name: 'カラー',
            display_name: '◆カラー◆',
            selection_mode: 'multiple',
            menus: [
              {
                id: 'menu_color_full',
                name: 'フルカラー',
                price: 8000,
                duration: 120,
                description: '全体カラー',
                image: 'https://placehold.co/400x300/fce7f3/9d174d?text=フルカラー',
                has_submenu: false,
                options: [
                  { id: 'opt_tone', name: 'トーンアップ', price: 500, duration: 0, is_default: false }
                ]
              },
              {
                id: 'menu_color_highlight',
                name: 'ハイライト',
                price: 6000,
                duration: 90,
                description: '部分ハイライト',
                image: 'https://placehold.co/400x300/fde68a/854d0e?text=ハイライト',
                has_submenu: false,
                options: []
              }
            ],
            options: []
          },
          {
            id: 'cat_treatment',
            name: 'トリートメント',
            display_name: '◆トリートメント◆',
            selection_mode: 'multiple',
            menus: [
              {
                id: 'menu_treat_basic',
                name: 'ベーシックトリートメント',
                price: 2000,
                duration: 30,
                description: '髪質改善',
                image: 'https://placehold.co/400x300/d1fae5/065f46?text=トリートメント',
                has_submenu: false,
                options: []
              }
            ],
            options: []
          }
        ],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: true
        }
      },
      visit_count_selection: {
        enabled: true,
        required: false,
        options: [
          { value: 'first', label: '初回（+30分）', duration: 30 },
          { value: 'repeat', label: '2回目以降', duration: 0 }
        ]
      },
      custom_fields: [
        { id: 'cf1', type: 'text', title: 'ご希望の時間帯', required: false, placeholder: '例：午前中' },
        { id: 'cf2', type: 'textarea', title: 'ご要望・備考', required: false, placeholder: '自由記入' },
        { id: 'cf3', type: 'radio', title: '施術のご希望', required: false, options: [{ label: 'ゆったり', value: 'relax' }, { label: '手早く', value: 'quick' }] },
        { id: 'cf4', type: 'checkbox', title: 'オプション希望', required: false, options: [{ label: 'ドライ付き', value: 'dry' }, { label: 'セット付き', value: 'set' }] }
      ],
      ui_settings: {
        show_visit_count: true,
        show_coupon_selection: true,
        show_repeat_booking: true,
        coupon_name: '2周年記念'
      }
    }
  }
};

export default function StoreDetailPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.storeId as string;
  const { toast } = useToast();
  
  const [store, setStore] = useState<Store | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [surveyForms, setSurveyForms] = useState<SurveyForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingForm, setEditingForm] = useState<Form | SurveyForm | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newFormData, setNewFormData] = useState({
    form_name: '',
    form_type: 'line' as 'line' | 'web',
    liff_id: '',
    security_secret: '',
    template: 'basic'
  });
  const [showCreateSurveyForm, setShowCreateSurveyForm] = useState(false);
  const [newSurveyData, setNewSurveyData] = useState({
    form_name: '',
    liff_id: '',
    template: 'counseling'
  });
  const [showStoreEditModal, setShowStoreEditModal] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [recentReservations, setRecentReservations] = useState<any[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<any | null>(null);
  const [showReservationDetail, setShowReservationDetail] = useState(false);
  const [creatingCalendar, setCreatingCalendar] = useState(false);
  const [disconnectingCalendar, setDisconnectingCalendar] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
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
        
        const formsResponse = await fetch(`/api/stores/${storeId}/forms`, {
          credentials: 'include',
        });
        if (formsResponse.ok) {
          const formsData = await formsResponse.json();
          setForms(formsData);
        }

        const surveysResponse = await fetch(`/api/stores/${storeId}/surveys`, {
          credentials: 'include',
        });
        if (surveysResponse.ok) {
          const surveysData = await surveysResponse.json();
          setSurveyForms(surveysData);
        }

        const reservationsResponse = await fetch(`/api/stores/${storeId}/reservations`, {
          credentials: 'include',
        });
        if (reservationsResponse.ok) {
          const reservationsData = await reservationsResponse.json();
          setRecentReservations(reservationsData.slice(0, 10));
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

  useEffect(() => {
    const status = searchParams.get('google_calendar');
    const message = searchParams.get('message');
    if (!status || !storeId) return;
    if (status === 'connected') {
      toast({ title: '連携完了', description: '店舗のGoogleカレンダーと連携しました' });
    } else if (status === 'error') {
      const descriptions: Record<string, string> = {
        config: 'Google OAuthの設定がありません。管理者設定を確認してください。',
        unauthorized: 'ログインしてください。',
        forbidden: 'この店舗へのアクセス権限がありません。',
        no_code: '認証がキャンセルされました。',
        no_refresh_token: 'リフレッシュトークンを取得できませんでした。再度お試しください。',
        exchange: 'トークン取得に失敗しました。',
        encryption: 'トークンの保存に失敗しました。',
        save: '店舗の更新に失敗しました。',
        invalid_state: '無効なリクエストです。',
        local: 'ローカル環境では利用できません。',
        server: 'サーバーエラーが発生しました。',
      };
      toast({
        title: 'Googleカレンダー連携エラー',
        description: (message && descriptions[message]) || '連携に失敗しました。',
        variant: 'destructive',
      });
    }
    router.replace(`/admin/${storeId}`, { scroll: false });
  }, [searchParams, storeId, router]);

  const handleCreateForm = async () => {
    if (!newFormData.form_name.trim()) {
      toast({
        title: 'エラー',
        description: 'フォーム名を入力してください',
        variant: 'destructive',
      });
      return;
    }

    if (newFormData.form_type === 'web' && !newFormData.security_secret?.trim()) {
      toast({
        title: 'エラー',
        description: 'Web予約フォームの場合、SECURITY_SECRETを入力してください',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);

    try {
      const selectedTemplate = FORM_TEMPLATES[newFormData.template as keyof typeof FORM_TEMPLATES];
      
      const response = await fetch(`/api/stores/${storeId}/forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          form_name: newFormData.form_name.trim(),
          form_type: newFormData.form_type,
          liff_id: newFormData.form_type === 'line' ? (newFormData.liff_id.trim() || undefined) : undefined,
          security_secret: newFormData.form_type === 'web' ? newFormData.security_secret.trim() : undefined,
          template: selectedTemplate
        }),
      });

      if (response.ok) {
        const newForm = await response.json();
        setForms([...forms, newForm]);
        setNewFormData({ form_name: '', form_type: 'line', liff_id: '', security_secret: '', template: 'basic' });
        setShowCreateForm(false);
        const formName = newForm.config?.basic_info?.form_name || newFormData.form_name.trim();
        toast({
          title: '成功',
          description: `フォーム「${formName}」を作成しました`,
        });
      } else {
        const error = await response.json();
        toast({
          title: 'エラー',
          description: error.error || 'フォーム作成に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Form creation error:', error);
      toast({
        title: 'エラー',
        description: 'フォーム作成に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSurveyForm = async () => {
    if (!newSurveyData.form_name.trim()) {
      toast({
        title: 'エラー',
        description: 'フォーム名を入力してください',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const selectedTemplate = SURVEY_TEMPLATES[newSurveyData.template as keyof typeof SURVEY_TEMPLATES];
      const response = await fetch(`/api/stores/${storeId}/surveys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          form_name: newSurveyData.form_name.trim(),
          liff_id: newSurveyData.liff_id.trim(),
          template_config: selectedTemplate.config
        }),
      });

      if (response.ok) {
        const newForm = await response.json();
        setSurveyForms([...surveyForms, newForm]);
        setNewSurveyData({ form_name: '', liff_id: '', template: 'counseling' });
        setShowCreateSurveyForm(false);
        toast({
          title: '成功',
          description: `アンケートフォーム「${newForm.config.basic_info.title}」を作成しました`,
        });
      } else {
        const error = await response.json();
        toast({
          title: 'エラー',
          description: error.error || 'アンケート作成に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Survey creation error:', error);
      toast({
        title: 'エラー',
        description: 'アンケート作成に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSurveyForm = async (formId: string) => {
    if (!confirm('本当にこのアンケートフォームを削除しますか？\nこの操作は取り消せません。')) {
      return;
    }

    try {
      const response = await fetch(`/api/surveys/${formId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setSurveyForms(surveyForms.filter(f => f.id !== formId));
        toast({
          title: '成功',
          description: 'アンケートフォームを削除しました',
        });
      } else {
        const error = await response.json();
        toast({
          title: 'エラー',
          description: error.error || '削除に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: 'エラー',
        description: '削除に失敗しました',
        variant: 'destructive',
      });
    }
  };

  const handleEditForm = (form: Form | SurveyForm) => {
    setEditingForm(form);
    setShowEditModal(true);
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
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(editingStore),
      });

      if (response.ok) {
        const updatedStore = await response.json();
        setStore(updatedStore);
        setShowStoreEditModal(false);
        setEditingStore(null);
        toast({
          title: '成功',
          description: '店舗情報を更新しました',
        });
      } else {
        const error = await response.json();
        toast({
          title: 'エラー',
          description: error.error || '更新に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Store update error:', error);
      toast({
        title: 'エラー',
        description: '店舗情報の更新に失敗しました',
        variant: 'destructive',
      });
    }
  };

  const handleCreateCalendar = async () => {
    if (!store) return;
    setCreatingCalendar(true);
    try {
      const response = await fetch(`/api/stores/${storeId}/calendar`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.google_calendar_id) {
        setStore({ ...store, google_calendar_id: data.google_calendar_id });
        toast({
          title: '成功',
          description: 'Googleカレンダーを作成し、店舗に紐づけました',
        });
      } else {
        toast({
          title: 'エラー',
          description: data.error || 'カレンダーの作成に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Create calendar error:', error);
      toast({
        title: 'エラー',
        description: 'カレンダーの作成に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setCreatingCalendar(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!storeId || !store) return;
    setDisconnectingCalendar(true);
    try {
      const response = await fetch(`/api/stores/${storeId}/calendar/disconnect`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        setStore({
          ...store,
          google_calendar_id: '',
          google_calendar_source: 'system',
        });
        toast({ title: '連携を解除しました' });
      } else {
        const data = await response.json().catch(() => ({}));
        toast({
          title: 'エラー',
          description: data.error || '連携の解除に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Disconnect calendar error:', error);
      toast({
        title: 'エラー',
        description: '連携の解除に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setDisconnectingCalendar(false);
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
        setForms(forms.filter(form => form.id !== deletingFormId));
        setShowDeleteConfirm(false);
        setDeletingFormId(null);
        toast({
          title: '成功',
          description: 'フォームを削除しました',
        });
      } else {
        const error = await response.json();
        toast({
          title: 'エラー',
          description: error.error || '削除に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Form deletion error:', error);
      toast({
        title: 'エラー',
        description: 'フォームの削除に失敗しました',
        variant: 'destructive',
      });
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
        toast({
          title: '成功',
          description: '店舗を削除しました',
        });
        router.push('/admin');
      } else {
        const error = await response.json();
        toast({
          title: 'エラー',
          description: error.error || '削除に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Store deletion error:', error);
      toast({
        title: 'エラー',
        description: '店舗の削除に失敗しました',
        variant: 'destructive',
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'コピーしました',
      description: 'URLをクリップボードにコピーしました',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border">
          <CardContent className="pt-6">
            <div className="text-center text-destructive">
              {error || '店舗が見つかりません'}
            </div>
            <div className="mt-4 text-center">
              <Button onClick={() => router.back()} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                戻る
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="admin-page min-h-screen bg-background">
      {/* ── ナビゲーションバー ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/admin')}
              className="text-muted-foreground hover:text-foreground h-8 px-2 shrink-0"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline text-xs">店舗一覧</span>
            </Button>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <StoreIcon className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="font-semibold text-foreground text-sm truncate">{store.name}</span>
              <Badge className="bg-violet-600 hover:bg-violet-600 text-white border-0 text-xs px-1.5 py-0 shrink-0 cursor-default">
                サービス管理者
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/admin/${storeId}/reservations`)}
              className="text-muted-foreground hover:text-foreground text-xs h-8"
            >
              <Calendar className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">予約一覧</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/${storeId}/admin`)}
              className="text-muted-foreground hover:text-green-600 text-xs h-8"
            >
              <StoreIcon className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">店舗管理者</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* ── 店舗ヘッダーカード ── */}
        <Card className="border-border bg-card">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-foreground">{store.name}</h1>
                  {store.google_calendar_id && (
                    <Badge className="bg-green-500/20 text-green-700 border border-green-500/30 text-xs">
                      カレンダー連携中
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-1">ID: {store.id}</p>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {store.google_calendar_id ? (
                  <>
                    <Button variant="outline" size="sm"
                      onClick={() => window.open(`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(store.google_calendar_id ?? '')}`, '_blank')}
                      className="border-border h-8 text-xs"
                    >
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      カレンダーを開く
                    </Button>
                    {store.google_calendar_source === 'store_oauth' ? (
                      <Button variant="outline" size="sm" disabled={disconnectingCalendar}
                        onClick={handleDisconnectCalendar}
                        className="border-border h-8 text-xs"
                      >
                        {disconnectingCalendar ? '解除中...' : '連携を解除'}
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm"
                          onClick={() => { window.location.href = `/api/integrations/google-calendar/connect?store_id=${storeId}`; }}
                          className="border-border h-8 text-xs"
                        >
                          <Calendar className="mr-1 h-3.5 w-3.5" />
                          Googleカレンダー連携
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                          onClick={() => copyToClipboard(`${getBaseUrl()}/api/integrations/google-calendar/connect?store_id=${storeId}`)}
                          title="連携用URLをコピー"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <InfoTooltip text="店舗オーナーのGoogleアカウントでOAuth認証を行い、そのカレンダーに予約を自動登録します。コピーボタンで連携URLを取得し、店舗オーナーに共有してください。" />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" disabled={creatingCalendar}
                        onClick={handleCreateCalendar}
                        className="border-border h-8 text-xs"
                      >
                        <Calendar className="mr-1 h-3.5 w-3.5" />
                        {creatingCalendar ? '作成中...' : 'カレンダーを作成'}
                      </Button>
                      <InfoTooltip text="サービスアカウント経由でGoogleカレンダーを新規作成します。作成したカレンダーに予約が自動登録されます。店舗オーナーのGoogleアカウントとは連携しません。" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm"
                        onClick={() => { window.location.href = `/api/integrations/google-calendar/connect?store_id=${storeId}`; }}
                        className="border-border h-8 text-xs"
                      >
                        <Calendar className="mr-1 h-3.5 w-3.5" />
                        Googleカレンダーと連携
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                        onClick={() => copyToClipboard(`${getBaseUrl()}/api/integrations/google-calendar/connect?store_id=${storeId}`)}
                        title="連携用URLをコピー"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <InfoTooltip text="店舗オーナーのGoogleアカウントでOAuth認証を行い、そのカレンダーに予約を自動登録します。コピーボタンで連携URLを取得し、店舗オーナーに共有してください。" />
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── タブナビゲーション ── */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="h-10 bg-card border border-border p-1 w-full sm:w-auto grid grid-cols-4 sm:inline-grid">
            <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none">概要</TabsTrigger>
            <TabsTrigger value="forms" className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none">予約フォーム</TabsTrigger>
            <TabsTrigger value="surveys" className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none">アンケート</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none">設定</TabsTrigger>
          </TabsList>

          {/* 概要タブ */}
          <TabsContent value="overview" className="space-y-6">
            {/* LINE Messaging API Webhook URL */}
            <div className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">LINE Webhook URL</span>
                {!store?.line_channel_access_token && (
                  <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-0.5 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> トークン未設定
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-2 py-1 rounded flex-1 min-w-0 truncate">
                  {getBaseUrl()}/api/webhooks/line?storeId={storeId}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => {
                    const webhookUrl = `${getBaseUrl()}/api/webhooks/line?storeId=${storeId}`;
                    copyToClipboard(webhookUrl);
                  }}
                  aria-label="Webhook URLをコピー"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* フォームURL一覧 + 基本情報 横並び */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">フォームURL一覧</CardTitle>
                  <CardDescription>顧客向けの公開URL</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  {forms.length === 0 && surveyForms.length === 0 ? (
                    <p className="text-center text-muted-foreground py-6 text-sm">
                      まだフォームが作成されていません
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {forms.length > 0 && (
                        <>
                          <p className="text-xs font-medium text-muted-foreground px-1 pb-0.5">予約フォーム</p>
                          {forms.map((form) => {
                            const deployInfo = (form as any).static_deploy;
                            let formUrl = deployInfo?.deploy_url || deployInfo?.storage_url || `/preview/${storeId}/forms/${form.id}`;
                            if (formUrl.startsWith('/') && !formUrl.startsWith('//')) {
                              formUrl = `${getBaseUrl()}${formUrl}`;
                            }
                            return (
                              <div key={form.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 group">
                                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-sm font-medium truncate flex-1 min-w-0">
                                  {(form as any).form_name || form.config?.basic_info?.form_name}
                                </span>
                                <Badge variant={form.status === 'active' ? 'default' : 'secondary'} className="text-xs shrink-0">
                                  {form.status === 'active' ? '公開中' : '非公開'}
                                </Badge>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 opacity-50 group-hover:opacity-100" onClick={() => window.open(formUrl, '_blank')}>
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 opacity-50 group-hover:opacity-100" onClick={() => copyToClipboard(formUrl)}>
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            );
                          })}
                        </>
                      )}
                      {surveyForms.length > 0 && (
                        <>
                          <p className="text-xs font-medium text-muted-foreground px-1 pt-2 pb-0.5">アンケートフォーム</p>
                          {surveyForms.map((form) => {
                            const deployInfo = form.static_deploy;
                            let formUrl = deployInfo?.deploy_url || deployInfo?.storage_url || `/preview/${storeId}/surveys/${form.id}`;
                            if (formUrl.startsWith('/') && !formUrl.startsWith('//')) {
                              formUrl = `${getBaseUrl()}${formUrl}`;
                            }
                            return (
                              <div key={form.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 group">
                                <ClipboardList className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-sm font-medium truncate flex-1 min-w-0">
                                  {form.config.basic_info.title}
                                </span>
                                <Badge variant={form.status === 'active' ? 'default' : 'secondary'} className="text-xs shrink-0">
                                  {form.status === 'active' ? '公開中' : '非公開'}
                                </Badge>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 opacity-50 group-hover:opacity-100" onClick={() => window.open(formUrl, '_blank')}>
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 opacity-50 group-hover:opacity-100" onClick={() => copyToClipboard(formUrl)}>
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 店舗基本情報 */}
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">基本情報</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleEditStore}
                      className="text-muted-foreground hover:text-foreground h-7 w-7 p-0"
                      aria-label="店舗情報編集"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">店舗名</Label>
                      <p className="text-sm font-medium mt-0.5">{store.name}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">オーナー名</Label>
                      <p className="text-sm font-medium mt-0.5">{store.owner_name}</p>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs text-muted-foreground">メールアドレス</Label>
                      <p className="text-sm font-medium mt-0.5 break-all">{store.owner_email}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">電話番号</Label>
                      <p className="text-sm font-medium mt-0.5">{store.phone || '未設定'}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">ウェブサイト</Label>
                      <p className="text-sm font-medium mt-0.5 truncate">{store.website_url || '未設定'}</p>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs text-muted-foreground">住所</Label>
                      <p className="text-sm font-medium mt-0.5">{store.address || '未設定'}</p>
                    </div>
                    {store.description && (
                      <div className="col-span-2">
                        <Label className="text-xs text-muted-foreground">説明</Label>
                        <p className="text-sm font-medium mt-0.5">{store.description}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 最近の予約 */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>最近の予約</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/admin/${storeId}/reservations`)}
                  >
                    すべて見る
                  </Button>
        </div>
              </CardHeader>
              <CardContent>
                {loadingReservations ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">読み込み中...</p>
                ) : recentReservations.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">まだ予約がありません</p>
                ) : (
                  <div className="divide-y divide-border -mx-6">
                    {recentReservations.map((reservation) => {
                      const selectedMenus = reservation.selected_menus || [];
                      const menuInfo = selectedMenus.length > 0 ? selectedMenus[0] : null;
                      const menuName = menuInfo?.menu_name || reservation.menu_name || '未選択';
                      const submenuName = menuInfo?.submenu_name || reservation.submenu_name;
                      const fullMenuName = submenuName ? `${menuName} > ${submenuName}` : menuName;
                      const statusMap: Record<string, { label: string; className: string }> = {
                        confirmed: { label: '確認済み', className: 'bg-blue-50 text-blue-700 border-blue-200' },
                        pending:   { label: '保留中',   className: 'bg-amber-50 text-amber-700 border-amber-200' },
                        cancelled: { label: 'キャンセル', className: 'bg-red-50 text-red-600 border-red-200' },
                        completed: { label: '完了',     className: 'bg-green-50 text-green-700 border-green-200' },
                      };
                      const status = statusMap[reservation.status] ?? statusMap.pending;

                      return (
                        <div
                          key={reservation.id}
                          className="flex items-center gap-3 px-6 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                          onClick={() => {
                            setSelectedReservation(reservation);
                            setShowReservationDetail(true);
                          }}
                        >
                          {/* 日時ブロック */}
                          <div className="shrink-0 w-16 text-center">
                            <p className="text-xs font-semibold text-foreground leading-tight">
                              {new Date(reservation.reservation_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                            </p>
                            <p className="text-xs text-muted-foreground">{reservation.reservation_time}</p>
                          </div>
                          {/* 縦線 */}
                          <div className="w-px h-8 bg-border shrink-0" />
                          {/* 顧客・メニュー */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{reservation.customer_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{fullMenuName}</p>
                          </div>
                          {/* ステータスバッジ */}
                          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium ${status.className}`}>
                            {status.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 予約フォームタブ */}
          <TabsContent value="forms" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>予約フォーム</CardTitle>
                  <Button
              onClick={() => setShowCreateForm(!showCreateForm)}
                    className="w-full sm:w-auto"
            >
                    <Plus className="mr-2 h-4 w-4" />
              {showCreateForm ? 'キャンセル' : '新規フォーム作成'}
                  </Button>
          </div>
              </CardHeader>
              <CardContent className="space-y-6">
          {/* フォーム作成フォーム */}
          {showCreateForm && (
                  <Card className="border-primary/50">
                    <CardHeader>
                      <CardTitle className="text-lg">新しいフォームを作成</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="form_name">
                          フォーム名 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="form_name"
                    value={newFormData.form_name}
                    onChange={(e) => setNewFormData({...newFormData, form_name: e.target.value})}
                    placeholder="例：カット＆カラー予約フォーム"
                  />
                </div>
                      <div className="space-y-2">
                        <Label>フォームの種類</Label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="form_type"
                              checked={newFormData.form_type === 'line'}
                              onChange={() => setNewFormData({ ...newFormData, form_type: 'line' })}
                              className="rounded-full border-primary text-primary"
                            />
                            <span>LINE予約フォーム</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="form_type"
                              checked={newFormData.form_type === 'web'}
                              onChange={() => setNewFormData({ ...newFormData, form_type: 'web' })}
                              className="rounded-full border-primary text-primary"
                            />
                            <span>Web予約フォーム</span>
                          </label>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {newFormData.form_type === 'web'
                            ? 'URLだけで予約可能（LIFF ID不要）'
                            : 'LINEアプリ内で開く予約フォーム'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>テンプレート選択 <span className="text-destructive">*</span></Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(FORM_TEMPLATES).map(([key, template]) => (
                      <div key={key} className="relative">
                        <input
                          type="radio"
                          id={`template-${key}`}
                          name="template"
                          value={key}
                          checked={newFormData.template === key}
                          onChange={(e) => {
                            const selectedKey = e.target.value;
                            const selectedTemplate = FORM_TEMPLATES[selectedKey as keyof typeof FORM_TEMPLATES];
                            const updatedData: typeof newFormData = {
                              ...newFormData,
                              template: selectedKey
                            };
                            
                            if (selectedKey === 'debug') {
                              const debugTemplate = selectedTemplate as any;
                              if (debugTemplate.liff_id) {
                                updatedData.liff_id = debugTemplate.liff_id;
                              }
                            }
                            
                            setNewFormData(updatedData);
                          }}
                          className="sr-only"
                        />
                        <label
                          htmlFor={`template-${key}`}
                                className={`block p-4 border-2 rounded-lg cursor-pointer transition-all ${
                            newFormData.template === key
                                    ? 'border-primary bg-primary/10'
                                    : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <div className="flex items-start space-x-3">
                              <div className={`w-5 h-5 rounded-full border-2 ${
                                newFormData.template === key
                                      ? 'border-primary bg-primary'
                                      : 'border-muted-foreground'
                                  } flex items-center justify-center mt-0.5`}>
                                {newFormData.template === key && (
                                  <div className="w-2 h-2 bg-white rounded-full"></div>
                                )}
                              </div>
                                  <div className="flex-1">
                                    <h4 className="text-sm font-medium">{template.name}</h4>
                                    <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                            </div>
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>
                    </div>
                      {newFormData.form_type === 'line' && (
                        <div className="space-y-2">
                          <Label htmlFor="liff_id">LIFF ID</Label>
                          <Input
                            id="liff_id"
                            value={newFormData.liff_id}
                            onChange={(e) => setNewFormData({ ...newFormData, liff_id: e.target.value })}
                            placeholder="例：1234567890-abcdefgh"
                          />
                          <p className="text-xs text-muted-foreground">LINE Developersで作成したLIFF IDを入力（任意）</p>
                        </div>
                      )}
                      {newFormData.form_type === 'web' && (
                        <div className="space-y-2">
                          <Label htmlFor="security_secret">
                            SECURITY_SECRET <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id="security_secret"
                            type="password"
                            autoComplete="off"
                            value={newFormData.security_secret}
                            onChange={(e) => setNewFormData({ ...newFormData, security_secret: e.target.value })}
                            placeholder="Web予約フォーム用の秘密鍵"
                          />
                          <p className="text-xs text-muted-foreground">Web予約フォームの認証用。任意の文字列を設定してください。</p>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <Button
                  onClick={handleCreateForm}
                  disabled={submitting}
                          className="flex-1 sm:flex-none"
                >
                  {submitting ? '作成中...' : 'フォームを作成'}
                        </Button>
                        <Button
                          variant="outline"
                  onClick={() => setShowCreateForm(false)}
                          className="flex-1 sm:flex-none"
                >
                  キャンセル
                        </Button>
              </div>
                    </CardContent>
                  </Card>
          )}

                {/* フォーム一覧 */}
          <div className="space-y-3">
            {forms.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                まだ予約フォームが作成されていません
                    </p>
            ) : (
              forms.map((form) => {
                const deployInfo = (form as any).static_deploy;
                let formUrl = deployInfo?.deploy_url || deployInfo?.storage_url || `/preview/${storeId}/forms/${form.id}`;
                if (formUrl.startsWith('/') && !formUrl.startsWith('//')) {
                  formUrl = `${getBaseUrl()}${formUrl}`;
                }
                return (
                      <Card key={form.id}>
                        <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <h3 className="font-medium truncate">
{(form as any).form_name || form.config?.basic_info?.form_name}
                                </h3>
                        {form.draft_status === 'draft' && (
                                  <Badge variant="outline" className="text-orange-600 border-orange-600 shrink-0">
                                    下書き
                                  </Badge>
                                )}
                                <Badge variant={form.status === 'active' ? 'default' : 'secondary'} className="shrink-0">
                                  {form.status === 'active' ? '公開中' : '非公開'}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground font-mono truncate">
                                ID: {form.id}
                      </p>
                    </div>
                            <div className="flex gap-2 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                        onClick={() => handleEditForm(form)}
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                編集
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                        onClick={() => handleDeleteForm(form.id)}
                      >
                                <Trash2 className="mr-2 h-4 w-4" />
                        削除
                              </Button>
                    </div>
                  </div>
                          <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                            <code className="text-xs text-muted-foreground truncate flex-1 min-w-0">{formUrl}</code>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => window.open(formUrl, '_blank')} title="開く">
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => copyToClipboard(formUrl)} title="コピー">
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                );
              })
            )}
          </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* アンケートタブ */}
          <TabsContent value="surveys" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>アンケートフォーム</CardTitle>
                  <Button
              onClick={() => setShowCreateSurveyForm(!showCreateSurveyForm)}
                    className="w-full sm:w-auto"
            >
                    <Plus className="mr-2 h-4 w-4" />
              {showCreateSurveyForm ? 'キャンセル' : '新規アンケート作成'}
                  </Button>
          </div>
              </CardHeader>
              <CardContent className="space-y-6">
          {/* アンケート作成フォーム */}
          {showCreateSurveyForm && (
                  <Card className="border-primary/50">
                    <CardHeader>
                      <CardTitle className="text-lg">新しいアンケートを作成</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="survey_form_name">
                          フォーム名 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="survey_form_name"
                    value={newSurveyData.form_name}
                    onChange={(e) => setNewSurveyData({...newSurveyData, form_name: e.target.value})}
                    placeholder="例：初回カウンセリングシート"
                  />
                </div>
                      <div className="space-y-2">
                        <Label>テンプレート選択</Label>
                  <div className="grid grid-cols-1 gap-3">
                    {Object.entries(SURVEY_TEMPLATES).map(([key, template]) => (
                      <div
                        key={key}
                        onClick={() => setNewSurveyData({ ...newSurveyData, template: key })}
                        className={`cursor-pointer border rounded-lg p-3 transition-colors ${
                          newSurveyData.template === key
                                  ? 'border-primary bg-primary/10'
                                  : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                                <span className="font-medium">{template.name}</span>
                          {newSurveyData.template === key && (
                                  <span className="text-primary">✓</span>
                          )}
                        </div>
                              <p className="text-xs text-muted-foreground">{template.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
                      <div className="space-y-2">
                        <Label htmlFor="survey_liff_id">LIFF ID</Label>
                        <Input
                          id="survey_liff_id"
                    value={newSurveyData.liff_id}
                    onChange={(e) => setNewSurveyData({...newSurveyData, liff_id: e.target.value})}
                    placeholder="例：1234567890-abcdefgh"
                  />
                        <p className="text-xs text-muted-foreground">LINE Developersで作成したLIFF IDを入力（任意）</p>
                </div>
                      <div className="flex gap-3">
                        <Button
                  onClick={handleCreateSurveyForm}
                  disabled={submitting}
                          className="flex-1 sm:flex-none"
                >
                  {submitting ? '作成中...' : 'アンケートを作成'}
                        </Button>
                        <Button
                          variant="outline"
                  onClick={() => setShowCreateSurveyForm(false)}
                          className="flex-1 sm:flex-none"
                >
                  キャンセル
                        </Button>
              </div>
                    </CardContent>
                  </Card>
          )}

          {/* アンケート一覧 */}
          <div className="space-y-3">
            {surveyForms.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                まだアンケートが作成されていません
                    </p>
            ) : (
              surveyForms.map((form) => {
                const deployInfo = form.static_deploy;
                let formUrl = deployInfo?.deploy_url || deployInfo?.storage_url || `/preview/${storeId}/surveys/${form.id}`;
                if (formUrl.startsWith('/') && !formUrl.startsWith('//')) {
                  formUrl = `${getBaseUrl()}${formUrl}`;
                }
                return (
                      <Card key={form.id}>
                        <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <h3 className="font-medium truncate">{form.config.basic_info.title}</h3>
                        {form.draft_status === 'draft' && (
                                  <Badge variant="outline" className="text-orange-600 border-orange-600 shrink-0">
                                    下書き
                                  </Badge>
                                )}
                                <Badge variant={form.status === 'active' ? 'default' : 'secondary'} className="shrink-0">
                                  {form.status === 'active' ? '公開中' : '非公開'}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground font-mono truncate">
                                ID: {form.id}
                      </p>
                    </div>
                            <div className="flex gap-2 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                        onClick={() => handleEditForm(form)}
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                編集
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                        onClick={() => handleDeleteSurveyForm(form.id)}
                      >
                                <Trash2 className="mr-2 h-4 w-4" />
                        削除
                              </Button>
                    </div>
                  </div>
                          <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                            <code className="text-xs text-muted-foreground truncate flex-1 min-w-0">{formUrl}</code>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => window.open(formUrl, '_blank')} title="開く">
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => copyToClipboard(formUrl)} title="コピー">
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                );
              })
            )}
          </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 設定タブ */}
          <TabsContent value="settings" className="space-y-6">
            {/* 店舗管理者管理 */}
            <StoreAdminManager storeId={storeId} />

            {/* 危険ゾーン */}
            <Card className="border-destructive/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  <CardTitle className="text-destructive">危険ゾーン</CardTitle>
                        </div>
                <CardDescription>
              この操作は取り消すことができません。店舗を削除すると、関連する全てのフォームと予約データも削除されます。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="destructive"
            onClick={() => {
              if (confirm(`店舗「${store.name}」を本当に削除しますか？\n\nこの操作は取り消せません。関連する全てのフォームと予約データも削除されます。`)) {
                handleDeleteStore();
              }
            }}
          >
                  <Trash2 className="mr-2 h-4 w-4" />
            この店舗を削除する
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* 店舗編集モーダル */}
      <Dialog open={showStoreEditModal} onOpenChange={setShowStoreEditModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>店舗情報編集: {editingStore?.name}</DialogTitle>
          </DialogHeader>
          {editingStore && (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_name">
                    店舗名 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit_name"
                      value={editingStore.name}
                    onChange={(e) => setEditingStore({...editingStore, name: e.target.value})}
                    />
                  </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_owner_name">
                    オーナー名 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit_owner_name"
                      value={editingStore.owner_name}
                    onChange={(e) => setEditingStore({...editingStore, owner_name: e.target.value})}
                    />
                  </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_owner_email">メールアドレス</Label>
                  <Input
                    id="edit_owner_email"
                      type="email"
                      value={editingStore.owner_email}
                    onChange={(e) => setEditingStore({...editingStore, owner_email: e.target.value})}
                    />
                  </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_phone">電話番号</Label>
                  <Input
                    id="edit_phone"
                      type="tel"
                      value={editingStore.phone || ''}
                    onChange={(e) => setEditingStore({...editingStore, phone: e.target.value})}
                    />
                  </div>
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="edit_address">住所</Label>
                  <Input
                    id="edit_address"
                      value={editingStore.address || ''}
                    onChange={(e) => setEditingStore({...editingStore, address: e.target.value})}
                    />
                  </div>
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="edit_website_url">ウェブサイトURL</Label>
                  <Input
                    id="edit_website_url"
                      type="url"
                      value={editingStore.website_url || ''}
                    onChange={(e) => setEditingStore({...editingStore, website_url: e.target.value})}
                    />
                  </div>
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="edit_description">店舗説明</Label>
                    <textarea
                    id="edit_description"
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={editingStore.description || ''}
                    onChange={(e) => setEditingStore({...editingStore, description: e.target.value})}
                    />
                  </div>
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="edit_line_channel_access_token">LINE チャネルアクセストークン（任意）</Label>
                  <Input
                    id="edit_line_channel_access_token"
                    type="password"
                    placeholder="未設定の場合は空欄のまま"
                    value={editingStore.line_channel_access_token || ''}
                    onChange={(e) => setEditingStore({...editingStore, line_channel_access_token: e.target.value})}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Webhook・リマインドで使用します。
                  </p>
                </div>
                </div>
              </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStoreEditModal(false)}>
                キャンセル
            </Button>
            <Button onClick={handleSaveStore}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            const isSurvey = updatedForm.config && 'questions' in updatedForm.config;
            const endpoint = isSurvey 
              ? `/api/surveys/${updatedForm.id}`
              : `/api/forms/${updatedForm.id}`;
            
            const response = await fetch(endpoint, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(updatedForm),
            });

            if (response.ok) {
              const savedForm = await response.json();
              if (isSurvey) {
                 setSurveyForms(surveyForms.map(f => f.id === savedForm.id ? (savedForm as SurveyForm) : f));
              } else {
                 setForms(forms.map(f => f.id === savedForm.id ? (savedForm as Form) : f));
              }
              toast({
                title: '成功',
                description: 'フォームを保存しました',
              });
            } else {
              throw new Error('保存に失敗しました');
            }
          }}
          theme="light"
          userRole="service_admin"
        />
      )}

      {/* フォーム削除確認ダイアログ */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>フォームを削除</DialogTitle>
            <DialogDescription>
              この操作は取り消せません
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p>
Form「{forms.find(f => f.id === deletingFormId) ? ((forms.find(f => f.id === deletingFormId) as any).form_name || forms.find(f => f.id === deletingFormId)?.config?.basic_info?.form_name) : ''}」を削除しますか？
                </p>
            <p className="text-sm text-muted-foreground">
                  削除すると、このフォームに関連する予約データも全て削除されます。
                </p>
              </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDeleteForm}>
                  キャンセル
            </Button>
            <Button variant="destructive" onClick={confirmDeleteForm}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 予約詳細モーダル */}
      <Dialog open={showReservationDetail} onOpenChange={setShowReservationDetail}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>予約詳細</DialogTitle>
            <DialogDescription>
              {selectedReservation && (
                <>予約ID: {selectedReservation.id}</>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReservation && (
            <div className="space-y-4">
              {/* 基本情報 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">基本情報</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm text-muted-foreground">顧客名</Label>
                      <p className="font-medium">{selectedReservation.customer_name}</p>
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">電話番号</Label>
                      <p className="font-medium">{selectedReservation.customer_phone}</p>
                    </div>
                    {selectedReservation.customer_email && (
                      <div>
                        <Label className="text-sm text-muted-foreground">メールアドレス</Label>
                        <p className="font-medium">{selectedReservation.customer_email}</p>
                      </div>
                    )}
                    <div>
                      <Label className="text-sm text-muted-foreground">予約日時</Label>
                      <p className="font-medium">
                        {new Date(selectedReservation.reservation_date).toLocaleDateString('ja-JP')} {selectedReservation.reservation_time}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">ステータス</Label>
                      <div className="mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                          selectedReservation.status === 'confirmed' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          selectedReservation.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          selectedReservation.status === 'cancelled' ? 'bg-red-50 text-red-600 border-red-200' :
                          'bg-green-50 text-green-700 border-green-200'
                        }`}>
                          {selectedReservation.status === 'pending' ? '保留中' :
                           selectedReservation.status === 'confirmed' ? '確認済み' :
                           selectedReservation.status === 'cancelled' ? 'キャンセル' : '完了'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">フォーム</Label>
                      <p className="font-medium">
                        {forms.find(f => f.id === selectedReservation.form_id) 
                          ? ((forms.find(f => f.id === selectedReservation.form_id) as any)?.form_name || forms.find(f => f.id === selectedReservation.form_id)?.config?.basic_info?.form_name || 'フォーム')
                          : 'フォーム不明'}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{selectedReservation.form_id}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 選択メニュー */}
              {(() => {
                const menus = selectedReservation.selected_menus;
                return menus && Array.isArray(menus) && menus.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">選択メニュー</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {(menus as any[]).map((menu: any, index: number) => (
                          <div key={index} className="p-3 border rounded-lg">
                            <div className="font-medium">{menu.menu_name || menu.name || 'メニュー'}</div>
                            {menu.submenu_name && (
                              <div className="text-sm text-muted-foreground">サブメニュー: {menu.submenu_name}</div>
                            )}
                            {menu.price && (
                              <div className="text-sm text-muted-foreground">料金: ¥{menu.price.toLocaleString()}</div>
                            )}
                            {menu.duration && (
                              <div className="text-sm text-muted-foreground">所要時間: {menu.duration}分</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : null;
              })()}

              {/* 選択オプション */}
              {(() => {
                const options = selectedReservation.selected_options;
                return options && Array.isArray(options) && options.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">選択オプション</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {(options as any[]).map((option: any, index: number) => (
                          <div key={index} className="p-3 border rounded-lg">
                            <div className="font-medium">{option.option_name || option.name || 'オプション'}</div>
                            {option.price && (
                              <div className="text-sm text-muted-foreground">料金: ¥{option.price.toLocaleString()}</div>
                            )}
                            {option.duration && (
                              <div className="text-sm text-muted-foreground">所要時間: {option.duration}分</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : null;
              })()}

              {/* その他情報 */}
              {(() => {
                const info = selectedReservation.customer_info as Record<string, any> | null;
                if (!info || typeof info !== 'object') return null;

                const formConfig = forms.find(f => f.id === selectedReservation.form_id)?.config;

                // gender の値 → ラベル
                const genderLabel = (v: string) => {
                  const opt = formConfig?.gender_selection?.options?.find(o => o.value === v);
                  if (opt) return opt.label;
                  return v === 'male' ? '男性' : v === 'female' ? '女性' : v;
                };

                // visit_count の値 → ラベル
                const visitCountLabel = (v: string) => {
                  const opt = formConfig?.visit_count_selection?.options?.find(o => o.value === v);
                  if (opt) return opt.label;
                  return v === 'first' ? '初回' : v === 'repeat' ? '2回目以降' : v;
                };

                // coupon の値 → ラベル
                const couponLabel = (v: string) => {
                  const opt = formConfig?.coupon_selection?.options?.find(o => o.value === v);
                  if (opt) return opt.label;
                  return v === 'use' ? '利用する' : v === 'not_use' ? '利用しない' : v;
                };

                const rows: { label: string; value: string }[] = [];

                if (info.gender) rows.push({ label: '性別', value: genderLabel(String(info.gender)) });
                if (info.visit_count) rows.push({ label: '来店回数', value: visitCountLabel(String(info.visit_count)) });
                if (info.coupon) rows.push({ label: 'クーポン', value: couponLabel(String(info.coupon)) });
                if (info.notes && String(info.notes).trim()) rows.push({ label: 'メモ', value: String(info.notes) });
                if (info.total_price != null) rows.push({ label: '合計料金', value: `¥${Number(info.total_price).toLocaleString()}` });
                if (info.total_duration != null) rows.push({ label: '合計所要時間', value: `${info.total_duration}分` });
                if (info.preferred_date2) rows.push({ label: '第2希望日時', value: `${info.preferred_date2}${info.preferred_time2 ? ' ' + info.preferred_time2 : ''}` });
                if (info.preferred_date3) rows.push({ label: '第3希望日時', value: `${info.preferred_date3}${info.preferred_time3 ? ' ' + info.preferred_time3 : ''}` });

                // カスタムフィールド
                if (info.custom_fields && typeof info.custom_fields === 'object') {
                  Object.entries(info.custom_fields as Record<string, any>).forEach(([fieldId, fieldValue]) => {
                    const fieldDef = formConfig?.custom_fields?.find(f => f.id === fieldId);
                    const label = fieldDef?.title || fieldId;
                    const val = Array.isArray(fieldValue) ? fieldValue.join(', ') : String(fieldValue ?? '');
                    if (val) rows.push({ label, value: val });
                  });
                }

                if (rows.length === 0) return null;

                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">その他情報</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {rows.map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-start gap-4">
                            <span className="text-sm text-muted-foreground shrink-0">{label}</span>
                            <span className="text-sm font-medium text-right">{value}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* 作成日時 */}
              <div className="text-xs text-muted-foreground">
                作成日時: {new Date(selectedReservation.created_at).toLocaleString('ja-JP')}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
