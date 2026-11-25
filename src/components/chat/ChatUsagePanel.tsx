'use client';

/**
 * 1 対 1 トークの利用状況（全店舗）— マスター管理者のページ専用
 * 店舗ごとの、その月と前の月の 受信数・返信数・保存した画像の容量。有料オプションの料金を決める・請求するときの材料。
 * 件数だけを出し、会話の中身は出さない。料金の計算・請求はしない
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';
import { chatUsageMonth, formatBytes, previousUsageMonth, type ChatUsageCounts, type ChatUsageRow } from '@/lib/chat-events';

interface Report {
  month: string;
  previous_month: string;
  rows: ChatUsageRow[];
  totals: ChatUsageCounts;
  unavailable: boolean;
}

const monthLabel = (month: string) => `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月`;
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }) : '—');

export default function ChatUsagePanel() {
  const { toast } = useToast();
  const thisMonth = chatUsageMonth(new Date());
  const [month, setMonth] = useState(thisMonth);
  const [report, setReport] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/master-admin/chat-usage?month=${target}`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(json?.error || 'トークの利用状況の取得に失敗しました');
        return;
      }
      setReport(json);
      setLoadError(null);
    } catch {
      setLoadError('トークの利用状況の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`/api/master-admin/chat-usage?month=${month}&format=csv`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        toast({ title: 'ダウンロードできませんでした', description: 'もう一度お試しください', variant: 'destructive' });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-usage-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'ダウンロードできませんでした', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card data-slot="chat-usage">
      <CardHeader>
        <CardTitle className="text-base">1 対 1 トークの利用状況</CardTitle>
        <CardDescription>
          店舗ごとの、月ごとの利用量です。受信 = お客様が手で書いて送った通数（予約フォームの送信文や「予約確認」などは数えません）、返信 = 店舗がトークの画面から送った通数、画像 = その月に保存した画像の容量です。リマインダーや配信など、自動で送ったメッセージは数えません。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon" onClick={() => setMonth(previousUsageMonth(month))} aria-label="前の月">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="min-w-28 text-center font-medium" data-slot="chat-usage-month">
            {monthLabel(month)}
          </span>
          <Button type="button" variant="outline" size="icon" onClick={() => setMonth(nextMonth(month))} disabled={month >= thisMonth} aria-label="次の月">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={download} disabled={downloading || !report || report.rows.length === 0} data-slot="chat-usage-csv">
            <Download className="mr-1 h-4 w-4" aria-hidden="true" />
            {downloading ? 'ダウンロード中…' : 'CSV でダウンロード'}
          </Button>
        </div>

        {loadError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">{loadError}</p>}
        {report?.unavailable && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">データベースの更新（マイグレーション）がまだ適用されていないため、利用量は数えられていません。</p>}

        {report && (
          <>
            <div className="grid grid-cols-3 gap-2" data-slot="chat-usage-totals">
              {[
                { label: '受信の合計', value: `${report.totals.inbound.toLocaleString()} 通` },
                { label: '返信の合計', value: `${report.totals.outbound.toLocaleString()} 通` },
                { label: '画像の合計', value: formatBytes(report.totals.image_bytes) },
              ].map((t) => (
                <div key={t.label} className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t.label}</p>
                  <p className="mt-1 text-lg font-bold">{t.value}</p>
                </div>
              ))}
            </div>

            {report.rows.length === 0 ? (
              <p className="rounded-md border bg-muted/30 p-6 text-center text-muted-foreground">{loading ? '読み込み中…' : 'トーク機能を使っている店舗は、まだありません。'}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-left text-xs" data-slot="chat-usage-table">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">店舗</th>
                      <th className="px-3 py-2 font-medium">ON にした日</th>
                      <th className="px-3 py-2 text-right font-medium">受信</th>
                      <th className="px-3 py-2 text-right font-medium">返信</th>
                      <th className="px-3 py-2 text-right font-medium">画像</th>
                      <th className="px-3 py-2 text-right font-medium">前の月（受信 / 返信）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={r.store_id} className="border-t">
                        <td className="px-3 py-2">
                          <span className="font-medium">{r.store_name}</span>
                          <span className="ml-2 text-muted-foreground">{r.store_id}</span>
                          <Badge variant="outline" className={`ml-2 text-[10px] ${r.enabled ? 'border-[rgb(55,114,58)]/20 bg-[rgb(209,241,209)] text-[rgb(55,114,58)]' : ''}`}>
                            {r.enabled ? 'ON' : 'OFF'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">{fmtDate(r.enabled_at)}</td>
                        <td className="px-3 py-2 text-right">{r.current.inbound.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{r.current.outbound.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{formatBytes(r.current.image_bytes)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {r.previous.inbound.toLocaleString()} / {r.previous.outbound.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">料金の計算や請求は行いません（数を見るための画面です）。この画面を作る前の月の数は、数えていないので 0 です。</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
