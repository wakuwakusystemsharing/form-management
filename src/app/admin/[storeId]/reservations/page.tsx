'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReservationAnalytics from '@/components/ReservationAnalytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Calendar, BarChart3 } from 'lucide-react';

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

export default function AdminStoreReservationsPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.storeId as string;

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [store, setStore] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'list' | 'analytics'>('list');

  useEffect(() => {
    fetchStore();
    fetchReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, storeId]);

  const fetchStore = async () => {
    try {
      const response = await fetch(`/api/stores/${storeId}`);
      if (response.ok) {
        const data = await response.json();
        setStore(data);
      }
    } catch (error) {
      console.error('Failed to fetch store:', error);
    }
  };

  const fetchReservations = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (filterStatus !== 'all') {
        params.append('status', filterStatus);
      }

      const response = await fetch(`/api/stores/${storeId}/reservations?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setReservations(data);
      }
    } catch (error) {
      console.error('Failed to fetch reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: 'secondary' as const,
      confirmed: 'default' as const,
      cancelled: 'destructive' as const,
      completed: 'default' as const,
    };

    const labels = {
      pending: '保留中',
      confirmed: '確認済み',
      cancelled: 'キャンセル',
      completed: '完了',
    };

    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>
        {labels[status as keyof typeof labels] || status}
      </Badge>
    );
  };

  const formatDate = (date: string, time: string) => {
    const d = new Date(date);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    return `${dateStr} ${time}`;
  };

  const filteredReservations = filterStatus === 'all' 
    ? reservations 
    : reservations.filter(r => r.status === filterStatus);

  return (
    <div className="min-h-screen bg-background p-4 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* ヘッダー */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(`/admin/${storeId}`)}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    店舗詳細に戻る
                  </Button>
                </div>
                <CardTitle className="text-2xl">予約一覧</CardTitle>
                <CardDescription className="mt-1">
                  {store ? `${store.name} (店舗ID: ${storeId})` : `店舗ID: ${storeId}`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* タブナビゲーション */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'analytics')} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">
              <Calendar className="mr-2 h-4 w-4" />
              予約一覧
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <BarChart3 className="mr-2 h-4 w-4" />
              分析
            </TabsTrigger>
          </TabsList>

          {/* 分析タブ */}
          <TabsContent value="analytics" className="space-y-6">
            <ReservationAnalytics storeId={storeId} />
          </TabsContent>

          {/* 予約一覧タブ */}
          <TabsContent value="list" className="space-y-6">
            {/* フィルター */}
            <Card>
              <CardHeader>
                <CardTitle>フィルター</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="status-filter">ステータス</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger id="status-filter" className="w-full sm:w-[200px]">
                        <SelectValue placeholder="ステータスでフィルター" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全て</SelectItem>
                        <SelectItem value="pending">保留中</SelectItem>
                        <SelectItem value="confirmed">確認済み</SelectItem>
                        <SelectItem value="cancelled">キャンセル</SelectItem>
                        <SelectItem value="completed">完了</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 予約テーブル */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>予約一覧</CardTitle>
                  {!loading && filteredReservations.length > 0 && (
                    <Badge variant="outline">
                      合計 {filteredReservations.length} 件
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-4 text-muted-foreground">読み込み中...</p>
                  </div>
                ) : filteredReservations.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    予約データがありません
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>予約日時</TableHead>
                          <TableHead>顧客名</TableHead>
                          <TableHead>電話番号</TableHead>
                          <TableHead>メールアドレス</TableHead>
                          <TableHead>ステータス</TableHead>
                          <TableHead>作成日時</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredReservations.map((reservation) => (
                          <TableRow key={reservation.id}>
                            <TableCell className="font-medium">
                              {formatDate(reservation.reservation_date, reservation.reservation_time)}
                            </TableCell>
                            <TableCell>{reservation.customer_name}</TableCell>
                            <TableCell>{reservation.customer_phone}</TableCell>
                            <TableCell>{reservation.customer_email || '-'}</TableCell>
                            <TableCell>
                              {getStatusBadge(reservation.status)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {new Date(reservation.created_at).toLocaleString('ja-JP')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

