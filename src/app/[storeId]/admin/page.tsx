'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { Store } from '@/types/store';
import { Form } from '@/types/form';
import { SurveyForm } from '@/types/survey';
import FormEditModal from '@/components/FormEditor/FormEditModal';
import StoreAdminLayout from '@/components/StoreAdminLayout';
import ReservationAnalytics from '@/components/ReservationAnalytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { 
  Search, 
  Edit, 
  Eye, 
  Copy, 
  ExternalLink,
  Calendar,
  FileText,
  ClipboardList,
  Settings as SettingsIcon,
  LogOut
} from 'lucide-react';

interface Reservation {
  id: string;
  form_id: string;
  store_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  reservation_date: string;
  reservation_time: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  created_at: string;
  selected_menus?: unknown[];
  selected_options?: unknown[];
  customer_info?: unknown;
}

export default function StoreAdminPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const storeId = params.storeId as string;
  const { toast } = useToast();
  
  const [user, setUser] = useState<User | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [surveyForms, setSurveyForms] = useState<SurveyForm[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [surveyResponses, setSurveyResponses] = useState<any[]>([]);
  const [selectedSurveyFormId, setSelectedSurveyFormId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<Form | SurveyForm | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [showReservationDetail, setShowReservationDetail] = useState(false);

  // ログイン関連
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  
  // タブとフィルター
  const activeTab = searchParams.get('tab') || 'dashboard';
  const [formSearchQuery, setFormSearchQuery] = useState('');
  const [reservationFilterStatus, setReservationFilterStatus] = useState<string>('all');
  const router = useRouter();
  const reservationView = searchParams.get('view') || 'list';

  // 認証チェック
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          setUser(null);
          setCheckingAuth(false);
          return;
        }
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          setUser(session.user);
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('Auth check error:', err);
        setUser(null);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAuth();
  }, []);

  // ログイン処理
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoginError('Supabaseクライアントの初期化に失敗しました');
        setIsLoggingIn(false);
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.email,
        password: loginForm.password,
      });

      if (error) {
        setLoginError(error.message || 'ログインに失敗しました');
        return;
      }

      if (data.user) {
        setUser(data.user);
        // クッキーにアクセストークンを設定
        try {
          await fetch('/api/auth/set-cookie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ accessToken: data.session?.access_token }),
          });
        } catch (err) {
          console.error('Failed to set cookie:', err);
        }
        window.location.reload();
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('ログインに失敗しました');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // ログアウト処理
  const handleSignOut = async () => {
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
      document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      setUser(null);
      setStore(null);
      setForms([]);
      setSurveyForms([]);
      setReservations([]);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // データ取得（ログイン前でも店舗情報は取得）
  useEffect(() => {
    const fetchStore = async () => {
      try {
        const storeResponse = await fetch(`/api/stores/${storeId}`);
        if (storeResponse.ok) {
          const storeData = await storeResponse.json();
          setStore(storeData);
        }
      } catch (err) {
        console.error('Store fetch error:', err);
      }
    };

    if (storeId) {
      fetchStore();
    }
  }, [storeId]);

  // ユーザー認証後のデータ取得とアクセス権限チェック
  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      
      try {
        setLoading(true);
        
        // アクセス権限チェック（サービス管理者はスキップ）
        const ADMIN_EMAILS = [
          'wakuwakusystemsharing@gmail.com',
          'admin@wakuwakusystemsharing.com',
          'manager@wakuwakusystemsharing.com'
        ];
        
        const isServiceAdmin = ADMIN_EMAILS.includes(user.email || '');
        
        if (!isServiceAdmin) {
          // 店舗管理者の場合、アクセス権限をチェック
          const accessCheckResponse = await fetch(`/api/stores/${storeId}/admins`, {
            credentials: 'include',
          });
          
          if (!accessCheckResponse.ok) {
            // アクセス権限なし
            setError('この店舗へのアクセス権限がありません');
            setLoading(false);
            return;
          }
          
          // 自分の店舗管理者レコードが存在するか確認
          const admins = await accessCheckResponse.json();
          const hasAccess = Array.isArray(admins) && admins.some((admin: any) => admin.email === user.email);
          
          if (!hasAccess) {
            setError('この店舗へのアクセス権限がありません');
            setLoading(false);
            return;
          }
        }
        
        const storeResponse = await fetch(`/api/stores/${storeId}`);
        if (!storeResponse.ok) {
          setError('店舗が見つかりません');
          return;
        }
        const storeData = await storeResponse.json();
        setStore(storeData);
        
        const formsResponse = await fetch(`/api/stores/${storeId}/forms`);
        if (formsResponse.ok) {
          const formsData = await formsResponse.json();
          setForms(formsData);
        }
        
        const surveysResponse = await fetch(`/api/stores/${storeId}/surveys`);
        if (surveysResponse.ok) {
          const surveysData = await surveysResponse.json();
          setSurveyForms(surveysData);
        }
        
        const reservationsResponse = await fetch(`/api/stores/${storeId}/reservations`);
        if (reservationsResponse.ok) {
          const reservationsData = await reservationsResponse.json();
          setReservations(reservationsData);
        }

        // アンケート回答を取得
        const surveyResponsesResponse = await fetch(`/api/stores/${storeId}/surveys/responses`, {
          credentials: 'include',
        });
        if (surveyResponsesResponse.ok) {
          const surveyResponsesData = await surveyResponsesResponse.json();
          setSurveyResponses(surveyResponsesData);
        }
        
      } catch (err) {
        console.error('Data fetch error:', err);
        setError('データの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    if (storeId && user) {
      fetchData();
    }
  }, [storeId, user]);

  const getFormStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-gray-100 text-gray-800';
      case 'paused': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getFormStatusText = (status: string) => {
    switch (status) {
      case 'active': return '公開中';
      case 'inactive': return '非公開';
      case 'paused': return '一時停止';
      default: return '不明';
    }
  };

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'コピーしました',
      description: 'URLをクリップボードにコピーしました',
    });
  }, [toast]);

  // フォームIDからフォーム名を取得
  const getFormName = useCallback((formId: string) => {
    const form = forms.find(f => f.id === formId);
    if (form) {
      return (form as any).form_name || form.config?.basic_info?.form_name || 'フォーム';
    }
    return 'フォーム不明';
  }, [forms]);

  // フィルタリング
  const filteredForms = forms.filter(form => {
    if (!formSearchQuery) return true;
    const query = formSearchQuery.toLowerCase();
    const formName = (form as any).form_name || form.config?.basic_info?.form_name || '';
    return formName.toLowerCase().includes(query);
  });

  const filteredReservations = reservations.filter(reservation => {
    if (reservationFilterStatus === 'all') return true;
    return reservation.status === reservationFilterStatus;
  });

  // 統計情報（早期リターンの前に定義）
  const stats = useMemo(() => ({
    total: forms.length,
    active: forms.filter(f => f.status === 'active').length,
    draft: forms.filter(f => f.draft_status === 'draft').length,
    surveys: surveyForms.length,
    reservations: reservations.length,
    recentReservations: reservations.slice(0, 5),
  }), [forms, surveyForms, reservations]);

  // タブコンテンツ（早期リターンの前に定義）
  const renderTabContent = useMemo(() => {
    switch (activeTab) {
      case 'dashboard':
    return (
          <div className="space-y-6 p-4 lg:p-6">
            {/* 統計カード */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>フォーム数</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.total}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>公開中</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{stats.active}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>アンケート</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">{stats.surveys}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>予約数</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600">{stats.reservations}</div>
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
                    onClick={() => window.location.href = `/${storeId}/admin?tab=reservations`}
                  >
                    すべて見る
                  </Button>
        </div>
              </CardHeader>
              <CardContent>
                {stats.recentReservations.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    まだ予約がありません
                  </p>
                ) : (
                  <div className="space-y-2">
                    {stats.recentReservations.map((reservation) => (
                      <div
                        key={reservation.id}
                        className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => {
                          setSelectedReservation(reservation);
                          setShowReservationDetail(true);
                        }}
                      >
                        <div className="flex-1">
                          <p className="font-medium">{reservation.customer_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(reservation.reservation_date).toLocaleDateString('ja-JP')} {reservation.reservation_time}
                          </p>
      </div>
                        <Badge
                          variant={
                            reservation.status === 'confirmed' ? 'default' :
                            reservation.status === 'pending' ? 'secondary' :
                            reservation.status === 'completed' ? 'default' :
                            'destructive'
                          }
                          className={
                            reservation.status === 'completed' ? 'bg-green-100 text-green-800 hover:bg-green-100' : ''
                          }
                        >
                          {reservation.status === 'pending' ? '保留中' :
                           reservation.status === 'confirmed' ? '確認済み' :
                           reservation.status === 'cancelled' ? 'キャンセル' : '完了'}
                        </Badge>
                      </div>
                    ))}
          </div>
                )}
              </CardContent>
            </Card>
          </div>
        );

      case 'forms':
  return (
          <div className="space-y-6 p-4 lg:p-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                    <CardTitle>フォーム管理</CardTitle>
                    <CardDescription>予約フォームの編集・管理を行います</CardDescription>
            </div>
                  <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="フォームを検索..."
                      value={formSearchQuery}
                      onChange={(e) => setFormSearchQuery(e.target.value)}
                      className="pl-10"
                    />
            </div>
          </div>
              </CardHeader>
              <CardContent>
                {filteredForms.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">
                      {formSearchQuery ? '検索結果が見つかりませんでした' : 'まだフォームが作成されていません'}
                    </p>
                    {!formSearchQuery && (
                      <p className="text-sm">サービス管理者にフォーム作成を依頼してください</p>
                    )}
        </div>
            ) : (
                  <div className="space-y-4">
                    {filteredForms.map((form) => (
                      <Card key={form.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4 sm:p-6">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div className="flex-1 space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-lg font-semibold">
                          {(form as any).form_name || form.config?.basic_info?.form_name || 'フォーム'}
                        </h3>
                                <Badge className={getFormStatusColor(form.status)}>
                          {getFormStatusText(form.status)}
                                </Badge>
                        {form.draft_status === 'draft' && (
                                  <Badge variant="outline" className="text-orange-600 border-orange-600">
                            下書きあり
                                  </Badge>
                        )}
          </div>
          
                              <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                        <div>
                                  <span className="font-medium">フォームID:</span>
                                  <p className="text-xs font-mono">{form.id}</p>
            </div>
                        <div>
                                  <span className="font-medium">作成日:</span>
                                  <span className="ml-2">{new Date(form.created_at).toLocaleDateString('ja-JP')}</span>
                                  <span className="ml-4 font-medium">最終更新:</span>
                                  <span className="ml-2">{new Date(form.updated_at).toLocaleDateString('ja-JP')}</span>
                        </div>
          </div>
          
                              {/* デプロイURL */}
                      {(form as any).static_deploy?.deploy_url ? (
                                <div className="space-y-3">
                                    <div className="flex items-center">
                            <span className="text-sm font-medium">顧客向け本番URL</span>
          </div>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="flex-1"
                                        onClick={() => window.open(form.static_deploy?.deploy_url, '_blank')}
                                      >
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        開く
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="flex-1"
                                        onClick={() => copyToClipboard(form.static_deploy?.deploy_url || '')}
                                      >
                                        <Copy className="mr-2 h-4 w-4" />
                                        コピー
                                      </Button>
        </div>
                                </div>
                              ) : (
                                <Card className="bg-blue-50 border-blue-200">
                                  <CardContent className="p-4">
                                    <p className="text-sm text-blue-800">
                                      📝 準備中 - 数秒後にページを再読み込みしてください
                                    </p>
                                  </CardContent>
                                </Card>
                              )}
                      
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                        onClick={() => {
                          setEditingForm(form);
                          setShowEditModal(true);
                        }}
                                >
                                  <Edit className="mr-2 h-4 w-4" />
                                  編集
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                        onClick={() => window.open(`/preview/${storeId}/forms/${form.id}`, '_blank')}
                      >
                                  <Eye className="mr-2 h-4 w-4" />
                        プレビュー
                                </Button>
            </div>
          </div>
                </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
                )}
              </CardContent>
            </Card>
                    </div>
        );

      case 'reservations':
        return (
          <div className="space-y-6 p-4 lg:p-6">
            <Card>
              <CardHeader>
                <CardTitle>予約管理</CardTitle>
                <CardDescription>予約の確認・管理を行います</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* フォーム管理セクション */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">フォーム管理</h3>
                  {filteredForms.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">まだフォームが作成されていません</p>
              </div>
            ) : (
                    <div className="flex flex-wrap gap-4">
                      {filteredForms.map((form) => (
                        <Card key={form.id} className="flex-1 min-w-[300px] max-w-[500px] hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="space-y-3">
                              {/* フォーム名とステータス、右側にID・日付情報 */}
                              <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-base font-semibold">
                          {(form as any).form_name || form.config?.basic_info?.form_name || 'フォーム'}
                                  </h4>
                                  <Badge className={getFormStatusColor(form.status)}>
                          {getFormStatusText(form.status)}
                                  </Badge>
                        {form.draft_status === 'draft' && (
                                    <Badge variant="outline" className="text-orange-600 border-orange-600">
                            下書きあり
                                    </Badge>
                        )}
                      </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <div>
                                    <span className="font-medium">フォームID:</span>
                                    <span className="ml-1 font-mono">{form.id}</span>
                        </div>
                        <div>
                                    <span className="font-medium">作成日:</span>
                                    <span className="ml-1">{new Date(form.created_at).toLocaleDateString('ja-JP')}</span>
                        </div>
                        <div>
                                    <span className="font-medium">最終更新:</span>
                                    <span className="ml-1">{new Date(form.updated_at).toLocaleDateString('ja-JP')}</span>
                        </div>
                        </div>
                      </div>
                      
                              {/* 公開中URL */}
                      {(form as any).static_deploy?.deploy_url ? (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">公開中URL</span>
                                    <div className="flex gap-1">
                                      <Button
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => window.open(form.static_deploy?.deploy_url, '_blank')}
                                      >
                                        <ExternalLink className="h-3 w-3 mr-1" />
                                        開く
                                      </Button>
                                      <Button
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => copyToClipboard(form.static_deploy?.deploy_url || '')}
                                      >
                                        <Copy className="h-3 w-3 mr-1" />
                                        コピー
                                      </Button>
                            </div>
                          </div>
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded p-2">
                                  📝 準備中 - 数秒後にページを再読み込みしてください
                                </div>
                              )}
                              
                              {/* 編集・プレビューボタン */}
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-9"
                              onClick={() => {
                                    setEditingForm(form);
                                    setShowEditModal(true);
                                  }}
                                >
                                  <Edit className="mr-2 h-4 w-4" />
                                  編集
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-9"
                                  onClick={() => window.open(`/preview/${storeId}/forms/${form.id}`, '_blank')}
                                >
                                  <Eye className="mr-2 h-4 w-4" />
                                  プレビュー
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                          </div>
                          
                {/* 一覧・分析タブ */}
                <div className="border-t pt-6">
                  <Tabs value={reservationView === 'forms' ? 'list' : reservationView} onValueChange={(v) => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set('view', v);
                    router.push(`/${storeId}/admin?tab=reservations&${params.toString()}`);
                  }} className="space-y-6">
                    <div className="flex items-center justify-between">
                      <TabsList>
                        <TabsTrigger value="list">
                          <ClipboardList className="mr-2 h-4 w-4" />
                          一覧
                        </TabsTrigger>
                        <TabsTrigger value="analytics">
                          <Calendar className="mr-2 h-4 w-4" />
                          分析
                        </TabsTrigger>
                      </TabsList>
                      <Select value={reservationFilterStatus} onValueChange={setReservationFilterStatus}>
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">すべて</SelectItem>
                          <SelectItem value="pending">保留中</SelectItem>
                          <SelectItem value="confirmed">確認済み</SelectItem>
                          <SelectItem value="cancelled">キャンセル</SelectItem>
                          <SelectItem value="completed">完了</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <TabsContent value="analytics" className="space-y-6">
                      <ReservationAnalytics storeId={storeId} />
                    </TabsContent>

                    <TabsContent value="list" className="space-y-6">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>顧客名</TableHead>
                              <TableHead>フォーム</TableHead>
                              <TableHead>電話番号</TableHead>
                              <TableHead>予約日時</TableHead>
                              <TableHead>メニュー</TableHead>
                              <TableHead>ステータス</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredReservations.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                  予約がありません
                                </TableCell>
                              </TableRow>
                            ) : (
                              filteredReservations.map((reservation) => (
                                <TableRow 
                                  key={reservation.id}
                                  className="cursor-pointer hover:bg-accent"
                                  onClick={() => {
                                    setSelectedReservation(reservation);
                                    setShowReservationDetail(true);
                                  }}
                                >
                                  <TableCell className="font-medium">{reservation.customer_name}</TableCell>
                                  <TableCell>
                                    <div className="text-sm">
                                      <div className="font-medium">{getFormName(reservation.form_id)}</div>
                                      <div className="text-xs text-muted-foreground font-mono">{reservation.form_id}</div>
                            </div>
                                  </TableCell>
                                  <TableCell>{reservation.customer_phone}</TableCell>
                                  <TableCell>
                                    {new Date(reservation.reservation_date).toLocaleDateString('ja-JP')} {reservation.reservation_time}
                                  </TableCell>
                                  <TableCell>
                                    {(reservation as any).menu_name || (reservation.selected_menus && Array.isArray(reservation.selected_menus) && reservation.selected_menus.length > 0 
                                      ? (reservation.selected_menus as any[]).map((m: any) => m.menu_name || m.name).join(', ')
                                      : 'メニュー不明')}
                                    {(reservation as any).submenu_name && ` - ${(reservation as any).submenu_name}`}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        reservation.status === 'confirmed' ? 'default' :
                                        reservation.status === 'pending' ? 'secondary' :
                                        reservation.status === 'completed' ? 'default' :
                                        'destructive'
                                      }
                                      className={
                                        reservation.status === 'completed' ? 'bg-green-100 text-green-800 hover:bg-green-100' : ''
                                      }
                                    >
                                      {reservation.status === 'pending' ? '保留中' :
                                       reservation.status === 'confirmed' ? '確認済み' :
                                       reservation.status === 'cancelled' ? 'キャンセル' : '完了'}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                        </div>
                    </TabsContent>
                  </Tabs>
                            </div>
              </CardContent>
            </Card>
                          </div>
        );

      case 'surveys':
        return (
          <div className="space-y-6 p-4 lg:p-6">
            <Card>
              <CardHeader>
                <CardTitle>アンケート管理</CardTitle>
                <CardDescription>アンケートフォームの編集・管理を行います</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* フォーム管理セクション */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">フォーム管理</h3>
                  {surveyForms.filter(survey => {
                    if (!formSearchQuery) return true;
                    const query = formSearchQuery.toLowerCase();
                    const surveyTitle = survey.config?.basic_info?.title || '';
                    return surveyTitle.toLowerCase().includes(query);
                  }).length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">まだアンケートが作成されていません</p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-4">
                      {surveyForms.filter(survey => {
                        if (!formSearchQuery) return true;
                        const query = formSearchQuery.toLowerCase();
                        const surveyTitle = survey.config?.basic_info?.title || '';
                        return surveyTitle.toLowerCase().includes(query);
                      }).map((survey) => (
                        <Card key={survey.id} className="flex-1 min-w-[300px] max-w-[500px] hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="space-y-3">
                              {/* アンケート名とステータス、右側にID・日付情報 */}
                              <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-base font-semibold">
                                    {survey.config?.basic_info?.title || 'アンケート'}
                                  </h4>
                                  <Badge className={getFormStatusColor(survey.status)}>
                                    {getFormStatusText(survey.status)}
                                  </Badge>
                                  {survey.draft_status === 'draft' && (
                                    <Badge variant="outline" className="text-orange-600 border-orange-600">
                                      下書きあり
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                  <div>
                                    <span className="font-medium">アンケートID:</span>
                                    <span className="ml-1 font-mono">{survey.id}</span>
                                  </div>
                                  <div>
                                    <span className="font-medium">作成日:</span>
                                    <span className="ml-1">{new Date(survey.created_at).toLocaleDateString('ja-JP')}</span>
                                  </div>
                                  <div>
                                    <span className="font-medium">最終更新:</span>
                                    <span className="ml-1">{new Date(survey.updated_at).toLocaleDateString('ja-JP')}</span>
                                  </div>
                                </div>
                              </div>
                              
                              {/* 公開中URL */}
                              {(survey as any).static_deploy?.deploy_url ? (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">公開中URL</span>
                                    <div className="flex gap-1">
                                      <Button
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => window.open(survey.static_deploy?.deploy_url, '_blank')}
                                      >
                                        <ExternalLink className="h-3 w-3 mr-1" />
                                        開く
                                      </Button>
                                      <Button
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => copyToClipboard(survey.static_deploy?.deploy_url || '')}
                                      >
                                        <Copy className="h-3 w-3 mr-1" />
                                        コピー
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded p-2">
                                  📝 準備中 - 数秒後にページを再読み込みしてください
                                </div>
                              )}
                              
                              {/* 編集・プレビューボタン */}
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-9"
                                  onClick={() => {
                                    setEditingForm(survey);
                                    setShowEditModal(true);
                                  }}
                                >
                                  <Edit className="mr-2 h-4 w-4" />
                                  編集
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-9"
                                  onClick={() => window.open(`/preview/${storeId}/surveys/${survey.id}`, '_blank')}
                                >
                                  <Eye className="mr-2 h-4 w-4" />
                                  プレビュー
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                {/* 回答一覧セクション */}
                <div className="border-t pt-6">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                      <CardTitle>回答一覧</CardTitle>
                      <CardDescription>アンケートの回答を確認します</CardDescription>
                        </div>
                        <Select 
                          value={selectedSurveyFormId || 'all'} 
                          onValueChange={(value) => setSelectedSurveyFormId(value === 'all' ? null : value)}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="すべてのアンケート" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">すべてのアンケート</SelectItem>
                            {surveyForms.map((form) => (
                              <SelectItem key={form.id} value={form.id}>
                                {form.config?.basic_info?.title || 'アンケート'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const filteredResponses = selectedSurveyFormId
                          ? surveyResponses.filter((r: any) => r.survey_form_id === selectedSurveyFormId)
                          : surveyResponses;

                        if (filteredResponses.length === 0) {
                          return (
                      <div className="text-center py-12 text-muted-foreground">
                        <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium mb-2">まだ回答がありません</p>
                        <p className="text-sm">アンケートフォームを公開すると、回答がここに表示されます</p>
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-4">
                            {filteredResponses.map((response: any) => {
                              const surveyForm = surveyForms.find(f => f.id === response.survey_form_id);
                              const responses = typeof response.responses === 'string' 
                                ? JSON.parse(response.responses) 
                                : response.responses;

                              return (
                                <Card key={response.id} className="hover:shadow-md transition-shadow">
                                  <CardHeader>
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <CardTitle className="text-base">
                                          {surveyForm?.config?.basic_info?.title || 'アンケート'}
                                        </CardTitle>
                                        <CardDescription className="mt-1">
                                          送信日時: {new Date(response.submitted_at).toLocaleString('ja-JP')}
                                        </CardDescription>
                                      </div>
                                      <Badge variant="outline">
                                        ID: {response.id.substring(0, 8)}...
                                      </Badge>
                                    </div>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="space-y-3">
                                      {Object.entries(responses).map(([key, value]: [string, any]) => (
                                        <div key={key} className="border-b pb-2 last:border-0">
                                          <div className="font-medium text-sm text-muted-foreground mb-1">
                                            {key}
                                          </div>
                                          <div className="text-sm">
                                            {typeof value === 'string' ? value : JSON.stringify(value)}
                                          </div>
                                        </div>
                                      ))}
                      </div>
                    </CardContent>
                  </Card>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case 'settings':
        return (
          <div className="space-y-6 p-4 lg:p-6">
            <Card>
              <CardHeader>
                <CardTitle>店舗設定</CardTitle>
                <CardDescription>店舗の基本情報を確認・編集します</CardDescription>
              </CardHeader>
              <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                    <h3 className="font-medium mb-2">基本情報</h3>
                    <div className="space-y-2 text-sm">
                <div><span className="font-medium">店舗名:</span> {store?.name}</div>
                <div><span className="font-medium">オーナー:</span> {store?.owner_name}</div>
                <div><span className="font-medium">メール:</span> {store?.owner_email}</div>
                <div><span className="font-medium">電話:</span> {store?.phone || '未設定'}</div>
              </div>
            </div>
            <div>
                    <h3 className="font-medium mb-2">アカウント情報</h3>
                    <div className="space-y-2 text-sm">
                      <div><span className="font-medium">ログイン中:</span> {user?.email}</div>
                      <div><span className="font-medium">店舗ID:</span> {store?.id}</div>
              </div>
            </div>
          </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>ログイン画面のカスタマイズ</CardTitle>
                <CardDescription>ログイン画面に表示するロゴとカラーを設定します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
              <div className="space-y-2">
                  <Label htmlFor="logo_url">ロゴURL</Label>
                  <Input
                    id="logo_url"
                    type="url"
                    placeholder="https://example.com/logo.png"
                    value={store?.logo_url || ''}
                    onChange={async (e) => {
                      if (!store) return;
                      const updatedStore = { ...store, logo_url: e.target.value };
                      try {
                        const response = await fetch(`/api/stores/${storeId}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify(updatedStore),
                        });
                        if (response.ok) {
                          const savedStore = await response.json();
                          setStore(savedStore);
                          toast({
                            title: '保存しました',
                            description: 'ロゴURLを更新しました',
                          });
                        }
                      } catch (error) {
                        console.error('Store update error:', error);
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    ロゴ画像のURLを入力してください。未設定の場合はアイコンが表示されます。
                  </p>
              </div>
                <div className="space-y-2">
                  <Label htmlFor="theme_color">テーマカラー</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="theme_color"
                      type="color"
                      value={store?.theme_color || '#2563eb'}
                      onChange={async (e) => {
                        if (!store) return;
                        const updatedStore = { ...store, theme_color: e.target.value };
                        try {
                          const response = await fetch(`/api/stores/${storeId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify(updatedStore),
                          });
                          if (response.ok) {
                            const savedStore = await response.json();
                            setStore(savedStore);
                            toast({
                              title: '保存しました',
                              description: 'テーマカラーを更新しました',
                            });
                          }
                        } catch (error) {
                          console.error('Store update error:', error);
                        }
                      }}
                      className="w-20 h-10"
                    />
                    <Input
                      type="text"
                      placeholder="#2563eb"
                      value={store?.theme_color || ''}
                      onChange={async (e) => {
                        if (!store) return;
                        const updatedStore = { ...store, theme_color: e.target.value };
                        try {
                          const response = await fetch(`/api/stores/${storeId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify(updatedStore),
                          });
                          if (response.ok) {
                            const savedStore = await response.json();
                            setStore(savedStore);
                            toast({
                              title: '保存しました',
                              description: 'テーマカラーを更新しました',
                            });
                          }
                        } catch (error) {
                          console.error('Store update error:', error);
                        }
                      }}
                      className="flex-1"
                    />
            </div>
                  <p className="text-xs text-muted-foreground">
                    ログイン画面の背景色とアイコン色に使用されます。
                  </p>
          </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>アカウント管理</CardTitle>
                <CardDescription>ログアウトを行います</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={handleSignOut}
                  className="w-full sm:w-auto"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  ログアウト
                </Button>
              </CardContent>
            </Card>
        </div>
        );

      default:
        return null;
    }
  }, [activeTab, stats, filteredForms, filteredReservations, surveyForms, storeId, store, user, formSearchQuery, reservationFilterStatus, reservationView, router, searchParams, copyToClipboard, getFormName, selectedSurveyFormId, surveyResponses, toast]);

  // 認証チェック中
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">読み込み中...</p>
      </div>
      </div>
    );
  }

  // 未認証の場合はログインフォーム
  if (!user) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center p-4"
        style={{
          background: store?.theme_color 
            ? `linear-gradient(to bottom, ${store.theme_color}15, white)`
            : 'linear-gradient(to bottom, #eff6ff, white)'
        }}
      >
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            {store?.logo_url ? (
              <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                <img 
                  src={store.logo_url} 
                  alt={store.name || '店舗ロゴ'} 
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : (
              <div 
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{
                  backgroundColor: store?.theme_color ? `${store.theme_color}20` : '#dbeafe',
                }}
              >
                <SettingsIcon 
                  className="w-8 h-8" 
                  style={{ color: store?.theme_color || '#2563eb' }}
                />
              </div>
            )}
            <CardTitle className="text-2xl">店舗管理ログイン</CardTitle>
            <CardDescription>店舗ID: {storeId}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={loginForm.email}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="your-email@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                />
          </div>

              {loginError && (
                <div className="text-sm text-destructive text-center">{loginError}</div>
              )}

              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? 'ログイン中...' : 'ログイン'}
              </Button>
            </form>

            <div className="mt-6 text-xs text-muted-foreground text-center">
              <p>「店舗運営にとって「Need（必要不可欠）」な予約システム」</p>
        </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ローディング中
  if (loading) {
  return (
      <StoreAdminLayout
        storeId={storeId}
        storeName={store?.name}
        userEmail={user.email}
        onLogout={handleSignOut}
      >
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">読み込み中...</p>
          </div>
        </div>
      </StoreAdminLayout>
    );
  }

  // エラー
  if (error || !store) {
    return (
      <StoreAdminLayout
        storeId={storeId}
        storeName={store?.name}
        userEmail={user.email}
        onLogout={handleSignOut}
      >
        <div className="flex items-center justify-center h-full p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6">
              <div className="text-center text-destructive">
                {error || '店舗が見つかりません'}
            </div>
            </CardContent>
          </Card>
        </div>
      </StoreAdminLayout>
    );
  }

  return (
    <StoreAdminLayout
      storeId={storeId}
      storeName={store.name}
      userEmail={user.email}
      onLogout={handleSignOut}
    >
      {renderTabContent}

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
              body: JSON.stringify(updatedForm),
            });

            if (response.ok) {
              const savedForm = await response.json();
              if (isSurvey) {
                setSurveyForms(surveyForms.map(f => f.id === savedForm.id ? savedForm : f));
              } else {
              setForms(forms.map(f => f.id === savedForm.id ? savedForm : f));
              }
              toast({
                title: '保存しました',
                description: 'フォームの変更を保存しました',
              });
            } else {
              throw new Error('保存に失敗しました');
            }
          }}
          theme="light"
          userRole="store_admin"
        />
      )}

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
                        <Badge
                          variant={
                            selectedReservation.status === 'confirmed' ? 'default' :
                            selectedReservation.status === 'pending' ? 'secondary' :
                            selectedReservation.status === 'completed' ? 'default' :
                            'destructive'
                          }
                          className={
                            selectedReservation.status === 'completed' ? 'bg-green-100 text-green-800 hover:bg-green-100' : ''
                          }
                        >
                          {selectedReservation.status === 'pending' ? '保留中' :
                           selectedReservation.status === 'confirmed' ? '確認済み' :
                           selectedReservation.status === 'cancelled' ? 'キャンセル' : '完了'}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">フォーム</Label>
                      <p className="font-medium">{getFormName(selectedReservation.form_id)}</p>
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

              {/* 顧客情報 */}
              {(() => {
                const info = selectedReservation.customer_info;
                return info && typeof info === 'object' && info !== null && Object.keys(info).length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">その他情報</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {Object.entries(info as Record<string, any>).map(([key, value]) => (
                          <div key={key} className="flex justify-between">
                            <span className="text-sm text-muted-foreground">{key}:</span>
                            <span className="text-sm font-medium">{value != null ? String(value) : ''}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : null;
              })()}

              {/* 作成日時 */}
              <div className="text-xs text-muted-foreground">
                作成日時: {new Date(selectedReservation.created_at).toLocaleString('ja-JP')}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </StoreAdminLayout>
  );
}
