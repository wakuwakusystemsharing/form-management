'use client';

import { useState, useEffect } from 'react';
import { Customer, CustomerSegment } from '@/types/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Eye } from 'lucide-react';

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

  // 顧客データ取得
  useEffect(() => {
    fetchCustomers();
  }, [storeId, searchQuery, segmentFilter]);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (segmentFilter !== 'all') params.append('segment', segmentFilter);
      params.append('limit', '50');

      const response = await fetch(`/api/stores/${storeId}/customers?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
        setTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch customers:', error);
    } finally {
      setLoading(false);
    }
  };

  // セグメントバッジの色
  const getSegmentBadgeVariant = (segment: CustomerSegment) => {
    switch (segment) {
      case 'new':
        return 'default';
      case 'repeat':
        return 'secondary';
      case 'vip':
        return 'destructive';
      case 'dormant':
        return 'outline';
      default:
        return 'default';
    }
  };

  // セグメント判定（簡易版）
  const determineSegment = (customer: Customer): CustomerSegment => {
    const now = new Date();
    const lastVisit = customer.last_visit_date ? new Date(customer.last_visit_date) : null;

    // 休眠顧客
    if (lastVisit) {
      const daysSinceLastVisit = (now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastVisit >= 90) return 'dormant';
    }

    // VIP顧客
    if (customer.total_spent >= 50000 || customer.total_visits >= 10) return 'vip';

    // 新規顧客
    const firstVisit = customer.first_visit_date ? new Date(customer.first_visit_date) : null;
    if (firstVisit) {
      const daysSinceFirstVisit = (now.getTime() - firstVisit.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceFirstVisit <= 30) return 'new';
    }

    // リピーター
    if (customer.total_visits >= 2) return 'repeat';

    return 'new';
  };

  const getSegmentLabel = (segment: CustomerSegment) => {
    switch (segment) {
      case 'new':
        return '新規';
      case 'repeat':
        return 'リピーター';
      case 'vip':
        return 'VIP';
      case 'dormant':
        return '休眠';
      default:
        return '不明';
    }
  };

  // 日付フォーマット
  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>顧客一覧</CardTitle>
        <CardDescription>
          {total}件の顧客が登録されています
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* 検索・フィルター */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="顧客名、電話番号、メールで検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={segmentFilter} onValueChange={setSegmentFilter}>
            <SelectTrigger className="w-[180px]">
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
            <p className="mt-2 text-sm text-muted-foreground">読み込み中...</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">顧客が見つかりませんでした</p>
          </div>
        ) : (
          <div className="rounded-md border">
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
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => {
                  const segment = determineSegment(customer);
                  return (
                    <TableRow key={customer.id}>
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
                      <TableCell className="text-right">{customer.total_visits}回</TableCell>
                      <TableCell className="text-right">
                        ¥{customer.total_spent.toLocaleString()}
                      </TableCell>
                      <TableCell>{formatDate(customer.last_visit_date)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onCustomerClick?.(customer)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
