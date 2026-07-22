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
import { Input } from '@/components/ui/input';
import { ArrowLeft, Calendar, BarChart3, Download, X, Pencil } from 'lucide-react';

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

// 「顧客名の非表示」のデフォルト除外リスト（画面から追加・削除でき、localStorage に保存される）
const DEFAULT_HIDDEN_CUSTOMER_NAMES = [
  'テスト',
  '合同会社わくわく動作確認2号',
  'M',
  'テスト花子',
  '石山 隆平 (のこのこ)',
  '中江つばさ',
  '動作確認用02',
  '羽楽',
];
const HIDDEN_NAMES_STORAGE_KEY = 'allReservations_hiddenCustomerNames_v1';

// 全角スペース・全角括弧を半角に揃え、連続空白を1つにして比較する
function normalizeCustomerName(name: string): string {
  return (name || '')
    .replace(/　/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}


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
  const [hiddenNames, setHiddenNames] = useState<string[]>(DEFAULT_HIDDEN_CUSTOMER_NAMES);
  const [editingHiddenNames, setEditingHiddenNames] = useState<boolean>(false);
  const [newHiddenName, setNewHiddenName] = useState<string>('');
  const [exporting, setExporting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'list' | 'analytics'>('list');

  // 非表示リストを localStorage から復元
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HIDDEN_NAMES_STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) {
          setHiddenNames(arr);
        }
      }
    } catch { /* 破損時はデフォルトのまま */ }
  }, []);

  const saveHiddenNames = (names: string[]) => {
    setHiddenNames(names);
    try { localStorage.setItem(HIDDEN_NAMES_STORAGE_KEY, JSON.stringify(names)); } catch { /* ignore */ }
  };

  const addHiddenName = () => {
    const name = newHiddenName.trim();
    if (!name) return;
    if (hiddenNames.some((n) => normalizeCustomerName(n) === normalizeCustomerName(name))) {
      setNewHiddenName('');
      return;
    }
    saveHiddenNames([...hiddenNames, name]);
    setNewHiddenName('');
  };

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

  const hiddenNameSet = new Set(hiddenNames.map(normalizeCustomerName));
  const filteredReservations = hideTestCustomers
    ? reservations.filter((r) => !hiddenNameSet.has(normalizeCustomerName(r.customer_name)))
    : reservations;

  // 集計ダウンロード: 現在のフィルター結果を Excel（.xlsx）で出力。
  // Googleスプレッドシートへのインポート想定: A列=店舗ID / B列=店舗名 / C列以降=年月の横並びマトリクス。
  // シート1=予約数（キャンセル除く）、シート2=キャンセル数、シート3=アンケート回答数
  const handleDownloadExcel = async () => {
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const storeNameMap = new Map(stores.map((st) => [st.id, st.name]));
      const storeName = (id: string) => storeNameMap.get(id) || id;
      const fmtMonth = (m: string) => {
        const [y, mm] = m.split('-');
        return `${y}年${parseInt(mm, 10)}月`;
      };

      // ---- 予約の集計（store×month） ----
      const resCounts = new Map<string, number>();       // キャンセル除く
      const cancelCounts = new Map<string, number>();    // キャンセルのみ
      const monthSet = new Set<string>();
      const storeSet = new Set<string>();
      for (const r of filteredReservations) {
        const month = (r.reservation_date || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        monthSet.add(month);
        storeSet.add(r.store_id);
        const key = `${r.store_id}\t${month}`;
        if (r.status === 'cancelled') {
          cancelCounts.set(key, (cancelCounts.get(key) || 0) + 1);
        } else {
          resCounts.set(key, (resCounts.get(key) || 0) + 1);
        }
      }

      // ---- アンケート回答数の取得（store×month） ----
      const surveyCounts = new Map<string, number>();
      try {
        const params = new URLSearchParams();
        if (filterStoreId !== 'all') params.append('store_id', filterStoreId);
        const res = await fetch(`/api/surveys/stats?${params.toString()}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          (data.stats || []).forEach((e: { store_id: string; month: string; count: number }) => {
            surveyCounts.set(`${e.store_id}\t${e.month}`, e.count);
            monthSet.add(e.month);
            storeSet.add(e.store_id);
          });
        }
      } catch (e) {
        console.error('アンケート回答数の取得に失敗:', e);
      }

      const months = [...monthSet].sort();
      const storeIds = [...storeSet].sort((a, b) => storeName(a).localeCompare(storeName(b), 'ja'));

      const workbook = new ExcelJS.Workbook();

      // スタイル定義
      const HEADER_BG = 'FF1B2A4E';   // 濃紺
      const TOTAL_BG = 'FFFDF3E3';    // 薄いゴールド
      const BORDER: import('exceljs').Borders = {
        top: { style: 'thin', color: { argb: 'FFB8BCC6' } },
        left: { style: 'thin', color: { argb: 'FFB8BCC6' } },
        bottom: { style: 'thin', color: { argb: 'FFB8BCC6' } },
        right: { style: 'thin', color: { argb: 'FFB8BCC6' } },
        diagonal: {},
      };

      const buildSheet = (
        title: string,
        counts: Map<string, number>
      ) => {
        const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });

        // タイトル行
        const titleCell = sheet.getCell(1, 1);
        titleCell.value = `${title}（店舗×月別）`;
        titleCell.font = { size: 14, bold: true, color: { argb: 'FF1B2A4E' } };
        sheet.getRow(1).height = 24;

        // ヘッダー行（2行目）: A=店舗ID, B=店舗名, C..=年月, 最後=合計
        const header = ['店舗ID', '店舗名', ...months.map(fmtMonth), '合計'];
        const headerRow = sheet.getRow(2);
        header.forEach((text, i) => {
          const cell = headerRow.getCell(i + 1);
          cell.value = text;
          cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = BORDER;
        });
        headerRow.height = 20;

        // データ行（店舗ごと）
        const colTotals = new Array(months.length).fill(0);
        let grand = 0;
        storeIds.forEach((sid, rowIndex) => {
          const row = sheet.getRow(3 + rowIndex);
          row.getCell(1).value = sid;
          const nameCell = row.getCell(2);
          nameCell.value = storeName(sid);
          nameCell.font = { bold: true, size: 11 };
          let rowTotal = 0;
          months.forEach((m, mi) => {
            const v = counts.get(`${sid}\t${m}`) || 0;
            const cell = row.getCell(3 + mi);
            cell.value = v;
            cell.alignment = { horizontal: 'center' };
            if (v === 0) cell.font = { size: 11, color: { argb: 'FFB0B4BC' } };
            rowTotal += v;
            colTotals[mi] += v;
          });
          const totalCell = row.getCell(3 + months.length);
          totalCell.value = rowTotal;
          totalCell.font = { bold: true, size: 11 };
          totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
          totalCell.alignment = { horizontal: 'center' };
          grand += rowTotal;
          for (let c = 1; c <= 3 + months.length; c++) row.getCell(c).border = BORDER;
        });

        // 合計行
        const totalRow = sheet.getRow(3 + storeIds.length);
        totalRow.getCell(1).value = '';
        totalRow.getCell(2).value = '合計';
        months.forEach((m, mi) => {
          totalRow.getCell(3 + mi).value = colTotals[mi];
          totalRow.getCell(3 + mi).alignment = { horizontal: 'center' };
        });
        totalRow.getCell(3 + months.length).value = grand;
        totalRow.getCell(3 + months.length).alignment = { horizontal: 'center' };
        for (let c = 1; c <= 3 + months.length; c++) {
          const cell = totalRow.getCell(c);
          cell.font = { bold: true, size: 11 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
          cell.border = BORDER;
        }

        // 列幅
        sheet.getColumn(1).width = 10;
        sheet.getColumn(2).width = 30;
        for (let c = 3; c <= 3 + months.length; c++) sheet.getColumn(c).width = 12;
      };

      buildSheet('予約数', resCounts);
      buildSheet('キャンセル数', cancelCounts);
      buildSheet('アンケート回答数', surveyCounts);

      // 出力条件シート
      const infoSheet = workbook.addWorksheet('出力条件');
      const statusLabel = filterStatus === 'all' ? '全て' : filterStatus;
      const storeLabel = filterStoreId === 'all' ? '全店舗' : storeName(filterStoreId);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      [
        ['出力日時', `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`],
        ['ステータス', statusLabel],
        ['店舗', storeLabel],
        ['テスト用顧客', hideTestCustomers ? '非表示（除外して集計）' : '含む'],
        ['備考', '「予約数」はキャンセルを除いた件数です。キャンセルは「キャンセル数」シートを参照。'],
      ].forEach(([k, v], i) => {
        infoSheet.getCell(i + 1, 1).value = k;
        infoSheet.getCell(i + 1, 1).font = { bold: true };
        infoSheet.getCell(i + 1, 2).value = v;
      });
      infoSheet.getColumn(1).width = 16;
      infoSheet.getColumn(2).width = 70;

      const buffer = await workbook.xlsx.writeBuffer();
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `予約集計_${stamp}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('集計ダウンロードに失敗:', e);
      alert('集計ダウンロードに失敗しました');
    } finally {
      setExporting(false);
    }
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
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="hide-test-customers">顧客名の非表示</Label>
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="hide-test-customers"
                        className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-background cursor-pointer w-fit"
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingHiddenNames(!editingHiddenNames)}
                        className="h-10 px-2 text-muted-foreground"
                        title="非表示にする顧客名を編集"
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        編集
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="opacity-0 hidden sm:block">DL</Label>
                    <Button
                      variant="outline"
                      onClick={handleDownloadExcel}
                      disabled={loading || exporting || filteredReservations.length === 0}
                      className="w-full sm:w-auto"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {exporting ? '作成中...' : '集計ダウンロード'}
                    </Button>
                  </div>
                </div>

                {/* 非表示にする顧客名の編集パネル */}
                {editingHiddenNames && (
                  <div className="mt-4 p-4 rounded-md border bg-muted/40 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      ここに登録した顧客名の予約は、「テスト用顧客を非表示」がONのとき一覧と集計から除外されます（このブラウザに保存されます）
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {hiddenNames.length === 0 ? (
                        <span className="text-sm text-muted-foreground">登録された顧客名はありません</span>
                      ) : (
                        hiddenNames.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-background border text-sm"
                          >
                            {name}
                            <button
                              type="button"
                              onClick={() => saveHiddenNames(hiddenNames.filter((n) => n !== name))}
                              className="text-muted-foreground hover:text-red-500"
                              title={`${name} を非表示リストから削除`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={newHiddenName}
                        onChange={(e) => setNewHiddenName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHiddenName(); } }}
                        placeholder="非表示にする顧客名を入力（完全一致）"
                        className="w-full sm:w-80"
                      />
                      <Button variant="outline" size="sm" onClick={addHiddenName} disabled={!newHiddenName.trim()}>
                        追加
                      </Button>
                    </div>
                  </div>
                )}
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
