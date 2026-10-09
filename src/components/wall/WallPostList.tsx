'use client';

/**
 * 寄せ書きウォール: 店舗管理の付箋一覧（公開 / 非公開の切り替え）
 * 投稿者の情報は API が返さないため、ここにも出さない。非公開の理由は「規約違反」のみ
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { ChipFilter } from '@/components/customers/ChipTabs';
import { WALL_REPORT_REASONS } from '@/lib/wall-rules';
import type { WallAdminPost, WallPostStatus } from '@/types/wall';

type Filter = 'all' | 'pending' | 'review' | 'reported' | 'published' | 'hidden' | 'deleted';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'pending', label: '承認待ち' },
  { value: 'review', label: '通報で確認待ち' },
  { value: 'reported', label: '通報あり' },
  { value: 'published', label: '公開中' },
  { value: 'hidden', label: '非公開' },
  { value: 'deleted', label: '本人が削除' },
];

const STATUS_LABEL: Record<WallPostStatus, { label: string; className: string }> = {
  published: { label: '公開中', className: 'bg-[rgb(209,241,209)] text-[rgb(55,114,58)]' },
  pending: { label: '承認待ち', className: 'bg-yellow-100 text-yellow-800' },
  review: { label: '通報で確認待ち', className: 'bg-orange-100 text-orange-800' },
  hidden: { label: '非公開（規約違反）', className: 'bg-gray-200 text-gray-700' },
  deleted: { label: '本人が削除', className: 'bg-gray-100 text-gray-500' },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function WallPostList({ storeId, refreshKey = 0, onChanged }: { storeId: string; refreshKey?: number; onChanged?: () => void }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [posts, setPosts] = useState<WallAdminPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hideTarget, setHideTarget] = useState<WallAdminPost | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ filter });
      if (cursor) q.set('cursor', cursor);
      const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/posts?${q.toString()}`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: '付箋の取得に失敗しました', description: json.error, variant: 'destructive' });
        return;
      }
      setPosts((prev) => (cursor ? [...prev, ...json.posts] : json.posts));
      setNextCursor(json.next_cursor ?? null);
    } catch {
      toast({ title: '付箋の取得に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, filter, toast]);

  useEffect(() => { load(null); }, [load, refreshKey]);

  const moderate = async (post: WallAdminPost, action: 'publish' | 'hide') => {
    setBusyId(post.id);
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/posts/${encodeURIComponent(post.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'hide' ? { action, reason: 'terms_violation' } : { action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: '更新に失敗しました', description: json.error, variant: 'destructive' });
        return;
      }
      const updated = json.post as WallAdminPost;
      setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast({ title: action === 'publish' ? 'ボードに公開しました' : '非公開にしました' });
      onChanged?.();
    } catch {
      toast({ title: '更新に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setBusyId(null);
      setHideTarget(null);
    }
  };

  return (
    <div className="space-y-3">
      <ChipFilter items={FILTERS} value={filter} onChange={setFilter} ariaLabel="付箋の絞り込み" />

      {!loading && posts.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">該当する付箋はありません</p>
      )}

      <ul className="space-y-2">
        {posts.map((p) => {
          const st = STATUS_LABEL[p.status];
          const reasons = WALL_REPORT_REASONS.filter((r) => (p.report_reasons?.[r.id] ?? 0) > 0);
          return (
            <li key={p.id} data-slot="list-item" className="rounded-lg border bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">No.{p.no}</span>
                <span>{formatDateTime(p.created_at)}</span>
                <Badge data-slot="status-chip" className={`${st.className} border-0 font-medium`}>{st.label}</Badge>
                {p.status === 'pending' && p.pending_reason === 'ng_word' && (
                  <Badge variant="outline" className="border-red-300 text-red-700">NGワード: {p.ng_hits.join('、')}</Badge>
                )}
                {p.report_count > 0 && (
                  <Badge variant="outline" className="border-orange-300 text-orange-700">
                    通報 {p.report_count} 件{reasons.length > 0 && `（${reasons.map((r) => `${r.label} ${p.report_reasons[r.id]}`).join(' / ')}）`}
                  </Badge>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {p.body ?? <span className="text-muted-foreground">（投稿者が削除したため本文は表示しません）</span>}
              </p>
              {p.status !== 'deleted' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.status !== 'published' && (
                    <Button size="sm" onClick={() => moderate(p, 'publish')} disabled={busyId === p.id}>
                      {p.status === 'hidden' ? '再公開する' : 'ボードに公開する'}
                    </Button>
                  )}
                  {p.status !== 'hidden' && (
                    <Button size="sm" variant="outline" onClick={() => setHideTarget(p)} disabled={busyId === p.id}>
                      非公開にする
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {loading && <p className="py-4 text-center text-sm text-muted-foreground"><span data-slot="loading" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent align-middle" /> 読み込み中…</p>}
      {!loading && nextCursor && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => load(nextCursor)}>さらに読み込む</Button>
        </div>
      )}

      <Dialog open={!!hideTarget} onOpenChange={(o) => { if (!o) setHideTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>この付箋を非公開にしますか？</DialogTitle>
            <DialogDescription>
              非公開にできるのは、誹謗中傷・個人情報・宣伝など<strong>規約に違反する投稿</strong>だけです。お店にとって厳しい感想（低評価）だけを理由に非公開にすることはできません。
            </DialogDescription>
          </DialogHeader>
          {hideTarget?.body && <p className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap break-words">{hideTarget.body}</p>}
          <p className="text-sm">理由: <strong>規約違反</strong></p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setHideTarget(null)}>やめる</Button>
            <Button variant="destructive" disabled={!hideTarget || busyId === hideTarget.id} onClick={() => hideTarget && moderate(hideTarget, 'hide')}>
              規約違反として非公開にする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
