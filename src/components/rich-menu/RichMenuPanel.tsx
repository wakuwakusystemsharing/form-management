'use client';

/**
 * リッチメニュー（公式 LINE のトーク画面の下に出るメニュー）の一覧。
 * 作る・編集する・公式 LINE に反映する・反映をやめる・削除する。
 * 店舗管理者ページの「リッチメニュー」タブと、テナント側 店舗ページのタブで共用
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';
import { RICH_MENU_SIZES, RICH_MENU_STATUS_LABELS, describeRichMenuAction, type LineRichMenu } from '@/lib/line-rich-menu';
import type { RichMenuFormOption, RichMenuOverview } from '@/lib/line-rich-menu-service';
import RichMenuAreaCanvas from './RichMenuAreaCanvas';
import RichMenuEditorDialog from './RichMenuEditorDialog';

type Confirm = { kind: 'publish' | 'unpublish' | 'delete'; menu: LineRichMenu };

function statusBadge(menu: LineRichMenu): string {
  if (menu.status === 'published') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (menu.status === 'failed') return 'bg-red-50 text-red-700 border-red-200';
  if (menu.status === 'publishing') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

export default function RichMenuPanel({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const [overview, setOverview] = useState<RichMenuOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ menu: LineRichMenu | null } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // 通信中のメニュー（ボタンを押した直後に無効にして、2 回押しを防ぐ）
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/rich-menus`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setError(json?.error || 'リッチメニューの取得に失敗しました');
        return;
      }
      setOverview(json as RichMenuOverview);
      setError(null);
    } catch {
      setError('リッチメニューの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const forms: RichMenuFormOption[] = overview?.forms || [];
  const menus = overview?.menus || [];
  const formName = (id: string) => forms.find((f) => f.id === id)?.name ?? null;
  const menuName = (id: string) => menus.find((m) => m.id === id)?.name ?? null;
  // 全員向けに出しているメニュー（切り替え先のメニューは、このメニューと一緒に出ている）
  const mainMenu = menus.find((m) => m.is_default) ?? null;
  const reachedMax = !!overview && menus.length >= overview.max;

  const run = async () => {
    const c = confirm;
    if (!c || busyId) return;
    setConfirm(null);
    setBusyId(c.menu.id);
    const base = `/api/stores/${storeId}/rich-menus/${c.menu.id}`;
    try {
      const res = await fetchWithAuth(c.kind === 'delete' ? base : `${base}/${c.kind}`, { method: c.kind === 'delete' ? 'DELETE' : 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: c.kind === 'publish' ? '反映できませんでした' : c.kind === 'unpublish' ? '反映をやめられませんでした' : '削除できませんでした', description: json?.error || `エラーコード: ${res.status}`, variant: 'destructive' });
      } else {
        // local は LINE と通信しないので、「反映しました」とは言わない（notice に理由が入る）
        const title = json?.notice ? '記録を更新しました' : c.kind === 'publish' ? '公式 LINE に反映しました' : c.kind === 'unpublish' ? '反映をやめました' : '削除しました';
        toast({ title, description: json?.notice || (c.kind === 'publish' ? 'お客様のトーク画面に出るまで、少し時間がかかることがあります' : undefined) });
      }
    } catch {
      toast({ title: '通信に失敗しました', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setBusyId(null);
      void load();
    }
  };

  return (
    <div className="space-y-4" data-slot="rich-menu-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">リッチメニュー</h2>
          <p className="text-sm text-muted-foreground">公式 LINE のトーク画面の下に出るメニュー（画像とボタン）を作って、公式 LINE に反映します。</p>
        </div>
        <Button type="button" onClick={() => setEditing({ menu: null })} disabled={loading || reachedMax}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          新しく作る
        </Button>
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        「反映する」を押すと、公式 LINE の管理画面で設定したメニューの代わりに、こちらのメニューが全員に表示されます。「反映をやめる」を押すと、公式 LINE の管理画面のメニューに戻ります。
      </div>

      {overview?.local && <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">local では LINE に反映しません（記録だけ更新します）。</p>}
      {overview && !overview.local && !overview.has_token && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          LINE のチャネルアクセストークンが登録されていないため、反映できません。メニューを作って保存することはできます。
        </p>
      )}
      {overview?.external_notice && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status" data-slot="rich-menu-external">
          {overview.external_notice}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">読み込み中…</p>
      ) : menus.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">まだリッチメニューがありません。「新しく作る」から作成してください。</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {menus.map((menu) => {
            const busy = busyId === menu.id;
            const live = menu.status === 'published' && menu.is_default;
            // 全員向けではないが、切り替え先として公式 LINE に出ているメニュー
            const linked = menu.status === 'published' && !menu.is_default;
            // このメニューから切り替えで行けるメニューに、未反映の変更があるか
            const linkedDirty = live && menus.some((m) => m.id !== menu.id && m.status === 'published' && !m.is_default && m.dirty);
            return (
              <Card key={menu.id} data-slot="rich-menu-card">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{menu.name}</h3>
                    <Badge variant="outline" className={statusBadge(menu)}>
                      {linked ? '切り替え先として反映中' : RICH_MENU_STATUS_LABELS[menu.status]}
                    </Badge>
                    {(live || linked) && menu.dirty && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        未反映の変更あり
                      </Badge>
                    )}
                  </div>
                  <RichMenuAreaCanvas size={menu.size} imageUrl={menu.image_url} areas={menu.areas} className="max-w-sm" />
                  <p className="text-xs text-muted-foreground">
                    大きさ: {RICH_MENU_SIZES[menu.size].label}　／　バーの文言: {menu.chat_bar_text}　／　ボタン {menu.areas.length} 個
                  </p>
                  {menu.areas.length > 0 && (
                    <ol className="space-y-0.5 text-xs text-muted-foreground">
                      {menu.areas.map((a, i) => (
                        <li key={a.id} className="truncate">
                          {i + 1}. {describeRichMenuAction(a.action, formName, menuName)}
                        </li>
                      ))}
                    </ol>
                  )}
                  {live && menu.dirty && <p className="text-xs text-amber-700">保存した変更は、まだ公式 LINE に出ていません。「もう一度反映する」を押すと出ます。</p>}
                  {linkedDirty && !menu.dirty && <p className="text-xs text-amber-700">切り替え先のメニューに、まだ公式 LINE に出ていない変更があります。「もう一度反映する」を押すと出ます。</p>}
                  {linked && (
                    <p className="text-xs text-muted-foreground" data-slot="rich-menu-linked">
                      {mainMenu ? `「${mainMenu.name}」の切り替え先として、一緒に公式 LINE に出ています。` : '切り替え先として公式 LINE に出ています。'}
                      {menu.dirty && mainMenu ? `保存した変更は、「${mainMenu.name}」をもう一度反映すると出ます。` : ''}
                    </p>
                  )}
                  {menu.last_error && (
                    <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700" data-slot="rich-menu-error">
                      前回の反映に失敗しました: {menu.last_error}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={busy || menu.status === 'publishing'} onClick={() => setEditing({ menu })}>
                      編集
                    </Button>
                    <Button type="button" size="sm" disabled={busy || menu.status === 'publishing'} onClick={() => setConfirm({ kind: 'publish', menu })}>
                      {busy ? '通信中…' : live ? 'もう一度反映する' : linked ? 'このメニューを最初に出す' : '反映する'}
                    </Button>
                    {!linked && (menu.is_default || menu.line_rich_menu_id) && (
                      <Button type="button" variant="outline" size="sm" disabled={busy || menu.status === 'publishing'} onClick={() => setConfirm({ kind: 'unpublish', menu })}>
                        反映をやめる
                      </Button>
                    )}
                    {!live && !linked && menu.status !== 'publishing' && (
                      <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:text-red-700" disabled={busy} onClick={() => setConfirm({ kind: 'delete', menu })}>
                        削除
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {reachedMax && <p className="text-xs text-muted-foreground">リッチメニューは {overview?.max} 個までです。使っていないものを削除すると、新しく作れます。</p>}

      <RichMenuEditorDialog
        open={!!editing}
        storeId={storeId}
        menu={editing?.menu ?? null}
        forms={forms}
        menus={menus}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          toast({ title: '保存しました', description: saved.status === 'published' ? '公式 LINE に出すには、「もう一度反映する」を押してください' : '公式 LINE に出すには、「反映する」を押してください' });
          void load();
        }}
      />

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent data-slot="rich-menu-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'publish' ? 'このメニューを公式 LINE に反映しますか？' : confirm?.kind === 'unpublish' ? 'このメニューの反映をやめますか？' : 'このメニューを削除しますか？'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{confirm?.menu.name}</p>
                {confirm?.kind === 'publish' && (
                  <>
                    <p>友だち全員のトーク画面に、このメニューが表示されます。公式 LINE の管理画面で設定したメニューや、いま反映しているメニューは、このメニューに置き換わります。</p>
                    <p>新しいメニューが出てから古いものを消すので、メニューが出ない時間はありません。</p>
                    <p>切り替えのボタンがあるときは、切り替え先のメニューも一緒に公式 LINE に出ます（最初に出るのは、このメニューです）。</p>
                  </>
                )}
                {confirm?.kind === 'unpublish' && <p>友だちのトーク画面からこのメニューが消え、公式 LINE の管理画面で設定したメニューに戻ります（設定していなければ、メニューは出なくなります）。メニューの内容は下書きとして残ります。</p>}
                {confirm?.kind === 'delete' && <p>削除すると元に戻せません。</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>{confirm?.kind === 'publish' ? '反映する' : confirm?.kind === 'unpublish' ? '反映をやめる' : '削除する'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
