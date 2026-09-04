'use client';

import { fetchWithAuth } from '@/lib/client-auth';

import { useState, useEffect, useCallback } from 'react';
import { Customer, CustomerVisit } from '@/types/form';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Phone, Mail, Pencil, Trash2, MoreHorizontal, ChevronRight, Cake, User } from 'lucide-react';
import CustomerForm, { CustomerFormData, customerToFormData } from '@/components/CustomerForm';
import MobileSheet from '@/components/customers/MobileSheet';
import { ChipTabsList } from '@/components/customers/ChipTabs';
import { StatGrid, StatTile } from '@/components/customers/StatTile';
import { determineSegmentForList, getSegmentBadgeVariant, getSegmentLabel } from '@/components/CustomerList';

import type { LotteryEntryEffectiveStatus, LotteryEntryView } from '@/types/lottery';

const LOTTERY_STATUS_LABELS: Record<LotteryEntryEffectiveStatus, string> = {
  entered: '応募', provisional: '応募', drawn: '当選', lost: 'はずれ', redeemed: '引換済み', cancelled: '取り消し', expired: '期限切れ',
};

interface CustomerDetailProps {
  storeId: string;
  customerId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  onDeleted?: () => void;
  // 予約履歴の予約をタップしたときに予約詳細モーダルを開く（店舗管理者ページから渡される）
  onOpenReservation?: (reservation: any) => void;
  /** 予約履歴・来店履歴・統計情報を表示するか（店舗設定「店舗管理者に表示するメニュー」に連動。既定 true） */
  showReservationHistory?: boolean;
  /** 抽選履歴を表示するか（同上。既定 true） */
  showLotteryHistory?: boolean;
}

interface CustomerDetailData {
  customer: Customer;
  reservations: any[];
  visits: CustomerVisit[];
}

const dateFormatter = new Intl.DateTimeFormat('ja-JP');
const dateShortFormatter = new Intl.DateTimeFormat('ja-JP', { year: '2-digit', month: 'numeric', day: 'numeric' });
const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

function formatDate(dateString: string | null) {
  if (!dateString) return '-';
  return dateFormatter.format(new Date(dateString));
}
function formatDateShort(dateString: string | null) {
  if (!dateString) return '-';
  return dateShortFormatter.format(new Date(dateString));
}
function formatDateTime(dateString: string, timeString: string | null) {
  const dateStr = dateFormatter.format(new Date(dateString));
  return timeString ? `${dateStr} ${timeString}` : dateStr;
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case 'confirmed':
    case 'completed':
      return 'bg-[rgb(209,241,209)] text-[rgb(55,114,58)] border-[rgb(55,114,58)]/20';
    case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'cancelled': return 'bg-red-50 text-red-600 border-red-200';
    default: return '';
  }
}
function getStatusLabel(status: string) {
  switch (status) {
    case 'confirmed': return '確認済み';
    case 'pending': return '保留中';
    case 'cancelled': return 'キャンセル';
    case 'completed': return '完了';
    default: return status;
  }
}
function visitMenus(visit: CustomerVisit): string {
  if (!visit.treatment_menus || !Array.isArray(visit.treatment_menus)) return '-';
  return (visit.treatment_menus as Array<{ name?: string; menu_name?: string }>).map((m) => m.menu_name || m.name || '').filter(Boolean).join(', ') || '-';
}

