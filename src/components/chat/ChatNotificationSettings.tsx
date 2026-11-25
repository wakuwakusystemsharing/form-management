'use client';

/**
 * 1 対 1 トークの新着の通知の設定カード（スタッフの LINE・メール・送らない時間帯）
 * 店舗管理者ページの設定タブ（トークのタブが出ている店舗だけ）と、テナント側 店舗ページの設定タブで共用。
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章「未読と通知」
 *
 * - 既定は OFF。管理画面の未読の数（赤い数字）は、この設定に関係なく出る
 * - 通知にメッセージの本文は載せない（「〇〇様から新しいメッセージが届きました」とリンクだけ）
 * - 同じお客様からの新着は 10 分に 1 回まで。夜間（送らない時間帯）は送らない
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';
import { CHAT_NOTIFY_EMAIL_MAX, type ChatNotifySettings } from '@/lib/chat-notify';

interface View {
  settings: ChatNotifySettings;
  chat_enabled: boolean;
  staff_count: number;
  unavailable: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function ChatNotificationSettings({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}/chat/notifications`;
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChatNotifySettings | null>(null);
  const [emailsText, setEmailsText] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  const apply = useCallback((v: View) => {
    setView(v);
    setDraft(v.settings);
    setEmailsText(v.settings.emails.join('\n'));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth(base, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(json?.error || '通知の設定の取得に失敗しました');
        return;
      }
      apply(json);
      setLoadError(null);
    } catch {
      setLoadError('通知の設定の取得に失敗しました');
    }
  }, [base, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const emails = emailsText
    .split(/[\n,、\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const dirty = !!view && !!draft && JSON.stringify({ ...draft, emails }) !== JSON.stringify(view.settings);

  const save = async () => {
    if (!draft || busy) return;
    setBusy('save');
    try {
      const res = await fetchWithAuth(base, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, emails }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: '保存できませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
        return;
      }
      apply(json);
      toast({ title: '通知の設定を保存しました' });
    } catch {
      toast({ title: '保存できませんでした', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy('test');
    try {
      const res = await fetchWithAuth(`${base}/test`, { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: 'テストの通知を送れませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
        return;
      }
      const parts = [json.line_sent > 0 ? `LINE ${json.line_sent} 人` : '', json.email_sent > 0 ? `メール ${json.email_sent} 件` : ''].filter(Boolean).join('・');
      toast({ title: 'テストの通知を送りました', description: `${parts}${json.failed > 0 ? `（${json.failed} 件は送れませんでした）` : ''}` });
    } catch {
      toast({ title: 'テストの通知を送れませんでした', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const set = (patch: Partial<ChatNotifySettings>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setQuiet = (patch: Partial<ChatNotifySettings['quiet']>) => setDraft((d) => (d ? { ...d, quiet: { ...d.quiet, ...patch } } : d));
  const anyOn = !!view && (view.settings.line || (view.settings.email && view.settings.emails.length > 0));

  return (
    <Card data-slot="chat-notify-settings">
      <CardHeader>
        <CardTitle className="text-base">トークの新着の通知</CardTitle>
        <CardDescription>
          お客様から新しいメッセージが届いたとき、スタッフの LINE やメールで知らせます。通知には、メッセージの内容は載せません（「〇〇様から新しいメッセージが届きました」とリンクだけです）。管理画面の未読の数は、この設定に関係なく出ます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loadError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">{loadError}</p>}

        {view && draft && (
          <>
            {view.unavailable && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">データベースの更新（マイグレーション）がまだ適用されていないため、通知の設定は保存できません。</p>}
            {!view.chat_enabled && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">トーク機能が OFF のあいだは、新しいメッセージが保存されないので、通知も届きません。</p>}

            <div className="space-y-2">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={draft.line} onChange={(e) => set({ line: e.target.checked })} data-slot="chat-notify-line" />
                <span>
                  スタッフの LINE に通知する
                  <span className="block text-xs text-muted-foreground">
                    「今日の予約まとめ」で登録したスタッフ（いま {view.staff_count} 人）に、この店舗の公式 LINE から送ります。公式 LINE の通数を使います（1 回の通知 × スタッフの人数）。
                  </span>
                </span>
              </label>
              {draft.line && view.staff_count === 0 && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  LINE で受け取るスタッフが、まだ登録されていません。設定の「今日の予約まとめ・月次レポート」にある合言葉を付けて、スタッフが公式 LINE に「スタッフ登録 合言葉」と送ると登録されます。
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={draft.email} onChange={(e) => set({ email: e.target.checked })} data-slot="chat-notify-email" />
                <span>
                  メールで通知する
                  <span className="block text-xs text-muted-foreground">通数は使いません。</span>
                </span>
              </label>
              {draft.email && (
                <div className="space-y-1 pl-6">
                  <label htmlFor="chat_notify_emails" className="text-xs text-muted-foreground">
                    通知を受け取るメールアドレス（1 行に 1 件。{CHAT_NOTIFY_EMAIL_MAX} 件まで）
                  </label>
                  <textarea
                    id="chat_notify_emails"
                    rows={3}
                    value={emailsText}
                    onChange={(e) => setEmailsText(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                    placeholder="staff@example.com"
                    data-slot="chat-notify-emails"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={draft.quiet.enabled} onChange={(e) => setQuiet({ enabled: e.target.checked })} data-slot="chat-notify-quiet" />
                <span>
                  夜間は通知を送らない
                  <span className="block text-xs text-muted-foreground">その時間帯に届いたメッセージは、明けたあとの最初の新着と一緒に知らせます（未読の数にまとめて出ます）。</span>
                </span>
              </label>
              {draft.quiet.enabled && (
                <div className="flex flex-wrap items-center gap-2 pl-6 text-xs">
                  <select
                    className="h-10 rounded-md border border-input bg-background px-2 text-base md:text-sm"
                    value={draft.quiet.start}
                    onChange={(e) => setQuiet({ start: Number(e.target.value) })}
                    aria-label="送らない時間帯の始まり"
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h} 時
                      </option>
                    ))}
                  </select>
                  <span>から</span>
                  <select className="h-10 rounded-md border border-input bg-background px-2 text-base md:text-sm" value={draft.quiet.end} onChange={(e) => setQuiet({ end: Number(e.target.value) })} aria-label="送らない時間帯の終わり">
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h} 時
                      </option>
                    ))}
                  </select>
                  <span>まで（日本時間）</span>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">同じお客様からの新着は、10 分に 1 回までお知らせします。予約フォームの送信や「予約確認」などのボタンでは通知しません。</p>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={save} disabled={!!busy || !dirty || view.unavailable} data-slot="chat-notify-save">
                {busy === 'save' ? '保存中…' : '保存'}
              </Button>
              <Button type="button" variant="outline" onClick={test} disabled={!!busy || dirty || !anyOn} data-slot="chat-notify-test">
                {busy === 'test' ? '送信中…' : 'テストの通知を送る'}
              </Button>
              {dirty && <span className="text-xs text-muted-foreground">保存すると、テストの通知を送れます</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
