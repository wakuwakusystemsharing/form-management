'use client';

/**
 * 1 対 1 トークの設定カード（ON / OFF・会話の保存期間）
 * テナント側 店舗ページの設定タブ専用（運営だけが使う。API も運営だけが呼べる）。
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
 *
 * - 既定は OFF。ON にした店舗だけ、お客様が公式 LINE に送ったメッセージを保存する
 * - ON にできるのは「LINE 通知の署名チェック」でチャネルシークレットを登録した店舗だけ
 * - OFF にしても保存済みの会話は消さない（新しい会話を保存しなくなるだけ）
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';
import { CHAT_RETENTION_OPTIONS } from '@/lib/chat';

interface View {
  enabled: boolean;
  retention_years: number;
  enabled_at: string | null;
  secret_set: boolean;
  enable_blocker: string | null;
  stats: { threads: number; messages: number; last_message_at: string | null };
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ChatSettingsCard({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}/chat-settings`;
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'on' | 'off' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth(base, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(json?.error || 'トークの設定の取得に失敗しました');
        return;
      }
      setView(json);
      setLoadError(null);
    } catch {
      setLoadError('トークの設定の取得に失敗しました');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: { enabled?: boolean; retention_years?: number }, doneTitle: string, doneDescription?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetchWithAuth(base, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: '保存できませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
        return;
      }
      setView(json);
      setConfirm(null);
      toast({ title: doneTitle, description: doneDescription });
    } catch {
      toast({ title: '保存できませんでした', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-slot="chat-settings">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          1 対 1 トーク
          {view && (
            <Badge variant="outline" className={view.enabled ? 'border-[rgb(55,114,58)]/20 bg-[rgb(209,241,209)] text-[rgb(55,114,58)]' : ''}>
              {view.enabled ? 'ON' : 'OFF'}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          お客様が公式 LINE に送ったメッセージを、このシステムに保存する設定です（運営だけが変更できます）。ON にした店舗だけ保存し、OFF の店舗では何も保存しません。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loadError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">{loadError}</p>}

        {view && (
          <>
            <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
              会話は、このページの「トーク」タブで読んで返信できます。店舗管理者にも見せるときは、上の「店舗管理者に表示するメニュー」で「トークを表示」にチェックを入れてください（チェックを入れるまで、店舗管理者には出ません）。
            </p>

            {!view.enabled && view.enable_blocker && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-slot="chat-enable-blocker">
                {view.enable_blocker}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!view.enabled && confirm !== 'on' && (
                <Button type="button" onClick={() => setConfirm('on')} disabled={busy || !!view.enable_blocker}>
                  トーク機能を ON にする
                </Button>
              )}
              {view.enabled && confirm !== 'off' && (
                <Button type="button" variant="outline" onClick={() => setConfirm('off')} disabled={busy}>
                  トーク機能を OFF にする
                </Button>
              )}
              {view.enabled && view.enabled_at && <span className="text-xs text-muted-foreground">ON にした日時: {formatDateTime(view.enabled_at)}</span>}
            </div>

            {confirm === 'on' && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3" data-slot="chat-confirm-on">
                <p className="font-medium text-amber-900">トーク機能を ON にしますか？</p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-amber-900">
                  <li>この店舗の公式 LINE にお客様が送ったメッセージを、これから保存します（ON にする前のメッセージは保存されません）。</li>
                  <li>体の悩みなど、慎重に扱う内容が入ることがあります。プライバシーポリシーへの記載と、お客様への説明が済んだ店舗だけ ON にしてください。</li>
                  <li>保存期間（{view.retention_years} 年）を過ぎた会話は、自動で削除します。</li>
                  <li>公式 LINE の管理画面やアプリから返信した内容は、このシステムには出ません。返信は「トーク」タブにまとめてください。</li>
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => save({ enabled: true }, 'トーク機能を ON にしました', 'これから届くメッセージを保存します')} disabled={busy}>
                    {busy ? '保存中…' : 'ON にする'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
                    やめる
                  </Button>
                </div>
              </div>
            )}

            {confirm === 'off' && (
              <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3" data-slot="chat-confirm-off">
                <p className="text-red-700">トーク機能を OFF にしますか？ 新しいメッセージを保存しなくなります。保存済みの会話は消えず、保存期間が過ぎたら自動で削除されます。</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="destructive" size="sm" onClick={() => save({ enabled: false }, 'トーク機能を OFF にしました', '新しいメッセージは保存しません')} disabled={busy}>
                    {busy ? '保存中…' : 'OFF にする'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
                    やめる
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="chat_retention_years" className="text-xs text-muted-foreground">
                会話の保存期間（過ぎた会話は自動で削除します）
              </label>
              <div>
                <select
                  id="chat_retention_years"
                  className="h-10 rounded-md border border-input bg-background px-3 text-base md:text-sm"
                  value={view.retention_years}
                  disabled={busy}
                  onChange={(e) => save({ retention_years: Number(e.target.value) }, '保存期間を変更しました')}
                >
                  {CHAT_RETENTION_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y} 年
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs" data-slot="chat-stats">
              <p className="font-medium">保存している会話</p>
              <p className="mt-1 text-muted-foreground">
                {view.stats.threads} 人・{view.stats.messages} 通
                {view.stats.last_message_at ? `（最後に届いた日時: ${formatDateTime(view.stats.last_message_at)}）` : ''}
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={load} disabled={busy}>
                件数を更新
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
