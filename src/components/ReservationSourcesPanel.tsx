'use client';

/**
 * 流入経路（置き場所ごとの URL / QR コード）の発行と一覧
 * 予約管理 → 分析 → 「流入経路」。店舗管理者ページとテナント側 店舗ページで共用。
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 5 章
 */
import React, { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/client-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { SOURCE_FORM_STATUS_MESSAGES, SOURCE_NAME_MAX, type SourceFormStatus } from '@/lib/reservation-sources';

interface SourceView {
  id: string;
  form_id: string;
  name: string;
  code: string;
  active: boolean;
  click_count: number;
  entry_url: string;
  form_name: string;
  form_status: SourceFormStatus;
}

interface FormOption {
  id: string;
  name: string;
  status: SourceFormStatus;
}

export default function ReservationSourcesPanel({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}/reservation-sources`;
  const [sources, setSources] = useState<SourceView[]>([]);
  const [forms, setForms] = useState<FormOption[]>([]);
  const [max, setMax] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [formId, setFormId] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [qrOpenId, setQrOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth(base, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || '流入経路の取得に失敗しました');
        return;
      }
      setSources(Array.isArray(json.sources) ? json.sources : []);
      const list: FormOption[] = Array.isArray(json.forms) ? json.forms : [];
      setForms(list);
      if (typeof json.max === 'number') setMax(json.max);
      setFormId((cur) => cur || list[0]?.id || '');
      setError(null);
    } catch {
      setError('流入経路の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetchWithAuth(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, form_id: formId }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: '経路を作成できませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
        return;
      }
      setSources((cur) => [...cur, json]);
      setName('');
      setQrOpenId(json.id);
      toast({ title: `「${json.name}」を作成しました`, description: 'URL か QR コードを、置き場所に貼ってください' });
    } catch {
      toast({ title: '経路を作成できませんでした', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const update = async (id: string, patch: { name?: string; active?: boolean }, done: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetchWithAuth(`${base}/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: '変更できませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
        return;
      }
      setSources((cur) => cur.map((s) => (s.id === id ? json : s)));
      setEditing(null);
      toast({ title: done });
    } catch {
      toast({ title: '変更できませんでした', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'URL をコピーしました' });
    } catch {
      toast({ title: 'コピーできませんでした', variant: 'destructive' });
    }
  };

  const selectedForm = forms.find((f) => f.id === formId);
  const reachedMax = sources.length >= max;

  return (
    <div className="space-y-3 md:space-y-4" data-slot="reservation-sources">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">流入経路を作る</CardTitle>
          <CardDescription>
            店頭ポップ・チラシ・Instagram など、置き場所ごとに別々の URL と QR コードを作ると、どこから予約が入ったかが分かります。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {forms.length === 0 && !loading ? (
            <p className="text-muted-foreground">予約フォームがまだありません。先に予約フォームを作成してください。</p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <div className="space-y-1">
                  <label htmlFor="source_name" className="text-xs text-muted-foreground">
                    経路の名前（{SOURCE_NAME_MAX} 文字まで）
                  </label>
                  <Input id="source_name" value={name} maxLength={SOURCE_NAME_MAX} placeholder="例: 店頭ポップ、Instagram、チラシ（11月）" onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">開く予約フォーム</span>
                  <Select value={formId} onValueChange={setFormId}>
                    <SelectTrigger aria-label="開く予約フォーム">
                      <SelectValue placeholder="フォームを選ぶ" />
                    </SelectTrigger>
                    <SelectContent>
                      {forms.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={create} disabled={creating || !name.trim() || !formId || reachedMax}>
                  {creating ? '作成中…' : '作成する'}
                </Button>
              </div>
              {selectedForm && selectedForm.status !== 'ok' && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{SOURCE_FORM_STATUS_MESSAGES[selectedForm.status]}</p>}
              {reachedMax && <p className="text-xs text-muted-foreground">経路は {max} 件まで作成できます。</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">流入経路の一覧</CardTitle>
          <CardDescription>
            「読まれた数」は URL や QR コードが開かれた回数の目安です（開いただけで予約しなかった人も数えます）。経路ごとの予約数・売上は、このあと追加する予定です。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
          {loading && <p className="text-muted-foreground">読み込み中…</p>}
          {!loading && !error && sources.length === 0 && <p className="text-muted-foreground">まだ経路がありません。上の「流入経路を作る」から作成してください。</p>}

          {sources.map((s) => (
            <div key={s.id} className={`space-y-2 rounded-lg border p-3 ${s.active ? '' : 'bg-muted/40'}`} data-slot="reservation-source">
              <div className="flex flex-wrap items-center gap-2">
                {editing?.id === s.id ? (
                  <>
                    <Input className="h-8 min-w-0 flex-1" value={editing.name} maxLength={SOURCE_NAME_MAX} onChange={(e) => setEditing({ id: s.id, name: e.target.value })} aria-label="経路の名前" />
                    <Button type="button" size="sm" onClick={() => update(s.id, { name: editing.name }, '名前を変更しました')} disabled={busyId === s.id || !editing.name.trim()}>
                      保存
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)} disabled={busyId === s.id}>
                      やめる
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 break-words font-medium">{s.name}</span>
                    {!s.active && <Badge variant="outline">停止中</Badge>}
                    <Badge variant="outline">読まれた数 {s.click_count.toLocaleString('ja-JP')}</Badge>
                  </>
                )}
              </div>

              <p className="text-xs text-muted-foreground">開くフォーム: {s.form_name}</p>
              {s.form_status !== 'ok' && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{SOURCE_FORM_STATUS_MESSAGES[s.form_status]}</p>}
              {!s.active && <p className="text-xs text-muted-foreground">停止中の経路は、URL を開くと通常の予約フォームが開き、経路は記録されません（これまでの記録は残ります）。</p>}

              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{s.entry_url}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => copy(s.entry_url)}>
                  URL をコピー
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setQrOpenId(qrOpenId === s.id ? null : s.id)}>
                  {qrOpenId === s.id ? 'QR コードを閉じる' : 'QR コードを表示'}
                </Button>
                {editing?.id !== s.id && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing({ id: s.id, name: s.name })} disabled={!!busyId}>
                    名前を変更
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => update(s.id, { active: !s.active }, s.active ? '経路を停止しました' : '経路を再開しました')} disabled={busyId === s.id}>
                  {s.active ? '停止する' : '再開する'}
                </Button>
              </div>

              {qrOpenId === s.id && (
                <div className="flex flex-wrap items-end gap-3 rounded-md border bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- ログイン中だけ見られる動的な画像のため next/image を使わない */}
                  <img src={`${base}/${encodeURIComponent(s.id)}/qr`} alt={`「${s.name}」の QR コード`} width={180} height={180} className="h-[180px] w-[180px]" />
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">印刷物やポップに貼って使えます。</p>
                    <Button asChild variant="outline" size="sm">
                      <a href={`${base}/${encodeURIComponent(s.id)}/qr?download=1`} download={`qr-${s.code}.png`}>
                        画像を保存
                      </a>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
