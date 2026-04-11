'use client';

import { useState, useEffect, useCallback } from 'react';
import { Customer, CustomerVisit } from '@/types/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { Phone, Mail, Pencil, X } from 'lucide-react';
import CustomerForm, { CustomerFormData, customerToFormData } from '@/components/CustomerForm';

interface CustomerDetailProps {
  storeId: string;
  customerId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

interface CustomerDetailData {
  customer: Customer;
  reservations: any[];
  visits: CustomerVisit[];
}

export default function CustomerDetail({ storeId, customerId, open, onClose, onUpdated }: CustomerDetailProps) {
  const [data, setData] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const fetchCustomerDetail = useCallback(async () => {
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
  }, [storeId, customerId]);

  useEffect(() => {
    if (customerId && open) {
      fetchCustomerDetail();
      setIsEditing(false);
    }
  }, [customerId, open, fetchCustomerDetail]);

  const handleUpdate = async (formData: CustomerFormData) => {
    if (!customerId) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/stores/${storeId}/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || '更新に失敗しました');
      }

      toast({ title: '顧客情報を更新しました' });
      setIsEditing(false);
      fetchCustomerDetail();
      onUpdated?.();
    } catch (error) {
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const dateFormatter = new Intl.DateTimeFormat('ja-JP');
  const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return dateFormatter.format(new Date(dateString));
  };

  const formatDateTime = (dateString: string, timeString: string | null) => {
    const dateStr = dateFormatter.format(new Date(dateString));
    return timeString ? `${dateStr} ${timeString}` : dateStr;
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-[rgb(209,241,209)] text-[rgb(55,114,58)] border-[rgb(55,114,58)]/20';
      case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'cancelled': return 'bg-red-50 text-red-600 border-red-200';
      case 'completed': return 'bg-[rgb(209,241,209)] text-[rgb(55,114,58)] border-[rgb(55,114,58)]/20';
      default: return '';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'confirmed': return '確認済み';
      case 'pending': return '保留中';
      case 'cancelled': return 'キャンセル';
      case 'completed': return '完了';
      default: return status;
    }
  };

  if (!data || !open) {
    return null;
  }

  const { customer, reservations, visits } = data;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="store-admin-bg max-w-4xl max-h-[90vh] overflow-y-auto overscroll-contain bg-gray-50">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>顧客詳細</DialogTitle>
              <DialogDescription>
                {isEditing ? '顧客情報を編集しています' : '顧客情報、予約履歴、来店履歴を確認できます'}
              </DialogDescription>
            </div>
            <div className="mr-8">
              {!isEditing && !loading && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                  編集
                </Button>
              )}
              {isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(false)}
                >
                  <X className="mr-2 h-4 w-4" aria-hidden="true" />
                  編集を閉じる
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
            <p className="mt-2 text-sm text-muted-foreground">読み込み中…</p>
          </div>
        ) : isEditing ? (
          /* 編集モード */
          <CustomerForm
            initialData={customerToFormData(customer)}
            onSubmit={handleUpdate}
            onCancel={() => setIsEditing(false)}
            submitLabel="更新"
            isSubmitting={isSaving}
            linePictureUrl={customer.line_picture_url}
            customerName={customer.name}
          />
        ) : (
          /* 表示モード */
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
                          <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <span>{customer.phone}</span>
                        </div>
                      )}
                      {customer.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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
                    <p className="text-2xl font-bold tabular-nums">{customer.total_visits}回</p>
                    <p className="text-sm text-muted-foreground">来店回数</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">{currencyFormatter.format(customer.total_spent)}</p>
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
                              <Badge variant="outline" className={getStatusBadgeClass(reservation.status)}>
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
                                {visit.treatment_menus
                                  ? (Array.isArray(visit.treatment_menus)
                                    ? (visit.treatment_menus as Array<{ name?: string; menu_name?: string }>).map((m) => m.menu_name || m.name || '').filter(Boolean).join(', ') || '-'
                                    : '-')
                                  : '-'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {visit.amount ? currencyFormatter.format(Number(visit.amount)) : '-'}
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
                          <Badge variant="outline" className={customer.line_friend_flag ? 'bg-[rgb(209,241,209)] text-[rgb(55,114,58)] border-[rgb(55,114,58)]/20' : ''}>
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
