'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Customer, CustomerSegment } from '@/types/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchBar } from '@/components/ui/search-bar';
import { useToast } from '@/components/ui/use-toast';
import { useDebounce } from '@/hooks/use-debounce';
import { fetchWithAuth } from '@/lib/client-auth';
import { UserPlus, ChevronRight, Plus, Tag, X } from 'lucide-react';
import { summarizeTags } from '@/lib/customer-chart';
import CustomerForm, { CustomerFormData } from '@/components/CustomerForm';
import MobileSheet from '@/components/customers/MobileSheet';
import { ChipFilter } from '@/components/customers/ChipTabs';
import { ListSkeleton } from '@/components/customers/ListSkeleton';

interface CustomerListProps {
  storeId: string;
  onCustomerClick?: (customer: Customer) => void;
  /** 件数が分かったときに親へ通知（スマホのヘッダー行に表示するため） */
  onTotalChange?: (total: number) => void;
  /** タグで絞り込み（親が制御する場合。顧客詳細のタグをタップしたときに親から渡す） */
  tagFilter?: string | null;
  onTagFilterChange?: (tag: string | null) => void;
}

const PAGE_SIZE = 50;

const SEGMENT_ITEMS: Array<{ value: 'all' | CustomerSegment; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'new', label: '新規' },
  { value: 'repeat', label: 'リピーター' },
  { value: 'vip', label: 'VIP' },
  { value: 'dormant', label: '休眠' },
];

// セグメント判定（簡易版。API 側の determineCustomerSegment と同じ基準）
export function determineSegmentForList(customer: Customer): CustomerSegment {
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
}

export function getSegmentBadgeVariant(segment: CustomerSegment): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (segment) {
    case 'new': return 'default';
    case 'repeat': return 'secondary';
    case 'vip': return 'destructive';
    case 'dormant': return 'outline';
    default: return 'default';
  }
}

export function getSegmentLabel(segment: CustomerSegment): string {
  switch (segment) {
    case 'new': return '新規';
    case 'repeat': return 'リピーター';
    case 'vip': return 'VIP';
    case 'dormant': return '休眠';
    default: return '不明';
  }
}

const dateFmt = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' });
const dateFullFmt = new Intl.DateTimeFormat('ja-JP');
const yenFmt = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

