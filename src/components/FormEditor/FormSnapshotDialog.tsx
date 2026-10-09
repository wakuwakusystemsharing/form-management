'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Form } from '@/types/form';
import { diffConfigSections } from '@/lib/form-sync';

interface SnapshotSummary {
  id: string;
  reason: 'update' | 'sync' | 'restore';
  reason_label: string | null;
  source_form_id: string | null;
  actor_email: string | null;
  created_at: string;
}

interface FormSnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  /** 編集中のフォーム（現在の内容との差分表示に使う） */
  form: Form;
  /** 復元して更新（デプロイ）したあと、最新のフォームを親に渡す */
  onRestored: (restored: Form) => void;
}

const REASON_BADGE: Record<SnapshotSummary['reason'], string> = { update: '更新前', sync: '反映前', restore: '復元前' };

function formatJst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const jst = new Date(d.getTime() + 9 * 3600000);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()];
  return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${dow}）${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * 復元の共通処理: 復元前の状態を保存 → スナップショットの config で保存 → 再デプロイ。
 * 復元前も保存するので「戻したのを取り消す」ことができる
 */
export async function restoreFormFromSnapshot(storeId: string, formId: string, snapshotId: string): Promise<Form> {
  const getRes = await fetch(`/api/forms/${formId}/snapshots/${snapshotId}`, { credentials: 'include', cache: 'no-store' });
  if (!getRes.ok) throw new Error((await getRes.json().catch(() => ({}))).error || 'スナップショットの取得に失敗しました');
  const { snapshot } = (await getRes.json()) as { snapshot: { config: Form['config'] } };

  const curRes = await fetch(`/api/forms/${formId}`, { credentials: 'include', cache: 'no-store' });
  if (!curRes.ok) throw new Error('フォームの取得に失敗しました');
  const current = (await curRes.json()) as Form;
  if (current.store_id !== storeId) throw new Error('同じ店舗のフォームではありません');

  // 復元前の状態を保存（失敗しても復元は続行）
  await fetch(`/api/forms/${formId}/snapshots`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ reason: 'restore' }),
  }).catch(() => undefined);

  // フォーム種別は現在のまま（スナップショットは同じフォームのものなので通常は一致する）
  const config = { ...snapshot.config, form_type: current.config.form_type };
  const putRes = await fetch(`/api/forms/${formId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ ...current, config }),
  });
  if (!putRes.ok) throw new Error((await putRes.json().catch(() => ({}))).error || '保存に失敗しました');
  const restored = (await putRes.json()) as Form;

  const deployRes = await fetch(`/api/forms/${formId}/deploy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ storeId, formId }),
  });
  if (!deployRes.ok) throw new Error(`復元して保存しましたが、更新（デプロイ）に失敗しました: ${(await deployRes.json().catch(() => ({}))).error || '不明なエラー'}`);
  return restored;
}

/** 「更新履歴から戻す」ダイアログ */
export default function FormSnapshotDialog({ open, onOpenChange, storeId, form, onRestored }: FormSnapshotDialogProps) {
  const [rows, setRows] = useState<SnapshotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, string[]>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRows(null); setError(null); setDiffs({}); setConfirmId(null); setMessage(null);
    fetch(`/api/forms/${form.id}/snapshots`, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '更新履歴の取得に失敗しました');
        const json = (await res.json()) as { snapshots: SnapshotSummary[] };
        if (!cancelled) setRows(json.snapshots || []);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '取得に失敗しました'); });
    return () => { cancelled = true; };
  }, [open, form.id]);

  // 行を開いたときに現在の内容との差分（変わるセクション）を取得して表示
  const loadDiff = async (id: string) => {
    if (diffs[id]) return;
    try {
      const res = await fetch(`/api/forms/${form.id}/snapshots/${id}`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const { snapshot } = (await res.json()) as { snapshot: { config: Form['config'] } };
      setDiffs((prev) => ({ ...prev, [id]: diffConfigSections(form.config, snapshot.config) }));
    } catch { /* ignore */ }
  };

  const restore = async (id: string) => {
    setBusy(true); setMessage(null);
    try {
      const restored = await restoreFormFromSnapshot(storeId, form.id, id);
      onRestored(restored);
      setMessage('この状態に戻して更新しました。履歴に「復元前」が追加されたので、取り消すこともできます。');
      setConfirmId(null);
      // 一覧を取り直す
      const res = await fetch(`/api/forms/${form.id}/snapshots`, { credentials: 'include', cache: 'no-store' });
      if (res.ok) setRows(((await res.json()) as { snapshots: SnapshotSummary[] }).snapshots || []);
      setDiffs({});
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '復元に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-slot="dialog-content">
        <DialogHeader>
          <DialogTitle>更新履歴から戻す</DialogTitle>
          <DialogDescription>
            「更新」「他のフォームにも反映」「復元」の直前の状態を直近 20 件まで保存しています。選んだ状態に戻して、そのまま更新（デプロイ）します。
            フォーム名・フォーム種別・公開 URL は変わりません。
          </DialogDescription>
        </DialogHeader>

        {message && <p className="text-sm rounded-md border px-3 py-2 bg-muted/40">{message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {rows === null && !error && <p className="text-sm text-muted-foreground">読み込み中…</p>}
        {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">まだ履歴がありません。次に「更新」したときから保存されます。</p>}

        {rows && rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((r, index) => {
              const d = diffs[r.id];
              const isConfirm = confirmId === r.id;
              return (
                <li key={r.id} className="rounded-md border px-3 py-2 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{formatJst(r.created_at)}</span>
                    <Badge variant="outline" className="text-xs">{REASON_BADGE[r.reason] || r.reason}</Badge>
                    {r.reason_label && r.reason_label !== REASON_BADGE[r.reason] && <span className="text-xs text-muted-foreground">{r.reason_label}</span>}
                    {r.actor_email && <span className="text-xs text-muted-foreground">{r.actor_email}</span>}
                    {index === 0 && <span className="text-xs text-muted-foreground">（最新）</span>}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" className="text-xs underline text-muted-foreground" onClick={() => loadDiff(r.id)} disabled={busy}>
                      {d ? (d.length === 0 ? '現在の内容と同じです' : `現在と違う: ${d.join(' / ')}`) : '現在との違いを見る'}
                    </button>
                    {!isConfirm ? (
                      <Button size="sm" variant="outline" onClick={() => { setConfirmId(r.id); loadDiff(r.id); }} disabled={busy}>この状態に戻す</Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-destructive">
                          {index > 0 ? `これより新しい ${index} 件の変更も消えます。` : ''}戻して更新しますか？
                        </span>
                        <Button size="sm" variant="outline" onClick={() => setConfirmId(null)} disabled={busy}>やめる</Button>
                        <Button size="sm" onClick={() => restore(r.id)} disabled={busy}>{busy ? '復元中…' : '戻して更新'}</Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>閉じる</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
