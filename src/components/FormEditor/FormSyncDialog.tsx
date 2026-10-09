'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import type { Form } from '@/types/form';
import { restoreFormFromSnapshot } from './FormSnapshotDialog';
import {
  FORM_SYNC_SECTIONS,
  FORM_SYNC_SECTION_IDS,
  buildSyncedConfig,
  listSyncTargets,
  type SyncSectionId,
  type SyncTargetSummary,
} from '@/lib/form-sync';

interface FormSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  /** 反映元（保存＆デプロイ済みの最新の内容） */
  sourceForm: Form;
  /** 反映が終わったとき（一覧の再読込など） */
  onDone?: () => void;
}

type ResultRow = { id: string; name: string; ok: boolean; message: string; snapshotId: string | null; restored?: boolean };

const TARGETS_KEY = (sourceId: string) => `form_sync_targets_${sourceId}`;

/**
 * 「更新して他のフォームにも反映」ダイアログ。
 * 反映先ごとに GET /api/forms/{id} → buildSyncedConfig で差し替え → PUT /api/forms/{id} → POST /api/forms/{id}/deploy を行う
 * （既存の保存・デプロイ API をそのまま使うので認証・正規化・操作履歴は通常の更新と同じ）
 */
export default function FormSyncDialog({ open, onOpenChange, storeId, sourceForm, onDone }: FormSyncDialogProps) {
  const [targets, setTargets] = useState<SyncTargetSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [sections, setSections] = useState<SyncSectionId[]>(FORM_SYNC_SECTION_IDS);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // 反映先の候補を読み込む（同じ店舗の予約フォームのみ）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTargets(null);
    setLoadError(null);
    setResults(null);
    fetch(`/api/stores/${storeId}/forms`, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('フォーム一覧の取得に失敗しました');
        const list = (await res.json()) as Array<Form & { form_name?: string }>;
        if (cancelled) return;
        const candidates = listSyncTargets(list, sourceForm.id, storeId);
        setTargets(candidates);
        // 前回の選択を復元（無ければ全選択）
        let remembered: string[] | null = null;
        try {
          const raw = localStorage.getItem(TARGETS_KEY(sourceForm.id));
          remembered = raw ? (JSON.parse(raw) as string[]) : null;
        } catch { /* ignore */ }
        const ids = candidates.map((c) => c.id);
        setSelectedTargets(remembered ? ids.filter((id) => remembered!.includes(id)) : ids);
      })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : '取得に失敗しました'); });
    return () => { cancelled = true; };
  }, [open, storeId, sourceForm.id]);

  const toggleTarget = (id: string) => {
    setSelectedTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleSection = (id: SyncSectionId) => {
    setSections((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const canRun = !running && selectedTargets.length > 0 && sections.length > 0;
  const sourceName = sourceForm.config?.basic_info?.form_name || 'このフォーム';

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    setResults(null);
    try { localStorage.setItem(TARGETS_KEY(sourceForm.id), JSON.stringify(selectedTargets)); } catch { /* ignore */ }
    const rows: ResultRow[] = [];
    for (const id of selectedTargets) {
      const name = targets?.find((t) => t.id === id)?.name || id;
      setProgress(`「${name}」に反映中…`);
      let snapshotId: string | null = null;
      try {
        // 1) 反映先の最新を取得
        const getRes = await fetch(`/api/forms/${id}`, { credentials: 'include', cache: 'no-store' });
        if (!getRes.ok) throw new Error('フォームの取得に失敗しました');
        const target = (await getRes.json()) as Form;
        if (target.store_id !== storeId) throw new Error('同じ店舗のフォームではありません');
        // 1.5) 上書き前の状態をスナップショットに保存（「元に戻す」用。失敗しても反映は続行）
        try {
          const snapRes = await fetch(`/api/forms/${id}/snapshots`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ reason: 'sync', reason_label: `「${sourceName}」から反映前`, source_form_id: sourceForm.id }),
          });
          if (snapRes.ok) snapshotId = ((await snapRes.json()) as { snapshot: { id: string } }).snapshot.id;
        } catch { /* ignore */ }
        // 2) 選択したセクションだけ差し替え（種別固有の項目・送信時の項目編集は反映先のまま）
        const config = buildSyncedConfig(sourceForm.config, target.config, sections);
        // 3) 保存
        const putRes = await fetch(`/api/forms/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...target, config }),
        });
        if (!putRes.ok) {
          const err = await putRes.json().catch(() => ({}));
          throw new Error(err.error || '保存に失敗しました');
        }
        // 4) 再デプロイ
        const deployRes = await fetch(`/api/forms/${id}/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ storeId, formId: id }),
        });
        if (!deployRes.ok) {
          const err = await deployRes.json().catch(() => ({}));
          rows.push({ id, name, ok: false, message: `保存はできましたが、更新（デプロイ）に失敗しました: ${err.error || '不明なエラー'}`, snapshotId });
          continue;
        }
        rows.push({ id, name, ok: true, message: '反映して更新しました', snapshotId });
      } catch (e) {
        rows.push({ id, name, ok: false, message: e instanceof Error ? e.message : '不明なエラー', snapshotId });
      }
    }
    setResults(rows);
    setProgress('');
    setRunning(false);
    onDone?.();
  };

  const sectionLabels = useMemo(() => FORM_SYNC_SECTIONS, []);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-slot="dialog-content">
        <DialogHeader>
          <DialogTitle>他のフォームにも反映</DialogTitle>
          <DialogDescription>
            「{sourceName}」の設定を、同じ店舗の他の予約フォームにコピーして更新（デプロイ）します。
            フォーム名・LIFF ID・フォーム種別・メール欄・店舗側通知メール・LINE 以外のブラウザ制限・2 通目メッセージ・送信時の項目編集は反映先のまま残ります。
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-3">
            <ul className="space-y-2">
              {results.map((r) => (
                <li key={r.id} className={`rounded-md border px-3 py-2 text-sm ${r.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><span className="font-medium">{r.name}</span>：{r.message}</span>
                    {r.snapshotId && !r.restored && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={restoringId !== null}
                        onClick={async () => {
                          if (!window.confirm(`「${r.name}」を反映前の状態に戻して更新します。よろしいですか？`)) return;
                          setRestoringId(r.id);
                          try {
                            await restoreFormFromSnapshot(storeId, r.id, r.snapshotId!);
                            setResults((prev) => (prev || []).map((x) => (x.id === r.id ? { ...x, ok: true, message: '反映前の状態に戻して更新しました', restored: true } : x)));
                          } catch (e) {
                            setResults((prev) => (prev || []).map((x) => (x.id === r.id ? { ...x, ok: false, message: e instanceof Error ? e.message : '元に戻せませんでした' } : x)));
                          } finally {
                            setRestoringId(null);
                          }
                        }}
                      >
                        {restoringId === r.id ? '戻しています…' : '元に戻す'}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              「元に戻す」は反映直前の状態に戻して更新します。あとから戻したい場合は、各フォームの編集画面の「更新履歴」から行えます。
            </p>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>閉じる</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium">反映先のフォーム</Label>
              {loadError && <p className="text-sm text-destructive">{loadError}</p>}
              {targets === null && !loadError && <p className="text-sm text-muted-foreground">読み込み中…</p>}
              {targets && targets.length === 0 && (
                <p className="text-sm text-muted-foreground">同じ店舗に他の予約フォームがありません。</p>
              )}
              {targets && targets.length > 0 && (
                <div className="space-y-2">
                  {targets.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/40">
                      <Checkbox checked={selectedTargets.includes(t.id)} onCheckedChange={() => toggleTarget(t.id)} disabled={running} />
                      <span className="text-sm font-medium flex-1 truncate">{t.name}</span>
                      <Badge variant="outline" className="text-xs">{t.form_type === 'web' ? 'Web' : 'LINE'}</Badge>
                      {t.status && <Badge variant="secondary" className="text-xs">{t.status === 'active' ? '公開中' : t.status === 'paused' ? '一時停止' : '非公開'}</Badge>}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">反映する内容</Label>
                <div className="flex gap-2">
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSections(FORM_SYNC_SECTION_IDS)} disabled={running}>すべて選択</button>
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSections([])} disabled={running}>すべて外す</button>
                </div>
              </div>
              <div className="space-y-1.5">
                {sectionLabels.map((s) => (
                  <label key={s.id} className="flex items-start gap-2 cursor-pointer">
                    <Checkbox className="mt-0.5" checked={sections.includes(s.id)} onCheckedChange={() => toggleSection(s.id)} disabled={running} />
                    <span className="text-sm">
                      <span className="font-medium">{s.label}</span>
                      <span className="block text-xs text-muted-foreground">{s.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              反映先のフォームは上書きされ、そのまま更新（デプロイ）されます。元に戻す場合は反映先を開いて設定し直してください。
            </p>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{progress}</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>キャンセル</Button>
                <Button onClick={run} disabled={!canRun}>
                  {running ? '反映中…' : `${selectedTargets.length} 件に反映して更新`}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
