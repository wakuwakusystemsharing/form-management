'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { LotteryEntry, LotteryEntryView, LotteryFormWithStats } from '@/types/lottery';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, RefreshCw, Send, Shuffle, UserMinus, UserPlus } from 'lucide-react';

interface DeferredSummary {
  form_id: string;
  deferred_draw_status: 'accepting' | 'closed' | 'drawn' | 'notified';
  is_closed: boolean;
  applicants: number;
  provisional: LotteryEntry[];
  winners: LotteryEntry[];
  unnotified: number;
  prize_capacity: Record<string, { stock: number; assigned: number }>;
}

interface LotteryDeferredPanelProps {
  storeId: string;
  form: LotteryFormWithStats;
  /** 抽選実行・確定のあとに呼ぶ（フォーム一覧の再取得用） */
  onChanged?: () => void;
}

const STATUS_LABEL: Record<DeferredSummary['deferred_draw_status'], string> = {
  accepting: '応募受付中',
  closed: '締切済み',
  drawn: '仮当選（確定前）',
  notified: '確定・通知済み',
};

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/**
 * 後日抽選の管理パネル（1 フォーム分）
 * 抽選を実行 → 仮当選の入替 → 当選を確定して通知 → 未通知の再送
 */
export default function LotteryDeferredPanel({ storeId, form, onChanged }: LotteryDeferredPanelProps) {
  const { toast } = useToast();
  const [summary, setSummary] = useState<DeferredSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<'draw' | 'confirm' | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [applicants, setApplicants] = useState<LotteryEntryView[]>([]);
  const [addEntryId, setAddEntryId] = useState('');
  const [addPrizeId, setAddPrizeId] = useState('');

  const prizeName = useMemo(() => new Map(form.config.prizes.map((p) => [p.id, p.name])), [form]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lotteries/${form.id}/deferred/summary`, { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: '後日抽選の状況取得に失敗しました', description: json.error, variant: 'destructive' });
        return;
      }
      setSummary(json as DeferredSummary);
    } catch {
      toast({ title: '後日抽選の状況取得に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [form.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (method: string, path: string, body?: unknown, successTitle?: string) => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: '操作に失敗しました', description: json.error, variant: 'destructive' });
        return null;
      }
      if (successTitle) toast({ title: successTitle });
      await load();
      onChanged?.();
      return json;
    } catch {
      toast({ title: '操作に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const runDraw = async (force: boolean) => {
    setConfirmOpen(null);
    const json = await call('POST', `/api/lotteries/${form.id}/deferred/draw`, { force });
    if (json) toast({ title: '抽選を実行しました', description: `仮当選 ${json.provisional?.length ?? 0} 名。内容を確認して「当選を確定して通知」を押してください` });
  };

  const confirmWinners = async () => {
    setConfirmOpen(null);
    const json = await call('POST', `/api/lotteries/${form.id}/deferred/confirm`);
    if (json) {
      toast({
        title: '当選を確定しました',
        description: `通知成功 ${json.notified} 件 / 失敗 ${json.failed} 件 / 落選 ${json.lost} 件${json.failed > 0 ? '。失敗分は「未通知に再送」で再送できます' : ''}`,
        variant: json.failed > 0 ? 'destructive' : undefined,
      });
    }
  };

  const resend = async () => {
    const json = await call('POST', `/api/lotteries/${form.id}/deferred/resend`);
    if (json) toast({ title: '再送しました', description: `成功 ${json.notified} 件 / 失敗 ${json.failed} 件` });
  };

  const removeWinner = async (entryId: string) => {
    if (!confirm('この仮当選を外しますか？（枠は「応募者から追加」で補充できます）')) return;
    await call('PATCH', `/api/lotteries/${form.id}/deferred/winners`, { remove: [entryId] }, '仮当選から外しました');
  };

  const openAdd = async () => {
    setAddOpen(true);
    setAddEntryId('');
    setAddPrizeId(form.config.prizes[0]?.id ?? '');
    try {
      const res = await fetch(`/api/stores/${storeId}/lotteries/entries?form_id=${form.id}&status=entered&limit=500`, { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      setApplicants(res.ok ? (json.entries as LotteryEntryView[]) : []);
    } catch {
      setApplicants([]);
    }
  };

  const addWinner = async () => {
    if (!addEntryId || !addPrizeId) return;
    setAddOpen(false);
    await call('PATCH', `/api/lotteries/${form.id}/deferred/winners`, { add: [{ entry_id: addEntryId, prize_id: addPrizeId }] }, '仮当選に追加しました');
  };

  if (loading && !summary) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-3"><Loader2 className="h-4 w-4 animate-spin" />読み込み中...</div>;
  }
  if (!summary) return null;

  const status = summary.deferred_draw_status;
  const endAt = form.config.basic_info.period?.end_at;

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">📮 後日抽選の管理: {form.config.basic_info.title}</CardTitle>
            <CardDescription>
              応募 {summary.applicants} 件 ／ 締切 {formatDateTime(endAt) || '未設定'}
              {form.deferred_drawn_at && ` ／ 抽選 ${formatDateTime(form.deferred_drawn_at)}`}
              {form.deferred_notified_at && ` ／ 通知 ${formatDateTime(form.deferred_notified_at)}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-blue-700 border-blue-400">{STATUS_LABEL[status]}</Badge>
            <Button size="sm" variant="ghost" onClick={load} title="再読み込み"><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ステップ表示 */}
        <ol className="flex flex-wrap gap-2 text-xs">
          {(['accepting', 'drawn', 'notified'] as const).map((s, i) => {
            const active = (status === 'closed' ? 'accepting' : status) === s;
            const done = ['accepting', 'closed', 'drawn', 'notified'].indexOf(status) > ['accepting', 'drawn', 'notified'].indexOf(s);
            return (
              <li key={s} className={`rounded-full px-3 py-1 border ${active ? 'bg-blue-600 text-white border-blue-600' : done ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-white text-muted-foreground'}`}>
                {i + 1}. {s === 'accepting' ? '応募受付' : s === 'drawn' ? '抽選・仮当選の確認' : '確定・通知'}
              </li>
            );
          })}
        </ol>

        {/* 賞品ごとの枠 */}
        <div className="flex flex-wrap gap-2 text-xs">
          {form.config.prizes.map((p) => {
            const cap = summary.prize_capacity[p.id] ?? { stock: p.stock ?? 0, assigned: 0 };
            return <Badge key={p.id} variant="secondary">{p.name} {cap.assigned} / {cap.stock} 名</Badge>;
          })}
        </div>

        {/* 操作 */}
        {status !== 'notified' && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirmOpen('draw')} disabled={busy || summary.applicants === 0}>
              <Shuffle className="mr-2 h-4 w-4" />
              {status === 'drawn' ? '引き直す' : summary.is_closed ? '抽選を実行' : '締め切って抽選する'}
            </Button>
            {status === 'drawn' && (
              <>
                <Button size="sm" variant="outline" onClick={openAdd} disabled={busy}><UserPlus className="mr-2 h-4 w-4" />応募者から追加</Button>
                <Button size="sm" onClick={() => setConfirmOpen('confirm')} disabled={busy || summary.provisional.length === 0} className="bg-[rgb(209,241,209)] text-[rgb(55,114,58)] hover:bg-[rgb(55,114,58)] hover:text-white">
                  <Send className="mr-2 h-4 w-4" />当選を確定して LINE で通知
                </Button>
              </>
            )}
          </div>
        )}
        {status === 'notified' && summary.unnotified > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">
            未通知の当選者が {summary.unnotified} 名います
            <Button size="sm" variant="outline" onClick={resend} disabled={busy}>未通知に再送</Button>
          </div>
        )}
        {!summary.is_closed && status === 'accepting' && (
          <p className="text-xs text-muted-foreground">締切前です。締切を過ぎると「抽選を実行」できます（先に締め切ることもできます）。</p>
        )}

        {/* 仮当選 / 確定当選の一覧 */}
        {(summary.provisional.length > 0 || summary.winners.length > 0) && (
          <div className="rounded-md border bg-white divide-y">
            {[...summary.provisional, ...summary.winners].map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Badge variant="outline" className="shrink-0">{prizeName.get(e.prize_id || '') || e.prize_name || '—'}</Badge>
                <span className="flex-1 truncate">{e.line_display_name || '（不明）'}</span>
                {e.status === 'provisional' ? (
                  <Button size="sm" variant="ghost" className="text-destructive h-8" onClick={() => removeWinner(e.id)} disabled={busy}><UserMinus className="mr-1 h-4 w-4" />外す</Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{e.status === 'redeemed' ? '引換済み' : e.push_sent ? '通知済み' : '未通知'}{e.redeem_code ? ` ・ ${e.redeem_code}` : ''}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* 確認ダイアログ */}
      <Dialog open={confirmOpen !== null} onOpenChange={(o) => { if (!o) setConfirmOpen(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmOpen === 'draw' ? '抽選を実行しますか？' : '当選を確定して通知しますか？'}</DialogTitle>
            <DialogDescription>
              {confirmOpen === 'draw'
                ? `応募 ${summary.applicants} 件から賞品ごとの当選数だけランダムに選びます。${status === 'drawn' ? '現在の仮当選は破棄されます。' : ''}${!summary.is_closed ? 'まだ締切前ですが、実行すると応募を締め切ります。' : ''}結果は「仮当選」として表示され、確定前に手動で入れ替えできます。`
                : `仮当選 ${summary.provisional.length} 名を当選として確定し、引換コードを発行して LINE で通知します。それ以外の応募者は落選になります。確定後は当選者を変更できません。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(null)}>キャンセル</Button>
            {confirmOpen === 'draw'
              ? <Button onClick={() => runDraw(!summary.is_closed)} disabled={busy}>実行する</Button>
              : <Button onClick={confirmWinners} disabled={busy}>確定して通知する</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 応募者から追加 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>応募者から仮当選に追加</DialogTitle>
            <DialogDescription>未当選の応募者を選んで賞品を割り当てます</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={addEntryId} onValueChange={setAddEntryId}>
              <SelectTrigger><SelectValue placeholder="応募者を選択" /></SelectTrigger>
              <SelectContent>
                {applicants.length === 0 && <SelectItem value="__none" disabled>未当選の応募者がいません</SelectItem>}
                {applicants.map((a) => <SelectItem key={a.id} value={a.id}>{a.line_display_name || a.id}（{formatDateTime(a.entered_at)}）</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={addPrizeId} onValueChange={setAddPrizeId}>
              <SelectTrigger><SelectValue placeholder="賞品を選択" /></SelectTrigger>
              <SelectContent>
                {form.config.prizes.map((p) => {
                  const cap = summary.prize_capacity[p.id];
                  return <SelectItem key={p.id} value={p.id}>{p.name}（{cap?.assigned ?? 0} / {cap?.stock ?? p.stock ?? 0}）</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>キャンセル</Button>
            <Button onClick={addWinner} disabled={busy || !addEntryId || addEntryId === '__none' || !addPrizeId}>追加する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
