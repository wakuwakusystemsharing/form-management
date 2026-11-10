'use client';

/**
 * 店舗ページ「LINE メッセージ」タブ本体: 公式 LINE 向け Flex Message の一覧・作成・編集
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { ChevronDown, ChevronUp } from 'lucide-react';
import LineFlexEditorDialog, { type FlexFormOption, type FlexStoreInfo } from './LineFlexEditorDialog';
import LineFlexQuickEdit from './LineFlexQuickEdit';
import LineFlexAnswerSummary from './LineFlexAnswerSummary';
import { describeFlexContents, formLiffUrl, LINE_FLEX_TEMPLATES, resolveFlexContents } from '@/lib/line-flex-templates';
import { describeLineFlexItems } from '@/lib/line-flex-items';
import type { LineFlexMessage } from '@/types/line-flex';

export default function LineFlexPanel({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<LineFlexMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<FlexStoreInfo | null>(null);
  const [forms, setForms] = useState<FlexFormOption[]>([]);
  const [editing, setEditing] = useState<LineFlexMessage | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<LineFlexMessage | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // 「プレビュー編集」に未保存の変更があるか（閉じる・別のメッセージを開く前に確認する）
  const [previewDirty, setPreviewDirty] = useState(false);
  const togglePreview = (id: string) => {
    if (previewDirty && !window.confirm('プレビュー編集に未保存の変更があります。閉じると変更は消えます。よろしいですか？')) return;
    setPreviewDirty(false);
    setPreviewId(previewId === id ? null : id);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/line-messages`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setMessages(Array.isArray(json.messages) ? json.messages : []);
      else toast({ title: json.error || 'LINE メッセージの取得に失敗しました', variant: 'destructive' });
    } catch {
      toast({ title: 'LINE メッセージの取得に失敗しました', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storeRes, formsRes] = await Promise.all([
          fetch(`/api/stores/${encodeURIComponent(storeId)}`, { credentials: 'include', cache: 'no-store' }),
          fetch(`/api/stores/${encodeURIComponent(storeId)}/forms`, { credentials: 'include', cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (storeRes.ok) {
          const s = await storeRes.json();
          setStore({ name: s.name, phone: s.phone, address: s.address, website_url: s.website_url, logo_url: s.logo_url, theme_color: s.theme_color });
        }
        if (formsRes.ok) {
          const list = await formsRes.json();
          const arr = Array.isArray(list) ? list : [];
          setForms(
            arr.map((f: any) => ({
              id: String(f.id),
              name: f.config?.basic_info?.form_name || f.form_name || f.name || '予約フォーム',
              liffUrl: formLiffUrl(f),
              form: f,
            }))
          );
        }
      } catch {
        /* 下書き用の補助データなので失敗しても続行 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const remove = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/line-messages/${deleting.id}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '削除に失敗しました');
      toast({ title: '削除しました' });
      setDeleting(null);
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '削除に失敗しました', variant: 'destructive' });
    }
  };

  const templateLabel = (t: string) => LINE_FLEX_TEMPLATES.find((x) => x.id === t)?.label ?? t;
  const totalTaps = (m: LineFlexMessage) => Object.values(m.tap_counts ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

  return (
    <div className="space-y-4" data-slot="line-flex-panel">
      {/* 使い方 */}
      <Card data-slot="guide" className="border-[#06C755]/30 bg-[#06C755]/5">
        <CardContent className="p-4">
          <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setGuideOpen((v) => !v)}>
            <span className="font-medium text-sm">公式 LINE の Flex Message とは / 使い方</span>
            {guideOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {guideOpen && (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-muted-foreground">
                公式 LINE の管理画面では「カードタイプメッセージ」しか作れませんが、ここでは画像・見出し・説明・ボタンを自由に組み合わせた
                <span className="font-medium"> Flex Message </span>をテンプレートから作り、公式 LINE の自動応答や予約の自動メッセージに組み込めます。
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>「新規作成」でテンプレートを選び、項目を埋める（予約フォームのメニュー構成や店舗情報から下書きを作れます）。</li>
                <li>「送り方」で<span className="font-medium">キーワード</span>を登録（例: メニュー）。お客様がその言葉を送ると自動で返信します（無料）。</li>
                <li>公式 LINE 管理画面の<span className="font-medium">リッチメニュー</span>で、ボタンのアクションを「テキスト」にしてそのキーワードを設定すると、タップでこのメッセージが出ます。</li>
                <li>「送る内容の並び」で<span className="font-medium">テキスト・画像・動画・別の Flex</span> を追加すると、1 回の返信でまとめて送れます（最大 5 通。順番も変えられます）。</li>
                <li>予約完了（【ご予約確認】）・リマインダー・フォローメッセージの<span className="font-medium">あとに添える</span>こともできます（次回予約の導線やクーポンに）。</li>
                <li>保存したら「テスト送信」で自分の LINE に送って見た目を確認。ボタンのタップ数はこの一覧に表示されます。</li>
                <li><span className="font-medium">分岐</span>: テンプレート「分岐アンケート（かんたん）」なら、質問と選択肢を入れるだけで、ボタンを押すたびに次の質問や結果が届くメッセージを作れます。ほかのテンプレートでも、ボタンの動きを「押したら次のメッセージを送る」にすると別の LINE メッセージへつなげられます（選んだ内容の集計・タグ付けつき）。</li>
                <li>一覧の<span className="font-medium">「プレビュー編集」</span>を押すと、その場でプレビューの文字や画像をクリックして直し、「更新」で保存できます（名前・キーワード・送り方は「編集」から）。</li>
              </ol>
              <p className="text-[11px] text-muted-foreground">
                ※ 自動応答・差し込みは店舗の LINE チャネルアクセストークン（店舗編集で設定）を使います。公式 LINE 管理画面側の「応答メッセージ」で同じキーワードを設定していると両方届くので、どちらかに寄せてください。
                テスト送信は月の無料通数を 1 通使います。
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">LINE メッセージ <span className="text-sm font-normal text-muted-foreground">{messages.length} 件</span></h3>
        <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>＋ 新規作成</Button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">読み込み中…</p>
      ) : messages.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">まだメッセージがありません。「新規作成」から作ってください。</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => {
            const contents = m.payload && typeof m.payload.contents === 'object' ? (m.payload.contents as Record<string, unknown>) : resolveFlexContents(m);
            const taps = totalTaps(m);
            const itemsText = describeLineFlexItems(m.items ?? []);
            return (
              <Card key={m.id} data-slot="list-item" className={m.enabled ? '' : 'opacity-70'}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate">{m.name}</span>
                        <Badge variant="outline">{templateLabel(m.template)}</Badge>
                        {!m.enabled && <Badge variant="outline" className="text-muted-foreground">無効</Badge>}
                        <span className="text-xs text-muted-foreground">{describeFlexContents(contents)}</span>
                        {itemsText && <Badge variant="outline" className="text-[10px]">{itemsText}</Badge>}
                        {Object.keys(m.branches ?? {}).length > 0 && <Badge variant="outline" className="border-blue-300 bg-blue-50 text-[10px] text-blue-700">分岐あり</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        {m.keywords.length > 0 ? (
                          <>
                            <span className="text-muted-foreground">キーワード:</span>
                            {m.keywords.map((k) => (
                              <span key={k} className="rounded-full bg-muted px-2 py-0.5">{k}</span>
                            ))}
                          </>
                        ) : (
                          <span className="text-muted-foreground">キーワードなし</span>
                        )}
                        {m.attach_confirm && <Badge variant="outline" className="text-[10px]">予約確認に添付</Badge>}
                        {m.attach_reminder && <Badge variant="outline" className="text-[10px]">リマインダーに添付</Badge>}
                        {m.attach_follow && <Badge variant="outline" className="text-[10px]">フォローに添付</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        送信 {m.reply_count} 回 ・ ボタンタップ {m.track_taps ? `${taps} 回` : '計測なし'} ・ 更新 {new Date(m.updated_at).toLocaleDateString('ja-JP')}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => togglePreview(m.id)}>{previewId === m.id ? 'プレビュー編集を閉じる' : 'プレビュー編集'}</Button>
                      <Button size="sm" onClick={() => { setEditing(m); setEditorOpen(true); }}>編集</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(m)}>削除</Button>
                    </div>
                  </div>
                  {previewId === m.id && (
                    <div className="space-y-2">
                      <LineFlexQuickEdit
                        key={m.id}
                        storeId={storeId}
                        message={m}
                        forms={forms}
                        others={messages}
                        onDirtyChange={setPreviewDirty}
                        onSaved={(saved) => setMessages((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))}
                      />
                      {Object.keys(m.branches ?? {}).length > 0 && <LineFlexAnswerSummary storeId={storeId} messageId={m.id} version={m.updated_at} />}
                      {m.track_taps && Object.keys(m.links ?? {}).length > 0 && (
                        <div className="text-xs">
                          <p className="text-muted-foreground mb-1">ボタンごとのタップ数</p>
                          <ul className="space-y-0.5">
                            {Object.entries(m.links).map(([key, url]) => (
                              <li key={key} className="flex items-center gap-2">
                                <span className="tabular-nums w-10 text-right">{m.tap_counts?.[key] ?? 0} 回</span>
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
      )}

      <LineFlexEditorDialog
        storeId={storeId}
        store={store}
        forms={forms}
        others={messages}
        open={editorOpen}
        initial={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={(saved) => {
          setEditing(saved);
          setMessages((prev) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev]));
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{deleting?.name}」を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>キーワード応答・差し込みも止まります。この操作は元に戻せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