export default function CustomerDetail({ storeId, customerId, open, onClose, onUpdated, onDeleted, onOpenReservation, showReservationHistory = true, showLotteryHistory = true }: CustomerDetailProps) {
  const [data, setData] = useState<CustomerDetailData | null>(null);
  const [lotteryEntries, setLotteryEntries] = useState<LotteryEntryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [tab, setTab] = useState('reservations');
  const { toast } = useToast();

  const fetchCustomerDetail = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const response = await fetchWithAuth(`/api/stores/${storeId}/customers/${customerId}`);
      if (response.ok) setData(await response.json());
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
      setTab(showReservationHistory ? 'reservations' : showLotteryHistory ? 'lotteries' : 'line');
    }
  }, [customerId, open, fetchCustomerDetail, showReservationHistory, showLotteryHistory]);

  useEffect(() => {
    if (!customerId || !open || !showLotteryHistory) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/stores/${storeId}/lotteries/entries?customer_id=${encodeURIComponent(customerId)}&limit=100`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setLotteryEntries(Array.isArray(json.entries) ? json.entries : []);
      } catch (e) {
        console.error('Failed to fetch lottery entries:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [storeId, customerId, open, showLotteryHistory]);

  const handleUpdate = async (formData: CustomerFormData) => {
    if (!customerId) return;
    setIsSaving(true);
    try {
      const response = await fetchWithAuth(`/api/stores/${storeId}/customers/${customerId}`, {
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
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!customerId) return;
    setIsDeleting(true);
    try {
      const response = await fetchWithAuth(`/api/stores/${storeId}/customers/${customerId}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || '顧客の削除に失敗しました');
      }
      toast({ title: '顧客を削除しました' });
      setShowDeleteConfirm(false);
      onDeleted?.();
      onClose();
    } catch (error) {
      toast({ title: '削除に失敗しました', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!open) return null;

  const customer = data?.customer;
  const reservations = data?.reservations || [];
  const visits = data?.visits || [];
  const segment = customer ? determineSegmentForList(customer) : null;

  const headerRight = !isEditing && !loading && customer ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="操作メニュー" className="h-11 w-11 md:h-9 md:w-9">
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        <DropdownMenuItem className="min-h-11 md:min-h-9" onSelect={() => setIsEditing(true)}>
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />編集
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 md:min-h-9 text-red-600 focus:text-red-700" onSelect={() => setShowDeleteConfirm(true)}>
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const footer = isEditing && customer ? (
    <div className="flex gap-2">
      <Button type="button" variant="outline" className="h-12 md:h-10 flex-1 md:flex-none" onClick={() => setIsEditing(false)} disabled={isSaving}>
        キャンセル
      </Button>
      <Button type="submit" form="customer-edit-form" className="h-12 md:h-10 flex-[2] md:flex-none md:min-w-32 text-base md:text-sm" disabled={isSaving}>
        {isSaving ? '保存中…' : '保存'}
      </Button>
    </div>
  ) : null;

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={isEditing ? '顧客を編集' : '顧客詳細'}
      description={isEditing ? '顧客情報を編集しています' : '顧客情報、予約履歴、来店履歴を確認できます'}
      leftLabel={isEditing ? 'キャンセル' : '戻る'}
      onLeftClick={isEditing ? () => setIsEditing(false) : undefined}
      headerRight={headerRight}
      footer={footer}
    >
      {loading || !customer ? (
        <div className="text-center py-10" data-slot="loading">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-2 text-sm text-muted-foreground">読み込み中…</p>
        </div>
      ) : isEditing ? (
        <div className="p-4 md:p-6">
          <CustomerForm
            formId="customer-edit-form"
            initialData={customerToFormData(customer)}
            onSubmit={handleUpdate}
            onCancel={() => setIsEditing(false)}
            submitLabel="更新"
            isSubmitting={isSaving}
            linePictureUrl={customer.line_picture_url}
            customerName={customer.name}
            hideActions
          />
        </div>
      ) : (
        <div className="divide-y md:divide-y-0 md:space-y-4 md:p-6">
          {/* 基本情報 */}
          <section className="px-4 py-4 md:rounded-lg md:border md:bg-card" aria-label="基本情報">
            <div className="flex items-start gap-3">
              <Avatar className="h-14 w-14 shrink-0 md:h-20 md:w-20">
                {customer.line_picture_url && <AvatarImage src={customer.line_picture_url} alt="" />}
                <AvatarFallback className="text-xl md:text-2xl">{customer.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold truncate">{customer.name}</h3>
                  {segment && <Badge variant={getSegmentBadgeVariant(segment)} className="shrink-0">{getSegmentLabel(segment)}</Badge>}
                </div>
                {customer.name_kana && <p className="text-sm text-muted-foreground truncate">{customer.name_kana}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  {customer.phone && (
                    <a href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 min-h-8 text-primary underline-offset-2 active:underline">
                      <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="tabular-nums">{customer.phone}</span>
                    </a>
                  )}
                  {customer.email && (
                    <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 min-h-8 text-primary underline-offset-2 active:underline min-w-0">
                      <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{customer.email}</span>
                    </a>
                  )}
                  {customer.birthday && (
                    <span className="inline-flex items-center gap-1.5 min-h-8 text-muted-foreground">
                      <Cake className="h-4 w-4 shrink-0" aria-hidden="true" />{formatDate(customer.birthday)}
                    </span>
                  )}
                  {customer.gender && (
                    <span className="inline-flex items-center gap-1.5 min-h-8 text-muted-foreground">
                      <User className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {customer.gender === 'male' ? '男性' : customer.gender === 'female' ? '女性' : 'その他'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 統計（2×2）: 予約管理が非表示の店舗では出さない */}
          {showReservationHistory && (
          <section className="px-4 py-3 md:px-0 md:py-0" aria-label="統計情報">
            <StatGrid cols={4}>
              <StatTile label="来店回数" value={`${customer.total_visits}回`} />
              <StatTile label="総利用金額" value={currencyFormatter.format(customer.total_spent)} />
              <StatTile label="初回来店日" value={formatDateShort(customer.first_visit_date)} size="md" />
              <StatTile label="最終来店日" value={formatDateShort(customer.last_visit_date)} size="md" />
            </StatGrid>
          </section>
          )}

          {/* 履歴タブ */}
          <section className="py-3 md:py-0" aria-label="履歴">
            <Tabs value={tab} onValueChange={setTab} className="w-full">
              <div className="px-4 md:px-0">
                <ChipTabsList
                  desktopGrid
                  items={[
                    ...(showReservationHistory ? [
                      { value: 'reservations', label: '予約', count: reservations.length },
                      { value: 'visits', label: '来店', count: visits.length },
                    ] : []),
                    ...(showLotteryHistory ? [{ value: 'lotteries', label: '抽選', count: lotteryEntries.length }] : []),
                    { value: 'line', label: 'LINE' },
                  ]}
                />
              </div>

              {showReservationHistory && (
              <TabsContent value="reservations" className="px-4 md:px-0 mt-3">
                {reservations.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-6">予約履歴がありません</p>
                ) : (
                  <ul className="space-y-2">
                    {reservations.slice(0, 10).map((reservation: any) => (
                      <li key={reservation.id}>
                        <div
                          role={onOpenReservation ? 'button' : undefined}
                          tabIndex={onOpenReservation ? 0 : undefined}
                          onClick={() => onOpenReservation?.(reservation)}
                          onKeyDown={(e) => { if (onOpenReservation && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpenReservation(reservation); } }}
                          data-slot="list-item"
                          className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 min-h-[3.5rem] ${onOpenReservation ? 'cursor-pointer active:bg-muted/60 transition-colors' : ''}`}
                          title={onOpenReservation ? '予約詳細を開く' : undefined}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium tabular-nums">{formatDateTime(reservation.reservation_date, reservation.reservation_time)}</p>
                            <p className="text-sm text-muted-foreground truncate">{reservation.menu_name}</p>
                          </div>
                          <Badge variant="outline" className={`shrink-0 ${getStatusBadgeClass(reservation.status)}`}>{getStatusLabel(reservation.status)}</Badge>
                          {onOpenReservation && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              )}

              {showReservationHistory && (
              <TabsContent value="visits" className="px-4 md:px-0 mt-3">
                {visits.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-6">来店履歴がありません</p>
                ) : (
                  <>
                    {/* スマホ: カード */}
                    <ul className="space-y-2 md:hidden">
                      {visits.slice(0, 10).map((visit) => (
                        <li key={visit.id} data-slot="list-item" className="rounded-lg border bg-card px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium tabular-nums">{formatDateTime(visit.visit_date, visit.visit_time)}</p>
                            <p className="font-semibold tabular-nums shrink-0">{visit.amount ? currencyFormatter.format(Number(visit.amount)) : '-'}</p>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">{visitMenus(visit)}</p>
                        </li>
                      ))}
                    </ul>
                    {/* PC: テーブル */}
                    <div className="hidden md:block rounded-md border">
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
                              <TableCell>{visitMenus(visit)}</TableCell>
                              <TableCell className="text-right tabular-nums">{visit.amount ? currencyFormatter.format(Number(visit.amount)) : '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </TabsContent>
              )}

              {showLotteryHistory && (
              <TabsContent value="lotteries" className="px-4 md:px-0 mt-3">
                {lotteryEntries.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-6">抽選履歴がありません</p>
                ) : (
                  <ul className="space-y-2">
                    {lotteryEntries.map((e) => (
                      <li key={e.id} data-slot="list-item" className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {e.prize_name || (e.status === 'entered' || e.status === 'provisional' ? '応募中' : 'はずれ')}
                            {e.is_consolation && <span className="ml-1 text-xs text-muted-foreground">残念賞</span>}
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {new Date(e.entered_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {e.redeem_code ? ` ・ ${e.redeem_code}` : ''}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">{LOTTERY_STATUS_LABELS[e.effective_status]}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              )}

              <TabsContent value="line" className="px-4 md:px-0 mt-3">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">LINE 表示名</dt>
                    <dd className="font-medium truncate">{customer.line_display_name || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">友だち追加</dt>
                    <dd>
                      <Badge variant="outline" className={customer.line_friend_flag ? 'bg-[rgb(209,241,209)] text-[rgb(55,114,58)] border-[rgb(55,114,58)]/20' : ''}>
                        {customer.line_friend_flag ? '友だち' : '未追加'}
                      </Badge>
                    </dd>
                  </div>
                  {customer.line_status_message && (
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">ステータスメッセージ</dt>
                      <dd className="font-medium break-words">{customer.line_status_message}</dd>
                    </div>
                  )}
                  {customer.line_language && (
                    <div>
                      <dt className="text-xs text-muted-foreground">言語</dt>
                      <dd>{customer.line_language}</dd>
                    </div>
                  )}
                  {customer.line_os && (
                    <div>
                      <dt className="text-xs text-muted-foreground">端末 OS</dt>
                      <dd>{customer.line_os}</dd>
                    </div>
                  )}
                  {!customer.line_user_id && (
                    <p className="col-span-2 text-xs text-muted-foreground">LINE 未連携の顧客です（電話番号などで手動登録）</p>
                  )}
                </dl>
              </TabsContent>
            </Tabs>
          </section>

          {/* メモ */}
          {customer.notes && (
            <section className="px-4 py-4 md:rounded-lg md:border md:bg-card" aria-label="メモ">
              <h4 className="text-xs text-muted-foreground mb-1">メモ</h4>
              <p className="whitespace-pre-wrap text-sm">{customer.notes}</p>
            </section>
          )}
          {/* 下端の余白（最後の項目が画面端に貼り付かないように） */}
          <div className="h-4 md:hidden" aria-hidden="true" />
        </div>
      )}

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>顧客を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {customer ? `「${customer.name}」さんのデータを削除します。` : ''}
              この操作は取り消せません。来店履歴も併せて削除されます。過去の予約レコードは残りますが、顧客とのひも付けは外れます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={isDeleting} className="h-12 sm:h-10 mt-0">キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={isDeleting}
              className="h-12 sm:h-10 bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting ? '削除中…' : '削除する'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileSheet>
  );
}
