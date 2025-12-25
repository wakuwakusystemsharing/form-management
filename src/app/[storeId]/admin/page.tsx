'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
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
  Settings as SettingsIcon
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<Form | SurveyForm | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // ログイン関連
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  
  // タブとフィルター
  const activeTab = searchParams.get('tab') || 'dashboard';
  const [formSearchQuery, setFormSearchQuery] = useState('');
  const [reservationFilterStatus, setReservationFilterStatus] = useState<string>('all');
  const [reservationView, setReservationView] = useState<'list' | 'analytics'>('list');

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

  // データ取得
  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      
      try {
        setLoading(true);
        
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'コピーしました',
      description: 'URLをクリップボードにコピーしました',
    });
  };

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
  const stats = {
    total: forms.length,
    active: forms.filter(f => f.status === 'active').length,
    draft: forms.filter(f => f.draft_status === 'draft').length,
    surveys: surveyForms.length,
    reservations: reservations.length,
    recentReservations: reservations.slice(0, 5),
  };

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
                        className="flex items-center justify-between p-3 border rounded-lg"
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
                            'destructive'
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
                                  <p>{new Date(form.created_at).toLocaleDateString('ja-JP')}</p>
                        </div>
                      </div>
                      
                              {/* デプロイURL */}
                      {(form as any).static_deploy?.deploy_url ? (
                                <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
                                  <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-green-800">顧客向け本番URL</span>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date((form as any).static_deploy.deployed_at).toLocaleDateString('ja-JP')}
                                    </span>
                                  </div>
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <Button
                                      size="sm"
                                      className="flex-1 bg-green-600 hover:bg-green-700"
                                      onClick={() => window.open(form.static_deploy?.deploy_url, '_blank')}
                                    >
                                      <ExternalLink className="mr-2 h-4 w-4" />
                                      開く
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => copyToClipboard(form.static_deploy?.deploy_url || '')}
                                    >
                                      <Copy className="mr-2 h-4 w-4" />
                                      コピー
                                    </Button>
                            </div>
                          </div>
                              ) : (
                                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                  <p className="text-sm text-blue-800">
                                    📝 準備中 - 数秒後にページを再読み込みしてください
                                  </p>
                                </div>
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>予約管理</CardTitle>
                    <CardDescription>予約の確認・管理を行います</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                    <Button
                      variant={reservationView === 'list' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setReservationView('list')}
                    >
                      <ClipboardList className="mr-2 h-4 w-4" />
                      一覧
                    </Button>
                    <Button
                      variant={reservationView === 'analytics' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setReservationView('analytics')}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      分析
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {reservationView === 'analytics' ? (
                  <ReservationAnalytics storeId={storeId} />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>顧客名</TableHead>
                          <TableHead>電話番号</TableHead>
                          <TableHead>予約日時</TableHead>
                          <TableHead>メニュー</TableHead>
                          <TableHead>ステータス</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredReservations.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                              予約がありません
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredReservations.map((reservation) => (
                            <TableRow key={reservation.id}>
                              <TableCell className="font-medium">{reservation.customer_name}</TableCell>
                              <TableCell>{reservation.customer_phone}</TableCell>
                              <TableCell>
                                {new Date(reservation.reservation_date).toLocaleDateString('ja-JP')} {reservation.reservation_time}
                              </TableCell>
                              <TableCell>
                                {(reservation as any).menu_name || 'メニュー不明'}
                                {(reservation as any).submenu_name && ` - ${(reservation as any).submenu_name}`}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    reservation.status === 'confirmed' ? 'default' :
                                    reservation.status === 'pending' ? 'secondary' :
                                    'destructive'
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
                )}
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
        </div>
        );

      default:
        return null;
    }
  }, [activeTab, stats, filteredForms, filteredReservations, storeId, store, user, formSearchQuery, reservationFilterStatus, reservationView, setEditingForm, setShowEditModal, copyToClipboard, getFormStatusColor, getFormStatusText]);

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
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <SettingsIcon className="w-8 h-8 text-blue-600" />
            </div>
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
              <p>サービス管理者の方は <a href="/admin" className="text-primary hover:underline">こちら</a></p>
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
    </StoreAdminLayout>
  );
}
