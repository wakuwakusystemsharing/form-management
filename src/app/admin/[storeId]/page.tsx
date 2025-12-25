'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  AlertTriangle
} from 'lucide-react';

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

// テンプレート定義（既存のまま - 簡略化）
const FORM_TEMPLATES = {
  basic: {
    name: '📝 ベーシック',
    description: 'シンプルなメニュー選択のみ',
    config: {
      basic_info: { show_gender_selection: false },
      menu_structure: {
        structure_type: 'simple',
        categories: [{
            id: 'cat1',
            name: 'メニュー',
          menus: [{
                id: 'menu1',
                name: 'カット',
                price: 3000,
                duration: 60,
                description: 'スタンダードカット'
          }]
        }]
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
      basic_info: { show_gender_selection: true },
      menu_structure: {
        structure_type: 'simple',
        categories: [{
            id: 'cat1',
            name: 'メニュー',
          menus: [{
                id: 'menu1',
                name: 'カット',
                price: 3000,
                duration: 60,
                description: 'スタンダードカット',
                target_gender: ['male', 'female']
          }]
        }]
      },
      ui_settings: {
        show_visit_count: true,
        show_coupon_selection: true,
        show_repeat_booking: false
      }
    }
  },
  debug: {
    name: '🐛 デバッグ用（全機能）',
    description: '全ての機能を網羅したデバッグ用テンプレート',
    liff_id: '2008098784-5ZQ1LRn3',
    gas_endpoint: 'https://script.google.com/macros/s/AKfycby3QfS2E892nXbS-fnfBVrJX8KyJWTSsisKpe9zVz5QGWzvTH7Zc3PlOay9j60aSQLp/exec',
    config: {
      basic_info: { show_gender_selection: true },
      menu_structure: {
        structure_type: 'category',
        categories: [{
            id: 'cat1',
            name: 'カット',
          menus: [{
                id: 'menu1',
                name: 'スタンダードカット',
                price: 3000,
                duration: 60,
                description: '基本的なカットメニュー',
                gender_filter: 'both',
                has_submenu: true,
                sub_menu_items: [
              { id: 'sub1', name: 'ショートカット', price: 3000, duration: 60 },
              { id: 'sub2', name: 'ミディアムカット', price: 3500, duration: 70 },
              { id: 'sub3', name: 'ロングカット', price: 4000, duration: 80 }
            ]
          }]
        }]
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
    liff_id: '',
    gas_endpoint: '',
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

  const handleCreateForm = async () => {
    if (!newFormData.form_name.trim()) {
      toast({
        title: 'エラー',
        description: 'フォーム名を入力してください',
        variant: 'destructive',
      });
      return;
    }

    if (!newFormData.liff_id.trim()) {
      toast({
        title: 'エラー',
        description: 'LIFF IDを入力してください',
        variant: 'destructive',
      });
      return;
    }

    if (!newFormData.gas_endpoint.trim()) {
      toast({
        title: 'エラー',
        description: 'Google App Script エンドポイントを入力してください',
        variant: 'destructive',
      });
      return;
    }

    try {
      new URL(newFormData.gas_endpoint.trim());
    } catch {
      toast({
        title: 'エラー',
        description: '有効なURL形式ではありません',
        variant: 'destructive',
      });
      return;
    }

    const gasUrlPattern = /^https:\/\/script\.google\.com\/macros\/s\/[^\/]+\/exec/;
    if (!gasUrlPattern.test(newFormData.gas_endpoint.trim())) {
      toast({
        title: 'エラー',
        description: 'Google Apps ScriptのURL形式が正しくありません',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    
    let testPassed = false;
    try {
      const testStartTime = new Date();
      testStartTime.setHours(0, 0, 0, 0);
      const testEndTime = new Date(testStartTime);
      testEndTime.setDate(testStartTime.getDate() + 7);
      testEndTime.setHours(23, 59, 59, 999);

      const testApiUrl = `/api/gas/test?url=${encodeURIComponent(newFormData.gas_endpoint.trim())}&startTime=${encodeURIComponent(testStartTime.toISOString())}&endTime=${encodeURIComponent(testEndTime.toISOString())}`;

      const testResponse = await fetch(testApiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!testResponse.ok) {
        const errorData = await testResponse.json().catch(() => ({ error: '不明なエラー' }));
        throw new Error(errorData.error || `HTTPエラー: ${testResponse.status}`);
      }

      const result = await testResponse.json();
      
      if (!result.success) {
        throw new Error(result.error || 'テストに失敗しました');
      }

      testPassed = true;
    } catch (error) {
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
    }

    try {
      const selectedTemplate = FORM_TEMPLATES[newFormData.template as keyof typeof FORM_TEMPLATES];
      
      const response = await fetch(`/api/stores/${storeId}/forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        <Card className="w-full max-w-md">
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
    <div className="min-h-screen bg-background p-4 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* ヘッダー */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                onClick={() => router.back()}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    戻る
                  </Button>
            </div>
                <CardTitle className="text-3xl">{store.name}</CardTitle>
                <CardDescription className="mt-1">店舗ID: {store.id}</CardDescription>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                onClick={() => router.push(`/${storeId}/reservations`)}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  予約一覧
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/${storeId}/admin`)}
                >
                  <StoreIcon className="mr-2 h-4 w-4" />
                  店舗管理者
                </Button>
                <Button
                  variant="outline"
                onClick={handleEditStore}
              >
                  <Edit className="mr-2 h-4 w-4" />
                店舗情報編集
                </Button>
            </div>
          </div>
          </CardHeader>
        </Card>

        {/* タブナビゲーション */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">概要</TabsTrigger>
            <TabsTrigger value="forms">予約フォーム</TabsTrigger>
            <TabsTrigger value="surveys">アンケート</TabsTrigger>
            <TabsTrigger value="settings">設定</TabsTrigger>
          </TabsList>

          {/* 概要タブ */}
          <TabsContent value="overview" className="space-y-6">
            {/* フォームURL一覧 */}
            <Card>
              <CardHeader>
                <CardTitle>フォームURL一覧</CardTitle>
                <CardDescription>顧客向けの公開URL</CardDescription>
              </CardHeader>
              <CardContent>
                {forms.length === 0 && surveyForms.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    まだフォームが作成されていません
                  </p>
                ) : (
                  <div className="space-y-4">
                    {forms.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium mb-2">予約フォーム</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {forms.map((form) => {
                            const deployInfo = (form as any).static_deploy;
                            const formUrl = deployInfo?.deploy_url || deployInfo?.storage_url || `/preview/${storeId}/forms/${form.id}`;
                            
                            return (
                              <Card key={form.id}>
                                <CardHeader className="pb-3">
                                  <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">
                                      {(form as any).form_name || form.config?.basic_info?.form_name}
                                    </CardTitle>
                                    <Badge variant={form.status === 'active' ? 'default' : 'secondary'}>
                        {form.status === 'active' ? '公開中' : '非公開'}
                                    </Badge>
                    </div>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      className="flex-1"
                                      onClick={() => window.open(formUrl, '_blank')}
                                    >
                                      <ExternalLink className="mr-2 h-4 w-4" />
                                      開く
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => copyToClipboard(formUrl)}
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                      </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                    </div>
                      </div>
                    )}
                    {surveyForms.length > 0 && (
            <div>
                        <h3 className="text-sm font-medium mb-2">アンケートフォーム</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {surveyForms.map((form) => {
                            const deployInfo = form.static_deploy;
                            const formUrl = deployInfo?.deploy_url || deployInfo?.storage_url || `/preview/${storeId}/surveys/${form.id}`;
                            
                            return (
                              <Card key={form.id}>
                                <CardHeader className="pb-3">
                                  <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">{form.config.basic_info.title}</CardTitle>
                                    <Badge variant={form.status === 'active' ? 'default' : 'secondary'}>
                        {form.status === 'active' ? '公開中' : '非公開'}
                                    </Badge>
                    </div>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      className="flex-1"
                                      onClick={() => window.open(formUrl, '_blank')}
                                    >
                                      <ExternalLink className="mr-2 h-4 w-4" />
                                      開く
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => copyToClipboard(formUrl)}
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                      </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                    </div>
                      </div>
                    )}
            </div>
          )}
              </CardContent>
            </Card>

        {/* 店舗基本情報 */}
            <Card>
              <CardHeader>
                <CardTitle>基本情報</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                    <Label className="text-muted-foreground">店舗名</Label>
                    <p className="font-medium">{store.name}</p>
            </div>
            <div>
                    <Label className="text-muted-foreground">オーナー名</Label>
                    <p className="font-medium">{store.owner_name}</p>
            </div>
            <div>
                    <Label className="text-muted-foreground">メールアドレス</Label>
                    <p className="font-medium">{store.owner_email}</p>
            </div>
            <div>
                    <Label className="text-muted-foreground">電話番号</Label>
                    <p className="font-medium">{store.phone || '未設定'}</p>
            </div>
            <div className="md:col-span-2">
                    <Label className="text-muted-foreground">住所</Label>
                    <p className="font-medium">{store.address || '未設定'}</p>
            </div>
            <div className="md:col-span-2">
                    <Label className="text-muted-foreground">ウェブサイト</Label>
                    <p className="font-medium">{store.website_url || '未設定'}</p>
            </div>
            <div className="md:col-span-2">
                    <Label className="text-muted-foreground">説明</Label>
                    <p className="font-medium">{store.description || '未設定'}</p>
            </div>
          </div>
              </CardContent>
            </Card>

            {/* 最近の予約 */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>最近の予約</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/${storeId}/reservations`)}
                  >
                    すべて見る
                  </Button>
        </div>
              </CardHeader>
              <CardContent>
                {loadingReservations ? (
                  <p className="text-center text-muted-foreground py-8">読み込み中...</p>
                ) : recentReservations.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">まだ予約がありません</p>
                ) : (
                  <div className="space-y-3">
                    {recentReservations.map((reservation) => {
                      const selectedMenus = reservation.selected_menus || [];
                      const menuInfo = selectedMenus.length > 0 ? selectedMenus[0] : null;
                      const menuName = menuInfo?.menu_name || reservation.menu_name || '未選択';
                      const submenuName = menuInfo?.submenu_name || reservation.submenu_name;
                      const fullMenuName = submenuName ? `${menuName} > ${submenuName}` : menuName;
                      
                      return (
                        <div key={reservation.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{reservation.customer_name}</span>
                              <Badge
                                variant={
                                  reservation.status === 'confirmed' ? 'default' :
                                  reservation.status === 'pending' ? 'secondary' :
                                  'destructive'
                                }
                              >
                                {reservation.status === 'pending' ? '保留中' : 
                                 reservation.status === 'confirmed' ? '確認済み' : 'キャンセル'}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <div>📅 {new Date(reservation.reservation_date).toLocaleDateString('ja-JP')} {reservation.reservation_time}</div>
                              <div>📋 {fullMenuName}</div>
                              <div>📞 {reservation.customer_phone}</div>
                            </div>
                          </div>
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
                      <div className="space-y-2">
                        <Label htmlFor="liff_id">
                          LIFF ID <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="liff_id"
                    value={newFormData.liff_id}
                    onChange={(e) => setNewFormData({...newFormData, liff_id: e.target.value})}
                    placeholder="例：1234567890-abcdefgh"
                  />
                        <p className="text-xs text-muted-foreground">LINE Developersで作成したLIFF IDを入力</p>
                </div>
                      <div className="space-y-2">
                        <Label htmlFor="gas_endpoint">
                          Google App Script エンドポイント <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="gas_endpoint"
                    type="url"
                    value={newFormData.gas_endpoint}
                    onChange={(e) => setNewFormData({...newFormData, gas_endpoint: e.target.value})}
                    placeholder="例：https://script.google.com/macros/s/xxx/exec"
                  />
                        <p className="text-xs text-muted-foreground">カレンダー空き状況取得用のGASエンドポイント</p>
                </div>
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
              forms.map((form) => (
                      <Card key={form.id}>
                        <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-medium">
{(form as any).form_name || form.config?.basic_info?.form_name}
                                </h3>
                        {form.draft_status === 'draft' && (
                                  <Badge variant="outline" className="text-orange-600 border-orange-600">
                                    下書き
                                  </Badge>
                                )}
                                <Badge variant={form.status === 'active' ? 'default' : 'secondary'}>
                                  {form.status === 'active' ? '公開中' : '非公開'}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                ID: {form.id}
                      </p>
                    </div>
                            <div className="flex gap-2">
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
                        </CardContent>
                      </Card>
              ))
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
              surveyForms.map((form) => (
                      <Card key={form.id}>
                        <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-medium">{form.config.basic_info.title}</h3>
                        {form.draft_status === 'draft' && (
                                  <Badge variant="outline" className="text-orange-600 border-orange-600">
                                    下書き
                                  </Badge>
                                )}
                                <Badge variant={form.status === 'active' ? 'default' : 'secondary'}>
                                  {form.status === 'active' ? '公開中' : '非公開'}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                ID: {form.id}
                      </p>
                    </div>
                            <div className="flex gap-2">
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
                        </CardContent>
                      </Card>
              ))
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
                  <Label htmlFor="edit_owner_email">
                    メールアドレス <span className="text-destructive">*</span>
                  </Label>
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
            const isSurvey = 'questions' in updatedForm.config;
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
フォーム「{forms.find(f => f.id === deletingFormId) ? ((forms.find(f => f.id === deletingFormId) as any).form_name || forms.find(f => f.id === deletingFormId)?.config?.basic_info?.form_name) : ''}」を削除しますか？
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
    </div>
  );
}
