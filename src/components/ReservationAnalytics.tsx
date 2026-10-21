'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchWithAuth } from '@/lib/client-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChipFilter, ChipTabsList } from '@/components/customers/ChipTabs';
import { StatGrid, StatTile } from '@/components/customers/StatTile';
import {
  ANALYTICS_PERIOD_OPTIONS,
  resolveAnalyticsPeriod,
  type AnalyticsFormInfo,
  type AnalyticsPeriodPreset,
  type ReservationAnalyticsResult,
} from '@/lib/reservation-analytics';

type AnalyticsData = ReservationAnalyticsResult & {
  forms: AnalyticsFormInfo[];
  period: { date_from: string | null; date_to: string | null };
  form_id: string | null;
};

interface ReservationAnalyticsProps {
  storeId: string;
  /** 初期の期間（省略時は「過去12か月」） */
  defaultPeriod?: AnalyticsPeriodPreset;
}

const ALL_FORMS = '__all__';

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

const STATUS_LABELS: Record<string, string> = {
  pending: '保留中',
  confirmed: '確認済み',
  cancelled: 'キャンセル',
  completed: '完了',
};

/** "YYYY-MM-DD" → "M/D"（タイムゾーンに影響されないよう文字列で処理） */
function formatDate(dateStr: string) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

/** "YYYY-MM" → "YYYY年M月" */
function formatMonth(monthStr: string) {
  const [year, month] = monthStr.split('-');
  return `${year}年${parseInt(month, 10)}月`;
}

function formatPeriodLabel(period: { date_from: string | null; date_to: string | null }) {
  const f = (s: string) => {
    const [y, m, d] = s.split('-');
    return `${y}/${parseInt(m, 10)}/${parseInt(d, 10)}`;
  };
  if (!period.date_from && !period.date_to) return '全期間';
  return `${period.date_from ? f(period.date_from) : ''} 〜 ${period.date_to ? f(period.date_to) : ''}`;
}

