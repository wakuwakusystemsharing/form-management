'use client';

/**
 * 今日の予約まとめ・月次レポート（店舗スタッフへメール / LINE で自動送信）の設定カード
 * 店舗管理者ページの設定タブと、テナント側 店舗ページの設定タブで共用。設計: docs/朝のまとめ・月次レポート_実装設計.md
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { DIGEST_DEFAULT_SETTINGS, DIGEST_EMAIL_MAX, DIGEST_STAFF_MAX, DIGEST_TIME_OPTIONS, STAFF_REGISTER_KEYWORD, STAFF_UNREGISTER_KEYWORD, formatDigestDate, monthLabel, type DigestSettings } from '@/lib/store-digest';

interface StaffView {
  id: string;
  display_name: string;
  created_at: string;
}
interface LogView {
  id: string;
  kind: 'morning' | 'monthly';
  target_key: string;
  status: 'sending' | 'sent' | 'skipped' | 'failed';
  email_sent: number;
  line_sent: number;
  failed_count: number;
  detail: string | null;
}

const LOG_STATUS: Record<LogView['status'], string> = { sending: '送信中', sent: '送信済み', skipped: '見送り', failed: '失敗' };

function logLabel(l: LogView): string {
  return l.kind === 'morning' ? `今日の予約まとめ ${formatDigestDate(l.target_key)}` : `月次レポート ${monthLabel(l.target_key)}`;
}

export default function StoreDigestSettings({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}/digest`;
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [settings, setSettings] = useState<DigestSettings>(DIGEST_DEFAULT_SETTINGS);
  const [emailsText, setEmailsText] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffView[]>([]);
  const [logs, setLogs] = useState<LogView[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUnavailable(json.error || '設定を読み込めませんでした');
        return;
      }
      setUnavailable(null);
      setSettings(json.settings as DigestSettings);
      setEmailsText(((json.settings?.emails as string[]) || []).join('\n'));
      setCode(json.staff_code ?? null);
      setStaff(json.staff || []);
      setLogs(json.logs || []);
    } catch {
      setUnavailable('設定を読み込めませんでした（通信エラー）');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (p: Partial<DigestSettings>) => setSettings((s) => ({ ...s, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      const emails = emailsText.split(/[\n,、\s]+/).map((s) => s.trim()).filter(Boolean);
      const res = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...settings, emails }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '保存に失敗しました');
      setSettings(json.settings as DigestSettings);
      setEmailsText((json.settings.emails as string[]).join('\n'));
      toast({ title: '設定を保存しました' });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '保存に失敗しました', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const reissue = async () => {
    setBusy('code');
    try {
      const res = await fetch(`${base}/staff-code`, { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '合言葉の出し直しに失敗しました');
      setCode(json.staff_code);
      toast({ title: '合言葉を出し直しました', description: '古い合言葉は使えなくなりました。登録済みのスタッフはそのままです。' });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '合言葉の出し直しに失敗しました', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const removeStaff = async (s: StaffView) => {
    setBusy(s.id);
    try {
      const res = await fetch(`${base}/staff/${encodeURIComponent(s.id)}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '解除に失敗しました');
      setStaff((list) => list.filter((x) => x.id !== s.id));
      toast({ title: `${s.display_name} さんの登録を解除しました` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '解除に失敗しました', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async (kind: 'morning' | 'monthly') => {
    setBusy(`test-${kind}`);
    try {
      const res = await fetch(`${base}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ kind }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'テスト送信に失敗しました');
      toast({ title: 'テスト送信しました', description: `メール ${json.email_sent} 件・LINE ${json.line_sent} 人${json.detail ? `（${json.detail}）` : ''}` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'テスト送信に失敗しました', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const reportHref = `/${storeId}/admin?tab=dashboard&report=`;

  return (
    <Card className="shadow-sm" data-slot="store-digest-settings">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">今日の予約まとめ・月次レポート</CardTitle>
        <CardDescription>毎朝「今日の予約」を、毎月 1 日に「先月の成果」を、スタッフのメールや LINE へ自動でお届けします。管理画面を開かなくても、その日の予定が分かります。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">読み込み中…</p>
        ) : unavailable ? (
          <p className="rounded bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{unavailable}</p>
        ) : (
          <>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">送る内容</h3>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={settings.morning.enabled} onCheckedChange={(v) => patch({ morning: { ...settings.morning, enabled: v === true } })} className="mt-0.5" />
                <span>
                  <span className="font-medium">今日の予約まとめを毎朝送る</span>
                  <span className="block text-xs text-muted-foreground">時刻・お名前・メニュー・担当、前回の申し送り、新規 / VIP / 誕生月のしるし、空き待ちの件数。予約が 0 件の日は送りません。</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={settings.monthly.enabled} onCheckedChange={(v) => patch({ monthly: { enabled: v === true } })} className="mt-0.5" />
                <span>
                  <span className="font-medium">月次レポートを毎月 1 日に送る</span>
                  <span className="block text-xs text-muted-foreground">先月の予約数・売上・新規のお客様・リピート率・キャンセル率・前月比・人気メニュー・配信の成果。</span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>送る時刻</span>
                <Select value={settings.morning.time} onValueChange={(v) => patch({ morning: { ...settings.morning, time: v } })}>
                  <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIGEST_TIME_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">ごろ（月次レポートも同じ時刻）</span>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">送り先</h3>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={settings.channels.email} onCheckedChange={(v) => patch({ channels: { ...settings.channels, email: v === true } })} />
                <span className="font-medium">メールで受け取る</span>
              </label>
              {settings.channels.email && (
                <div className="space-y-1 pl-6">
                  <textarea
                    value={emailsText}
                    onChange={(e) => setEmailsText(e.target.value)}
                    rows={3}
                    placeholder={'owner@example.com\nstaff@example.com'}
                    className="w-full rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                    data-slot="textarea"
                  />
                  <p className="text-[11px] text-muted-foreground">1 行に 1 件、{DIGEST_EMAIL_MAX} 件まで。</p>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={settings.channels.line} onCheckedChange={(v) => patch({ channels: { ...settings.channels, line: v === true } })} />
                <span className="font-medium">LINE で受け取る（公式 LINE からスタッフ個人の LINE へ）</span>
              </label>
              {settings.channels.line && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3 pl-4" data-slot="digest-line-staff">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">スタッフの登録方法</p>
                    <p className="text-xs text-muted-foreground">受け取りたいスタッフが、お店の公式 LINE を友だち追加して、トークで次のとおり送ります。</p>
                    {code ? (
                      <p className="inline-block rounded bg-background px-3 py-1.5 font-mono text-base font-semibold tracking-wide">{STAFF_REGISTER_KEYWORD} {code}</p>
                    ) : (
                      <p className="text-sm text-destructive">合言葉は無効になっています（間違いが続いたため）。「合言葉を出し直す」を押してください。</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={busy === 'code'} onClick={reissue}>合言葉を出し直す</Button>
                      <span className="text-[11px] text-muted-foreground">合言葉を知っている人は誰でも登録できます。スタッフ以外には教えないでください。解除は「{STAFF_UNREGISTER_KEYWORD}」と送るか、下の一覧から。</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">登録済みのスタッフ（{staff.length} / {DIGEST_STAFF_MAX} 人）</p>
                    {staff.length === 0 ? (
                      <p className="text-xs text-muted-foreground">まだ登録されていません。登録するまで LINE には届きません。</p>
                    ) : (
                      <ul className="divide-y rounded-md border bg-background">
                        {staff.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm" data-slot="list-item">
                            <span className="truncate">{s.display_name}</span>
                            <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy === s.id} onClick={() => removeStaff(s)}>解除</Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">LINE で送ると、公式 LINE の通数（無料メッセージ数）を使います（1 回 × スタッフの人数。毎朝 2 人なら月に約 60 通）。通数を節約したいときはメールをお使いください。</p>
                </div>
              )}
            </div>

            <p className="rounded bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
              アレルギー・既往歴は、メール・LINE には内容を載せず「注意あり」とだけ表示します（内容は顧客詳細でご確認ください）。お客様のお名前・メニュー・申し送りは載りますので、送り先はスタッフだけにしてください。
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy === 'test-morning'} onClick={() => sendTest('morning')}>今日の予約まとめをテスト送信</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy === 'test-monthly'} onClick={() => sendTest('monthly')}>月次レポートをテスト送信</Button>
              <a href={reportHref} className="text-sm text-primary underline underline-offset-2">月次レポートを見る</a>
            </div>
            <p className="text-[11px] text-muted-foreground">テスト送信は、保存済みの送り先へいまの内容を送ります（先に「保存」を押してください）。</p>

            {logs.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">最近の送信</h3>
                <ul className="space-y-1 text-xs">
                  {logs.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span>{logLabel(l)}</span>
                      <span className={l.status === 'failed' ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                        {LOG_STATUS[l.status]}
                        {l.status === 'sent' ? `（メール ${l.email_sent} 件・LINE ${l.line_sent} 人）` : ''}
                      </span>
                      {l.detail && <span className="text-muted-foreground">{l.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
