'use client';

import { useState, useEffect } from 'react';
import { Customer, CustomerVisit } from '@/types/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Calendar, Phone, Mail, User, MapPin, Star } from 'lucide-react';

interface CustomerDetailProps {
  storeId: string;
  customerId: string | null;
  open: boolean;
  onClose: () => void;
}

interface CustomerDetailData {
  customer: Customer;
  reservations: any[];
  visits: CustomerVisit[];
}

export default function CustomerDetail({ storeId, customerId, open, onClose }: CustomerDetailProps) {
  const [data, setData] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (customerId && open) {
      fetchCustomerDetail();
    }
  }, [customerId, open]);

  const fetchCustomerDetail = async () => {
    if (!customerId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/stores/${storeId}/customers/${customerId}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch customer detail:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP');
  };

  const formatDateTime = (dateString: string, timeString: string | null) => {
    const date = new Date(dateString);
    const dateStr = date.toLocaleDateString('ja-JP');
    return timeString ? `${dateStr} ${timeString}` : dateStr;
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'default';
      case 'pending':
        return 'secondary';
      case 'cancelled':
        return 'destructive';
      case 'completed':
        return 'outline';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'confirmed':
        return '確認済み';
      case 'pending':
        return '保留中';
      case 'cancelled':
        return 'キャンセル';
      case 'completed':
        return '完了';
      default:
        return status;
    }
  };

  if (!data || !open) {
    return null;
  }

  const { customer, reservations, visits } = data;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>顧客詳細</DialogTitle>
          <DialogDescription>顧客情報、予約履歴、来店履歴を確認できます</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
            <p className="mt-2 text-sm text-muted-foreground">読み込み中...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 基本情報セクション */}
            <Card>
              <CardHeader>
                <CardTitle>基本情報</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-6">
                  <Avatar className="h-20 w-20">
                    {customer.line_picture_url && (
                      <AvatarImage src={customer.line_picture_url} alt={customer.name} />
                    )}
                    <AvatarFallback className="text-2xl">{customer.name.charAt(0)}</AvatarFallback>
                  </Avatar>

                  <div className="flex-1 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">顧客名</p>
                        <p className="font-medium">{customer.name}</p>
                      </div>
                      {customer.name_kana && (
                        <div>
                          <p className="text-sm text-muted-foreground">フリガナ</p>
                          <p className="font-medium">{customer.name_kana}</p>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {customer.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span>{customer.phone}</span>
                        </div>
                      )}
                      {customer.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <span>{customer.email}</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {customer.birthday && (
                        <div>
                          <p className="text-sm text-muted-foreground">誕生日</p>
                          <p>{formatDate(customer.birthday)}</p>
                        </div>
                      )}
                      {customer.gender && (
                        <div>
                          <p className="text-sm text-muted-foreground">性別</p>
                          <p>{customer.gender === 'male' ? '男性' : customer.gender === 'female' ? '女性' : 'その他'}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 統計情報セクション */}
            <Card>
              <CardHeader>
                <CardTitle>統計情報</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{customer.total_visits}回</p>
                    <p className="text-sm text-muted-foreground">来店回数</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">¥{customer.total_spent.toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">総利用金額</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">{formatDate(customer.first_visit_date)}</p>
                    <p className="text-sm text-muted-foreground">初回来店日</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">{formatDate(customer.last_visit_date)}</p>
                    <p className="text-sm text-muted-foreground">最終来店日</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* タブコンテンツ */}
            <Tabs defaultValue="reservations" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="reservations">予約履歴</TabsTrigger>
                <TabsTrigger value="visits">来店履歴</TabsTrigger>
                <TabsTrigger value="line">LINE情報</TabsTrigger>
              </TabsList>

              {/* 予約履歴タブ */}
              <TabsContent value="reservations">
                <Card>
                  <CardHeader>
                    <CardTitle>予約履歴</CardTitle>
                    <CardDescription>{reservations.length}件の予約があります</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {reservations.length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">予約履歴がありません</p>
                    ) : (
                      <div className="space-y-4">
                        {reservations.slice(0, 10).map((reservation: any) => (
                          <div key={reservation.id} className="border rounded-lg p-4">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <p className="font-medium">
                                  {formatDateTime(reservation.reservation_date, reservation.reservation_time)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {reservation.menu_name}
                                </p>
                              </div>
                              <Badge variant={getStatusBadgeVariant(reservation.status)}>
                                {getStatusLabel(reservation.status)}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 来店履歴タブ */}
              <TabsContent value="visits">
                <Card>
                  <CardHeader>
                    <CardTitle>来店履歴</CardTitle>
                    <CardDescription>{visits.length}件の来店記録があります</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {visits.length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">来店履歴がありません</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>来店日時</TableHead>
                            <TableHead>施術内容</TableHead>
                            <TableHead className="text-right">利用金額</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visits.slice(0, 10).map((visit) => (
                            <TableRow key={visit.id}>
                              <TableCell>{formatDateTime(visit.visit_date, visit.visit_time)}</TableCell>
                              <TableCell>
                                {visit.treatment_menus ?
                                  JSON.stringify(visit.treatment_menus) : '-'}
                              </TableCell>
                              <TableCell className="text-right">
                                {visit.amount ? `¥${visit.amount.toLocaleString()}` : '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* LINE情報タブ */}
              <TabsContent value="line">
                <Card>
                  <CardHeader>
                    <CardTitle>LINE連携情報</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">LINE表示名</p>
                          <p className="font-medium">{customer.line_display_name || '-'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">友だち追加状態</p>
                          <Badge variant={customer.line_friend_flag ? 'default' : 'outline'}>
                            {customer.line_friend_flag ? '友だち' : '未追加'}
                          </Badge>
                        </div>
                      </div>

                      {customer.line_status_message && (
                        <div>
                          <p className="text-sm text-muted-foreground">ステータスメッセージ</p>
                          <p className="font-medium">{customer.line_status_message}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        {customer.line_language && (
                          <div>
                            <p className="text-sm text-muted-foreground">言語設定</p>
                            <p>{customer.line_language}</p>
                          </div>
                        )}
                        {customer.line_os && (
                          <div>
                            <p className="text-sm text-muted-foreground">デバイスOS</p>
                            <p>{customer.line_os}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* メモセクション */}
            {customer.notes && (
              <Card>
                <CardHeader>
                  <CardTitle>メモ</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap">{customer.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
