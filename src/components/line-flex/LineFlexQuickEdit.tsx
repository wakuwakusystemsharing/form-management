'use client';

/**
 * LINE メッセージ一覧の「プレビュー編集」: 一覧のカードの中でプレビューを直接さわって編集し、「更新」で保存する
 * 左 = プレビュー（クリックで選択・文字はその場で書き換え）/ 右 = 追加・選んだパーツの設定
 * 名前・キーワード・送り方などは変えない（それらは「編集」から）。操作のしくみは編集ダイアログと同じ（src/lib/flex-edit.ts）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import FlexPreview, { type FlexPreviewEdit } from './FlexPreview';
import FlexPartInspector from './FlexPartInspector';
import type { FlexFormOption } from './LineFlexEditorDialog';
import { applyFlexEdit, currentFlexContents, isTemplateLinked, validSelection, type FlexEditOp, type FlexEditState } from '@/lib/flex-edit';
import { itemsToPreview } from '@/lib/line-flex-items';
import { resolveFlexContents } from '@/lib/line-flex-templates';
import type { FlexContainer, LineFlexItem, LineFlexMessage, LineFlexMessageInput } from '@/types/line-flex';

interface Props {
  storeId: string;
  message: LineFlexMessage;
  forms: FlexFormOption[];
  /** 同じ店舗の LINE メッセージ（「保存済みの LINE メッセージ」を並びに入れているときのプレビュー用） */
  others: LineFlexMessage[];
  onSaved: (message: LineFlexMessage) => void;
  /** 未保存の変更があるかどうかを親に知らせる（閉じる前の確認用） */
  onDirtyChange?: (dirty: boolean) => void;
}

const HISTORY_MAX = 50;
const HISTORY_COALESCE_MS = 800;
const nowMs = (): number => Date.now();

