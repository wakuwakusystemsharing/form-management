'use client';

/**
 * 月次レポート（店舗管理者ページのダッシュボード → 「月次レポート」。?tab=dashboard&report=YYYY-MM）
 * 月を切り替えて過去の月も見られる。数字の定義は src/lib/store-digest.ts の computeMonthlyReport
 */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatGrid, StatTile } from '@/components/customers/StatTile';
import { formatChange, monthLabel, yen, type MonthlyReport } from '@/lib/store-digest';

interface ReportPage {
  months: string[];
  report: MonthlyReport;
  current_month: string;
}

function Change({ value }: { value: number | null }) {
  if (value === null) return null;
  const tone = value > 0 ? 'text-emerald-600' : value < 0 ? 'text-destructive' : 'text-muted-foreground';
  return <span className={`ml-1.5 text-[11px] font-medium ${tone}`}>{formatChange(value)}</span>;
}

export default function MonthlyReportView({ storeId, month, onMonthChange, onBack }: { storeId: string; month: string | null; onMonthChange: (month: string) => void; onBack?: () => void }) {
  const [loaded, setLoaded] = useState<{ key: string; page: ReportPage | null; error: string | null } | null>(null);
  const key = `${storeId}:${month ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    const q = month ? `?month=${encodeURIComponent(month)}` : '';
    fetch(`/api/stores/${encodeURIComponent(storeId)}/reports/monthly${q}`, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoaded({ key, page: null, error: json.error || '月次レポートの取得に失敗しました' });
        else setLoaded({ key, page: json as ReportPage, error: null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, page: null, error: '月次レポートの取得に失敗しました（通信エラー）' });
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, month, key]);

  const loading = !loaded || loaded.key !== key;
  // 月を切り替えている間は前の月の内容を薄く出したままにする
  const page = loaded?.page ?? null;
  const error = !loading ? loaded?.error : null;
  const r = page?.report ?? null;
  const months = page?.months ?? [];
  const index = r ? months.indexOf(r.month) : -1;
  const maxMenuCount = r ? Math.max(1, ...r.top_menus.map((m) => m.count)) : 1;

  return (
    <div className="space-y-4 p-4 lg:p-6" data-slot="monthly-report">
      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />ダッシュボードに戻る
          </Button>
        )}
        <h2 className="text-lg font-semibold">月次レポート</h2>
      </div>

      {error && <p className="rounded bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{error}</p>}
      {!r && loading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中…</p>}

      {r && (
        <div className={loading ? 'space-y-4 opacity-60' : 'space-y-4'}>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label="前の月" disabled={index < 0 || index >= months.length - 1} onClick={() => onMonthChange(months[index + 1])}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select value={r.month} onValueChange={onMonthChange}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>{monthLabel(m)}{m === page?.current_month ? '（今月）' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="icon" aria-label="次の月" disabled={index <= 0} onClick={() => onMonthChange(months[index - 1])}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {r.month === page?.current_month && <span className="text-xs text-muted-foreground">今月はまだ途中の数字です（これからの予約も含みます）</span>}
          </div>

          <StatGrid cols={4}>
            <StatTile label="予約数" value={<>{r.reservations}<span className="text-sm font-medium"> 件</span><Change value={r.change.reservations} /></>} />
            <StatTile label="売上" value={<>{yen(r.revenue)}<Change value={r.change.revenue} /></>} />
            <StatTile label="新規のお客様" value={<>{r.new_customers}<span className="text-sm font-medium"> 人</span><span className="ml-1.5 text-[11px] font-medium text-muted-foreground">前月 {r.prev.new_customers} 人</span></>} />
            <StatTile label="リピート率" value={r.repeat_rate === null ? '—' : `${r.repeat_rate}%`} />
            <StatTile label="1 件あたり" value={yen(r.average)} />
            <StatTile label="予約したお客様" value={<>{r.customers}<span className="text-sm font-medium"> 人</span></>} />
            <StatTile label="キャンセル率" value={r.cancel_rate === null ? '—' : `${r.cancel_rate}%`} />
            <StatTile label="キャンセル" value={<>{r.cancelled}<span className="text-sm font-medium"> 件</span></>} />
          </StatGrid>

          <Card className="shadow-sm">
            <CardContent className="space-y-2 p-4">
              <h3 className="text-sm font-semibold">前月（{monthLabel(r.prev.month)}）との比較</h3>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><p className="text-xs text-muted-foreground">予約数</p><p className="tabular-nums">{r.prev.reservations} → <span className="font-semibold">{r.reservations}</span> 件</p></div>
                <div><p className="text-xs text-muted-foreground">売上</p><p className="tabular-nums">{yen(r.prev.revenue)} → <span className="font-semibold">{yen(r.revenue)}</span></p></div>
                <div><p className="text-xs text-muted-foreground">新規のお客様</p><p className="tabular-nums">{r.prev.new_customers} → <span className="font-semibold">{r.new_customers}</span> 人</p></div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="space-y-2 p-4">
              <h3 className="text-sm font-semibold">人気メニュー</h3>
              {r.top_menus.length === 0 ? (
                <p className="text-sm text-muted-foreground">この月の予約はありません。</p>
              ) : (
                <ul className="space-y-2">
                  {r.top_menus.map((m, i) => (
                    <li key={m.name} className="space-y-1 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate">{i + 1}. {m.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{m.count} 件・{yen(m.revenue)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round((m.count / maxMenuCount) * 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="space-y-2 p-4">
              <h3 className="text-sm font-semibold">配信の成果</h3>
              {r.broadcasts ? (
                <div className="space-y-1 text-sm">
                  <p>この月に送った配信 <span className="font-semibold tabular-nums">{r.broadcasts.count}</span> 回（<span className="tabular-nums">{r.broadcasts.sent}</span> 通）</p>
                  <p>タップした人の予約 <span className="font-semibold tabular-nums">{r.broadcasts.tapped_reservations}</span> 件・<span className="font-semibold tabular-nums">{yen(r.broadcasts.tapped_revenue)}</span></p>
                  <p className="text-muted-foreground">受け取った人の予約 <span className="tabular-nums">{r.broadcasts.received_reservations}</span> 件・<span className="tabular-nums">{yen(r.broadcasts.received_revenue)}</span>（参考）</p>
                  <p className="text-[11px] text-muted-foreground">配信ごとに、送信のあと 7 日以内に受け付けた予約を数えています（同じ予約が 2 つの配信に入るときは両方に数えます）。</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">この月に送った配信はありません。</p>
              )}
            </CardContent>
          </Card>

          <p className="text-[11px] leading-5 text-muted-foreground">
            予約日がこの月の予約を数えています（キャンセルは予約数・売上から除きます）。売上は予約のメニュー・オプション・指名料・宿泊料金の合計です。
            新規のお客様 = この月より前に予約が無い人、リピート率 = この月に予約した人のうち、以前にも予約がある人の割合です。
          </p>
        </div>
      )}
    </div>
  );
}
