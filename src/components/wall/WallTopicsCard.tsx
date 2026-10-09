'use client';

/**
 * 寄せ書きウォール: お題（テーマ）の管理（案 3）
 * 期間を決めて 1 つだけ出す。同じ期間に 2 つは出せない（サーバーで検証）
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import type { WallTopic } from '@/types/wall';

type TopicRow = WallTopic & { status: 'active' | 'upcoming' | 'ended' };

const STATUS_LABEL: Record<TopicRow['status'], { label: string; className: string }> = {
  active: { label: '開催中', className: 'bg-[rgb(209,241,209)] text-[rgb(55,114,58)]' },
  upcoming: { label: '予定', className: 'bg-blue-100 text-blue-800' },
  ended: { label: '終了', className: 'bg-gray-100 text-gray-600' },
};

function todayJst(): string {
  const d = new Date(Date.now() + 9 * 3600000);
  return d.toISOString().slice(0, 10);
}

function plusDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const EMPTY_FORM = () => ({ title: '', description: '', starts_on: todayJst(), ends_on: plusDays(todayJst(), 30) });

export default function WallTopicsCard({ storeId, onChanged }: { storeId: string; onChanged?: () => void }) {
  const { toast } = useToast();
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: string | null } & ReturnType<typeof EMPTY_FORM> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/topics`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: 'お題の取得に失敗しました', description: json.error, variant: 'destructive' }); return; }
      setTopics(json.topics || []);
    } catch {
      toast({ title: 'お題の取得に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const url = editing.id
        ? `/api/stores/${encodeURIComponent(storeId)}/wall/topics/${encodeURIComponent(editing.id)}`
        : `/api/stores/${encodeURIComponent(storeId)}/wall/topics`;
      const res = await fetch(url, {
        method: editing.id ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editing.title, description: editing.description, starts_on: editing.starts_on, ends_on: editing.ends_on }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: 'お題を保存できませんでした', description: json.error, variant: 'destructive' }); return; }
      toast({ title: editing.id ? 'お題を更新しました' : 'お題を追加しました' });
      setEditing(null);
      await load();
      onChanged?.();
    } catch {
      toast({ title: 'お題を保存できませんでした', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: TopicRow) => {
    if (!window.confirm(`お題「${t.title}」を削除しますか？\n貼られた付箋は残り、お題のラベルだけ外れます。`)) return;
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/topics/${encodeURIComponent(t.id)}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: '削除できませんでした', description: json.error, variant: 'destructive' }); return; }
      toast({ title: 'お題を削除しました' });
      await load();
      onChanged?.();
    } catch {
      toast({ title: '削除できませんでした', description: 'ネットワークエラー', variant: 'destructive' });
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">お題</CardTitle>
        <CardDescription>「今月のおすすめメニューを教えて」のようなテーマを期間を決めて出せます。期間中はボードの見出しの下に表示され、お客様は「お題に答える」か「自由に書く」かを選べます。同じ期間に出せるお題は 1 つです。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!editing && (
          <Button size="sm" onClick={() => setEditing({ id: null, ...EMPTY_FORM() })}>＋ お題を追加</Button>
        )}

        {editing && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="wall-topic-title">お題（40 文字まで）</label>
              <Input id="wall-topic-title" value={editing.title} maxLength={40} placeholder="例: 秋のおすすめメニューを教えて" onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="wall-topic-desc">説明（任意・120 文字まで）</label>
              <Textarea id="wall-topic-desc" rows={2} value={editing.description} maxLength={120} placeholder="例: 食べてよかったメニューと、ひとこと感想をどうぞ" onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="wall-topic-start">開始日</label>
                <Input id="wall-topic-start" type="date" value={editing.starts_on} onChange={(e) => setEditing({ ...editing, starts_on: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="wall-topic-end">終了日</label>
                <Input id="wall-topic-end" type="date" value={editing.ends_on} onChange={(e) => setEditing({ ...editing, ends_on: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(null)} disabled={saving}>やめる</Button>
              <Button size="sm" onClick={save} disabled={saving || !editing.title.trim()}>{saving ? '保存中…' : editing.id ? '更新' : '追加'}</Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">お題はまだありません。</p>
        ) : (
          <ul className="space-y-2">
            {topics.map((t) => {
              const st = STATUS_LABEL[t.status];
              return (
                <li key={t.id} data-slot="list-item" className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge data-slot="status-chip" className={`${st.className} border-0 font-medium`}>{st.label}</Badge>
                      <span className="font-medium">{t.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{t.starts_on} 〜 {t.ends_on}{t.description && ` ｜ ${t.description}`}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: t.id, title: t.title, description: t.description, starts_on: t.starts_on, ends_on: t.ends_on })}>編集</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(t)}>削除</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
