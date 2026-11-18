'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/client-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { WAITLIST_NOTIFICATION_LABELS, WAITLIST_STATUS_LABELS, type WaitlistNotificationType, type WaitlistStatus } from '@/lib/waitlist';
import { groupWaitlistBySlot, type WaitlistSlotGroupInput } from '@/lib/waitlist-summary';

interface WaitlistRow extends WaitlistSlotGroupInput {
  id: string;
  form_id: string;
  customer_id: string | null;
  menu_text: string;
  notified_at: string | null;
  notify_count: number;
  created_at: string;
}

interface NotificationRow {
  id: string;
  type: WaitlistNotificationType;
  result: 'success' | 'failed';
  error_message: string | null;
  sent_at: string;
  customer_name: string | null;
  reservation_date: string | null;
  reservation_time: string | null;
}

interface NotificationData {
  notifications: NotificationRow[];
  month: { key: string; sent: number; failed: number };
  line_quota: { type: 'limited' | 'none'; limit: number | null; usage: number } | null;
}

type View = 'list' | 'slots' | 'history';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}（${WEEKDAYS[dow]}）`;
}

const formatSlot = (date: string, time: string) => `${formatDate(date)}${time}`;

function formatJst(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const j = new Date(t.getTime() + 9 * 3600000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}`;
}

const isActive = (s: WaitlistStatus) => s === 'waiting' || s === 'notified';

/**
 * 予約一覧の上に出す「空き待ち（キャンセル待ち）」。
 * 一覧 / 日時ごとの人数 / お知らせの送信履歴（今月の送信数つき）。
 * 空き待ちが 1 件も無い店舗（機能を使っていない店舗）では何も表示しない
 */
