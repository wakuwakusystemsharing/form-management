'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Store } from '@/types/store';
import { Form } from '@/types/form';
import { SurveyForm } from '@/types/survey';
import FormEditModal from '@/components/FormEditor/FormEditModal';

// アンケートテンプレート定義
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
  },
  debug: {
    name: '🐛 デバッグ用（全機能）',
    description: '全ての機能を網羅したデバッグ用テンプレート',
    liff_id: '2008098784-5ZQ1LRn3',
    gas_endpoint: 'https://script.google.com/macros/s/AKfycby3QfS2E892nXbS-fnfBVrJX8KyJWTSsisKpe9zVz5QGWzvTH7Zc3PlOay9j60aSQLp/exec',
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
            display_name: 'カット',
            menus: [
              {
                id: 'menu1',
                name: 'スタンダードカット',
                price: 3000,
                duration: 60,
                description: '基本的なカットメニュー',
                gender_filter: 'both',
                has_submenu: true,
                sub_menu_items: [
                  {
                    id: 'sub1',
                    name: 'ショートカット',
                    price: 3000,
                    duration: 60,
                    description: 'ショートスタイルのカット'
                  },
                  {
                    id: 'sub2',
                    name: 'ミディアムカット',
                    price: 3500,
                    duration: 70,
                    description: 'ミディアムスタイルのカット'
                  },
                  {
                    id: 'sub3',
                    name: 'ロングカット',
                    price: 4000,
                    duration: 80,
                    description: 'ロングスタイルのカット'
                  }
                ],
                options: [
                  {
                    id: 'opt1',
                    name: 'シャンプー',
                    price: 500,
                    duration: 15,
                    description: '基本シャンプー',
                    is_default: true
                  },
                  {
                    id: 'opt2',
                    name: 'トリートメント',
                    price: 1000,
                    duration: 20,
                    description: 'ヘアトリートメント',
                    is_default: false
                  }
                ]
              },
              {
                id: 'menu2',
                name: '男性専用カット',
                price: 2500,
                duration: 45,
                description: '男性向けのカットメニュー',
                gender_filter: 'male',
                options: [
                  {
                    id: 'opt3',
                    name: 'シェービング',
                    price: 800,
                    duration: 10,
                    description: '顔剃りサービス',
                    is_default: false
                  }
                ]
              },
              {
                id: 'menu3',
                name: '女性専用カット',
                price: 4000,
                duration: 90,
                description: '女性向けのカットメニュー',
                gender_filter: 'female',
                options: [
                  {
                    id: 'opt4',
                    name: 'ブロー',
                    price: 1500,
                    duration: 30,
                    description: 'スタイリングブロー',
                    is_default: true
                  }
                ]
              }
            ],
            options: [],
            selection_mode: 'single',
            gender_condition: 'all'
          },
          {
            id: 'cat2',
            name: 'カラー',
            display_name: 'カラー',
            menus: [
              {
                id: 'menu4',
                name: 'フルカラー',
                price: 8000,
                duration: 120,
                description: '全体カラーリング',
                gender_filter: 'both',
                has_submenu: true,
                sub_menu_items: [
                  {
                    id: 'sub4',
                    name: 'ベーシックカラー',
                    price: 8000,
                    duration: 120,
                    description: '標準的なカラーリング'
                  },
                  {
                    id: 'sub5',
                    name: 'プレミアムカラー',
                    price: 12000,
                    duration: 150,
                    description: '高品質なカラーリング'
                  }
                ],
                options: [
                  {
                    id: 'opt5',
                    name: 'カラートリートメント',
                    price: 2000,
                    duration: 20,
                    description: 'カラー後のトリートメント',
                    is_default: true
                  }
                ]
              },
              {
                id: 'menu5',
                name: 'ハイライト',
                price: 10000,
                duration: 150,
                description: 'ハイライトカラー',
                gender_filter: 'female',
                options: [
                  {
                    id: 'opt6',
                    name: 'オーガニックカラー',
                    price: 3000,
                    duration: 30,
                    description: 'オーガニック素材使用',
                    is_default: false
                  }
                ]
              }
            ],
            options: [],
            selection_mode: 'single',
            gender_condition: 'all'
          },
          {
            id: 'cat3',
            name: 'パーマ',
            display_name: 'パーマ',
            menus: [
              {
                id: 'menu6',
                name: 'デジタルパーマ',
                price: 6000,
                duration: 120,
                description: 'デジタルパーマ',
                gender_filter: 'both',
                options: [
                  {
                    id: 'opt7',
                    name: 'カット込み',
                    price: 2000,
                    duration: 60,
                    description: 'カットサービス付き',
                    is_default: true
                  },
                  {
                    id: 'opt8',
                    name: 'トリートメント込み',
                    price: 1500,
                    duration: 20,
                    description: 'トリートメントサービス付き',
                    is_default: false
                  }
                ]
              }
            ],
            options: [],
            selection_mode: 'single',
            gender_condition: 'all'
          },
          {
            id: 'cat4',
            name: 'オプション',
            display_name: 'オプション',
            menus: [
              {
                id: 'menu7',
                name: 'ヘッドスパ',
                price: 2000,
                duration: 30,
                description: 'リラックスヘッドスパ',
                gender_filter: 'both',
                options: [
                  {
                    id: 'opt9',
                    name: 'アロマオイル',
                    price: 500,
                    duration: 5,
                    description: 'アロマオイル追加',
                    is_default: false
                  }
                ]
              },
              {
                id: 'menu8',
                name: 'ヘッドマッサージ',
                price: 1500,
                duration: 20,
                description: '頭皮マッサージ',
                gender_filter: 'both'
              }
            ],
            options: [],
            selection_mode: 'single',
            gender_condition: 'all'
          }
        ]
      },
      ui_settings: {
        show_visit_count: true,
        show_coupon_selection: true,
        show_repeat_booking: true
      }
    }
  },
  with_images: {
    name: '🖼️ 画像付きメニュー',
    description: '画像表示機能付きのメニュー選択フォーム',
    liff_id: '2008098784-5ZQ1LRn3',
    gas_endpoint: 'https://script.google.com/macros/s/AKfycby3QfS2E892nXbS-fnfBVrJX8KyJWTSsisKpe9zVz5QGWzvTH7Zc3PlOay9j60aSQLp/exec',
    config: {
      basic_info: {
        show_gender_selection: true
      },
      menu_structure: {
        structure_type: 'category',
        categories: [
          {
            id: 'cat1',
            name: 'メニュー',
            display_name: 'メニュー',
            menus: [
              {
                id: 'menu1',
                name: 'コースA (1000円/30分)',
                price: 1000,
                duration: 30,
                description: '初回体験向け。軽めの着色汚れを除去。',
                image: 'https://www.dropbox.com/scl/fi/rp6b5xcnbnt5d03ommeb4/.png?rlkey=y6hhwc2ubinzpavldh3fgzl6p&st=d0cbcp3s&raw=1',
                gender_filter: 'both',
                has_submenu: false,
                options: [
                  {
                    id: 'opt1',
                    name: 'コーヒーやお茶の着色が気になる方',
                    price: 0,
                    duration: 0,
                    description: 'おすすめ',
                    is_default: true
                  }
                ]
              },
              {
                id: 'menu2',
                name: 'コースB (2000円/60分)',
                price: 2000,
                duration: 60,
                description: '本格的なホワイトニング。より白い歯へ。',
                image: 'https://www.dropbox.com/scl/fi/adiq6vy9fxdqub025oavy/.png?rlkey=ghg3q2r7a9izp610x7johbl3b&st=eup1t89x&raw=1',
                gender_filter: 'both',
                has_submenu: false,
                options: [
                  {
                    id: 'opt2',
                    name: 'より白い歯を目指す方',
                    price: 0,
                    duration: 0,
                    description: 'おすすめ',
                    is_default: false
                  }
                ]
              },
              {
                id: 'menu3',
                name: 'コースC (3000円/90分)',
                price: 3000,
                duration: 90,
                description: 'プレミアムホワイトニング。最高の白さを実現。',
                image: 'https://www.dropbox.com/scl/fi/su141b49bkpnspprslc17/.png?rlkey=guaknyrjpgta2nve3hf9nagkz&st=jyx7zxcn&raw=1',
                gender_filter: 'both',
                has_submenu: false,
                options: [
                  {
                    id: 'opt3',
                    name: '結婚式や重要な行事を控えている方',
                    price: 0,
                    duration: 0,
                    description: 'おすすめ',
                    is_default: false
                  }
                ]
              }
            ],
            options: [],
            selection_mode: 'single',
            gender_condition: 'all'
          },
          {
            id: 'cat2',
            name: 'オプション',
            display_name: 'オプション',
            menus: [
              {
                id: 'menu4',
                name: 'フッ素コーティング',
                price: 500,
                duration: 10,
                description: '歯を保護します',
                image: 'https://www.dropbox.com/scl/fi/rp6b5xcnbnt5d03ommeb4/.png?rlkey=y6hhwc2ubinzpavldh3fgzl6p&st=d0cbcp3s&raw=1',
                gender_filter: 'both',
                options: []
              },
              {
                id: 'menu5',
                name: 'リテーナー（カスタム）',
                price: 5000,
                duration: 0,
                description: 'ホワイトニング維持用',
                image: 'https://www.dropbox.com/scl/fi/adiq6vy9fxdqub025oavy/.png?rlkey=ghg3q2r7a9izp610x7johbl3b&st=eup1t89x&raw=1',
                gender_filter: 'both',
                options: []
              }
            ],
            options: [],
            selection_mode: 'single',
            gender_condition: 'all'
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
    gas_endpoint: '',
    calendar_url: '',
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

        // アンケート一覧取得
        const surveysResponse = await fetch(`/api/stores/${storeId}/surveys`, {
          credentials: 'include',
        });
        if (surveysResponse.ok) {
          const surveysData = await surveysResponse.json();
          setSurveyForms(surveysData);
        }

        // 最近の予約取得（最新10件）
        const reservationsResponse = await fetch(`/api/stores/${storeId}/reservations`, {
          credentials: 'include',
        });
        if (reservationsResponse.ok) {
          const reservationsData = await reservationsResponse.json();
          // 最新10件に制限（作成日時の降順でソート済み）
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

  const handleCreateForm = async () => {
    if (!newFormData.form_name.trim()) {
      alert('フォーム名を入力してください');
      return;
    }

    // フォームタイプに応じたバリデーション
    if (newFormData.form_type === 'line') {
      if (!newFormData.liff_id.trim()) {
        alert('LIFF IDを入力してください');
        return;
      }
    } else if (newFormData.form_type === 'web') {
      if (!newFormData.calendar_url.trim()) {
        alert('カレンダー取得URLを入力してください');
        return;
      }
      if (!newFormData.security_secret.trim()) {
        alert('SECURITY_SECRETを入力してください');
        return;
      }
    }

    if (!newFormData.gas_endpoint.trim()) {
      alert('Google App Script エンドポイントを入力してください');
      return;
    }

    // GASエンドポイントのバリデーション（URL形式チェック）
    try {
      new URL(newFormData.gas_endpoint.trim());
    } catch {
      alert('有効なURL形式ではありません');
      return;
    }

    // Google Apps ScriptのURLパターンチェック
    const gasUrlPattern = /^https:\/\/script\.google\.com\/macros\/s\/[^\/]+\/exec/;
    if (!gasUrlPattern.test(newFormData.gas_endpoint.trim())) {
      alert('Google Apps ScriptのURL形式が正しくありません（例: https://script.google.com/macros/s/xxx/exec）');
      return;
    }

    setSubmitting(true);
    
    // GASエンドポイントが実際に動作するかテスト（サーバーサイドプロキシ経由）
    let testPassed = false;
    try {
      const testStartTime = new Date();
      testStartTime.setHours(0, 0, 0, 0);
      const testEndTime = new Date(testStartTime);
      testEndTime.setDate(testStartTime.getDate() + 7);
      testEndTime.setHours(23, 59, 59, 999);

      // サーバーサイドプロキシAPIを使用してCORSエラーを回避
      const testApiUrl = `/api/gas/test?url=${encodeURIComponent(newFormData.gas_endpoint.trim())}&startTime=${encodeURIComponent(testStartTime.toISOString())}&endTime=${encodeURIComponent(testEndTime.toISOString())}`;

      const testResponse = await fetch(testApiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!testResponse.ok) {
        const errorData = await testResponse.json().catch(() => ({ error: '不明なエラー' }));
        throw new Error(errorData.error || `HTTPエラー: ${testResponse.status}`);
      }

      const result = await testResponse.json();
      
      if (!result.success) {
        throw new Error(result.error || 'テストに失敗しました');
      }

      // テスト成功
      testPassed = true;
      console.log('GASエンドポイントのテスト成功:', result.data);
    } catch (error) {
      console.error('GASエンドポイントのテスト失敗:', error);
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      const shouldContinue = window.confirm(
        `GASエンドポイントの接続テストに失敗しました。\n\n` +
        `エラー: ${errorMessage}\n\n` +
        `それでもフォームを作成しますか？\n\n` +
        `（注意: カレンダー空き状況が取得できない可能性があります）`
      );
      
      if (!shouldContinue) {
        setSubmitting(false);
        return;
      }
      // ユーザーが続行を選択した場合は、testPassed = falseのまま続行
    }

    // フォーム作成処理
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
          form_type: newFormData.form_type,
          liff_id: newFormData.form_type === 'line' ? newFormData.liff_id.trim() : '',
          gas_endpoint: newFormData.gas_endpoint.trim(),
          calendar_url: newFormData.form_type === 'web' ? newFormData.calendar_url.trim() : '',
          security_secret: newFormData.form_type === 'web' ? newFormData.security_secret.trim() : '',
          template: selectedTemplate
        }),
      });

      if (response.ok) {
        const newForm = await response.json();
        setForms([...forms, newForm]);
        setNewFormData({ 
          form_name: '', 
          form_type: 'line',
          liff_id: '', 
          gas_endpoint: '', 
          calendar_url: '',
          security_secret: '',
          template: 'basic' 
        });
        setShowCreateForm(false);
        const formName = newForm.config?.basic_info?.form_name || newFormData.form_name.trim();
        alert(`フォーム「${formName}」を作成しました（ID: ${newForm.id}）\nテンプレート: ${selectedTemplate?.name || 'ベーシック'}`);
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

  const handleCreateSurveyForm = async () => {
    if (!newSurveyData.form_name.trim()) {
      alert('フォーム名を入力してください');
      return;
    }

    setSubmitting(true);
    try {
      const selectedTemplate = SURVEY_TEMPLATES[newSurveyData.template as keyof typeof SURVEY_TEMPLATES];
      const response = await fetch(`/api/stores/${storeId}/surveys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
        alert(`アンケートフォーム「${newForm.config.basic_info.title}」を作成しました`);
      } else {
        const error = await response.json();
        alert(`エラー: ${error.error}`);
      }
    } catch (error) {
      console.error('Survey creation error:', error);
      alert('アンケート作成に失敗しました');
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
        alert('アンケートフォームを削除しました');
      } else {
        const error = await response.json();
        alert(`削除に失敗しました: ${error.error}`);
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('削除に失敗しました');
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
        let storageUrl = '';
        
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
          formUrl = `${baseUrl}/preview/${storeId}/forms/${form.id}`;
        }
        
        // storage_urlを別途保存
        if (deployInfo?.storage_url) {
          storageUrl = deployInfo.storage_url;
        }
        
        return {
          id: form.id,
          name: (form as any).form_name || form.config?.basic_info?.form_name,
          url: formUrl,
          storageUrl: storageUrl,
          status: form.status,
          environment: deployInfo?.environment || 'production'
        };
      }),
      surveyUrls: surveyForms.map(form => {
        const deployInfo = form.static_deploy;
        let formUrl = '';
        let storageUrl = '';
        
        if (deployInfo?.deploy_url) {
          formUrl = deployInfo.deploy_url;
        } else if (deployInfo?.storage_url) {
          formUrl = deployInfo.storage_url;
        } else {
          formUrl = `${baseUrl}/preview/${storeId}/surveys/${form.id}`;
        }
        
        if (deployInfo?.storage_url) {
          storageUrl = deployInfo.storage_url;
        }
        
        return {
          id: form.id,
          name: form.config.basic_info.title,
          url: formUrl,
          storageUrl: storageUrl,
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

        {/* フォーム一覧表示 */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-600">
          <h2 className="text-lg font-semibold text-cyan-400 mb-4">
            📋 フォーム一覧
          </h2>
          
          {/* フォームURLカード（2列グリッドレイアウト） */}
          {urls.formUrls.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-400 mb-2">予約フォーム</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {urls.formUrls.map((form) => (
                  <div key={form.id} className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                    {/* フォーム名とステータス */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-cyan-300 font-medium">{form.name}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        form.status === 'active' 
                          ? 'bg-green-600 text-green-100' 
                          : 'bg-gray-600 text-gray-300'
                      }`}>
                        {form.status === 'active' ? '公開中' : '非公開'}
                      </span>
                    </div>
                    
                    {/* 本番URL（deploy_url）- 目立つ表示 */}
                    <div className="mb-3">
                      <label className="block text-xs text-gray-400 mb-2">顧客向け本番URL</label>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => window.open(form.url, '_blank')}
                          className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-center"
                          title="新しいタブで開く"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(form.url);
                            alert('URLをコピーしました');
                          }}
                          className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-md text-sm transition-colors"
                          title="URLをコピー"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    
                    {/* Storage URL - 控えめな表示 */}
                    {form.storageUrl && (
                      <div className="pt-2 border-t border-gray-600">
                        <button
                          onClick={() => window.open(form.storageUrl!, '_blank')}
                          className="text-xs text-gray-400 hover:text-gray-300 underline"
                          title="Storage URL を開く"
                        >
                          Storage URL を開く
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* アンケートフォームURLカード */}
          {urls.surveyUrls.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">アンケートフォーム</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {urls.surveyUrls.map((form) => (
                  <div key={form.id} className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                    {/* フォーム名とステータス */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-emerald-300 font-medium">{form.name}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        form.status === 'active' 
                          ? 'bg-green-600 text-green-100' 
                          : 'bg-gray-600 text-gray-300'
                      }`}>
                        {form.status === 'active' ? '公開中' : '非公開'}
                      </span>
                    </div>
                    
                    {/* 本番URL（deploy_url）- 目立つ表示 */}
                    <div className="mb-3">
                      <label className="block text-xs text-gray-400 mb-2">顧客向け本番URL</label>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => window.open(form.url, '_blank')}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-center"
                          title="新しいタブで開く"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(form.url);
                            alert('URLをコピーしました');
                          }}
                          className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-md text-sm transition-colors"
                          title="URLをコピー"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    
                    {/* Storage URL - 控えめな表示 */}
                    {form.storageUrl && (
                      <div className="pt-2 border-t border-gray-600">
                        <button
                          onClick={() => window.open(form.storageUrl!, '_blank')}
                          className="text-xs text-gray-400 hover:text-gray-300 underline"
                          title="Storage URL を開く"
                        >
                          Storage URL を開く
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
                    フォームタイプ <span className="text-red-400">*</span>
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="relative">
                      <input
                        type="radio"
                        id="form-type-line"
                        name="form_type"
                        value="line"
                        checked={newFormData.form_type === 'line'}
                        onChange={(e) => setNewFormData({...newFormData, form_type: 'line'})}
                        className="sr-only"
                      />
                      <label
                        htmlFor="form-type-line"
                        className={`block p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 ${
                          newFormData.form_type === 'line'
                            ? 'border-emerald-500 bg-emerald-900/20 ring-2 ring-emerald-500/20'
                            : 'border-gray-500 bg-gray-700 hover:border-emerald-400 hover:bg-gray-600'
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <div className="flex-shrink-0">
                            <div className={`w-5 h-5 rounded-full border-2 ${
                              newFormData.form_type === 'line'
                                ? 'border-emerald-500 bg-emerald-500'
                                : 'border-gray-400'
                            } flex items-center justify-center`}>
                              {newFormData.form_type === 'line' && (
                                <div className="w-2 h-2 bg-white rounded-full"></div>
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-gray-100">
                              LINE予約フォーム
                            </h4>
                            <p className="text-xs text-gray-400 mt-1">
                              LINE公式アカウント経由で予約（LIFF ID必須）
                            </p>
                          </div>
                        </div>
                      </label>
                    </div>
                    <div className="relative">
                      <input
                        type="radio"
                        id="form-type-web"
                        name="form_type"
                        value="web"
                        checked={newFormData.form_type === 'web'}
                        onChange={(e) => setNewFormData({...newFormData, form_type: 'web'})}
                        className="sr-only"
                      />
                      <label
                        htmlFor="form-type-web"
                        className={`block p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 ${
                          newFormData.form_type === 'web'
                            ? 'border-emerald-500 bg-emerald-900/20 ring-2 ring-emerald-500/20'
                            : 'border-gray-500 bg-gray-700 hover:border-emerald-400 hover:bg-gray-600'
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <div className="flex-shrink-0">
                            <div className={`w-5 h-5 rounded-full border-2 ${
                              newFormData.form_type === 'web'
                                ? 'border-emerald-500 bg-emerald-500'
                                : 'border-gray-400'
                            } flex items-center justify-center`}>
                              {newFormData.form_type === 'web' && (
                                <div className="w-2 h-2 bg-white rounded-full"></div>
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-gray-100">
                              Web予約フォーム
                            </h4>
                            <p className="text-xs text-gray-400 mt-1">
                              URLだけで予約可能（LIFF ID不要）
                            </p>
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
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
                          onChange={(e) => {
                            const selectedKey = e.target.value;
                            const selectedTemplate = FORM_TEMPLATES[selectedKey as keyof typeof FORM_TEMPLATES];
                            const updatedData: typeof newFormData = {
                              ...newFormData,
                              template: selectedKey
                            };
                            
                            // デバッグ用テンプレートが選ばれた場合、LIFF IDとGASエンドポイントを自動設定
                            if (selectedKey === 'debug') {
                              const debugTemplate = selectedTemplate as any;
                              if (debugTemplate.liff_id) {
                                updatedData.liff_id = debugTemplate.liff_id;
                              }
                              if (debugTemplate.gas_endpoint) {
                                updatedData.gas_endpoint = debugTemplate.gas_endpoint;
                              }
                            }
                            
                            setNewFormData(updatedData);
                          }}
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
                {newFormData.form_type === 'line' && (
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
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Google App Script エンドポイント（予約送信用） <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="url"
                    value={newFormData.gas_endpoint}
                    onChange={(e) => setNewFormData({...newFormData, gas_endpoint: e.target.value})}
                    placeholder="例：https://script.google.com/macros/s/xxx/exec"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {newFormData.form_type === 'line'
                      ? 'カレンダー空き状況取得用のGASエンドポイント'
                      : '予約データをGoogle Calendarに登録するためのGASエンドポイント'}
                  </p>
                </div>
                {newFormData.form_type === 'web' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        カレンダー取得URL <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="url"
                        value={newFormData.calendar_url}
                        onChange={(e) => setNewFormData({...newFormData, calendar_url: e.target.value})}
                        placeholder="例：https://script.google.com/macros/s/xxx/exec"
                        className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                      />
                      <p className="text-xs text-gray-400 mt-1">Google Calendarの空き状況を取得するためのGASエンドポイント</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        SECURITY_SECRET <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={newFormData.security_secret}
                        onChange={(e) => setNewFormData({...newFormData, security_secret: e.target.value})}
                        placeholder="例：9f3a7c1e5b2d48a0c6e1f4d9b3a8c2e7d5f0a1b6c3d8e2f7a9b0c4e6d1f3a5b7"
                        className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                      />
                      <p className="text-xs text-gray-400 mt-1">フォーム送信時の簡易署名用の秘密鍵</p>
                    </div>
                  </>
                )}
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

          {/* 予約フォーム一覧 */}
          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-gray-100 mb-4">予約フォーム</h2>
            {forms.length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                まだ予約フォームが作成されていません
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

        {/* アンケートフォーム管理 */}
        <div className="bg-gray-800 rounded-lg shadow-sm p-6 mb-6 border border-gray-600">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-100">アンケートフォーム</h2>
            <button
              onClick={() => setShowCreateSurveyForm(!showCreateSurveyForm)}
              className="bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-500 transition-colors font-medium"
            >
              {showCreateSurveyForm ? 'キャンセル' : '新規アンケート作成'}
            </button>
          </div>

          {/* アンケート作成フォーム */}
          {showCreateSurveyForm && (
            <div className="bg-gray-700 rounded-lg p-4 mb-4 border border-gray-500">
              <h3 className="text-lg font-medium mb-3 text-gray-100">新しいアンケートを作成</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    フォーム名 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={newSurveyData.form_name}
                    onChange={(e) => setNewSurveyData({...newSurveyData, form_name: e.target.value})}
                    placeholder="例：初回カウンセリングシート"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    テンプレート選択
                  </label>
                  <div className="grid grid-cols-1 gap-3">
                    {Object.entries(SURVEY_TEMPLATES).map(([key, template]) => (
                      <div
                        key={key}
                        onClick={() => setNewSurveyData({ ...newSurveyData, template: key })}
                        className={`cursor-pointer border rounded-lg p-3 transition-colors ${
                          newSurveyData.template === key
                            ? 'border-emerald-500 bg-emerald-900/20'
                            : 'border-gray-600 hover:border-gray-500 bg-gray-800'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-200">{template.name}</span>
                          {newSurveyData.template === key && (
                            <span className="text-emerald-500">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{template.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    LIFF ID
                  </label>
                  <input
                    type="text"
                    value={newSurveyData.liff_id}
                    onChange={(e) => setNewSurveyData({...newSurveyData, liff_id: e.target.value})}
                    placeholder="例：1234567890-abcdefgh"
                    className="w-full px-3 py-2 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-600 text-gray-100 placeholder-gray-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">LINE Developersで作成したLIFF IDを入力（任意）</p>
                </div>
              </div>
              <div className="flex items-center space-x-3 mt-6">
                <button
                  onClick={handleCreateSurveyForm}
                  disabled={submitting}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-700"
                >
                  {submitting ? '作成中...' : 'アンケートを作成'}
                </button>
                <button
                  onClick={() => setShowCreateSurveyForm(false)}
                  className="bg-gray-600 text-gray-200 px-4 py-2 rounded-md hover:bg-gray-500 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-700"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* アンケート一覧 */}
          <div className="space-y-3">
            {surveyForms.length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                まだアンケートが作成されていません
              </div>
            ) : (
              surveyForms.map((form) => (
                <div key={form.id} className="border border-gray-600 rounded-lg p-4 bg-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-100">
                        {form.config.basic_info.title}
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
                        onClick={() => handleDeleteSurveyForm(form.id)}
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">最近の予約</h2>
            <button
              onClick={() => router.push(`/${storeId}/reservations`)}
              className="text-cyan-400 hover:text-cyan-300 text-sm font-medium transition-colors"
            >
              予約一覧・分析を見る →
            </button>
          </div>
          {loadingReservations ? (
            <div className="text-gray-400 text-center py-8">
              読み込み中...
            </div>
          ) : recentReservations.length === 0 ? (
            <div className="text-gray-400 text-center py-8">
              まだ予約がありません
            </div>
          ) : (
            <div className="space-y-3">
              {recentReservations.map((reservation) => {
                const selectedMenus = reservation.selected_menus || [];
                const menuInfo = selectedMenus.length > 0 ? selectedMenus[0] : null;
                const menuName = menuInfo?.menu_name || reservation.menu_name || '未選択';
                const submenuName = menuInfo?.submenu_name || reservation.submenu_name;
                const fullMenuName = submenuName ? `${menuName} > ${submenuName}` : menuName;
                
                return (
                  <div key={reservation.id} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-gray-100 font-medium">{reservation.customer_name}</span>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            reservation.status === 'pending' 
                              ? 'bg-yellow-900/50 text-yellow-200 border border-yellow-700'
                              : reservation.status === 'confirmed'
                              ? 'bg-green-900/50 text-green-200 border border-green-700'
                              : 'bg-red-900/50 text-red-200 border border-red-700'
                          }`}>
                            {reservation.status === 'pending' ? '保留中' : 
                             reservation.status === 'confirmed' ? '確認済み' : 'キャンセル'}
                          </span>
                        </div>
                        <div className="text-sm text-gray-400 space-y-1">
                          <div>📅 {new Date(reservation.reservation_date).toLocaleDateString('ja-JP')} {reservation.reservation_time}</div>
                          <div>📋 {fullMenuName}</div>
                          <div>📞 {reservation.customer_phone}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            const isSurvey = 'questions' in updatedForm.config;
            const endpoint = isSurvey 
              ? `/api/surveys/${updatedForm.id}`
              : `/api/forms/${updatedForm.id}`;
            
            const response = await fetch(endpoint, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
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