// 横棒チャート: ラベル行とバー + 数値を分け、ラベルが長くても数値が押し出されない
const BarChart = <T,>({
  data,
  getLabel,
  getValue,
  formatValue = (v: number) => String(v),
  maxValue,
}: {
  data: T[];
  getLabel: (item: T) => string;
  getValue: (item: T) => number;
  formatValue?: (v: number) => string;
  maxValue?: number;
}) => {
  if (data.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>;
  const max = maxValue || Math.max(...data.map(getValue), 1);
  return (
    <div className="space-y-2.5">
      {data.map((item, index) => {
        const value = getValue(item);
        const percentage = Math.max(0, Math.min(100, (value / max) * 100));
        return (
          <div key={index} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <span className="text-sm text-muted-foreground truncate">{getLabel(item)}</span>
            <span className="text-sm font-medium tabular-nums">{formatValue(value)}</span>
            <div className="col-span-2 h-2.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** ラベル + 件数（人数）の簡易リスト（顧客属性用） */
function CountList({ counts, unit }: { counts: Record<string, number>; unit: string }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>;
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="space-y-3">
      {entries.map(([label, count]) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <span className="text-sm truncate">{label}</span>
          <span className="shrink-0 flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">{total > 0 ? Math.round((count / total) * 100) : 0}%</span>
            <Badge variant="secondary">{count}{unit}</Badge>
          </span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
        <CardTitle className="text-base md:text-lg">{title}</CardTitle>
        {description && <CardDescription className="text-xs md:text-sm">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-4 pt-1 md:p-6 md:pt-0">{children}</CardContent>
    </Card>
  );
}

/** フォーム別の予約数・売上の一覧（概要 / 売上分析で共用） */
function FormBreakdownTable({ rows, selectedFormId, onSelect }: { rows: AnalyticsData['by_form']; selectedFormId: string; onSelect: (formId: string) => void }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const totalCancelled = rows.reduce((s, r) => s + r.cancelled, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground border-b">
            <th className="text-left font-medium py-2 pr-2">フォーム</th>
            <th className="text-right font-medium py-2 px-2 whitespace-nowrap">予約数</th>
            <th className="text-right font-medium py-2 px-2 whitespace-nowrap">キャンセル</th>
            <th className="text-right font-medium py-2 pl-2 whitespace-nowrap">売上</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const active = selectedFormId === r.form_id;
            const selectable = !!r.form_id;
            return (
              <tr key={r.form_id || '__none__'} className={active ? 'bg-primary/5' : ''}>
                <td className="py-2 pr-2 min-w-0">
                  {selectable ? (
                    <button
                      type="button"
                      onClick={() => onSelect(active ? ALL_FORMS : r.form_id)}
                      className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      aria-pressed={active}
                      title={active ? '絞り込みを解除' : 'このフォームだけで集計'}
                    >
                      {r.form_name}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{r.form_name}</span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">{total > 0 ? Math.round((r.count / total) * 100) : 0}%</span>
                </td>
                <td className="text-right py-2 px-2 tabular-nums">{r.count}</td>
                <td className="text-right py-2 px-2 tabular-nums text-muted-foreground">{r.cancelled}</td>
                <td className="text-right py-2 pl-2 tabular-nums font-medium whitespace-nowrap">{yen.format(r.revenue)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t text-xs text-muted-foreground">
            <td className="py-2 pr-2">合計</td>
            <td className="text-right py-2 px-2 tabular-nums">{total}</td>
            <td className="text-right py-2 px-2 tabular-nums">{totalCancelled}</td>
            <td className="text-right py-2 pl-2 tabular-nums whitespace-nowrap">{yen.format(totalRevenue)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function ReservationAnalytics({ storeId, defaultPeriod = 'last_12_months' }: ReservationAnalyticsProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [period, setPeriod] = useState<AnalyticsPeriodPreset>(defaultPeriod);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [formId, setFormId] = useState<string>(ALL_FORMS);

  // 期間指定は from / to が両方そろうか、片方だけでも日付として有効なら送る
  const range = useMemo(() => {
    if (period === 'custom') {
      return { date_from: customFrom || null, date_to: customTo || null };
    }
    const r = resolveAnalyticsPeriod(period);
    return r ? { date_from: r.date_from, date_to: r.date_to } : { date_from: null, date_to: null };
  }, [period, customFrom, customTo]);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (range.date_from) params.set('date_from', range.date_from);
      if (range.date_to) params.set('date_to', range.date_to);
      if (formId !== ALL_FORMS) params.set('form_id', formId);
      const qs = params.toString();
      const response = await fetchWithAuth(`/api/stores/${storeId}/reservations/analytics${qs ? `?${qs}` : ''}`);
      if (response.ok) {
        setData(await response.json());
      } else {
        const body = await response.json().catch(() => ({}));
        setError(body?.error || '分析データの取得に失敗しました');
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError('分析データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [storeId, range.date_from, range.date_to, formId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // 日別は期間が長いと読めないので、直近 31 日分だけ出す
  const dailyRows = useMemo(() => (data ? data.daily_stats.slice(-31) : []), [data]);

  const controls = (
    <div className="space-y-2">
      <ChipFilter
        ariaLabel="集計期間"
        items={ANALYTICS_PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={period}
        onChange={setPeriod}
      />
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3">
        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-2 md:flex md:items-end">
            <div className="space-y-1">
              <Label htmlFor="analytics-date-from" className="text-xs text-muted-foreground">開始日</Label>
              <Input id="analytics-date-from" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="analytics-date-to" className="text-xs text-muted-foreground">終了日</Label>
              <Input id="analytics-date-to" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-9" />
            </div>
          </div>
        )}
        <div className="space-y-1 md:ml-auto md:w-72">
          <Label htmlFor="analytics-form" className="text-xs text-muted-foreground">フォーム</Label>
          <Select value={formId} onValueChange={setFormId}>
            <SelectTrigger id="analytics-form" className="h-9">
              <SelectValue placeholder="すべてのフォーム" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FORMS}>すべてのフォーム</SelectItem>
              {(data?.forms || []).map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true">
        {controls}
        <StatGrid cols={4}>
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[4.25rem] rounded-lg bg-muted animate-pulse" />)}
        </StatGrid>
        <div className="h-48 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        {controls}
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">{error || '分析データの取得に失敗しました'}</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedFormName = formId !== ALL_FORMS ? data.forms.find((f) => f.id === formId)?.name : null;
  const scopeLabel = `${formatPeriodLabel(data.period)}${selectedFormName ? ` / ${selectedFormName}` : ''}`;

  return (
    <div className={`space-y-3 md:space-y-4 ${loading ? 'opacity-60 transition-opacity' : ''}`} aria-busy={loading || undefined}>
      {controls}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <StatGrid cols={4}>
        <StatTile label="予約数" value={<>{data.summary.total}<span className="text-sm font-medium ml-0.5">件</span></>} />
        <StatTile label="キャンセル" value={<>{data.summary.cancelled}<span className="text-sm font-medium ml-0.5">件</span></>} />
        <StatTile label="売上" value={yen.format(data.summary.total_revenue)} size="md" />
        <StatTile label="1件あたり" value={yen.format(data.summary.average_revenue)} size="md" />
      </StatGrid>
      <p className="text-xs text-muted-foreground px-1">
        集計対象: {scopeLabel}。キャンセル済みの予約は予約数・メニュー・時間帯・売上に含めません（ステータス別集計のみ）。売上はメニュー料金とオプション料金の合計です
      </p>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <ChipTabsList
          desktopGrid
          className="-mx-4 w-[calc(100%+2rem)] px-4 md:mx-0 md:w-full md:px-1"
          items={[
            { value: 'overview', label: '概要' },
            { value: 'menus', label: 'メニュー分析' },
            { value: 'time', label: '時間帯分析' },
            { value: 'customers', label: '顧客属性' },
            { value: 'revenue', label: '売上分析' },
          ]}
        />

        {/* 概要 */}
        <TabsContent value="overview" className="space-y-3 md:space-y-4 mt-3">
          <div className="grid gap-3 md:gap-4 md:grid-cols-2">
            <Section title="フォーム別の予約数" description="フォーム名をタップするとそのフォームだけで集計します（絞り込み中でも全フォームを表示）">
              <FormBreakdownTable rows={data.by_form} selectedFormId={formId} onSelect={setFormId} />
            </Section>
            <Section title="ステータス別集計" description="キャンセルを含む件数">
              {Object.keys(data.status_distribution).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(data.status_distribution).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <span className="text-sm">{STATUS_LABELS[status] || status}</span>
                      <Badge variant="secondary">{count}件</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>
              )}
            </Section>
            <Section title="日別予約数" description={data.daily_stats.length > dailyRows.length ? '予約のあった日の直近 31 日分' : '予約のあった日'}>
              <BarChart data={dailyRows} getLabel={(item) => formatDate(item.date)} getValue={(item) => item.count} />
            </Section>
            <Section title="月別予約数">
              <BarChart data={data.monthly_stats} getLabel={(item) => formatMonth(item.month)} getValue={(item) => item.count} />
            </Section>
          </div>
        </TabsContent>

        {/* メニュー分析 */}
        <TabsContent value="menus" className="space-y-3 md:space-y-4 mt-3">
          <div className="grid gap-3 md:gap-4 md:grid-cols-2">
            <Section title="メニュー別人気度（予約数）" description="上位 10 件。サブメニューは「メニュー > サブメニュー」で表示">
              <BarChart
                data={data.menu_popularity.slice(0, 10)}
                getLabel={(item) => `${item.category_name ? item.category_name + ' > ' : ''}${item.menu_name}`}
                getValue={(item) => item.count}
              />
            </Section>
            <Section title="オプション別人気度（選択数）" description="上位 10 件">
              <BarChart data={data.option_popularity.slice(0, 10)} getLabel={(item) => item.option_name} getValue={(item) => item.count} />
            </Section>
            <Section title="メニュー別売上" description="メニュー（サブメニュー）料金の合計。オプション料金は含みません">
              <BarChart data={data.revenue_analysis.by_menu.slice(0, 10)} getLabel={(item) => item.menu_name} getValue={(item) => item.revenue} formatValue={(v) => yen.format(v)} />
            </Section>
            <Section title="オプション別売上">
              <BarChart
                data={[...data.option_popularity].sort((a, b) => b.revenue - a.revenue).slice(0, 10)}
                getLabel={(item) => item.option_name}
                getValue={(item) => item.revenue}
                formatValue={(v) => yen.format(v)}
              />
            </Section>
          </div>
        </TabsContent>

        {/* 時間帯分析 */}
        <TabsContent value="time" className="space-y-3 md:space-y-4 mt-3">
          <Section title="時間帯別予約分布" description="予約開始時刻を 1 時間ごとにまとめた件数">
            <BarChart data={data.time_slot_distribution} getLabel={(item) => `${item.time}〜`} getValue={(item) => item.count} />
          </Section>
        </TabsContent>

        {/* 顧客属性 */}
        <TabsContent value="customers" className="space-y-3 md:space-y-4 mt-3">
          <p className="text-xs text-muted-foreground px-1">予約フォームで選択された内容の集計です（フォームで項目を表示していない予約は数えません）</p>
          <div className="grid gap-3 md:gap-4 md:grid-cols-3">
            <Section title="性別">
              <CountList counts={data.customer_demographics.gender} unit="件" />
            </Section>
            <Section title="ご来店回数">
              <CountList counts={data.customer_demographics.visit_count} unit="件" />
            </Section>
            <Section title="クーポン利用">
              <CountList counts={data.customer_demographics.coupon_usage} unit="件" />
            </Section>
          </div>
        </TabsContent>

        {/* 売上分析 */}
        <TabsContent value="revenue" className="space-y-3 md:space-y-4 mt-3">
          <StatGrid cols={3}>
            <StatTile label="売上合計" value={yen.format(data.revenue_analysis.total_revenue)} size="md" />
            <StatTile label="1件あたり" value={yen.format(data.summary.average_revenue)} size="md" />
            <StatTile label="メニュー種類" value={<>{data.revenue_analysis.by_menu.length}<span className="text-sm font-medium ml-0.5">種類</span></>} />
          </StatGrid>
          <div className="grid gap-3 md:gap-4 md:grid-cols-2">
            <Section title="月別売上">
              <BarChart data={data.revenue_analysis.by_month} getLabel={(item) => formatMonth(item.month)} getValue={(item) => item.revenue} formatValue={(v) => yen.format(v)} />
            </Section>
            <Section title="フォーム別売上">
              <FormBreakdownTable rows={data.by_form} selectedFormId={formId} onSelect={setFormId} />
            </Section>
            <Section title="メニュー別売上（トップ10）" description="メニュー（サブメニュー）料金の合計">
              <BarChart data={data.revenue_analysis.by_menu.slice(0, 10)} getLabel={(item) => item.menu_name} getValue={(item) => item.revenue} formatValue={(v) => yen.format(v)} />
            </Section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
