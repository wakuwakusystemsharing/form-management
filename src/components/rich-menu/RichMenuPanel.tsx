'use client';

/**
 * リッチメニュー（公式 LINE のトーク画面の下に出るメニュー）の一覧。
 * 作る・編集する・公式 LINE に反映する・反映をやめる・削除する。
 * 店舗管理者ページの「リッチメニュー」タブと、テナント側 店舗ページのタブで共用
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RefreshCw } from 'lucide-react';
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
import type { AudienceOptions } from '@/components/broadcast/AudienceEditor';
import { describeAudience } from '@/lib/broadcast-audience';
import { formOptionsFromForms, menuNamesFromForms, surveyChoicesFromForms } from '@/lib/broadcast-options';
import { sortRuleMenus } from '@/lib/line-rich-menu-rules';

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
  // 「条件に合うお客様だけ」の条件に使う選択肢
  const [audienceOptions, setAudienceOptions] = useState<AudienceOptions>({ tags: [], menus: [], forms: [], surveys: [] });
  const [syncing, setSyncing] = useState(false);

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

  // 条件の選択肢（タグ・メニュー・フォーム・アンケート）。読めなくても画面は使える
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = `/api/stores/${storeId}`;
      const get = async (url: string) => {
        try {
          const res = await fetchWithAuth(url, { cache: 'no-store' });
          return res.ok ? await res.json() : null;
        } catch {
          return null;
        }
      };
      const [tags, formList, surveys] = await Promise.all([get(`${base}/customers/tags`), get(`${base}/forms`), get(`${base}/surveys`)]);
      if (cancelled) return;
      const list = Array.isArray(formList) ? formList : [];
      setAudienceOptions({
        tags: Array.isArray(tags?.tags) ? tags.tags.map((t: { tag: string }) => t.tag).filter(Boolean) : [],
        menus: menuNamesFromForms(list),
        forms: formOptionsFromForms(list),
        surveys: surveyChoicesFromForms(Array.isArray(surveys) ? surveys : []),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const forms: RichMenuFormOption[] = overview?.forms || [];
  const menus = overview?.menus || [];
  const formName = (id: string) => forms.find((f) => f.id === id)?.name ?? null;
  const menuName = (id: string) => menus.find((m) => m.id === id)?.name ?? null;
  const messageName = (id: string) => (overview?.messages || []).find((m) => m.id === id)?.name ?? null;
  // 全員向けに出しているメニュー（切り替え先のメニューは、このメニューと一緒に出ている）
  const mainMenu = menus.find((m) => m.is_default) ?? null;
  // お客様ごとのメニュー（優先順位の順）と、それ以外（全員向け・切り替え先）
  const ruleMenus = sortRuleMenus(menus);
  const ruleIds = ruleMenus.map((m) => m.id);
  const ordered = [...menus.filter((m) => !m.rule), ...ruleMenus];
  const firstRuleId = ruleIds[0] ?? null;

  const moveRule = async (id: string, direction: -1 | 1) => {
    const index = ruleIds.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ruleIds.length || busyId) return;
    const ids = [...ruleIds];
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusyId(id);
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/rich-menus/rule-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast({ title: '優先順位を変えられませんでした', description: json?.error || `エラーコード: ${res.status}`, variant: 'destructive' });
      }
    } catch {
      toast({ title: '通信に失敗しました', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setBusyId(null);
      void load();
    }
  };

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/rich-menus/sync`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) toast({ title: '見直せませんでした', description: json?.error || `エラーコード: ${res.status}`, variant: 'destructive' });
      else toast({ title: 'お客様ごとのメニューを見直しました', description: json?.summary || undefined });
    } catch {
      toast({ title: '通信に失敗しました', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setSyncing(false);
      void load();
    }
  };
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
        toast({ title: c.menu.rule && !json?.notice ? (c.kind === 'publish' ? '条件に合うお客様に出しました' : c.kind === 'unpublish' ? '出すのをやめました' : title) : title, description: json?.notice || json?.summary || (c.kind === 'publish' ? 'お客様のトーク画面に出るまで、少し時間がかかることがあります' : undefined) });
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
          {ordered.map((menu) => {
            const busy = busyId === menu.id;
            const isRule = !!menu.rule;
            const ruleIndex = ruleIds.indexOf(menu.id);
            const live = menu.status === 'published' && (menu.is_default || isRule);
            // 全員向けではないが、切り替え先として公式 LINE に出ているメニュー
            const linked = menu.status === 'published' && !menu.is_default && !isRule;
            // このメニューから切り替えで行けるメニューに、未反映の変更があるか
            const linkedDirty = live && !isRule && menus.some((m) => m.id !== menu.id && !m.rule && m.status === 'published' && !m.is_default && m.dirty);
            return (
              <Card key={menu.id} data-slot="rich-menu-card" className={isRule && menu.id === firstRuleId ? 'lg:col-start-1' : undefined}>
                <CardContent className="space-y-3 p-4">
                  {isRule && (
                    <div className="flex flex-wrap items-center gap-2 text-xs" data-slot="rich-menu-rule-head">
                      <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                        お客様ごと・優先 {ruleIndex + 1}
                      </Badge>
                      <span className="flex-1" />
                      <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label="優先順位を上げる" disabled={busy || ruleIndex <= 0} onClick={() => void moveRule(menu.id, -1)}>
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label="優先順位を下げる" disabled={busy || ruleIndex >= ruleIds.length - 1} onClick={() => void moveRule(menu.id, 1)}>
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{menu.name}</h3>
                    <Badge variant="outline" className={statusBadge(menu)}>
                      {linked ? '切り替え先として反映中' : isRule && menu.status === 'published' ? '条件に合うお客様に表示中' : RICH_MENU_STATUS_LABELS[menu.status]}
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
                  {menu.rule && (
                    <p className="rounded-md bg-muted/50 px-2 py-1.5 text-xs" data-slot="rich-menu-rule-text">
                      出す相手: {describeAudience(menu.rule.audience, { formName: (id) => formName(id) ?? id })}
                      {menu.status === 'published' && <span className="ml-2 font-medium tabular-nums">（いま {overview?.link_counts?.[menu.id] ?? 0} 人に設定中）</span>}
                    </p>
                  )}
                  {menu.areas.length > 0 && (
                    <ol className="space-y-0.5 text-xs text-muted-foreground">
                      {menu.areas.map((a, i) => (
                        <li key={a.id} className="truncate">
                          {i + 1}. {describeRichMenuAction(a.action, formName, menuName, messageName)}
                        </li>
                      ))}
                    </ol>
                  )}
                  {live && menu.dirty && <p className="text-xs text-amber-700">保存した変更は、まだ公式 LINE に出ていません。「{isRule ? 'もう一度出す' : 'もう一度反映する'}」を押すと出ます。</p>}
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
                      {busy ? '通信中…' : isRule ? (live ? 'もう一度出す' : '条件に合うお客様に出す') : live ? 'もう一度反映する' : linked ? 'このメニューを最初に出す' : '反映する'}
                    </Button>
                    {!linked && (menu.is_default || menu.line_rich_menu_id || live) && (
                      <Button type="button" variant="outline" size="sm" disabled={busy || menu.status === 'publishing'} onClick={() => setConfirm({ kind: 'unpublish', menu })}>
                        {isRule ? '出すのをやめる' : '反映をやめる'}
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
      {ruleMenus.length > 0 && (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground" data-slot="rich-menu-rules-note">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-foreground">お客様ごとのメニューについて</p>
            <Button type="button" variant="outline" size="sm" disabled={syncing || !ruleMenus.some((m) => m.status === 'published')} onClick={() => void syncNow()}>
              <RefreshCw className={syncing ? 'mr-1 h-3.5 w-3.5 animate-spin' : 'mr-1 h-3.5 w-3.5'} aria-hidden="true" />
              {syncing ? '見直しています…' : 'いま見直す'}
            </Button>
          </div>
          <p>
            条件に合うお客様には、全員向けのメニューの代わりに、そのメニューが出ます。条件が重なるお客様には、優先の数字が小さいメニューが出ます。だれに出すかは、予約が入ったとき・顧客情報を変えたとき・1 日 1 回、自動で見直します。すぐに合わせたいときは「いま見直す」を押してください。
          </p>
          {overview?.rule_unavailable && <p className="text-amber-700">{overview.rule_unavailable}</p>}
        </div>
      )}
      {reachedMax && <p className="text-xs text-muted-foreground">リッチメニューは {overview?.max} 個までです。使っていないものを削除すると、新しく作れます。</p>}

      <RichMenuEditorDialog
        open={!!editing}
        storeId={storeId}
        menu={editing?.menu ?? null}
        forms={forms}
        messages={overview?.messages || []}
        menus={menus}
        audienceOptions={audienceOptions}
        ruleUnavailable={overview?.rule_unavailable ?? null}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          toast({
            title: '保存しました',
            description: saved.rule
              ? saved.status === 'published'
                ? '公式 LINE に出すには、「もう一度出す」を押してください'
                : '公式 LINE に出すには、「条件に合うお客様に出す」を押してください'
              : saved.status === 'published'
                ? '公式 LINE に出すには、「もう一度反映する」を押してください'
                : '公式 LINE に出すには、「反映する」を押してください',
          });
          void load();
        }}
      />

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent data-slot="rich-menu-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'publish'
                ? confirm.menu.rule
                  ? 'このメニューを、条件に合うお客様に出しますか？'
                  : 'このメニューを公式 LINE に反映しますか？'
                : confirm?.kind === 'unpublish'
                  ? confirm.menu.rule
                    ? 'このメニューを出すのをやめますか？'
                    : 'このメニューの反映をやめますか？'
                  : 'このメニューを削除しますか？'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{confirm?.menu.name}</p>
                {confirm?.kind === 'publish' && confirm.menu.rule && (
                  <>
                    <p>条件に合うお客様のトーク画面に、全員向けのメニューの代わりに、このメニューが出ます。条件に合わないお客様のメニューは変わりません。</p>
                    <p>出す相手: {describeAudience(confirm.menu.rule.audience, { formName: (id) => formName(id) ?? id })}</p>
                  </>
                )}
                {confirm?.kind === 'publish' && !confirm.menu.rule && (
                  <>
                    <p>友だち全員のトーク画面に、このメニューが表示されます。公式 LINE の管理画面で設定したメニューや、いま反映しているメニューは、このメニューに置き換わります。</p>
                    <p>新しいメニューが出てから古いものを消すので、メニューが出ない時間はありません。</p>
                    <p>切り替えのボタンがあるときは、切り替え先のメニューも一緒に公式 LINE に出ます（最初に出るのは、このメニューです）。</p>
                  </>
                )}
                {confirm?.kind === 'unpublish' && confirm.menu.rule && <p>このメニューを出していたお客様は、次に条件が合うメニューか、全員向けのメニューに戻ります。メニューの内容は下書きとして残ります。</p>}
                {confirm?.kind === 'unpublish' && !confirm.menu.rule && <p>友だちのトーク画面からこのメニューが消え、公式 LINE の管理画面で設定したメニューに戻ります（設定していなければ、メニューは出なくなります）。メニューの内容は下書きとして残ります。</p>}
                {confirm?.kind === 'delete' && <p>削除すると元に戻せません。</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>{confirm?.kind === 'publish' ? (confirm.menu.rule ? '出す' : '反映する') : confirm?.kind === 'unpublish' ? (confirm.menu.rule ? '出すのをやめる' : '反映をやめる') : '削除する'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
