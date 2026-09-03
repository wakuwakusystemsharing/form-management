'use client';

import { useState, useEffect, useCallback } from 'react';
import { Customer, CustomerSegment } from '@/types/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';
import { Search, UserPlus } from 'lucide-react';
import CustomerForm, { CustomerFormData } from '@/components/CustomerForm';

interface CustomerListProps {
  storeId: string;
  onCustomerClick?: (customer: Customer) => void;
}

export default function CustomerList({ storeId, onCustomerClick }: CustomerListProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [segmentFilter, setSegmentFilter] = useState<string>('all');
  const [total, setTotal] = useState(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (segmentFilter !== 'all') params.append('segment', segmentFilter);
      params.append('limit', '50');

      const response = await fetchWithAuth(`/api/stores/${storeId}/customers?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
        setTotal(data.total || 0);
      } else if (response.status === 401) {
        // 再ログイン誘導のトーストはページ側（AUTH_REQUIRED_EVENT）で表示する
        console.warn('Failed to fetch customers: authentication required');
      } else {
        const data = await response.json().catch(() => ({}));
        console.error('Failed to fetch customers:', response.status, data);
        toast({
          title: '顧客一覧の取得に失敗しました',
          description: data.error || `エラーコード: ${response.status}`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to fetch customers:', error);
      toast({ title: '顧客一覧の取得に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, searchQuery, segmentFilter, toast]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleCreateCustomer = async (formData: CustomerFormData) => {
    setIsCreating(true);
    try {
      const response = await fetchWithAuth(`/api/stores/${storeId}/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || '顧客の作成に失敗しました');
      }

      toast({ title: '顧客を作成しました' });
      setShowCreateDialog(false);
      fetchCustomers();
    } catch (error) {
      throw error;
    } finally {
      setIsCreating(false);
    }
  };

  // セグメントバッジの色
  const getSegmentBadgeVariant = (segment: CustomerSegment) => {
    switch (segment) {
      case 'new': return 'default';
      case 'repeat': return 'secondary';
      case 'vip': return 'destructive';
      case 'dormant': return 'outline';
      default: return 'default';
    }
  };

  // セグメント判定（簡易版）
  const determineSegment = (customer: Customer): CustomerSegment => {
    const now = new Date();
    const lastVisit = customer.last_visit_date ? new Date(customer.last_visit_date) : null;

    if (lastVisit) {
      const daysSinceLastVisit = (now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastVisit >= 90) return 'dormant';
    }

    if (customer.total_spent >= 50000 || customer.total_visits >= 10) return 'vip';

    const firstVisit = customer.first_visit_date ? new Date(customer.first_visit_date) : null;
    if (firstVisit) {
      const daysSinceFirstVisit = (now.getTime() - firstVisit.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceFirstVisit <= 30) return 'new';
    }

    if (customer.total_visits >= 2) return 'repeat';

    return 'new';
  };

  const getSegmentLabel = (segment: CustomerSegment) => {
    switch (segment) {
      case 'new': return '新規';
      case 'repeat': return 'リピーター';
      case 'vip': return 'VIP';
      case 'dormant': return '休眠';
      default: return '不明';
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Intl.DateTimeFormat('ja-JP').format(new Date(dateString));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>顧客一覧</CardTitle>
              <CardDescription>{total}件の顧客が登録されています</CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} size="sm">
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              顧客を追加
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* 検索・フィルター */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-6">
            <div className="flex-1 min-w-0 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="顧客名、電話番号、メールで検索…"
                aria-label="顧客を検索"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={segmentFilter} onValueChange={setSegmentFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" aria-label="セグメントで絞り込み">
                <SelectValue placeholder="セグメント" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                <SelectItem value="new">新規</SelectItem>
                <SelectItem value="repeat">リピーター</SelectItem>
                <SelectItem value="vip">VIP</SelectItem>
                <SelectItem value="dormant">休眠</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 顧客テーブル */}
          {loading ? (
            <div className="text-center py-8">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
              <p className="mt-2 text-sm text-muted-foreground">読み込み中…</p>
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">顧客が見つかりませんでした</p>
            </div>
          ) : (
            <>
            {/* スマホ: カード一覧（テーブルは横幅に収まらないため） */}
            <div className="space-y-2 md:hidden">
              {customers.map((customer) => {
                const segment = determineSegment(customer);
                return (
                  <button
                    type="button"
                    key={customer.id}
                    data-slot="list-item"
                    onClick={() => onCustomerClick?.(customer)}
                    className="w-full text-left border rounded-lg p-3 hover:bg-[rgb(244,144,49)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        {customer.line_picture_url && (
                          <AvatarImage src={customer.line_picture_url} alt={customer.name} />
                        )}
                        <AvatarFallback>{customer.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium truncate">{customer.name}</p>
                          <Badge variant={getSegmentBadgeVariant(segment)} className="shrink-0">
                            {getSegmentLabel(segment)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{customer.phone || '電話番号なし'}</p>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <div><span className="block text-[11px]">来店回数</span><span className="text-foreground tabular-nums">{customer.total_visits}回</span></div>
                      <div><span className="block text-[11px]">総利用金額</span><span className="text-foreground tabular-nums">{formatCurrency(customer.total_spent)}</span></div>
                      <div><span className="block text-[11px]">最終来店日</span><span className="text-foreground">{formatDate(customer.last_visit_date)}</span></div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* PC: テーブル */}
            <div className="rounded-md border hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>顧客名</TableHead>
                    <TableHead>電話番号</TableHead>
                    <TableHead>セグメント</TableHead>
                    <TableHead className="text-right">来店回数</TableHead>
                    <TableHead className="text-right">総利用金額</TableHead>
                    <TableHead>最終来店日</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => {
                    const segment = determineSegment(customer);
                    return (
                      <TableRow
                        key={customer.id}
                        className="cursor-pointer hover:bg-[rgb(244,144,49)]/10"
                        onClick={() => onCustomerClick?.(customer)}
                      >
                        <TableCell>
                          <Avatar className="h-8 w-8">
                            {customer.line_picture_url && (
                              <AvatarImage src={customer.line_picture_url} alt={customer.name} />
                            )}
                            <AvatarFallback>{customer.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell className="font-medium">{customer.name}</TableCell>
                        <TableCell>{customer.phone || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={getSegmentBadgeVariant(segment)}>
                            {getSegmentLabel(segment)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{customer.total_visits}回</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(customer.total_spent)}
                        </TableCell>
                        <TableCell>{formatDate(customer.last_visit_date)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 顧客作成ダイアログ */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>新規顧客を追加</DialogTitle>
            <DialogDescription>顧客情報を入力してください</DialogDescription>
          </DialogHeader>
          <CustomerForm
            onSubmit={handleCreateCustomer}
            onCancel={() => setShowCreateDialog(false)}
            submitLabel="追加"
            isSubmitting={isCreating}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