export default function LineFlexQuickEdit({ storeId, message, forms, others, onSaved, onDirtyChange }: Props) {
  const { toast } = useToast();
  const [state, setState] = useState<FlexEditState>({ template: message.template, data: message.data, flexOverride: message.flex_override ?? null });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: FlexEditState[]; future: FlexEditState[] }>({ past: [], future: [] });
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const lastChangeAt = useRef(0);

  const contents = useMemo(() => currentFlexContents(state), [state]);
  const selected = validSelection(state, selectedPath);
  const items: LineFlexItem[] = useMemo(() => (message.items && message.items.length > 0 ? message.items : [{ key: 'main', type: 'main' }]), [message.items]);
  const previewMessages = useMemo(
    () =>
      itemsToPreview(items, contents, message.alt_text, (refId) => {
        const o = others.find((x) => x.id === refId && x.id !== message.id);
        if (!o) return null;
        const c = o.payload && typeof o.payload.contents === 'object' ? (o.payload.contents as FlexContainer) : resolveFlexContents(o);
        return { contents: c, altText: o.alt_text };
      }),
    [items, contents, message.alt_text, message.id, others]
  );

  const markDirty = (value: boolean) => {
    setDirty(value);
    onDirtyChange?.(value);
  };
  const change = (next: FlexEditState, typing: boolean) => {
    const now = nowMs();
    const skip = typing && now - lastChangeAt.current < HISTORY_COALESCE_MS;
    lastChangeAt.current = now;
    if (!skip) setHistory((h) => ({ past: [...h.past, state].slice(-HISTORY_MAX), future: [] }));
    setState(next);
    markDirty(true);
  };

  const applyEdit = (op: FlexEditOp) => {
    setError(null);
    const r = applyFlexEdit(state, op, selected);
    if (!r) return;
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.becameFree) toast({ title: '自由編集に切り替えました', description: '「編集」画面の入力項目とは連動しなくなります。「テンプレートに戻す」か「元に戻す」で戻せます。' });
    change({ ...state, data: r.data ?? state.data, flexOverride: r.flexOverride ?? state.flexOverride }, r.typing);
    if (r.selected !== undefined) setSelectedPath(r.selected);
  };
  // 画像のアップロード完了時など、あとから呼ばれる場面でも最新の状態に対して操作する
  const applyEditRef = useRef(applyEdit);
  useEffect(() => {
    applyEditRef.current = applyEdit;
  });

  const undo = () => {
    const past = [...history.past];
    const snap = past.pop();
    if (!snap) return;
    setHistory({ past, future: [...history.future, state] });
    setState(snap);
    setError(null);
    markDirty(true);
    lastChangeAt.current = 0;
  };
  const redo = () => {
    const future = [...history.future];
    const snap = future.pop();
    if (!snap) return;
    setHistory({ past: [...history.past, state], future });
    setState(snap);
    setError(null);
    markDirty(true);
    lastChangeAt.current = 0;
  };
  const resetToTemplate = () => {
    change({ ...state, flexOverride: null }, false);
    setError(null);
  };

  const uploadImage = async (slot: string, file: File, apply: (url: string) => void) => {
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('storeId', storeId);
      fd.append('menuId', `flex_${message.id}_${slot}`);
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'アップロードに失敗しました');
      apply(json.url);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'アップロードに失敗しました', variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!contents) {
      toast({ title: 'Flex の内容が空です。パーツを追加してください', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      // PUT はメッセージ全体を渡す（名前・キーワード・送り方などは保存済みの値のまま）
      const body: LineFlexMessageInput = {
        id: message.id,
        name: message.name,
        template: state.template,
        data: state.data,
        flex_override: state.flexOverride,
        alt_text: message.alt_text,
        keywords: message.keywords,
        attach_confirm: message.attach_confirm,
        attach_reminder: message.attach_reminder,
        attach_follow: message.attach_follow,
        enabled: message.enabled,
        track_taps: message.track_taps,
        items,
      };
      const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/line-messages/${message.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '更新に失敗しました');
      markDirty(false);
      toast({ title: '更新しました' });
      onSaved(json.message as LineFlexMessage);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '更新に失敗しました', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const previewEdit: FlexPreviewEdit = {
    selected,
    onSelect: setSelectedPath,
    onTextCommit: (path, text) => applyEdit({ type: 'text', path, text }),
    onMoveTo: (path, index) => applyEdit({ type: 'moveTo', path, index }),
    onAction: (action, path) => {
      if (action === 'prev') applyEdit({ type: 'move', path, dir: -1 });
      else if (action === 'next') applyEdit({ type: 'move', path, dir: 1 });
      else applyEdit({ type: action, path });
    },
  };
  const freeEditing = !!state.flexOverride && state.template !== 'custom';

  return (
    <div className="space-y-3" data-slot="flex-quick-edit">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* 左: プレビュー（直接さわって編集） */}
        <div className="min-w-0">
          <FlexPreview contents={contents} altText={message.alt_text} messages={previewMessages.length > 0 ? previewMessages : undefined} edit={contents ? previewEdit : undefined} />
        </div>
        {/* 右: 追加・選んだパーツの設定 */}
        <div className="min-w-0 space-y-2">
          <FlexPartInspector
            contents={contents}
            selected={selected}
            onSelect={setSelectedPath}
            onOp={(op) => applyEditRef.current(op)}
            templateLinked={isTemplateLinked(state)}
            formUrls={forms.filter((f) => f.liffUrl).map((f) => ({ name: f.name, url: f.liffUrl }))}
            uploading={uploading}
            onUpload={uploadImage}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={undo}
            onRedo={redo}
            error={error}
          />
          {freeEditing && (
            <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              <span className="min-w-0 flex-1">自由編集中です（「編集」画面の入力項目とは連動しません）。「テンプレートに戻す」で入力項目の内容に戻せます（自由編集の内容は消えます）。</span>
              <Button type="button" size="sm" variant="outline" className="h-6 bg-white text-[11px]" onClick={resetToTemplate}>テンプレートに戻す</Button>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button type="button" onClick={save} disabled={saving || !dirty}>{saving ? '更新中…' : '更新'}</Button>
        {dirty ? (
          <span className="text-[11px] text-amber-700">未保存の変更があります。「更新」を押すと、この LINE メッセージに反映されます。</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">プレビューを編集して「更新」を押すと保存されます。名前・キーワード・送り方は「編集」から変えられます。</span>
        )}
      </div>
    </div>
  );
}
