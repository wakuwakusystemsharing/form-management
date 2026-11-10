'use client';

/**
 * 配信の設定: 月間上限・超えたときの扱い・配信停止 / 再開のキーワード・自動配信の実行時刻、公式 LINE の今月の通数
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { BROADCAST_KEYWORD_MAX } from '@/lib/broadcast-quota';
import type { BroadcastSettings, LineQuotaInfo } from '@/types/broadcast';

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

export default function BroadcastSettingsCard({ storeId, used, onSaved }: { storeId: string; used: number; onSaved?: (s: BroadcastSettings) => void }) {
  const { toast } = useToast();
  const url = `/api/stores/${encodeURIComponent(storeId)}/broadcast-settings`;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState('');
  const [overLimit, setOverLimit] = useState<'confirm' | 'block'>('confirm');
  const [optOut, setOptOut] = useState('');
  const [optIn, setOptIn] = useState('');
  const [time, setTime] = useState('10:00');
  const [quota, setQuota] = useState<LineQuotaInfo | null>(null);
  // 友だちの取り込み
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '配信設定の取得に失敗しました');
      const s = json.settings as BroadcastSettings;
      setLimit(s.monthly_limit === null ? '' : String(s.monthly_limit));
      setOverLimit(s.over_limit);
      setOptOut(s.opt_out_keyword);
      setOptIn(s.opt_in_keyword);
      setTime(s.automation_time);
      setQuota(json.line_quota ?? null);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '配信設定の取得に失敗しました', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [url, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const friendsUrl = `/api/stores/${encodeURIComponent(storeId)}/line-friends/import`;
  const loadFriendCount = useCallback(async () => {
    try {
      const res = await fetch(friendsUrl, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setFriendCount(typeof json.friend_only_count === 'number' ? json.friend_only_count : 0);
    } catch {
      /* 件数は補助 */
    }
  }, [friendsUrl]);

  useEffect(() => {
    loadFriendCount();
  }, [loadFriendCount]);

  const importFriends = async () => {
    setImporting(true);
    setImportNote(null);
    try {
      const res = await fetch(friendsUrl, { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportNote(json.error || '友だちの取り込みに失敗しました');
        return;
      }
      setImportNote(
        json.remaining
          ? `${json.imported} 人を取り込みました。まだ続きがあります。もう一度「友だちを取り込む」を押してください。`
          : json.imported > 0
            ? `${json.imported} 人を取り込みました（すでに登録済み ${json.existing} 人）。`
            : `新しく取り込む友だちはいませんでした（すでに登録済み ${json.existing} 人）。`
      );
      loadFriendCount();
    } catch {
      setImportNote('友だちの取り込みに失敗しました（通信エラー）');
    } finally {
      setImporting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ monthly_limit: limit === '' ? null : Number(limit), over_limit: overLimit, opt_out_keyword: optOut, opt_in_keyword: optIn, automation_time: time }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '保存に失敗しました');
      toast({ title: '設定を保存しました' });
      onSaved?.(json.settings as BroadcastSettings);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '保存に失敗しました', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="py-6 text-center text-sm text-muted-foreground">読み込み中…</p>;

  const lineRemaining = quota && quota.type === 'limited' && quota.limit !== null ? Math.max(0, quota.limit - quota.usage) : null;

  return (
    <div className="space-y-3" data-slot="broadcast-settings">
      <Card>
        <CardContent className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">公式 LINE の今月の通数</h3>
          {quota ? (
            <div className="space-y-1 text-sm">
              <p>
                今月送った数 <span className="font-semibold tabular-nums">{quota.usage}</span> 通
                {quota.type === 'limited' && quota.limit !== null ? (
                  <span className="text-muted-foreground"> / 無料で送れる数 {quota.limit} 通（残り <span className={lineRemaining !== null && lineRemaining < quota.limit * 0.1 ? 'font-semibold text-destructive' : 'font-semibold'}>{lineRemaining}</span> 通）</span>
                ) : (
                  <span className="text-muted-foreground">（上限なしのプラン）</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">うち、この配信タブから送った数は {used} 通です。残りは予約の確認・リマインダー・フォローメッセージ・公式 LINE 管理画面からの配信などです。</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">LINE から通数を取得できませんでした（チャネルアクセストークンが未設定か、一時的な通信エラーです）。この配信タブから今月送った数は {used} 通です。</p>
          )}
          <p className="text-[11px] text-muted-foreground">通数は「送った相手の人数」で数えます（1 人に 5 通まとめて送っても 1 通）。上限を超えた分は LINE のプランによって追加料金がかかるか、送れなくなります。</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4" data-slot="friend-import">
          <h3 className="text-sm font-semibold">友だち登録だけのお客様</h3>
          <p className="text-sm">
            予約もアンケートもしていない LINE 友だち: <span className="font-semibold tabular-nums">{friendCount ?? '—'}</span> 人
            <span className="text-muted-foreground">（配信先に含まれます）</span>
          </p>
          <p className="text-xs text-muted-foreground">
            友だち追加されたとき、またはお客様が公式 LINE に何か送ってきたとき（リッチメニューの操作を含む）に、LINE の表示名で顧客管理へ自動登録します。
            顧客管理の一覧では「LINE 友だちのみも表示」にチェックすると確認でき、タグを付けて絞り込みにも使えます。予約すると通常の顧客に切り替わります。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={importing} onClick={importFriends}>{importing ? '取り込み中…' : '友だちを取り込む'}</Button>
            <span className="text-[11px] text-muted-foreground">この機能より前からの友だちを一括で登録します。LINE の認証済みアカウント（青・緑のバッジ）だけが使えます</span>
          </div>
          {importNote && <p className="rounded bg-muted/60 px-2 py-1 text-xs">{importNote}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h3 className="text-sm font-semibold">配信の設定</h3>

          <div className="space-y-1">
            <Label htmlFor="broadcast_limit" className="text-xs">この配信タブから 1 か月に送れる数の上限（空 = 制限なし）</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="broadcast_limit" type="number" inputMode="numeric" min={0} value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))} placeholder="制限なし" className="h-9 w-32" />
              <span className="text-sm text-muted-foreground">通 / 月</span>
              <Select value={overLimit} onValueChange={(v) => setOverLimit(v as 'confirm' | 'block')}>
                <SelectTrigger className="h-9 w-64 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirm">超えるときは確認してから送れる</SelectItem>
                  <SelectItem value="block">超える配信は送れないようにする</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">無料通数の使いすぎを防ぐための目安です。リマインダーなどで使う分を残して決めてください（例: 無料 200 通なら 100）。自動配信は上限を超える日は送らずに見送ります。</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="broadcast_opt_out" className="text-xs">配信を止めるキーワード</Label>
              <Input id="broadcast_opt_out" value={optOut} maxLength={BROADCAST_KEYWORD_MAX} onChange={(e) => setOptOut(e.target.value)} placeholder="配信停止" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="broadcast_opt_in" className="text-xs">配信を再開するキーワード</Label>
              <Input id="broadcast_opt_in" value={optIn} maxLength={BROADCAST_KEYWORD_MAX} onChange={(e) => setOptIn(e.target.value)} placeholder="配信再開" />
            </div>
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              お客様が公式 LINE でこの言葉をそのまま送ると、配信を止める / 再開できます（予約の確認・リマインダーは止まりません）。
              公式 LINE 管理画面の「応答メッセージ」で同じ言葉を使っていると返信が 2 通届くので、どちらかに寄せてください。
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">自動配信を判定する時刻</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger className="h-9 w-32 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={h}>{h}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">自動配信はこの時刻以降に 1 日 1 回判定して送ります（数分〜1 時間ほど遅れることがあります）。お客様が LINE を見やすい時間帯にしてください。</p>
          </div>

          <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '設定を保存'}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
