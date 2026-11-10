'use client';

/**
 * 配信の作成・編集ダイアログ（下書きのみ編集できる）
 * 左: 配信先の条件 → メッセージ → 送るタイミング / 右: スマホ枠のプレビュー。下: 下書き保存・テスト送信・予約 / 今すぐ送る
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import FlexPreview from '@/components/line-flex/FlexPreview';
import AudienceEditor, { type AudienceOptions } from './AudienceEditor';
import BroadcastItemsEditor, { type ItemJsonState } from './BroadcastItemsEditor';
import { describeAudience, normalizeAudience } from '@/lib/broadcast-audience';
import { BROADCAST_NAME_MAX, broadcastItemsToPreview, validateBroadcastItems } from '@/lib/broadcast-items';
import { buildSendSummary, type QuotaEvaluation } from '@/lib/broadcast-quota';
import { payloadsToPreview } from '@/lib/line-flex-items';
import { validateFlexContents } from '@/lib/line-flex-templates';
import type { Broadcast, BroadcastAudience, BroadcastInput, BroadcastItem, BroadcastSticker } from '@/types/broadcast';
import type { LineFlexMessage } from '@/types/line-flex';

interface Props {
  storeId: string;
  open: boolean;
  initial: Broadcast | null; // null = 新規
  options: AudienceOptions;
  messages: LineFlexMessage[];
  stickers: BroadcastSticker[];
  onClose: () => void;
  onSaved: (b: Broadcast) => void;
}

interface Estimate {
  count: number;
  excluded_opt_out: number;
  excluded_blocked: number;
  excluded_no_line: number;
  unverified?: number;
  sample: Array<{ id: string; name: string }>;
  quota: QuotaEvaluation;
  unfiltered: boolean;
}

interface CustomerOption {
  id: string;
  name: string;
  line_user_id: string;
  line_display_name?: string | null;
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function BroadcastEditorDialog({ storeId, open, initial, options, messages, stickers, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [audience, setAudience] = useState<BroadcastAudience>(initial?.audience ?? {});
  const [items, setItems] = useState<BroadcastItem[]>(initial?.items ?? []);
  const [itemJson, setItemJson] = useState<ItemJsonState>({});
  const [timing, setTiming] = useState<'now' | 'later'>('now');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [audienceKey, setAudienceKey] = useState(0);
  // 送信前の確認
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmOver, setConfirmOver] = useState(false);
  const [confirmDouble, setConfirmDouble] = useState(false);
  const [sending, setSending] = useState(false);
  // テスト送信
  const [testOpen, setTestOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [testTarget, setTestTarget] = useState<CustomerOption | null>(null);
  const [testSending, setTestSending] = useState(false);
  // 画像アップロードの置き場所（保存前でも決まるよう、ダイアログを開くたびに振る）
  const uploadId = useRef('');

  // 開くたびに初期化
  useEffect(() => {
    if (!open) return;
    setSavedId(initial?.id ?? null);
    setName(initial?.name ?? '');
    setAudience(initial?.audience ?? {});
    const nextItems = initial?.items ?? [];
    setItems(nextItems);
    const js: ItemJsonState = {};
    for (const it of nextItems) if (it.type === 'flex') js[it.key] = { text: it.contents ? JSON.stringify(it.contents, null, 2) : '', error: null };
    setItemJson(js);
    setTiming('now');
    setScheduledLocal(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setDirty(false);
    setEstimate(null);
    setConfirmOpen(false);
    setConfirmOver(false);
    setConfirmDouble(false);
    setTestOpen(false);
    setTestTarget(null);
    setCustomers([]);
    setCustomerQuery('');
    setAudienceKey((k) => k + 1);
    uploadId.current = initial?.id?.replace(/-/g, '').slice(0, 12) || Math.random().toString(36).slice(2, 14);
  }, [open, initial]);

  // 配信先の人数（条件が変わるたびに少し待ってから計算）
  const audienceJson = JSON.stringify(normalizeAudience(audience));
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEstimating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/broadcasts/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ audience: JSON.parse(audienceJson) }) });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json) setEstimate(json as Estimate);
      } catch {
        /* 見積りは補助なので失敗しても続行 */
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, storeId, audienceJson]);

  const touch = () => setDirty(true);
  const itemsError = validateBroadcastItems(items, { requireContent: true });
  const jsonError = Object.entries(itemJson).find(([key, s]) => s.error && items.some((x) => x.key === key))?.[1].error ?? null;

  const previewMessages = useMemo(
    () =>
      broadcastItemsToPreview(items, {
        ref: (id) => {
          const m = messages.find((x) => x.id === id);
          if (!m) return null;
          return payloadsToPreview(m.payloads && m.payloads.length > 0 ? m.payloads : m.payload ? [m.payload] : []);
        },
        sticker: (id) => {
          const s = stickers.find((x) => x.id === id);
          return s ? s.preview_url || s.url : null;
        },
      }),
    [items, messages, stickers]
  );

  const changeItemJson = (key: string, text: string) => {
    touch();
    const setContents = (contents: Record<string, unknown> | null) => setItems((list) => list.map((x) => (x.key === key && x.type === 'flex' ? { ...x, contents } : x)));
    if (!text.trim()) {
      setItemJson((s) => ({ ...s, [key]: { text, error: 'Flex の JSON を入力してください' } }));
      setContents(null);
      return;
    }
    try {
      let parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed && parsed.type === 'flex' && parsed.contents && typeof parsed.contents === 'object') parsed = parsed.contents as Record<string, unknown>;
      const err = validateFlexContents(parsed);
      setItemJson((s) => ({ ...s, [key]: { text, error: err } }));
      setContents(err ? null : parsed);
    } catch {
      setItemJson((s) => ({ ...s, [key]: { text, error: 'JSON として読み取れません（カンマや括弧の抜けを確認してください）' } }));
      setContents(null);
    }
  };

  const uploadImage = async (slot: string, file: File, current: string | undefined, apply: (url: string) => void) => {
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('storeId', storeId);
      fd.append('menuId', `broadcast_${uploadId.current}_${slot}`);
      if (current) fd.append('oldImageUrl', current);
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'アップロードに失敗しました');
      apply(json.url);
      touch();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'アップロードに失敗しました', variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  /** 下書きを保存して、保存後の配信を返す（失敗時は null） */
  const saveDraft = async (opts: { silent?: boolean } = {}): Promise<Broadcast | null> => {
    if (!name.trim()) {
      toast({ title: '配信の名前を入力してください', variant: 'destructive' });
      return null;
    }
    if (jsonError) {
      toast({ title: jsonError, variant: 'destructive' });
      return null;
    }
    // 下書きは空でも保存できるが、途中まで入力した項目のエラーは先に伝える
    const partial = validateBroadcastItems(items);
    if (partial) {
      toast({ title: partial, variant: 'destructive' });
      return null;
    }
    setSaving(true);
    try {
      const body: BroadcastInput = { name, audience: normalizeAudience(audience), items };
      const url = savedId ? `/api/stores/${storeId}/broadcasts/${savedId}` : `/api/stores/${storeId}/broadcasts`;
      const res = await fetch(url, { method: savedId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '保存に失敗しました');
      const saved = json.broadcast as Broadcast;
      setSavedId(saved.id);
      setDirty(false);
      if (!opts.silent) toast({ title: '下書きを保存しました' });
      onSaved(saved);
      return saved;
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '保存に失敗しました', variant: 'destructive' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const openConfirm = async () => {
    if (itemsError) {
      toast({ title: itemsError, variant: 'destructive' });
      return;
    }
    if (estimate && estimate.count === 0) {
      toast({ title: '配信先が 0 人です。条件を見直してください', variant: 'destructive' });
      return;
    }
    if (timing === 'later') {
      const t = Date.parse(scheduledLocal);
      if (Number.isNaN(t) || t <= Date.now()) {
        toast({ title: '送信日時は現在より後にしてください', variant: 'destructive' });
        return;
      }
    }
    if (!savedId || dirty) {
      const saved = await saveDraft({ silent: true });
      if (!saved) return;
    }
    setConfirmOver(false);
    setConfirmDouble(false);
    setConfirmOpen(true);
  };

  const send = async () => {
    if (!savedId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/broadcasts/${savedId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scheduled_at: timing === 'later' ? new Date(scheduledLocal).toISOString() : null, confirmed: confirmOver, double_confirmed: confirmDouble }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '配信の予約に失敗しました');
      toast({ title: json.immediate ? '送信を開始しました（数分以内に届きます）' : '配信を予約しました' });
      onSaved(json.broadcast as Broadcast);
      setConfirmOpen(false);
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '配信の予約に失敗しました', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const searchCustomers = async (q: string) => {
    setCustomerQuery(q);
    try {
      const res = await fetch(`/api/stores/${storeId}/customers?search=${encodeURIComponent(q)}&limit=20`, { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      const list = (Array.isArray(json.customers) ? json.customers : []) as CustomerOption[];
      setCustomers(list.filter((c) => !!c.line_user_id));
    } catch {
      /* ignore */
    }
  };

  const sendTest = async () => {
    if (!testTarget) return;
    setTestSending(true);
    try {
      let id = savedId;
      if (!id || dirty) {
        const saved = await saveDraft({ silent: true });
        if (!saved) return;
        id = saved.id;
      }
      const res = await fetch(`/api/stores/${storeId}/broadcasts/${id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ line_user_id: testTarget.line_user_id, name: testTarget.name }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'テスト送信に失敗しました');
      toast({ title: `${testTarget.name || testTarget.line_display_name || '送信先'} へテスト送信しました` });
      setTestOpen(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'テスト送信に失敗しました', variant: 'destructive' });
    } finally {
      setTestSending(false);
    }
  };

  const messageCount = previewMessages.length;
  const summary = estimate ? buildSendSummary({ recipients: estimate.count, messages: Math.max(messageCount, 1), quota: estimate.quota }) : [];
  const canConfirm = !!estimate && !estimate.quota.blocked && (!estimate.quota.needs_confirm || confirmOver) && (!estimate.quota.double_confirm || confirmDouble);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[92dvh] max-w-[calc(100%-1rem)] flex-col overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-5 pb-3 pt-5">
          <DialogTitle>{initial ? '配信を編集' : '新しい配信'}</DialogTitle>
          <DialogDescription>送る相手を選び、メッセージを組み立てて、今すぐ または 日時を指定して送ります。</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-5">
              <div className="space-y-1">
                <Label htmlFor="broadcast_name" className="text-xs">配信の名前（管理用。お客様には見えません） <span className="text-destructive">*</span></Label>
                <Input id="broadcast_name" value={name} maxLength={BROADCAST_NAME_MAX} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="例: 11 月の新色カラーのご案内" />
              </div>

              <section className="space-y-3 rounded-lg border p-3">
                <h4 className="text-sm font-medium">① 配信先</h4>
                <AudienceEditor key={audienceKey} value={audience} onChange={(a) => { setAudience(a); touch(); }} options={options} />
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-slot="audience-estimate">
                  {estimate ? (
                    <>
                      <span className="font-semibold tabular-nums">{estimating ? '…' : estimate.count} 人</span>
                      <span className="text-muted-foreground"> に送ります</span>
                      {(estimate.excluded_opt_out > 0 || estimate.excluded_blocked > 0 || estimate.excluded_no_line > 0) && (
                        <span className="block text-[11px] text-muted-foreground">
                          条件に合う人のうち、
                          {[
                            estimate.excluded_opt_out > 0 ? `配信停止 ${estimate.excluded_opt_out} 人` : '',
                            estimate.excluded_blocked > 0 ? `ブロックされた ${estimate.excluded_blocked} 人` : '',
                            estimate.excluded_no_line > 0 ? `LINE 未連携 ${estimate.excluded_no_line} 人` : '',
                          ].filter(Boolean).join('・')}
                          は除いています
                        </span>
                      )}
                      {(estimate.unverified ?? 0) > 0 && (
                        <span className="block text-[11px] text-muted-foreground">
                          うち {estimate.unverified} 人は友だち追加の記録がありません。送信するときに LINE へ確認し、友だちでない人は自動で外します
                        </span>
                      )}
                      {estimate.sample.length > 0 && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          例: {estimate.sample.slice(0, 8).map((s) => s.name).join('、')}{estimate.count > 8 ? ' ほか' : ''}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">人数を計算しています…</span>
                  )}
                </div>
              </section>

              <section className="space-y-2 rounded-lg border p-3">
                <h4 className="text-sm font-medium">② メッセージ <span className="text-xs font-normal text-muted-foreground">{items.length} 件</span></h4>
                <BroadcastItemsEditor items={items} onChange={(next) => { setItems(next); touch(); }} messages={messages} stickers={stickers} uploading={uploading} onUpload={uploadImage} jsonState={itemJson} onJsonChange={changeItemJson} />
                {messageCount > 5 && <p className="text-xs text-destructive">合計 {messageCount} 通になります。1 回に送れるのは 5 通までです（保存済みの LINE メッセージは、その追加メッセージも数えます）</p>}
              </section>

              <section className="space-y-2 rounded-lg border p-3">
                <h4 className="text-sm font-medium">③ 送るタイミング</h4>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" name="broadcast_timing" checked={timing === 'now'} onChange={() => setTiming('now')} />今すぐ送る</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="broadcast_timing" checked={timing === 'later'} onChange={() => setTiming('later')} />日時を指定</label>
                  {timing === 'later' && <Input type="datetime-local" value={scheduledLocal} min={toLocalInput(new Date())} onChange={(e) => setScheduledLocal(e.target.value)} className="h-8 w-56 text-xs" />}
                </div>
                <p className="text-[11px] text-muted-foreground">送信は 5 分おきの処理で行うため、指定した時刻から数分遅れることがあります。予約した配信は送信が始まる前なら取り消せます。</p>
              </section>
            </div>

            <div className="space-y-3 self-start lg:sticky lg:top-0">
              <h4 className="text-sm font-medium">プレビュー</h4>
              <FlexPreview contents={null} messages={previewMessages.length > 0 ? previewMessages : undefined} />
            </div>
          </div>
        </div>

        {confirmOpen && estimate && (
          <div className="space-y-2 border-t bg-amber-50 px-5 py-3 text-sm" data-slot="broadcast-confirm">
            <p className="font-medium">送信前の確認</p>
            <p className="text-xs text-muted-foreground">配信先: {describeAudience(normalizeAudience(audience), { formName: (id) => options.forms.find((f) => f.id === id)?.name ?? id })}</p>
            <ul className="space-y-0.5 text-xs">
              {summary.map((line, i) => (
                <li key={i} className={estimate.quota.exceeds && i > 0 ? 'text-destructive' : undefined}>{line}</li>
              ))}
              <li>{timing === 'later' ? `送信日時: ${new Date(scheduledLocal).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })}` : '今すぐ送信します（取り消せません）'}</li>
            </ul>
            {estimate.quota.needs_confirm && (
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmOver} onChange={(e) => setConfirmOver(e.target.checked)} />今月の上限を超えることを確認しました</label>
            )}
            {estimate.quota.double_confirm && (
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmDouble} onChange={(e) => setConfirmDouble(e.target.checked)} />{estimate.count} 人に送ることを確認しました</label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={send} disabled={!canConfirm || sending}>{sending ? '処理中…' : timing === 'later' ? 'この内容で予約する' : 'この内容で送信する'}</Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={sending}>戻る</Button>
            </div>
          </div>
        )}

        {!confirmOpen && (
          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
            <Button type="button" onClick={openConfirm} disabled={saving}>{timing === 'later' ? '予約する' : '今すぐ送る'}</Button>
            <Button type="button" variant="outline" onClick={() => saveDraft()} disabled={saving}>{saving ? '保存中…' : '下書き保存'}</Button>
            <Button type="button" variant="outline" onClick={() => { setTestOpen((v) => !v); if (customers.length === 0) searchCustomers(''); }}>テスト送信</Button>
            {dirty && savedId && <span className="text-[11px] text-amber-700">未保存の変更があります</span>}
            <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>閉じる</Button>
          </div>
        )}

        {testOpen && !confirmOpen && (
          <div className="space-y-2 border-t bg-muted/30 px-5 py-3">
            <p className="text-xs">自分の LINE などに送って見た目を確認します（LINE 連携済みの顧客から選びます）。保存してから送ります。無料通数を 1 通使います。</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={customerQuery} onChange={(e) => searchCustomers(e.target.value)} placeholder="名前・電話番号で検索" className="h-8 w-56 text-xs" />
              <Select value={testTarget?.id ?? ''} onValueChange={(v) => setTestTarget(customers.find((c) => c.id === v) ?? null)}>
                <SelectTrigger className="h-8 w-64 text-xs"><SelectValue placeholder={customers.length ? '顧客を選ぶ' : '該当する顧客がいません'} /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name || c.line_display_name || c.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" disabled={!testTarget || testSending} onClick={sendTest}>{testSending ? '送信中…' : 'この顧客に送る'}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
