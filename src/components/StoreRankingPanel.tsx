'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWithAuth } from '@/lib/client-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChipFilter } from '@/components/customers/ChipTabs';
import { StatGrid, StatTile } from '@/components/customers/StatTile';
import { ANALYTICS_PERIOD_OPTIONS, resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from '@/lib/reservation-analytics';
import {
  RANKING_METRICS,
  formatRankingValue,
  rankRows,
  type RankingMetric,
  type StoreRankingRow,
} from '@/lib/store-ranking';
import { Trophy } from 'lucide-react';

/** ランキングで使う期間チップ（「期間指定」は使わない） */
type RankingPeriodPreset = Exclude<AnalyticsPeriodPreset, 'custom'>;
const PERIOD_ITEMS = ANALYTICS_PERIOD_OPTIONS.filter((o): o is { value: RankingPeriodPreset; label: string } => o.value !== 'custom');
const TOP_N = 10;

interface StoreRankingPanelProps {
  /** ランキングから外す店舗 ID（全予約一覧の「テスト店舗の非表示」） */
  hiddenStoreIds?: string[];
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'bg-amber-400 text-amber-950';
  if (rank === 2) return 'bg-slate-300 text-slate-900';
  if (rank === 3) return 'bg-orange-300 text-orange-950';
  return 'bg-muted text-muted-foreground';
}

function RankingCard({ metric, rows }: { metric: RankingMetric; rows: StoreRankingRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const ranked = useMemo(() => rankRows(rows, metric.key), [rows, metric.key]);
  const visible = showAll ? ranked : ranked.slice(0, TOP_N);
  // バーの長さは最大値（低い順の指標は最大値 = いちばん悪い値）に対する割合
  const maxValue = ranked.reduce((m, r) => Math.max(m, r.value), 0);

  return (
    <Card data-slot="card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          {metric.label}
        </CardTitle>
        <CardDescription className="text-xs">
          {metric.description}
          {!metric.periodic && '。期間の切替は影響しません'}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {ranked.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">対象の店舗がありません</p>
        ) : (
          <ol className="space-y-1.5">
            {visible.map(({ rank, row, value }) => {
              const ratio = maxValue > 0 ? Math.max(0, Math.min(1, value / maxValue)) : 0;
              return (
                <li key={row.store_id} data-slot="list-item" className="relative overflow-hidden rounded-md">
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/10"
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                    aria-hidden="true"
                  />
                  <div className="relative flex items-center gap-3 px-2 py-1.5">
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rankBadgeClass(rank)}`}>
                      {rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{row.store_name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{formatRankingValue(metric.key, value)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {ranked.length > TOP_N && (
          <div className="mt-3 flex justify-center">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '上位 10 件だけ表示' : `すべて表示（${ranked.length} 店舗）`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 全店舗ランキング（全予約一覧 → ランキングタブ）。
 * 予約数 / 売上 / アンケート回答数 / LINE 友だち追加率 / キャンセル率 を店舗ごとに順位付けして表示する。
 */
export default function StoreRankingPanel({ hiddenStoreIds = [] }: StoreRankingPanelProps) {
  const [period, setPeriod] = useState<RankingPeriodPreset>('this_month');
  const [rows, setRows] = useState<StoreRankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRanking = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = resolveAnalyticsPeriod(period);
      const params = new URLSearchParams();
      if (range) {
        params.set('date_from', range.date_from);
        params.set('date_to', range.date_to);
      }
      const qs = params.toString();
      const res = await fetchWithAuth(`/api/stores/ranking${qs ? `?${qs}` : ''}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'ランキングの取得に失敗しました');
      }
      const json = await res.json();
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ランキングの取得に失敗しました');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchRanking();
  }, [fetchRanking]);

  const hidden = useMemo(() => new Set(hiddenStoreIds), [hiddenStoreIds]);
  const visibleRows = useMemo(() => rows.filter((r) => !hidden.has(r.store_id)), [rows, hidden]);
  const totals = useMemo(
    () =>
      visibleRows.reduce(
        (acc, r) => ({
          reservations: acc.reservations + r.reservations,
          sales: acc.sales + r.sales,
          surveys: acc.surveys + r.survey_responses,
        }),
        { reservations: 0, sales: 0, surveys: 0 }
      ),
    [visibleRows]
  );

  return (
    <div className="space-y-4">
      <ChipFilter ariaLabel="集計期間" items={PERIOD_ITEMS} value={period} onChange={setPeriod} />

      {error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <div data-slot="loading" className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
            集計中...
          </CardContent>
        </Card>
      ) : (
        <>
          <StatGrid cols={4}>
            <StatTile label="対象店舗" value={`${visibleRows.length}店舗`} />
            <StatTile label="予約数（合計）" value={formatRankingValue('reservations', totals.reservations)} />
            <StatTile label="売上（合計）" value={formatRankingValue('sales', totals.sales)} size="md" />
            <StatTile label="アンケート回答（合計）" value={formatRankingValue('survey_responses', totals.surveys)} />
          </StatGrid>
          {hiddenStoreIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              予約一覧タブで非表示にしている {hiddenStoreIds.length} 店舗はランキングから除いています
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {RANKING_METRICS.map((metric) => (
              <RankingCard key={metric.key} metric={metric} rows={visibleRows} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