export default function WaitlistPanel({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<WaitlistRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [showAll, setShowAll] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [history, setHistory] = useState<NotificationData | null>(null);
  const [historyError, setHistoryError] = useState(false);

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

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/waitlist/notifications`, { credentials: 'include' });
      if (!res.ok) throw new Error('failed');
      setHistory(await res.json());
      setHistoryError(false);
    } catch {
      setHistoryError(true);
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
  const slotDays = groupWaitlistBySlot(activeRows);

  const openPanel = () => {
    setOpen((v) => !v);
    if (!open && !history) loadHistory();
  };

  const refresh = async () => {
    await Promise.all([load(), loadHistory()]);
  };

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
      await refresh();
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

  const quota = history?.line_quota;

  return (
    <Card data-slot="waitlist-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">空き待ち（キャンセル待ち） {activeRows.length} 件</CardTitle>
            <CardDescription>満席の時間に登録されたお客様です。空きが出ると LINE で自動的にお知らせします。</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={openPanel} data-testid="waitlist-panel-toggle">
            {open ? '閉じる' : '一覧を見る'}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {/* 今月の送信数（空き待ちのお知らせは公式 LINE の月間の送信数を使う） */}
          {history && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="waitlist-month">
              <div>
                今月の空き待ちのお知らせ: <strong>{history.month.sent} 通</strong>
                {history.month.failed > 0 ? `（送信失敗 ${history.month.failed} 件）` : ''}
              </div>
              {quota ? (
                <div className="text-xs text-muted-foreground mt-1">
                  公式 LINE 全体の今月の送信数: {quota.usage.toLocaleString()} 通
                  {quota.type === 'limited' && quota.limit !== null ? ` / 上限 ${quota.limit.toLocaleString()} 通（残り ${Math.max(0, quota.limit - quota.usage).toLocaleString()} 通）` : '（上限なし）'}
                  {quota.type === 'limited' && quota.limit !== null && quota.usage >= quota.limit ? ' ※ 上限に達しているため、お知らせを送れません' : ''}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mt-1">公式 LINE 全体の送信数は取得できませんでした（公式 LINE の管理画面でご確認ください）。</div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant={view === 'list' ? 'default' : 'outline'} size="sm" onClick={() => setView('list')}>一覧</Button>
            <Button variant={view === 'slots' ? 'default' : 'outline'} size="sm" onClick={() => setView('slots')} data-testid="waitlist-view-slots">日時ごとの人数</Button>
            <Button
              variant={view === 'history' ? 'default' : 'outline'}
              size="sm"
              data-testid="waitlist-view-history"
              onClick={() => {
                setView('history');
                loadHistory();
              }}
            >
              送信履歴
            </Button>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={refresh}>更新</Button>
            <Button variant="outline" size="sm" onClick={runNow} disabled={running} data-testid="waitlist-run">
              {running ? '確認中…' : '今すぐ空きを確認'}
            </Button>
          </div>

          {view === 'list' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant={showAll ? 'ghost' : 'secondary'} size="sm" onClick={() => setShowAll(false)}>受付中（{activeRows.length}）</Button>
                <Button variant={showAll ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowAll(true)}>すべて（{rows.length}）</Button>
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
            </>
          )}

          {view === 'slots' &&
            (slotDays.length === 0 ? (
              <p className="text-sm text-muted-foreground">受付中の空き待ちはありません。</p>
            ) : (
              <div className="space-y-2" data-testid="waitlist-slots">
                <p className="text-xs text-muted-foreground">受付中の空き待ちを、日付と時間ごとにまとめた人数です。人数の多い時間は、空きが出たときにすぐ埋まりやすい時間です。</p>
                <ul className="divide-y rounded-md border">
                  {slotDays.map((day) => (
                    <li key={day.date} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3 text-sm">
                      <div className="font-medium min-w-[110px]">
                        {formatDate(day.date)}
                        <span className="ml-2 text-xs text-muted-foreground">計 {day.total} 人</span>
                      </div>
                      <div className="flex flex-1 flex-wrap gap-2">
                        {day.slots.map((slot) => (
                          <span
                            key={slot.time}
                            title={slot.names.join('、')}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${slot.count >= 3 ? 'border-orange-400 bg-orange-50 text-orange-800' : 'bg-background'}`}
                          >
                            <span className="font-medium">{slot.time}</span>
                            <span>{slot.count} 人</span>
                            {slot.notified > 0 && <span className="text-muted-foreground">（お知らせ済み {slot.notified}）</span>}
                            {slot.staffNames.length > 0 && <span className="text-muted-foreground">担当: {slot.staffNames.join('・')}</span>}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

          {view === 'history' &&
            (historyError ? (
              <p className="text-sm text-red-600">送信履歴を取得できませんでした。「更新」を押してもう一度お試しください。</p>
            ) : !history ? (
              <p className="text-sm text-muted-foreground">読み込み中…</p>
            ) : history.notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだお知らせを送っていません。</p>
            ) : (
              <ul className="divide-y rounded-md border" data-testid="waitlist-history">
                {history.notifications.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm" data-slot="list-item">
                    <div className="min-w-[90px] text-xs text-muted-foreground">{formatJst(n.sent_at)}</div>
                    <div className="min-w-[100px]">{n.customer_name || '（お名前なし）'}</div>
                    <div className="flex-1 min-w-[160px]">
                      {WAITLIST_NOTIFICATION_LABELS[n.type] || n.type}
                      {n.reservation_date ? <span className="text-muted-foreground">（{formatSlot(n.reservation_date, n.reservation_time || '')} の枠）</span> : null}
                    </div>
                    <Badge variant={n.result === 'success' ? 'secondary' : 'destructive'}>{n.result === 'success' ? '送信済み' : '送信失敗'}</Badge>
                    {n.result === 'failed' && n.error_message && <div className="w-full text-xs text-red-600 break-all">{n.error_message.slice(0, 160)}</div>}
                  </li>
                ))}
              </ul>
            ))}

          <p className="text-xs text-muted-foreground">
            空きの確認は、予約のキャンセル・日時変更の直後と 10 分おきに自動で行います。「今すぐ空きを確認」で、待たずに確認できます。送信履歴は新しい順に 100 件まで表示します。
          </p>
        </CardContent>
      )}
    </Card>
  );
}
