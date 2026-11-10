'use client';

/**
 * 「配信」タブ本体（店舗管理者ページ / テナント側 店舗ページ共通）
 * 配信の一覧・作成・予約の取り消し・複製・結果、スタンプ素材の管理
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { ChevronDown, ChevronUp } from 'lucide-react';
import BroadcastEditorDialog from './BroadcastEditorDialog';
import type { AudienceOptions } from './AudienceEditor';
import { describeAudience } from '@/lib/broadcast-audience';
import { describeBroadcastItems } from '@/lib/broadcast-items';
import { formOptionsFromForms, menuNamesFromForms, surveyChoicesFromForms } from '@/lib/broadcast-options';
import type { Broadcast, BroadcastSettings, BroadcastSticker, BroadcastStatus } from '@/types/broadcast';
import type { LineFlexMessage } from '@/types/line-flex';

interface Overview {
  settings: BroadcastSettings;
  used: number;
  opt_out_count: number;
  token_set: boolean;
}

interface RecipientRow {
  id: string;
  display_name: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
}

const STATUS_LABEL: Record<BroadcastStatus, { label: string; className: string }> = {
  draft: { label: '下書き', className: 'text-muted-foreground' },
  scheduled: { label: '予約済み', className: 'border-blue-300 bg-blue-50 text-blue-700' },
  sending: { label: '送信中', className: 'border-amber-300 bg-amber-50 text-amber-700' },
  sent: { label: '送信済み', className: 'border-green-300 bg-green-50 text-green-700' },
  cancelled: { label: '取り消し', className: 'text-muted-foreground' },
  failed: { label: '失敗', className: 'border-red-300 bg-red-50 text-red-700' },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function BroadcastPanel({ storeId, showGuide = true }: { storeId: string; showGuide?: boolean }) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}`;
  const [view, setView] = useState<'list' | 'stickers'>('list');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(true);
  const [options, setOptions] = useState<AudienceOptions>({ tags: [], menus: [], forms: [], surveys: [] });
  const [messages, setMessages] = useState<LineFlexMessage[]>([]);
  const [stickers, setStickers] = useState<BroadcastSticker[]>([]);
  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<Broadcast | null>(null);
  const [cancelling, setCancelling] = useState<Broadcast | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<{ total: number; rows: RecipientRow[] } | null>(null);
  const [stickerLabel, setStickerLabel] = useState('');
  const [stickerUploading, setStickerUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/broadcasts`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '配信の取得に失敗しました');
      setBroadcasts(Array.isArray(json.broadcasts) ? json.broadcasts : []);
      setOverview(json.overview ?? null);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '配信の取得に失敗しました', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [base, toast]);

  const loadStickers = useCallback(async () => {
    try {
      const res = await fetch(`${base}/broadcast-stickers`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setStickers(Array.isArray(json.stickers) ? json.stickers : []);
    } catch {
      /* 補助データ */
    }
  }, [base]);

  useEffect(() => {
    load();
    loadStickers();
  }, [load, loadStickers]);

  // 送信中のものがある間は 20 秒おき、予約済みがある間は 60 秒おきに取り直す（送信の進み具合を画面に出すため）
  const hasSending = broadcasts.some((b) => b.status === 'sending');
  const hasScheduled = broadcasts.some((b) => b.status === 'scheduled');
  useEffect(() => {
    if (!hasSending && !hasScheduled) return;
    const t = setInterval(load, hasSending ? 20000 : 60000);
    return () => clearInterval(t);
  }, [hasSending, hasScheduled, load]);

  // 条件の選択肢（タグ・メニュー・フォーム・アンケート）と保存済み LINE メッセージ
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const get = async (url: string) => {
        try {
          const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
          return res.ok ? await res.json() : null;
        } catch {
          return null;
        }
      };
      const [tags, forms, surveys, msgs] = await Promise.all([get(`${base}/customers/tags`), get(`${base}/forms`), get(`${base}/surveys`), get(`${base}/line-messages`)]);
      if (cancelled) return;
      const formList = Array.isArray(forms) ? forms : [];
      setOptions({
        tags: Array.isArray(tags?.tags) ? tags.tags.map((t: { tag: string }) => t.tag).filter(Boolean) : [],
        menus: menuNamesFromForms(formList),
        forms: formOptionsFromForms(formList),
        surveys: surveyChoicesFromForms(Array.isArray(surveys) ? surveys : []),
      });
      setMessages(Array.isArray(msgs?.messages) ? msgs.messages : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const post = async (url: string, okTitle: string, failTitle: string) => {
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || failTitle);
      toast({ title: okTitle });
      await load();
      return json;
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : failTitle, variant: 'destructive' });
      return null;
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`${base}/broadcasts/${deleting.id}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '削除に失敗しました');
      toast({ title: '削除しました' });
      setDeleting(null);
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '削除に失敗しました', variant: 'destructive' });
    }
  };

  const toggleDetail = async (b: Broadcast) => {
    if (detailId === b.id) {
      setDetailId(null);
      return;
    }
    setDetailId(b.id);
    setRecipients(null);
    try {
      const res = await fetch(`${base}/broadcasts/${b.id}/recipients?limit=200`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setRecipients({ total: json.total ?? 0, rows: Array.isArray(json.recipients) ? json.recipients : [] });
    } catch {
      /* ignore */
    }
  };

  const uploadSticker = async (file: File) => {
    setStickerUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('storeId', storeId);
      fd.append('menuId', `sticker_${Math.random().toString(36).slice(2, 10)}`);
      const up = await fetch('/api/upload/menu-image', { method: 'POST', body: fd, credentials: 'include' });
      const upJson = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upJson.error || 'アップロードに失敗しました');
      const res = await fetch(`${base}/broadcast-stickers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ label: stickerLabel || file.name.replace(/\.[^.]+$/, ''), url: upJson.url }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'スタンプの保存に失敗しました');
      toast({ title: 'スタンプを追加しました' });
      setStickerLabel('');
      loadStickers();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'スタンプの追加に失敗しました', variant: 'destructive' });
    } finally {
      setStickerUploading(false);
    }
  };

  const removeSticker = async (s: BroadcastSticker) => {
    try {
      const res = await fetch(`${base}/broadcast-stickers?id=${encodeURIComponent(s.id)}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '削除に失敗しました');
      loadStickers();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '削除に失敗しました', variant: 'destructive' });
    }
  };

  const formName = (id: string) => options.forms.find((f) => f.id === id)?.name ?? id;
  const limit = overview?.settings.monthly_limit ?? null;
  const totalTaps = (b: Broadcast) => Object.values(b.tap_counts ?? {}).reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0);

  return (
    <div className="space-y-4" data-slot="broadcast-panel">
      {showGuide && (
      <Card data-slot="guide" className="border-[#06C755]/30 bg-[#06C755]/5">
        <CardContent className="p-4">
          <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setGuideOpen((v) => !v)}>
            <span className="text-sm font-medium">配信とは / 使い方</span>
            {guideOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {guideOpen && (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-muted-foreground">公式 LINE の友だちのうち、タグや予約したメニュー・最終来店日などで絞り込んだお客様にだけメッセージを送れます。</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>「新しい配信」で<span className="font-medium">配信先</span>を選ぶ（条件を足すたびに人数が出ます。条件なし = すべての友だち）。</li>
                <li><span className="font-medium">メッセージ</span>を追加（保存済みの LINE メッセージ・テキスト・画像・動画・スタンプ。最大 5 通）。</li>
                <li>「テスト送信」で自分の LINE に送って確認してから、<span className="font-medium">今すぐ送る</span> か <span className="font-medium">日時を指定</span>して予約。</li>
              </ol>
              <p className="text-[11px] text-muted-foreground">
                ※ 配信は公式 LINE の無料メッセージ通数を使います（1 人 = 1 通。5 通まとめて送っても 1 通）。予約のリマインダーなども同じ枠を使うので、送りすぎに注意してください。
                お客様が「{overview?.settings.opt_out_keyword ?? '配信停止'}」と送ると、以後の配信から外れます（予約の確認・リマインダーは届きます）。
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {overview && !overview.token_set && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">この店舗の LINE チャネルアクセストークンが未設定のため、配信できません（店舗編集で登録してください）。</p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="text-sm" data-slot="broadcast-usage">
          今月の配信 <span className="font-semibold tabular-nums">{overview?.used ?? 0}</span> 通
          {limit !== null && <span className="text-muted-foreground"> / 上限 {limit} 通（残り {Math.max(0, limit - (overview?.used ?? 0))}）</span>}
          {overview && overview.opt_out_count > 0 && <span className="ml-3 text-muted-foreground">配信停止 {overview.opt_out_count} 人</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}>配信一覧</Button>
          <Button size="sm" variant={view === 'stickers' ? 'default' : 'outline'} onClick={() => setView('stickers')}>スタンプ・素材</Button>
          <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>＋ 新しい配信</Button>
        </div>
      </div>

      {view === 'list' &&
        (loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">読み込み中…</p>
        ) : broadcasts.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">まだ配信がありません。「新しい配信」から作ってください。</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {broadcasts.map((b) => {
              const st = STATUS_LABEL[b.status];
              return (
                <Card key={b.id} data-slot="list-item">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{b.name}</span>
                          <Badge variant="outline" className={st.className} data-slot="status-chip">{st.label}</Badge>
                          {b.status === 'scheduled' && <span className="text-xs text-muted-foreground">{fmt(b.scheduled_at)} に送信</span>}
                          {(b.status === 'sent' || b.status === 'failed') && <span className="text-xs text-muted-foreground">{fmt(b.finished_at ?? b.started_at)}</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">配信先: {describeAudience(b.audience, { formName })}</p>
                        <p className="text-xs text-muted-foreground">内容: {describeBroadcastItems(b.items)}</p>
                        {b.status !== 'draft' && (
                          <p className="text-xs tabular-nums">
                            対象 {b.recipient_count} 人
                            {(b.status === 'sending' || b.status === 'sent' || b.status === 'failed') && ` ・ 送信 ${b.sent_count} ・ 失敗 ${b.failed_count}`}
                            {b.status === 'sent' && b.track_taps && Object.keys(b.links ?? {}).length > 0 && ` ・ ボタンタップ ${totalTaps(b)} 回`}
                          </p>
                        )}
                        {b.error && <p className="text-xs text-destructive">{b.error}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {b.status === 'draft' && <Button size="sm" onClick={() => { setEditing(b); setEditorOpen(true); }}>編集</Button>}
                        {b.status === 'scheduled' && <Button size="sm" variant="outline" onClick={() => setCancelling(b)}>予約を取り消す</Button>}
                        {b.status !== 'draft' && <Button size="sm" variant="outline" onClick={() => toggleDetail(b)}>{detailId === b.id ? '閉じる' : '宛先と結果'}</Button>}
                        <Button size="sm" variant="outline" onClick={() => post(`${base}/broadcasts/${b.id}/duplicate`, '複製しました（下書き）', '複製に失敗しました')}>複製</Button>
                        {b.status !== 'scheduled' && b.status !== 'sending' && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(b)}>削除</Button>}
                      </div>
                    </div>
                    {detailId === b.id && (
                      <div className="rounded-md border bg-muted/30 p-2 text-xs">
                        {!recipients ? (
                          <p className="text-muted-foreground">読み込み中…</p>
                        ) : recipients.rows.length === 0 ? (
                          <p className="text-muted-foreground">宛先がありません</p>
                        ) : (
                          <>
                            <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                              {recipients.rows.map((r) => (
                                <li key={r.id} className="flex items-center gap-2">
                                  <span className={`w-12 shrink-0 ${r.status === 'failed' ? 'text-destructive' : r.status === 'sent' ? 'text-green-700' : 'text-muted-foreground'}`}>
                                    {r.status === 'sent' ? '送信済み' : r.status === 'failed' ? '失敗' : r.status === 'skipped' ? '見送り' : '待機中'}
                                  </span>
                                  <span className="truncate">{r.display_name || 'お客様'}</span>
                                  {r.error && <span className="truncate text-muted-foreground" title={r.error}>{r.error}</span>}
                                </li>
                              ))}
                            </ul>
                            {recipients.total > recipients.rows.length && <p className="mt-1 text-muted-foreground">ほか {recipients.total - recipients.rows.length} 人</p>}
                          </>
                        )}
                        {b.track_taps && Object.keys(b.links ?? {}).length > 0 && (
                          <div className="mt-2 border-t pt-2">
                            <p className="mb-1 text-muted-foreground">ボタンごとのタップ数</p>
                            <ul className="space-y-0.5">
                              {Object.entries(b.links).map(([key, url]) => (
                                <li key={key} className="flex items-center gap-2">
                                  <span className="w-10 text-right tabular-nums">{b.tap_counts?.[key] ?? 0} 回</span>
                                  <span className="truncate text-muted-foreground" title={url}>{url}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}

      {view === 'stickers' && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <h3 className="text-sm font-semibold">スタンプ・素材</h3>
              <p className="text-xs text-muted-foreground">配信のメッセージで「＋ スタンプ」から選べます。スタンプは画像メッセージとして届きます（正方形の JPEG / PNG がおすすめ。5MB まで）。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={stickerLabel} maxLength={30} onChange={(e) => setStickerLabel(e.target.value)} placeholder="名前（例: ありがとう）" className="h-8 w-48 text-xs" />
              <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs hover:bg-muted">
                {stickerUploading ? 'アップロード中…' : '画像を追加'}
                <input type="file" accept="image/jpeg,image/png" className="hidden" disabled={stickerUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSticker(f); e.target.value = ''; }} />
              </label>
            </div>
            {stickers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">スタンプがまだありません。画像を追加してください。</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
                {stickers.map((s) => (
                  <div key={s.id} className="space-y-1 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.preview_url || s.url} alt={s.label} className="aspect-square w-full rounded-lg border object-cover" />
                    <p className="truncate text-[11px]">{s.label}</p>
                    {s.store_id ? (
                      <button type="button" className="text-[11px] text-destructive hover:underline" onClick={() => removeSticker(s)}>削除</button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">共通</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <BroadcastEditorDialog
        storeId={storeId}
        open={editorOpen}
        initial={editing}
        options={options}
        messages={messages}
        stickers={stickers}
        onClose={() => setEditorOpen(false)}
        onSaved={(saved) => {
          setEditing(saved.status === 'draft' ? saved : null);
          setBroadcasts((prev) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev]));
          if (saved.status !== 'draft') load();
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{deleting?.name}」を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>配信の記録（宛先と結果）も消えます。今月の配信通数の集計からも外れます。この操作は元に戻せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!cancelling} onOpenChange={(o) => { if (!o) setCancelling(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{cancelling?.name}」の予約を取り消しますか？</AlertDialogTitle>
            <AlertDialogDescription>下書きに戻ります。内容を直して、もう一度予約できます。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { const b = cancelling; setCancelling(null); if (b) await post(`${base}/broadcasts/${b.id}/cancel`, '予約を取り消しました（下書きに戻しました）', '取り消しに失敗しました'); }}>取り消す</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
