'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/client-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { WAITLIST_STATUS_LABELS, type WaitlistStatus } from '@/lib/waitlist';

interface WaitlistRow {
  id: string;
  form_id: string;
  customer_id: string | null;
  customer_name: string | null;
  reservation_date: string;
  reservation_time: string;
  menu_text: string;
  staff_name: string | null;
  status: WaitlistStatus;
  notified_at: string | null;
  notify_count: number;
  created_at: string;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatSlot(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}（${WEEKDAYS[dow]}）${time}`;
}

function formatJst(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const j = new Date(t.getTime() + 9 * 3600000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}`;
}

const isActive = (s: WaitlistStatus) => s === 'waiting' || s === 'notified';

/**
 * 予約一覧の上に出す「空き待ち（キャンセル待ち）」の一覧。
 * 空き待ちが 1 件も無い店舗（機能を使っていない店舗）では何も表示しない
 */
export default function WaitlistPanel({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<WaitlistRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/waitlist?scope=all`, { credentials: 'include' });
      if (!res.ok) {
        setRows([]);
        return;
      }
      const data = await res.json();
      setRows(Array.isArray(data?.entries) ? data.entries : []);
    } catch {
      setRows([]);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!rows || rows.length === 0) return null;

  const activeRows = rows.filter((r) => isActive(r.status));
  const shown = (showAll ? rows : activeRows).slice().sort((a, b) => {
    if (showAll) return b.created_at.localeCompare(a.created_at);
    return `${a.reservation_date} ${a.reservation_time}`.localeCompare(`${b.reservation_date} ${b.reservation_time}`);
  });

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/waitlist/run`, { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || '空き待ちの確認に失敗しました');
      toast({
        title: '空き待ちを確認しました',
        description: `空きのお知らせ ${data.notified || 0} 件 / 埋まったお知らせ ${data.apologized || 0} 件 / 終了 ${data.expired || 0} 件${data.failed ? ` / 送信失敗 ${data.failed} 件` : ''}`,
      });
      await load();
    } catch (e) {
      toast({ title: 'エラー', description: e instanceof Error ? e.message : '空き待ちの確認に失敗しました', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const cancel = async (row: WaitlistRow) => {
    if (!window.confirm(`${row.customer_name || 'お客様'} の ${formatSlot(row.reservation_date, row.reservation_time)} の空き待ちを取り消しますか？\n（お客様への通知は送られません）`)) return;
    setBusyId(row.id);
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/waitlist/${row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || '空き待ちの取り消しに失敗しました');
      toast({ title: '空き待ちを取り消しました' });
      await load();
    } catch (e) {
      toast({ title: 'エラー', description: e instanceof Error ? e.message : '空き待ちの取り消しに失敗しました', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card data-slot="waitlist-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">空き待ち（キャンセル待ち） {activeRows.length} 件</CardTitle>
            <CardDescription>満席の時間に登録されたお客様です。空きが出ると LINE で自動的にお知らせします。</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} data-testid="waitlist-panel-toggle">
            {open ? '閉じる' : '一覧を見る'}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={showAll ? 'outline' : 'default'} size="sm" onClick={() => setShowAll(false)}>受付中（{activeRows.length}）</Button>
            <Button variant={showAll ? 'default' : 'outline'} size="sm" onClick={() => setShowAll(true)}>すべて（{rows.length}）</Button>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={load}>更新</Button>
            <Button variant="outline" size="sm" onClick={runNow} disabled={running} data-testid="waitlist-run">
              {running ? '確認中…' : '今すぐ空きを確認'}
            </Button>
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">受付中の空き待ちはありません。</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {shown.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm" data-slot="list-item">
                  <div className="font-medium min-w-[120px]">{formatSlot(r.reservation_date, r.reservation_time)}</div>
                  <div className="min-w-[100px]">{r.customer_name || '（お名前なし）'}</div>
                  <div className="flex-1 min-w-[140px] text-muted-foreground">
                    {r.menu_text || 'メニュー未選択'}
                    {r.staff_name ? ` / 担当: ${r.staff_name}` : ''}
                  </div>
                  <Badge variant={r.status === 'notified' ? 'default' : isActive(r.status) ? 'secondary' : 'outline'}>
                    {WAITLIST_STATUS_LABELS[r.status] || r.status}
                  </Badge>
                  <div className="text-xs text-muted-foreground">
                    登録 {formatJst(r.created_at)}
                    {r.notified_at ? ` / お知らせ ${formatJst(r.notified_at)}` : ''}
                  </div>
                  {isActive(r.status) && (
                    <Button variant="ghost" size="sm" className="text-red-600" disabled={busyId === r.id} onClick={() => cancel(r)}>
                      取り消す
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            空きの確認は、予約のキャンセル・日時変更の直後と 10 分おきに自動で行います。「今すぐ空きを確認」で、待たずに確認できます。
          </p>
        </CardContent>
      )}
    </Card>
  );
}
