'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchWithAuth } from '@/lib/client-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChipFilter, ChipTabsList } from '@/components/customers/ChipTabs';
import { StatGrid, StatTile } from '@/components/customers/StatTile';
import { ANALYTICS_PERIOD_OPTIONS, resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from '@/lib/reservation-analytics';
import type { SurveyAnalyticsResult, SurveyCountRow, SurveyQuestionStat } from '@/lib/survey-analytics';

type AnalyticsData = SurveyAnalyticsResult & {
  forms: Array<{ id: string; name: string }>;
  period: { date_from: string | null; date_to: string | null };
  form_id: string | null;
};

interface SurveyAnalyticsProps {
  storeId: string;
  /** 初期の期間（省略時は「過去12か月」） */
  defaultPeriod?: AnalyticsPeriodPreset;
}

const ALL_FORMS = '__all__';

const TYPE_LABELS: Record<string, string> = {
  text: '1 行の入力',
  textarea: '複数行の入力',
  radio: '単一選択',
  checkbox: '複数選択',
  select: 'ドロップダウン',
  date: '日付',
  datetime: '日時',
  birthday: '誕生日',
  address: '住所',
  multiple_dates: '第三希望日時',
  extra: '追加質問など',
};

/** "YYYY-MM-DD" → "M/D" */
function formatDate(dateStr: string) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

/** "YYYY-MM" → "YYYY年M月" */
function formatMonth(monthStr: string) {
  const [year, month] = monthStr.split('-');
  return `${year}年${parseInt(month, 10)}月`;
}

/** ISO 日時 → 日本時間の "YYYY/M/D" */
function formatJstDay(iso: string | null) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function formatPeriodLabel(period: { date_from: string | null; date_to: string | null }) {
  const f = (s: string) => {
    const [y, m, d] = s.split('-');
    return `${y}/${parseInt(m, 10)}/${parseInt(d, 10)}`;
  };
  if (!period.date_from && !period.date_to) return '全期間';
  return `${period.date_from ? f(period.date_from) : ''} 〜 ${period.date_to ? f(period.date_to) : ''}`;
}

const Empty = () => <p className="text-sm text-muted-foreground py-4 text-center">データがありません</p>;

// 横棒チャート: ラベル行とバー + 数値を分け、ラベルが長くても数値が押し出されない
function BarChart<T>({ data, getLabel, getValue, formatValue = (v: number) => String(v) }: { data: T[]; getLabel: (item: T) => string; getValue: (item: T) => number; formatValue?: (v: number, item: T) => string }) {
  if (data.length === 0) return <Empty />;
  const max = Math.max(...data.map(getValue), 1);
  return (
    <div className="space-y-2.5">
      {data.map((item, index) => {
        const value = getValue(item);
        return (
          <div key={index} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <span className="text-sm text-muted-foreground truncate">{getLabel(item)}</span>
            <span className="text-sm font-medium tabular-nums">{formatValue(value, item)}</span>
            <div className="col-span-2 h-2.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, description, children, slot }: { title: string; description?: string; children: React.ReactNode; slot?: string }) {
  return (
    <Card data-slot-name={slot}>
      <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
        <CardTitle className="text-base md:text-lg">{title}</CardTitle>
        {description && <CardDescription className="text-xs md:text-sm">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-4 pt-1 md:p-6 md:pt-0">{children}</CardContent>
    </Card>
  );
}

const countRow = (row: SurveyCountRow) => `${row.count}件（${row.percent}%）`;

/** 質問 1 つぶんの集計 */
function QuestionCard({ stat, index }: { stat: SurveyQuestionStat; index: number | null }) {
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-sm md:text-base break-words min-w-0">{index !== null ? `Q${index + 1}. ` : ''}{stat.title}</span>
      <Badge variant="outline" className="shrink-0 text-[11px]">{TYPE_LABELS[stat.type] ?? stat.type}</Badge>
    </div>
  );
  return (
    <Card data-slot-name="survey-question-stat">
      <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
        {header}
        <CardDescription className="text-xs md:text-sm">回答 {stat.answered} 件（回答率 {stat.answer_rate}%）</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-1 md:p-6 md:pt-0">
        {stat.answered === 0 ? (
          <p className="text-sm text-muted-foreground">この期間の回答はありません</p>
        ) : stat.kind === 'choice' || stat.kind === 'prefecture' ? (
          <BarChart data={stat.rows ?? []} getLabel={(r) => r.label} getValue={(r) => r.count} formatValue={(_, r) => countRow(r)} />
        ) : stat.kind === 'age' ? (
          <div className="space-y-3">
            {stat.average_age !== null && stat.average_age !== undefined && <p className="text-sm">平均 <span className="font-semibold tabular-nums">{stat.average_age}</span> 歳</p>}
            <BarChart data={stat.rows ?? []} getLabel={(r) => r.label} getValue={(r) => r.count} formatValue={(_, r) => countRow(r)} />
          </div>
        ) : stat.kind === 'text' ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">最近の回答（新しい順に {stat.samples?.length ?? 0} 件）</p>
            <ul className="space-y-1.5">
              {(stat.samples ?? []).map((s, i) => (
                <li key={i} className="rounded-md bg-muted/60 px-3 py-2 text-sm break-words whitespace-pre-wrap">
                  {s.text}
                  <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">{formatJstDay(s.submitted_at)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">すべての回答は「回答一覧」で確認できます。</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">この回答タイプは、回答数だけを集計しています。内容は「回答一覧」で確認できます。</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * アンケートの分析（店舗管理者ページ / テナント側 店舗ページ共通）
 * 期間（回答した日）とアンケートで絞り込み、回答数・フォーム別・質問ごとの集計・回答のタイミングを出す
 */
export default function SurveyAnalytics({ storeId, defaultPeriod = 'last_12_months' }: SurveyAnalyticsProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [period, setPeriod] = useState<AnalyticsPeriodPreset>(defaultPeriod);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [formId, setFormId] = useState<string>(ALL_FORMS);

  const range = useMemo(() => {
    if (period === 'custom') return { date_from: customFrom || null, date_to: customTo || null };
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
      const response = await fetchWithAuth(`/api/stores/${storeId}/surveys/analytics${qs ? `?${qs}` : ''}`);
      if (response.ok) {
        setData(await response.json());
      } else {
        const body = await response.json().catch(() => ({}));
        setError(body?.error || '分析データの取得に失敗しました');
      }
    } catch (err) {
      console.error('Failed to fetch survey analytics:', err);
      setError('分析データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [storeId, range.date_from, range.date_to, formId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // 日別は期間が長いと読めないので、直近 31 日分だけ出す
  const dailyRows = useMemo(() => (data ? data.daily.slice(-31) : []), [data]);
  // 時間帯は、回答のあった時間の前後だけ出す
  const hourlyRows = useMemo(() => {
    if (!data) return [];
    const used = data.hourly.filter((h) => h.count > 0).map((h) => h.hour);
    if (used.length === 0) return [];
    return data.hourly.filter((h) => h.hour >= Math.min(...used) && h.hour <= Math.max(...used));
  }, [data]);

  const controls = (
    <div className="space-y-2">
      <ChipFilter ariaLabel="集計期間" items={ANALYTICS_PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} value={period} onChange={setPeriod} />
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3">
        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-2 md:flex md:items-end">
            <div className="space-y-1">
              <Label htmlFor="survey-analytics-date-from" className="text-xs text-muted-foreground">開始日</Label>
              <Input id="survey-analytics-date-from" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="survey-analytics-date-to" className="text-xs text-muted-foreground">終了日</Label>
              <Input id="survey-analytics-date-to" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-9" />
            </div>
          </div>
        )}
        <div className="space-y-1 md:ml-auto md:w-72">
          <Label htmlFor="survey-analytics-form" className="text-xs text-muted-foreground">アンケート</Label>
          <Select value={formId} onValueChange={setFormId}>
            <SelectTrigger id="survey-analytics-form" className="h-9">
              <SelectValue placeholder="すべてのアンケート" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FORMS}>すべてのアンケート</SelectItem>
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

  const { summary } = data;
  const selectedForm = data.forms.find((f) => f.id === formId) ?? null;
  const mainQuestions = (data.questions ?? []).filter((s) => !s.extra);
  const extraQuestions = (data.questions ?? []).filter((s) => s.extra);

  return (
    <div className="space-y-3 md:space-y-4" data-slot-name="survey-analytics" aria-busy={loading}>
      {controls}
      <p className="text-xs text-muted-foreground">
        {formatPeriodLabel(data.period)}（回答した日）・{selectedForm ? selectedForm.name : 'すべてのアンケート'}
        {error && <span className="ml-2 text-destructive">{error}</span>}
      </p>

      <StatGrid cols={4}>
        <StatTile label="回答数" value={summary.total} />
        <StatTile label="回答した人数" value={summary.respondents} />
        <StatTile label="2 回以上答えた人" value={summary.repeat_respondents} />
        <StatTile label="最後の回答" value={formatJstDay(summary.last_submitted_at)} size="md" />
      </StatGrid>
      {(summary.linked_customers !== null || summary.anonymous > 0) && (
        <p className="text-xs text-muted-foreground">
          {summary.linked_customers !== null && <>回答した人のうち、顧客として登録されている人は {summary.linked_customers} 人です。</>}
          {summary.anonymous > 0 && <> LINE の外から答えた回答が {summary.anonymous} 件あります（だれの回答か分からないので、1 件を 1 人として数えています）。</>}
        </p>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <ChipTabsList
          desktopGrid
          className="-mx-4 w-[calc(100%+2rem)] px-4 md:mx-0 md:w-full md:px-1"
          items={[
            { value: 'overview', label: '概要' },
            { value: 'questions', label: '質問ごとの回答' },
            { value: 'timing', label: '回答のタイミング' },
          ]}
        />

        {/* 概要 */}
        <TabsContent value="overview" className="space-y-3 md:space-y-4 mt-3">
          <Section title="アンケートごとの回答数" description="行を押すと、そのアンケートだけの集計に切り替わります" slot="survey-by-form">
            {data.by_form.length === 0 ? (
              <Empty />
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 text-left font-medium">アンケート</th>
                      <th className="py-2 text-right font-medium">回答数</th>
                      <th className="py-2 text-right font-medium">回答した人数</th>
                      <th className="py-2 text-right font-medium">最後の回答</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_form.map((row) => {
                      const exists = data.forms.some((f) => f.id === row.form_id);
                      return (
                        <tr key={row.form_id} className={`border-b last:border-0 ${formId === row.form_id ? 'bg-primary/5' : ''}`}>
                          <td className="py-2 pr-2">
                            {exists ? (
                              <button type="button" className="text-left text-primary underline-offset-2 hover:underline" onClick={() => setFormId(formId === row.form_id ? ALL_FORMS : row.form_id)}>
                                {row.name}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">{row.name}</span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">{row.count}</td>
                          <td className="py-2 text-right tabular-nums">{row.respondents}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{formatJstDay(row.last_submitted_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <div className="grid gap-3 md:gap-4 md:grid-cols-2">
            <Section title="月ごとの回答数">
              <BarChart data={data.monthly} getLabel={(m) => formatMonth(m.month)} getValue={(m) => m.count} formatValue={(v) => `${v}件`} />
            </Section>
            <Section title="日ごとの回答数" description="直近の 31 日ぶん（回答のあった日だけ）">
              <BarChart data={dailyRows} getLabel={(d) => formatDate(d.date)} getValue={(d) => d.count} formatValue={(v) => `${v}件`} />
            </Section>
          </div>
        </TabsContent>

        {/* 質問ごとの回答 */}
        <TabsContent value="questions" className="space-y-3 md:space-y-4 mt-3">
          {!selectedForm ? (
            <Card>
              <CardContent className="space-y-3 p-4 md:p-6" data-slot-name="survey-pick-form">
                <p className="text-sm">質問ごとの集計は、アンケートを 1 つ選ぶと見られます（アンケートによって質問が違うため）。</p>
                {data.forms.length === 0 ? (
                  <p className="text-sm text-muted-foreground">アンケートがまだありません。</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {data.forms.map((f) => (
                      <Button key={f.id} type="button" variant="outline" size="sm" onClick={() => setFormId(f.id)}>
                        {f.name}（{data.by_form.find((r) => r.form_id === f.id)?.count ?? 0}件）
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : summary.total === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">この期間の回答はありません。期間を広げてみてください。</CardContent></Card>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">割合は、その質問に答えた回答を 100% としています。複数選択の質問は、合計が 100% を超えます。</p>
              <div className="grid gap-3 md:gap-4 md:grid-cols-2">
                {mainQuestions.map((stat, i) => <QuestionCard key={`${i}-${stat.title}`} stat={stat} index={i} />)}
              </div>
              {extraQuestions.length > 0 && (
                <>
                  <h4 className="pt-2 text-sm font-semibold text-muted-foreground">そのほかの回答項目（選択肢の追加質問・前に使っていた質問など）</h4>
                  <div className="grid gap-3 md:gap-4 md:grid-cols-2">
                    {extraQuestions.map((stat, i) => <QuestionCard key={`x-${i}-${stat.title}`} stat={stat} index={null} />)}
                  </div>
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* 回答のタイミング */}
        <TabsContent value="timing" className="space-y-3 md:space-y-4 mt-3">
          <div className="grid gap-3 md:gap-4 md:grid-cols-2">
            <Section title="曜日ごとの回答数" description="アンケートを案内する曜日の参考に">
              {summary.total === 0 ? <Empty /> : <BarChart data={data.weekday} getLabel={(w) => `${w.label}曜日`} getValue={(w) => w.count} formatValue={(v) => `${v}件`} />}
            </Section>
            <Section title="時間帯ごとの回答数" description="回答した時刻（日本時間）">
              <BarChart data={hourlyRows} getLabel={(h) => `${h.hour}時台`} getValue={(h) => h.count} formatValue={(v) => `${v}件`} />
            </Section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
