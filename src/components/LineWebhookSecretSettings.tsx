'use client';

/**
 * LINE Webhook の署名チェック（チャネルシークレットの登録）の設定カード
 * テナント側 店舗ページの設定タブ専用（運営だけが使う。API も運営だけが呼べる）。
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 4 章
 *
 * - 登録すると、その店舗の Webhook は「LINE から届いた本物の通知」だけを受け付ける
 * - 未登録の店舗は今までどおり動く
 * - シークレットを間違えて登録すると、その店舗の LINE の自動応答が止まる。登録したら必ず「接続を確認」を押す
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';

interface Status {
  secret_set: boolean;
  updated_at: string | null;
  webhook_url: string;
  error?: string;
}

interface CheckResult {
  endpoint: string | null;
  ok: boolean;
  messages: string[];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function LineWebhookSecretSettings({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}/line-webhook`;
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'delete' | 'check' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth(base, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(json?.error || '状態の取得に失敗しました');
        return;
      }
      setStatus(json);
      setLoadError(json?.error || null);
    } catch {
      setLoadError('状態の取得に失敗しました');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = useCallback(async () => {
    setBusy('check');
    setCheck(null);
    try {
      const res = await fetchWithAuth(`${base}/test`, { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setCheck({ endpoint: null, ok: false, messages: [json?.error || '接続の確認に失敗しました'] });
        return;
      }
      setCheck({ endpoint: json.endpoint ?? null, ok: json.ok === true, messages: Array.isArray(json.messages) ? json.messages : [] });
    } catch {
      setCheck({ endpoint: null, ok: false, messages: ['接続の確認に失敗しました'] });
    } finally {
      setBusy(null);
    }
  }, [base]);

  const save = async () => {
    if (busy) return;
    setBusy('save');
    try {
      const res = await fetchWithAuth(base, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_secret: secret }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: '保存できませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
        setBusy(null);
        return;
      }
      setStatus(json);
      setSecret('');
      toast({ title: 'チャネルシークレットを登録しました', description: '続けて、LINE からの通知を受け取れるか確認します' });
    } catch {
      toast({ title: '保存できませんでした', description: 'もう一度お試しください', variant: 'destructive' });
      setBusy(null);
      return;
    }
    // 間違ったシークレットのまま気づかないと LINE の自動応答が止まるので、登録の直後に必ず確認する
    await runCheck();
  };

  const remove = async () => {
    if (busy) return;
    setBusy('delete');
    try {
      const res = await fetchWithAuth(base, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: '削除できませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
        return;
      }
      setStatus(json);
      setCheck(null);
      setConfirmDelete(false);
      toast({ title: 'チャネルシークレットを削除しました', description: '署名のチェックをやめ、今までどおりの動きに戻りました' });
    } catch {
      toast({ title: '削除できませんでした', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const copyUrl = async () => {
    if (!status?.webhook_url) return;
    try {
      await navigator.clipboard.writeText(status.webhook_url);
      toast({ title: 'Webhook URL をコピーしました' });
    } catch {
      toast({ title: 'コピーできませんでした', variant: 'destructive' });
    }
  };

  return (
    <Card data-slot="line-webhook-secret">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          LINE 通知の署名チェック
          {status && (
            <Badge variant="outline" className={status.secret_set ? 'border-[rgb(55,114,58)]/20 bg-[rgb(209,241,209)] text-[rgb(55,114,58)]' : ''}>
              {status.secret_set ? '登録済み' : '未登録'}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          公式 LINE から届く通知が本物かを確かめる設定です（運営だけが変更できます）。チャネルシークレットを登録すると、LINE 以外から送られた偽の通知を受け付けなくなります。未登録の店舗は今までどおり動きます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loadError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">{loadError}</p>}

        {status && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">この店舗の Webhook URL（LINE Developers の「Messaging API 設定」に登録する URL）</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{status.webhook_url}</code>
                <Button type="button" variant="outline" size="sm" onClick={copyUrl}>
                  コピー
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="line_channel_secret" className="text-xs text-muted-foreground">
                チャネルシークレット（LINE Developers の「チャネル基本設定」にある英数字 32 文字）
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="line_channel_secret"
                  type="password"
                  autoComplete="off"
                  className="min-w-0 flex-1"
                  placeholder={status.secret_set ? '登録済み（変更するときだけ入力）' : '未登録'}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <Button type="button" onClick={save} disabled={!!busy || !secret.trim()}>
                  {busy === 'save' ? '保存中…' : status.secret_set ? '上書きして保存' : '登録する'}
                </Button>
              </div>
              {status.secret_set && status.updated_at && <p className="text-xs text-muted-foreground">最後に登録した日時: {formatDateTime(status.updated_at)}（登録した内容は表示されません）</p>}
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                間違ったシークレットを登録すると、この店舗の LINE の自動応答（予約確認・キャンセル・予約変更など）が動かなくなります。登録すると自動で「接続を確認」を行うので、結果を必ず確かめてください。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={runCheck} disabled={!!busy}>
                {busy === 'check' ? '確認中…' : '接続を確認'}
              </Button>
              {status.secret_set && !confirmDelete && (
                <Button type="button" variant="outline" className="text-red-600" onClick={() => setConfirmDelete(true)} disabled={!!busy}>
                  シークレットを削除
                </Button>
              )}
            </div>

            {confirmDelete && (
              <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-red-700">チャネルシークレットを削除しますか？ 署名のチェックをやめ、今までどおりの動き（確認せずに受け付ける）に戻ります。</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={!!busy}>
                    {busy === 'delete' ? '削除中…' : '削除する'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(false)} disabled={!!busy}>
                    やめる
                  </Button>
                </div>
              </div>
            )}

            {check && (
              <div className={`space-y-1 rounded-md border p-3 ${check.ok ? 'border-[rgb(55,114,58)]/30 bg-[rgb(209,241,209)]/40' : 'border-red-200 bg-red-50'}`} data-slot="line-webhook-check">
                <p className={`font-medium ${check.ok ? 'text-[rgb(55,114,58)]' : 'text-red-700'}`}>{check.ok ? '確認できました' : '問題が見つかりました'}</p>
                {check.messages.map((m, i) => (
                  <p key={i} className={check.ok ? '' : 'text-red-700'}>
                    {m}
                  </p>
                ))}
                {check.endpoint && <p className="break-all text-xs text-muted-foreground">LINE に登録されている Webhook URL: {check.endpoint}</p>}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
