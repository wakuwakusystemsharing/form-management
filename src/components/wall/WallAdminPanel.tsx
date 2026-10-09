'use client';

/**
 * 寄せ書きウォール: 管理画面のタブ本体（店舗管理者ページ / テナント側 店舗ページで共通）
 * 上から 件数 → ボードの一覧カード（フォーム一覧と同じ見た目。「編集」でタブ付きの設定モーダル）→ お題 → 見どころまとめ → 付箋の確認（既定で開いている。縦の列に並ぶ）
 */
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import StoreAdminGuide, { GuideHint } from '@/components/StoreAdminGuide';
import { STORE_ADMIN_HINTS } from '@/lib/store-admin-guide';
import WallPostList from './WallPostList';
import WallSettingsEditor from './WallSettingsEditor';
import WallBoardCard from './WallBoardCard';
import WallTopicsCard from './WallTopicsCard';
import WallInsightsCard from './WallInsightsCard';
import type { WallBoardSettings, WallStats } from '@/types/wall';

export default function WallAdminPanel({ storeId, showGuide = true }: { storeId: string; showGuide?: boolean }) {
  const [stats, setStats] = useState<WallStats | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [postsOpen, setPostsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [postSearch, setPostSearch] = useState('');
  const [settings, setSettings] = useState<WallBoardSettings | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/settings`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled && json?.settings) setSettings(json.settings); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [storeId, refreshKey]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'コピーしました' });
    } catch {
      toast({ title: 'コピーできませんでした', variant: 'destructive' });
    }
  };

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
          寄せ書きは現在「非公開」です。下のカードの「編集」→「基本情報」で公開できます。
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
        <h3 className="text-sm font-semibold text-muted-foreground">ボード</h3>
        <WallBoardCard storeId={storeId} settings={settings} stats={stats} onEdit={() => setSettingsOpen(true)} onCopy={copy} />
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent
          className="store-admin-bg flex max-h-[90vh] w-full max-w-5xl flex-col p-0 sm:max-h-[90vh]"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="border-b px-6 pb-4 pt-6">
            <DialogTitle className="text-2xl">{settings?.theme.title || 'みんなの寄せ書き'} 編集</DialogTitle>
            <DialogDescription>公開するかどうか、受付ルール、見た目、NGワードをタブごとに設定します。「保存」を押すとすぐお客様の画面に反映されます。</DialogDescription>
          </DialogHeader>
          <WallSettingsEditor storeId={storeId} onSaved={(s) => { setSettings(s); setRefreshKey((k) => k + 1); setSettingsOpen(false); }} />
        </DialogContent>
      </Dialog>
      <WallTopicsCard storeId={storeId} onChanged={() => setRefreshKey((k) => k + 1)} />
      <WallInsightsCard storeId={storeId} refreshKey={refreshKey} onPickWord={(w) => { setPostSearch(w); setPostsOpen(true); }} />

      <div className="space-y-3 border-t pt-5">
        <Button
          type="button"
          variant={postsOpen ? 'secondary' : 'default'}
          className="w-full justify-between sm:w-auto sm:min-w-64"
          aria-expanded={postsOpen}
          aria-controls="wall-post-list"
          onClick={() => setPostsOpen((o) => !o)}
        >
          <span>
            付箋の確認
            {stats && stats.pending + stats.review > 0 && (
              <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">要確認 {stats.pending + stats.review}</span>
            )}
          </span>
          {postsOpen ? <ChevronUp /> : <ChevronDown />}
        </Button>
        {postsOpen && (
          <div id="wall-post-list" className="space-y-3">
            <GuideHint text={STORE_ADMIN_HINTS.wallPosts} />
            <WallPostList storeId={storeId} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} search={postSearch} onSearchChange={setPostSearch} />
          </div>
        )}
      </div>
    </div>
  );
}
