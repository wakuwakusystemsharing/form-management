'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import ReservationAnalytics from '@/components/ReservationAnalytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Calendar, BarChart3, Download } from 'lucide-react';

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
  source_medium?: string;
  created_at: string;
}

const SOURCE_MEDIUM_LABELS: Record<string, string> = {
  line: 'LINE',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x_twitter: 'X（旧Twitter）',
  google_maps: 'Googleマップ',
  google_search: 'Google検索',
  yahoo_search: 'Yahoo!検索',
  direct: '直接アクセス',
};

// 「顧客名の非表示」で除外するテスト用顧客名（完全一致。空白・括弧は正規化して比較）
const HIDDEN_CUSTOMER_NAMES = [
  'テスト',
  '合同会社わくわく動作確認2号',
  'M',
  'テスト花子',
  '石山 隆平 (のこのこ)',
  '中江つばさ',
  '動作確認用02',
  '羽楽',
];

// 全角スペース・全角括弧を半角に揃え、連続空白を1つにして比較する
function normalizeCustomerName(name: string): string {
  return (name || '')
    .replace(/　/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}
const HIDDEN_CUSTOMER_SET = new Set(HIDDEN_CUSTOMER_NAMES.map(normalizeCustomerName));

// CSV用: カンマ・引用符・改行を含むフィールドをエスケープ
function csvField(value: string | number): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AllReservationsPage() {
  const router = useRouter();
  const params = useParams();
  const tenantSlug = params.tenantSlug as string;
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterStoreId, setFilterStoreId] = useState<string>('all');
  const [hideTestCustomers, setHideTestCustomers] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'list' | 'analytics'>('list');

  useEffect(() => {
    fetchStores();
    fetchReservations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterStoreId]);

  const fetchStores = async () => {
    try {
      const response = await fetch('/api/stores');
      if (response.ok) {
        const data = await response.json();
        setStores(data.stores || []);
      }
    } catch (error) {
      console.error('Failed to fetch stores:', error);
    }
  };

  const fetchReservations = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (filterStatus !== 'all') {
        params.append('status', filterStatus);
      }
      if (filterStoreId !== 'all') {
        params.append('store_id', filterStoreId);
      }

      const response = await fetch(`/api/reservations?${params.toString()}`);
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
    const map: Record<string, { label: string; className: string }> = {
      confirmed: { label: '確認済み', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
      pending:   { label: '保留中',   className: 'bg-amber-50 text-amber-700 border border-amber-200' },
      cancelled: { label: 'キャンセル', className: 'bg-red-50 text-red-600 border border-red-200' },
      completed: { label: '完了',     className: 'bg-green-50 text-green-700 border border-green-200' },
    };
    const s = map[status] ?? map.pending;
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.className}`}>
        {s.label}
      </span>
    );
  };

  const formatDate = (date: string, time: string) => {
    const d = new Date(date);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    return `${dateStr} ${time}`;
  };

  const filteredReservations = hideTestCustomers
    ? reservations.filter((r) => !HIDDEN_CUSTOMER_SET.has(normalizeCustomerName(r.customer_name)))
    : reservations;

  // CSVダウンロード: 現在のフィルター結果を「店舗×月別」「店舗別合計」「月別合計」に集計して出力
  const handleDownloadCsv = () => {
    const storeNameMap = new Map(stores.map((s) => [s.id, s.name]));
    const monthOf = (r: Reservation) => (r.reservation_date || '').slice(0, 7); // YYYY-MM

    // 店舗×月別の集計（キャンセルの内数も持つ）
    const byStoreMonth = new Map<string, { storeId: string; month: string; total: number; cancelled: number }>();
    const byStore = new Map<string, { total: number; cancelled: number }>();
    const byMonth = new Map<string, { total: number; cancelled: number }>();
    let grandTotal = 0;
    let grandCancelled = 0;

    for (const r of filteredReservations) {
      const month = monthOf(r);
      if (!month) continue;
      const isCancelled = r.status === 'cancelled' ? 1 : 0;

      const key = `${r.store_id}\t${month}`;
      const sm = byStoreMonth.get(key) || { storeId: r.store_id, month, total: 0, cancelled: 0 };
      sm.total += 1; sm.cancelled += isCancelled;
      byStoreMonth.set(key, sm);

      const st = byStore.get(r.store_id) || { total: 0, cancelled: 0 };
      st.total += 1; st.cancelled += isCancelled;
      byStore.set(r.store_id, st);

      const mo = byMonth.get(month) || { total: 0, cancelled: 0 };
      mo.total += 1; mo.cancelled += isCancelled;
      byMonth.set(month, mo);

      grandTotal += 1; grandCancelled += isCancelled;
    }

    const storeName = (id: string) => storeNameMap.get(id) || id;
    const fmtMonth = (m: string) => {
      const [y, mm] = m.split('-');
      return `${y}年${parseInt(mm, 10)}月`;
    };

    const lines: string[] = [];
    lines.push('【店舗別×月別 予約数】');
    lines.push(['店舗ID', '店舗名', '年月', '予約数', 'うちキャンセル'].join(','));
    [...byStoreMonth.values()]
      .sort((a, b) => storeName(a.storeId).localeCompare(storeName(b.storeId), 'ja') || a.month.localeCompare(b.month))
      .forEach((e) => {
        lines.push([csvField(e.storeId), csvField(storeName(e.storeId)), fmtMonth(e.month), e.total, e.cancelled].join(','));
      });

    lines.push('');
    lines.push('【店舗別 合計】');
    lines.push(['店舗ID', '店舗名', '予約数合計', 'うちキャンセル'].join(','));
    [...byStore.entries()]
      .sort((a, b) => storeName(a[0]).localeCompare(storeName(b[0]), 'ja'))
      .forEach(([id, e]) => {
        lines.push([csvField(id), csvField(storeName(id)), e.total, e.cancelled].join(','));
      });

    lines.push('');
    lines.push('【月別 合計（全店舗）】');
    lines.push(['年月', '予約数合計', 'うちキャンセル'].join(','));
    [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([m, e]) => {
        lines.push([fmtMonth(m), e.total, e.cancelled].join(','));
      });

    lines.push('');
    lines.push(['総予約数', grandTotal, `うちキャンセル ${grandCancelled}`].map(csvField).join(','));
    const statusLabel = filterStatus === 'all' ? '全て' : filterStatus;
    const storeLabel = filterStoreId === 'all' ? '全店舗' : storeName(filterStoreId);
    lines.push([csvField('出力条件'), csvField(`ステータス=${statusLabel} / 店舗=${storeLabel} / テスト用顧客=${hideTestCustomers ? '非表示' : '含む'}`)].join(','));

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    // UTF-8 BOM 付き（Excel で日本語が文字化けしないように）
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `予約集計_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="admin-page min-h-screen bg-background p-4 lg:p-8">
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
                    onClick={() => router.push(`/tenant/${tenantSlug}/admin`)}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    管理画面に戻る
                  </Button>
                </div>
                <CardTitle className="text-2xl">全予約一覧</CardTitle>
                <CardDescription className="mt-1">全店舗の予約データ（サービス管理者専用）</CardDescription>
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
            {filterStoreId !== 'all' ? (
              <ReservationAnalytics storeId={filterStoreId} />
            ) : (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-muted-foreground">
                    <p className="mb-4">分析機能を使用するには、店舗を選択してください</p>
                    <div className="flex justify-center">
                      <Select value={filterStoreId} onValueChange={setFilterStoreId}>
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="店舗を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全店舗</SelectItem>
                          {stores.map((store) => (
                            <SelectItem key={store.id} value={store.id}>
                              {store.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
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
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="store-filter">店舗</Label>
                    <Select value={filterStoreId} onValueChange={setFilterStoreId}>
                      <SelectTrigger id="store-filter" className="w-full sm:w-[200px]">
                        <SelectValue placeholder="店舗でフィルター" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全店舗</SelectItem>
                        {stores.map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="opacity-0 hidden sm:block">CSV</Label>
                    <Button
                      variant="outline"
                      onClick={handleDownloadCsv}
                      disabled={loading || filteredReservations.length === 0}
                      className="w-full sm:w-auto"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      CSVダウンロード
                    </Button>
                  </div>
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="hide-test-customers">顧客名の非表示</Label>
                    <label
                      htmlFor="hide-test-customers"
                      className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-background cursor-pointer w-full sm:w-fit"
                    >
                      <input
                        id="hide-test-customers"
                        type="checkbox"
                        checked={hideTestCustomers}
                        onChange={(e) => setHideTestCustomers(e.target.checked)}
                        className="h-4 w-4 rounded"
                      />
                      <span className="text-sm whitespace-nowrap">テスト用顧客を非表示</span>
                    </label>
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
                          <TableHead>店舗ID</TableHead>
                          <TableHead>顧客名</TableHead>
                          <TableHead>電話番号</TableHead>
                          <TableHead>経路</TableHead>
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
                            <TableCell>
                              <code className="text-xs bg-muted px-2 py-1 rounded">
                                {reservation.store_id}
                              </code>
                            </TableCell>
                            <TableCell>{reservation.customer_name}</TableCell>
                            <TableCell>{reservation.customer_phone}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {reservation.source_medium ? (SOURCE_MEDIUM_LABELS[reservation.source_medium] || reservation.source_medium) : '-'}
                            </TableCell>
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
