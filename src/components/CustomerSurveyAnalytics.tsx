'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/client-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatGrid, StatTile } from '@/components/customers/StatTile';
import type { CustomerSurveyStats } from '@/lib/survey-analytics';

type Data = CustomerSurveyStats & { total_responses: number; form_count: number };

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

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

function RateBar({ label, value, total, rate }: { label: string; value: number; total?: number; rate: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
      <span className="text-sm text-muted-foreground truncate">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}人{total !== undefined ? ` / ${total}人` : ''}（{rate}%）</span>
      <div className="col-span-2 h-2.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
      </div>
    </div>
  );
}

/**
 * 顧客分析の「アンケート」タブ。
 * 顧客のうちアンケートに答えた人の数、セグメントごとの回答率、答えた人 / 答えていない人の来店の違い
 */
export default function CustomerSurveyAnalytics({ storeId }: { storeId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/customers/survey-analytics`);
      if (res.ok) setData(await res.json());
      else setError((await res.json().catch(() => ({})))?.error || 'アンケートの分析データの取得に失敗しました');
    } catch (e) {
      console.error('Failed to fetch customer survey analytics:', e);
      setError('アンケートの分析データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <StatGrid cols={4}>
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[4.25rem] rounded-lg bg-muted animate-pulse" />)}
        </StatGrid>
        <div className="h-40 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }
  if (!data) return <p className="py-8 text-center text-sm text-muted-foreground">{error || 'データが見つかりませんでした'}</p>;

  if (data.total_responses === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground" data-slot-name="customer-survey-empty">
          {data.form_count === 0 ? 'アンケートがまだありません。' : 'アンケートの回答がまだありません。'}
        </CardContent>
      </Card>
    );
  }

  const { compare } = data;
  return (
    <div className="space-y-3 md:space-y-4" data-slot-name="customer-survey-analytics">
      <StatGrid cols={4}>
        <StatTile label="回答した顧客" value={`${data.responded}人`} />
        <StatTile label="回答率" value={data.response_rate === null ? '—' : `${data.response_rate}%`} />
        <StatTile label="LINE 連携の顧客" value={`${data.line_linked}人`} />
        <StatTile label="未登録の回答者" value={`${data.unregistered_respondents}人`} />
      </StatGrid>
      <p className="text-xs text-muted-foreground">
        回答と顧客は LINE で結び付けるので、回答率は「LINE と連携している顧客のうち、アンケートに 1 回でも答えた人」の割合です。
        未登録の回答者は、アンケートには答えたものの、顧客として登録されていない人です。
      </p>

      <div className="grid gap-3 md:gap-4 md:grid-cols-2">
        <Section title="アンケートごとの回答した顧客" description="そのアンケートに答えた顧客の人数（LINE 連携の顧客に対する割合）">
          {data.by_form.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">顧客として登録されている回答者がまだ居ません</p>
          ) : (
            <div className="space-y-2.5">
              {data.by_form.map((f) => <RateBar key={f.form_id} label={f.name} value={f.customers} rate={f.rate} />)}
            </div>
          )}
        </Section>
        <Section title="セグメントごとの回答率" description="どの層のお客様がアンケートに答えているか">
          <div className="space-y-2.5">
            {data.by_segment.map((s) => <RateBar key={s.segment} label={s.label} value={s.responded} total={s.customers} rate={s.rate} />)}
          </div>
        </Section>
      </div>

      <Section title="回答した人と、していない人の違い" description="LINE と連携している顧客を、アンケートに答えたかどうかで分けた平均です">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-slot-name="customer-survey-compare">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left font-medium" />
                <th className="py-2 text-right font-medium">人数</th>
                <th className="py-2 text-right font-medium">平均の来店回数</th>
                <th className="py-2 text-right font-medium">平均の利用額</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: '回答した人', row: compare.responded },
                { label: '回答していない人', row: compare.not_responded },
              ].map(({ label, row }) => (
                <tr key={label} className="border-b last:border-0">
                  <td className="py-2">{label}</td>
                  <td className="py-2 text-right tabular-nums">{row.customers}人</td>
                  <td className="py-2 text-right tabular-nums">{row.customers > 0 ? `${row.avg_visits}回` : '—'}</td>
                  <td className="py-2 text-right tabular-nums">{row.customers > 0 ? yen.format(row.avg_spent) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">アンケートに答えたから来店が増えた、という意味ではありません（よく来店する人ほど答えやすい、ということもあります）。目安として見てください。</p>
      </Section>
    </div>
  );
}