export default function CustomerList({ storeId, onCustomerClick, onTotalChange, tagFilter: tagFilterProp, onTagFilterChange }: CustomerListProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery.trim(), 300);
  const [segmentFilter, setSegmentFilter] = useState<'all' | CustomerSegment>('all');
  const [internalTagFilter, setInternalTagFilter] = useState<string | null>(null);
  // 店舗のタグ一覧（絞り込みのプルダウン用）
  const [storeTags, setStoreTags] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/stores/${storeId}/customers/tags`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setStoreTags(Array.isArray(json.tags) ? json.tags.map((t: { tag: string }) => t.tag) : []);
      } catch (e) {
        console.error('Failed to fetch store tags:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [storeId]);
  const tagFilter = tagFilterProp !== undefined ? tagFilterProp : internalTagFilter;
  const setTagFilter = (tag: string | null) => {
    setInternalTagFilter(tag);
    onTagFilterChange?.(tag);
  };
  const [total, setTotal] = useState(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();
  const requestSeq = useRef(0);

  const fetchPage = useCallback(async (offset: number): Promise<{ customers: Customer[]; total: number } | null> => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.append('search', debouncedSearch);
    if (segmentFilter !== 'all') params.append('segment', segmentFilter);
    if (tagFilter) params.append('tag', tagFilter);
    params.append('limit', String(PAGE_SIZE));
    if (offset > 0) params.append('offset', String(offset));
    const response = await fetchWithAuth(`/api/stores/${storeId}/customers?${params.toString()}`);
    if (response.ok) {
      const data = await response.json();
      return { customers: data.customers || [], total: data.total || 0 };
    }
    if (response.status === 401) {
      console.warn('Failed to fetch customers: authentication required');
      return null;
    }
    const data = await response.json().catch(() => ({}));
    toast({ title: '顧客一覧の取得に失敗しました', description: data.error || `エラーコード: ${response.status}`, variant: 'destructive' });
    return null;
  }, [storeId, debouncedSearch, segmentFilter, tagFilter, toast]);

  const fetchCustomers = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const page = await fetchPage(0);
      if (seq !== requestSeq.current) return; // 古いレスポンスは捨てる
      if (page) {
        setCustomers(page.customers);
        setTotal(page.total);
        onTotalChange?.(page.total);
      }
    } catch (error) {
      console.error('Failed to fetch customers:', error);
      toast({ title: '顧客一覧の取得に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [fetchPage, onTotalChange, toast]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await fetchPage(customers.length);
      if (page) {
        setCustomers((prev) => [...prev, ...page.customers]);
        setTotal(page.total);
      }
    } catch (error) {
      console.error('Failed to load more customers:', error);
    } finally {
      setLoadingMore(false);
    }
  };

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
    } finally {
      setIsCreating(false);
    }
  };

  const hasMore = customers.length < total;
  const isFiltered = !!debouncedSearch || segmentFilter !== 'all' || !!tagFilter;

  const renderTags = (customer: Customer, className = '') => {
    const { shown, rest } = summarizeTags(customer.tags, 2);
    if (shown.length === 0) return null;
    return (
      <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} aria-label="タグ">
        {shown.map((t) => (
          <span key={t} className="inline-flex items-center rounded-full border bg-muted/40 px-1.5 text-[11px] leading-5 text-muted-foreground max-w-[9rem] truncate">{t}</span>
        ))}
        {rest > 0 && <span className="text-[11px] leading-5 text-muted-foreground">+{rest}</span>}
      </span>
    );
  };

  const listBody = (
    <>
      {loading ? (
        <ListSkeleton rows={5} />
      ) : customers.length === 0 ? (
        <div className="text-center py-10 px-4">
          <p className="text-muted-foreground">{isFiltered ? '条件に合う顧客が見つかりませんでした' : 'まだ顧客が登録されていません'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isFiltered ? '検索語や絞り込みを変えてみてください' : 'LINE 予約が入ると自動で登録されます。手動で追加することもできます'}
          </p>
          {isFiltered ? (
            <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearchQuery(''); setSegmentFilter('all'); setTagFilter(null); }}>
              絞り込みを解除
            </Button>
          ) : (
            <Button size="sm" className="mt-4" onClick={() => setShowCreateDialog(true)}>
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              顧客を追加
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* スマホ: カード一覧（テーブルは横幅に収まらないため） */}
          <ul className="space-y-2 md:hidden" aria-label="顧客一覧">
            {customers.map((customer) => {
              const segment = determineSegmentForList(customer);
              return (
                <li key={customer.id}>
                  <button
                    type="button"
                    data-slot="list-item"
                    onClick={() => onCustomerClick?.(customer)}
                    className="w-full min-h-[4.25rem] text-left border rounded-lg bg-card px-3 py-2.5 flex items-center gap-3 active:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Avatar className="h-11 w-11 shrink-0">
                      {customer.line_picture_url && <AvatarImage src={customer.line_picture_url} alt="" />}
                      <AvatarFallback>{customer.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-medium truncate flex-1">{customer.name}</p>
                        <Badge variant={getSegmentBadgeVariant(segment)} className="shrink-0 text-[11px] px-1.5 py-0">
                          {getSegmentLabel(segment)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{customer.phone || '電話番号なし'}</p>
                      {renderTags(customer, 'mt-0.5')}
                      <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums truncate">
                        来店 <span className="text-foreground">{customer.total_visits}回</span>
                        <span className="mx-1.5 opacity-50">・</span>
                        <span className="text-foreground">{yenFmt.format(customer.total_spent)}</span>
                        <span className="mx-1.5 opacity-50">・</span>
                        最終 <span className="text-foreground">{customer.last_visit_date ? dateFmt.format(new Date(customer.last_visit_date)) : '-'}</span>
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>

          {/* PC: テーブル */}
          <div className="rounded-md border hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>顧客名</TableHead>
                  <TableHead>電話番号</TableHead>
                  <TableHead>タグ</TableHead>
                  <TableHead>セグメント</TableHead>
                  <TableHead className="text-right">来店回数</TableHead>
                  <TableHead className="text-right">総利用金額</TableHead>
                  <TableHead>最終来店日</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => {
                  const segment = determineSegmentForList(customer);
                  return (
                    <TableRow key={customer.id} className="cursor-pointer hover:bg-[rgb(244,144,49)]/10" onClick={() => onCustomerClick?.(customer)}>
                      <TableCell>
                        <Avatar className="h-8 w-8">
                          {customer.line_picture_url && <AvatarImage src={customer.line_picture_url} alt="" />}
                          <AvatarFallback>{customer.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell>{customer.phone || '-'}</TableCell>
                      <TableCell>{renderTags(customer) ?? <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell><Badge variant={getSegmentBadgeVariant(segment)}>{getSegmentLabel(segment)}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{customer.total_visits}回</TableCell>
                      <TableCell className="text-right tabular-nums">{yenFmt.format(customer.total_spent)}</TableCell>
                      <TableCell>{customer.last_visit_date ? dateFullFmt.format(new Date(customer.last_visit_date)) : '-'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {hasMore && (
            <div className="pt-3 text-center">
              <Button variant="outline" className="w-full md:w-auto h-11 md:h-9" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '読み込み中…' : `さらに読み込む（残り ${total - customers.length} 件）`}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );

  const filters = (
    <div className="space-y-2 md:flex md:items-center md:gap-4 md:space-y-0">
      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="顧客名、電話番号、メール、タグで検索"
        ariaLabel="顧客を検索"
        className="md:flex-1 [&_input]:h-12 md:[&_input]:h-10"
      />
      {tagFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 pl-2.5 pr-1 py-0.5 text-xs">
            <Tag className="h-3 w-3" aria-hidden="true" />
            <span className="max-w-[12rem] truncate">{tagFilter}</span>
            <button type="button" onClick={() => setTagFilter(null)} aria-label="タグの絞り込みを解除" className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted active:bg-muted">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
          <span className="text-xs text-muted-foreground">のタグで絞り込み中</span>
        </div>
      )}
      {/* スマホ: チップ列 / PC: セレクト */}
      <ChipFilter items={SEGMENT_ITEMS} value={segmentFilter} onChange={setSegmentFilter} ariaLabel="セグメントで絞り込み" className="md:hidden -mx-4 px-4" />
      <Select value={segmentFilter} onValueChange={(v) => setSegmentFilter(v as 'all' | CustomerSegment)}>
        <SelectTrigger className="hidden md:flex w-[180px]" aria-label="セグメントで絞り込み">
          <SelectValue placeholder="セグメント" />
        </SelectTrigger>
        <SelectContent>
          {SEGMENT_ITEMS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {/* タグで絞り込み（店舗にタグが 1 つでもあるとき。スマホは検索欄の下、PC はセグメントの右） */}
      {(storeTags.length > 0 || tagFilter) && (
        <Select value={tagFilter || '__all__'} onValueChange={(v) => setTagFilter(v === '__all__' ? null : v)}>
          <SelectTrigger className="w-full md:w-[200px] h-11 md:h-10" aria-label="タグで絞り込み">
            <SelectValue placeholder="タグで絞り込み" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">タグ: すべて</SelectItem>
            {[...new Set([...(tagFilter ? [tagFilter] : []), ...storeTags])].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );

  return (
    <>
      {/* スマホ: Card なし・画面幅いっぱい */}
      <div className="md:hidden space-y-3">
        {filters}
        {listBody}
        {/* 固定「追加」ボタン（下部ナビ 56px + safe area の上） */}
        <div className="fixed right-4 z-20 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)]">
          <Button
            type="button"
            data-slot="fab"
            className="h-12 rounded-full px-5 shadow-lg text-base"
            onClick={() => setShowCreateDialog(true)}
            aria-label="顧客を追加"
          >
            <Plus className="h-5 w-5 mr-1" aria-hidden="true" />
            追加
          </Button>
        </div>
        {/* 固定ボタンに最後のカードが隠れないよう余白 */}
        <div className="h-16" aria-hidden="true" />
      </div>

      {/* PC: 従来の Card */}
      <Card className="hidden md:block">
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
          <div className="mb-6">{filters}</div>
          {listBody}
        </CardContent>
      </Card>

      {/* 顧客作成（スマホは全画面シート） */}
      <MobileSheet
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        title="新規顧客を追加"
        description="顧客情報を入力してください"
        leftLabel="キャンセル"
        desktopClassName="md:max-w-2xl"
        footer={
          <Button type="submit" form="customer-form" className="w-full h-12 md:h-10 text-base md:text-sm" disabled={isCreating}>
            {isCreating ? '保存中…' : '追加'}
          </Button>
        }
      >
        <div className="p-4 md:p-6">
          <CustomerForm
            formId="customer-form"
            onSubmit={handleCreateCustomer}
            onCancel={() => setShowCreateDialog(false)}
            submitLabel="追加"
            isSubmitting={isCreating}
            storeId={storeId}
            hideActions
          />
        </div>
      </MobileSheet>
    </>
  );
}
