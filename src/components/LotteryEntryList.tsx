'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { LotteryEntryEffectiveStatus, LotteryEntryView, LotteryFormWithStats } from '@/types/lottery';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Download, Loader2, QrCode, RefreshCw, Search } from 'lucide-react';

interface LotteryEntryListProps {
  storeId: string;
  forms: LotteryFormWithStats[];
  /** QR スキャン画面へのリンクを出す（店舗管理者ページ） */
  scanHref?: string;
  /** 引換操作後に呼ぶ（フォーム一覧の集計を更新するため） */
  onChanged?: () => void;
}

const STATUS_LABELS: Record<LotteryEntryEffectiveStatus, string> = {
  entered: '応募',
  provisional: '仮当選',
  drawn: '当選',
  lost: 'はずれ',
  redeemed: '引換済み',
  cancelled: '取り消し',
  expired: '期限切れ',
};

const STATUS_CLASSES: Record<LotteryEntryEffectiveStatus, string> = {
  entered: 'bg-blue-100 text-blue-800',
  provisional: 'bg-purple-100 text-purple-800',
  drawn: 'bg-[rgb(209,241,209)] text-[rgb(55,114,58)]',
  lost: 'bg-gray-100 text-gray-700',
  redeemed: 'bg-[rgb(254,225,190)] text-[rgb(200,100,10)]',
  cancelled: 'bg-red-100 text-red-800',
  expired: 'bg-yellow-100 text-yellow-800',
};

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}
function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())}`;
}

const PAGE_SIZE = 50;

/**
 * 抽選履歴の一覧 + 引換操作
 * GET /api/stores/{storeId}/lotteries/entries を使う。
 */
export default function LotteryEntryList({ storeId, forms, scanHref, onChanged }: LotteryEntryListProps) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<LotteryEntryView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [formId, setFormId] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<LotteryEntryView | null>(null);
  const [acting, setActing] = useState(false);
  const [note, setNote] = useState('');

  const formTitle = useMemo(() => new Map(forms.map((f) => [f.id, f.config.basic_info.title || f.id])), [forms]);
  const selectedForm = selected ? forms.find((f) => f.id === selected.lottery_form_id) : null;

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (formId !== 'all') params.set('form_id', formId);
    if (status !== 'all') params.set('status', status);
    if (search) params.set('search', search);
    return params;
  }, [formId, status, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildQuery();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      const res = await fetch(`/api/stores/${storeId}/lotteries/entries?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: '抽選履歴の取得に失敗しました', description: err.error, variant: 'destructive' });
        return;
      }
      const json = await res.json();
      setEntries(json.entries || []);
      setTotal(json.total || 0);
    } catch {
      toast({ title: '抽選履歴の取得に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, buildQuery, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const applySearch = () => {
    setPage(0);
    setSearch(searchInput.trim());
  };

  const act = async (entry: LotteryEntryView, action: 'redeem' | 'unredeem' | 'cancel' | 'restore') => {
    setActing(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/lotteries/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, note: note || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: '更新に失敗しました', description: json.error, variant: 'destructive' });
        return;
      }
      const labels = { redeem: '引換済みにしました', unredeem: '引換を取り消しました', cancel: '取り消しました', restore: '元に戻しました' };
      toast({ title: labels[action] });
      setSelected(null);
      setNote('');
      await load();
      onChanged?.();
    } catch {
      toast({ title: '更新に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setActing(false);
    }
  };

  const exportCsv = () => {
    const params = buildQuery();
    window.open(`/api/stores/${storeId}/lotteries/entries/export?${params.toString()}`, '_blank');
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card className="shadow-sm border-border/60">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base">抽選履歴</CardTitle>
            <CardDescription>誰が・いつ・何に当たったか、引換状況を確認します（{total} 件）</CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            {scanHref && (
              <Button asChild variant="outline" size="sm">
                <Link href={scanHref}><QrCode className="mr-2 h-4 w-4" />QR をスキャン</Link>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />CSV 出力
            </Button>
            <Button variant="ghost" size="sm" onClick={load} title="再読み込み">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <Select value={formId} onValueChange={(v) => { setFormId(v); setPage(0); }}>
            <SelectTrigger className="sm:w-56"><SelectValue placeholder="フォーム" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべてのフォーム</SelectItem>
              {forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.config.basic_info.title || f.id}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="sm:w-40"><SelectValue placeholder="状態" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべての状態</SelectItem>
              {(Object.keys(STATUS_LABELS) as LotteryEntryEffectiveStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-2 flex-1">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
              placeholder="LINE 名・引換コード・賞品名で検索"
            />
            <Button variant="outline" onClick={applySearch}><Search className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />読み込み中...</div>
        ) : entries.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">該当する履歴はありません</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">日時</TableHead>
                  <TableHead className="whitespace-nowrap">LINE 名</TableHead>
                  <TableHead className="whitespace-nowrap">フォーム</TableHead>
                  <TableHead className="whitespace-nowrap">賞品</TableHead>
                  <TableHead className="whitespace-nowrap">コード</TableHead>
                  <TableHead className="whitespace-nowrap">状態</TableHead>
                  <TableHead className="whitespace-nowrap">有効期限</TableHead>
                  <TableHead className="whitespace-nowrap">引換</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => { setSelected(e); setNote(e.redeemed_note || ''); }}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDateTime(e.entered_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{e.line_display_name || <span className="text-muted-foreground">（不明）</span>}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">{formTitle.get(e.lottery_form_id) || e.lottery_form_id}</TableCell>
                    <TableCell className="text-sm">
                      {e.prize_name || (e.status === 'entered' || e.status === 'provisional' ? '—' : 'はずれ')}
                      {e.is_consolation && <span className="ml-1 text-[10px] text-muted-foreground">残念賞</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm tracking-wider">{e.redeem_code || '—'}</TableCell>
                    <TableCell><Badge className={STATUS_CLASSES[e.effective_status]}>{STATUS_LABELS[e.effective_status]}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{formatDate(e.expires_at) || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {e.effective_status === 'drawn' ? (
                        <Button size="sm" variant="outline" className="h-8" onClick={(ev) => { ev.stopPropagation(); setSelected(e); setNote(''); }}>引換</Button>
                      ) : e.status === 'redeemed' ? (
                        <span className="text-xs text-muted-foreground">{formatDateTime(e.redeemed_at)}</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {pageCount > 1 && (
          <div className="flex items-center justify-end gap-2 mt-4 text-sm">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>前へ</Button>
            <span className="text-muted-foreground">{page + 1} / {pageCount}</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>次へ</Button>
          </div>
        )}
      </CardContent>

      {/* 詳細・引換ダイアログ */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="sm:max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>抽選履歴の詳細</DialogTitle>
                <DialogDescription>{formTitle.get(selected.lottery_form_id) || selected.lottery_form_id}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">日時</span><span className="col-span-2">{formatDateTime(selected.entered_at)}</span></div>
                <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">LINE 名</span><span className="col-span-2">{selected.line_display_name || '（不明）'}</span></div>
                <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">結果</span><span className="col-span-2">{selected.prize_name ? `${selected.prize_name}${selected.is_consolation ? '（残念賞）' : ''}` : selected.status === 'entered' ? '応募' : selected.status === 'provisional' ? '仮当選' : 'はずれ'}</span></div>
                {selected.prize_id && selectedForm && (() => {
                  const prize = selectedForm.config.prizes.find((p) => p.id === selected.prize_id) || selectedForm.config.consolation_prize;
                  return prize?.description ? <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">内容</span><span className="col-span-2">{prize.description}</span></div> : null;
                })()}
                {selected.redeem_code && <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">引換コード</span><span className="col-span-2 font-mono text-lg tracking-widest">{selected.redeem_code}</span></div>}
                <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">状態</span><span className="col-span-2"><Badge className={STATUS_CLASSES[selected.effective_status]}>{STATUS_LABELS[selected.effective_status]}</Badge></span></div>
                {selected.expires_at && <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">有効期限</span><span className="col-span-2">{formatDate(selected.expires_at)}</span></div>}
                {selected.redeemed_at && <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">引換日時</span><span className="col-span-2">{formatDateTime(selected.redeemed_at)}</span></div>}
                {selected.answers && Object.keys(selected.answers).length > 0 && (
                  <div className="border-t pt-2 mt-2">
                    <p className="text-xs text-muted-foreground mb-1">事前質問の回答</p>
                    {Object.entries(selected.answers).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-3 gap-2"><span className="text-muted-foreground truncate">{k}</span><span className="col-span-2 break-words">{Array.isArray(v) ? v.join(', ') : String(v ?? '')}</span></div>
                    ))}
                  </div>
                )}
                {selected.customer_id && (
                  <p className="text-xs"><Link className="underline text-primary" href={`/${storeId}/admin?tab=customers&customerId=${selected.customer_id}`}>顧客情報を見る</Link></p>
                )}
                <div className="pt-2">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="備考（担当者名など。任意）" />
                </div>
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {selected.effective_status === 'drawn' && (
                  <Button onClick={() => act(selected, 'redeem')} disabled={acting} className="bg-[rgb(209,241,209)] text-[rgb(55,114,58)] hover:bg-[rgb(55,114,58)] hover:text-white">引換済みにする</Button>
                )}
                {selected.status === 'redeemed' && (
                  <Button variant="outline" onClick={() => act(selected, 'unredeem')} disabled={acting}>引換を取り消す</Button>
                )}
                {selected.status !== 'cancelled' && (
                  <Button variant="outline" className="text-destructive" onClick={() => { if (confirm('この履歴を取り消しますか？（在庫・参加回数のカウントから外れます）')) act(selected, 'cancel'); }} disabled={acting}>取り消す</Button>
                )}
                {selected.status === 'cancelled' && (
                  <Button variant="outline" onClick={() => act(selected, 'restore')} disabled={acting}>取り消しを戻す</Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
