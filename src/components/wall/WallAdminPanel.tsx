'use client';

/**
 * 寄せ書きウォール: 管理画面のタブ本体（店舗管理者ページ / テナント側 店舗ページで共通）
 * 上から 件数 → 付箋の確認 → ボードの設定
 */
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import StoreAdminGuide, { GuideHint } from '@/components/StoreAdminGuide';
import { STORE_ADMIN_HINTS } from '@/lib/store-admin-guide';
import WallPostList from './WallPostList';
import WallSettingsCard from './WallSettingsCard';
import type { WallStats } from '@/types/wall';

export default function WallAdminPanel({ storeId, showGuide = true }: { storeId: string; showGuide?: boolean }) {
  const [stats, setStats] = useState<WallStats | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/stats`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled && json?.stats) setStats(json.stats); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [storeId, refreshKey]);

  const tiles = [
    { label: '直近7日の投稿', value: stats?.week_posts, title: '直近 7 日間に貼られた付箋の数' },
    { label: '承認待ち', value: stats?.pending, title: '承認制、または NG ワードを含むため表示を止めている付箋' },
    { label: '通報で確認待ち', value: stats?.review, title: '通報が 3 件に達してボードから外れている付箋' },
  ];

  return (
    <div className="space-y-5">
      {showGuide && <StoreAdminGuide tab="walls" />}
      {stats && !stats.enabled && (
        <p className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
          寄せ書きは現在「非公開」です。下の「ボードの設定」で公開できます。
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Card key={t.label} className="shadow-sm">
            <CardContent className="p-4">
              <p className="mb-1 text-xs font-medium text-muted-foreground" title={t.title}>{t.label}</p>
              <div className={`text-2xl font-bold ${t.label !== '直近7日の投稿' && (t.value ?? 0) > 0 ? 'text-orange-600' : 'text-[rgb(55,114,58)]'}`}>{t.value ?? '-'}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">付箋の確認</h3>
        <GuideHint text={STORE_ADMIN_HINTS.wallPosts} />
        <WallPostList storeId={storeId} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
      </div>

      <div className="border-t pt-5">
        <WallSettingsCard storeId={storeId} onSaved={() => setRefreshKey((k) => k + 1)} />
      </div>
    </div>
  );
}
