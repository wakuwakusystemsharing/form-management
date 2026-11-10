'use client';

/**
 * 自動配信（ステップ配信）: ルールの一覧と作成・編集
 * きっかけ（休眠 / 誕生月 / 初回来店 N 日後 / 来店 N 回目 / タグ）に当てはまったお客様へ、1 日 1 回の判定で自動的に送る
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import FlexPreview from '@/components/line-flex/FlexPreview';
import AudienceEditor, { type AudienceOptions } from './AudienceEditor';
import BroadcastItemsEditor, { type ItemJsonState } from './BroadcastItemsEditor';
import { describeAudience, normalizeAudience } from '@/lib/broadcast-audience';
import { AUTOMATION_TEMPLATES, AUTOMATION_WINDOW_DAYS, describeAutomationTrigger } from '@/lib/broadcast-automation';
import { BROADCAST_NAME_MAX, broadcastItemsToPreview, describeBroadcastItems, validateBroadcastItems } from '@/lib/broadcast-items';
import { payloadsToPreview } from '@/lib/line-flex-items';
import { validateFlexContents } from '@/lib/line-flex-templates';
import type { AutomationTrigger, BroadcastAudience, BroadcastAutomation, BroadcastAutomationInput, BroadcastItem, BroadcastSticker } from '@/types/broadcast';
import type { LineFlexMessage } from '@/types/line-flex';

interface Props {
  storeId: string;
  options: AudienceOptions;
  messages: LineFlexMessage[];
  stickers: BroadcastSticker[];
  /** 自動配信の実行時刻（HH:00。説明文に使う） */
  automationTime: string;
}

/** 画像アップロードの置き場所に使う ID（保存前のルール用） */
function newUploadId(): string {
  return Math.random().toString(36).slice(2, 14);
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
      {children}
    </button>
  );
}

function NumberInput({ value, onChange, min, max, suffix }: { value: number; onChange: (n: number) => void; min: number; max: number; suffix: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => { const n = Math.floor(Number(e.target.value)); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }} className="h-8 w-20 text-xs" />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </span>
  );
}

/** きっかけごとの入力欄 */
function TriggerFields({ trigger, onChange, tags }: { trigger: AutomationTrigger; onChange: (t: AutomationTrigger) => void; tags: string[] }) {
  switch (trigger.type) {
    case 'dormant':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">最終来店から <NumberInput value={trigger.days} min={14} max={730} suffix="日たったら送る" onChange={(days) => onChange({ type: 'dormant', days })} /></div>
          <p className="text-[11px] text-muted-foreground">その日数に達してから {AUTOMATION_WINDOW_DAYS} 日以内のお客様が対象です。すでに長く来店の無いお客様には送りません（そちらは「新しい配信」で「最終来店 ◯日以上前」を使ってください）。再来店して、また同じ日数が空いたら改めて送ります。</p>
        </div>
      );
    case 'birthday':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">誕生月の <NumberInput value={trigger.day} min={1} max={28} suffix="日に送る" onChange={(day) => onChange({ type: 'birthday', day })} /></div>
          <p className="text-[11px] text-muted-foreground">顧客情報に誕生日が登録されているお客様に、毎年 1 回送ります。月の途中で ON にした場合、その月が誕生月のお客様にも送ります。</p>
        </div>
      );
    case 'first_visit_after':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">初めての来店から <NumberInput value={trigger.days} min={1} max={365} suffix="日後に送る" onChange={(days) => onChange({ type: 'first_visit_after', days })} /></div>
          <p className="text-[11px] text-muted-foreground">1 人 1 回だけ送ります。予約ごとに送る「フォローメッセージ」を使っている店舗では、内容が重ならないようにしてください。</p>
        </div>
      );
    case 'visits_reached': {
      const text = trigger.counts.join(', ');
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            来店回数が
            <Input
              defaultValue={text}
              key={text}
              onBlur={(e) => {
                const counts = [...new Set(e.target.value.split(/[,、\s]+/).map((v) => Math.floor(Number(v))).filter((n) => Number.isFinite(n) && n >= 1 && n <= 1000))].sort((a, b) => a - b).slice(0, 10);
                onChange({ type: 'visits_reached', counts: counts.length > 0 ? counts : [5] });
              }}
              placeholder="5, 10"
              className="h-8 w-32 text-xs"
            />
            回目になった翌日に送る
          </div>
          <p className="text-[11px] text-muted-foreground">カンマ区切りで複数指定できます（例: 5, 10）。回数ごとに 1 回ずつ送ります。</p>
        </div>
      );
    }
    case 'tag_added':
      return (
        <div className="space-y-1">
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">この店舗にはまだタグがありません（顧客管理・アンケート・予約フォームの選択肢で付けられます）</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <Chip key={t} active={trigger.tags.includes(t)} onClick={() => onChange({ type: 'tag_added', tags: trigger.tags.includes(t) ? trigger.tags.filter((x) => x !== t) : [...trigger.tags, t] })}>{t}</Chip>
              ))}
            </div>
          )}
          <p className="text-[11px] text-amber-700">選んだタグのどれかが付いているお客様に、タグごとに 1 回送ります。ON にした時点ですでにタグが付いているお客様にも送られるので、下の人数を確認してください。</p>
        </div>
      );
    default:
      return null;
  }
}

export default function BroadcastAutomationPanel({ storeId, options, messages, stickers, automationTime }: Props) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}/broadcast-automations`;
  const [rules, setRules] = useState<BroadcastAutomation[]>([]);
  const [recent, setRecent] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<BroadcastAutomation | null>(null);
  const [runConfirm, setRunConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  // 編集ダイアログ
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [trigger, setTrigger] = useState<AutomationTrigger>({ type: 'dormant', days: 90 });
  const [audience, setAudience] = useState<BroadcastAudience>({});
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [itemJson, setItemJson] = useState<ItemJsonState>({});
  const [resend, setResend] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [audienceKey, setAudienceKey] = useState(0);
  const uploadId = useRef('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '自動配信の取得に失敗しました');
      setRules(Array.isArray(json.automations) ? json.automations : []);
      setRecent(json.recent_sends ?? {});
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '自動配信の取得に失敗しました', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [base, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (rule: BroadcastAutomation | null, template?: (typeof AUTOMATION_TEMPLATES)[number]) => {
    setEditingId(rule?.id ?? null);
    setName(rule?.name ?? template?.label ?? '');
    setEnabled(rule?.enabled ?? false);
    setTrigger(rule?.trigger ?? template?.trigger ?? { type: 'dormant', days: 90 });
    setAudience(rule?.audience ?? {});
    const nextItems = rule?.items ?? [];
    setItems(nextItems);
    const js: ItemJsonState = {};
    for (const it of nextItems) if (it.type === 'flex') js[it.key] = { text: it.contents ? JSON.stringify(it.contents, null, 2) : '', error: null };
    setItemJson(js);
    setResend(rule ? (rule.resend_after_days ? String(rule.resend_after_days) : '') : template?.resend_after_days ? String(template.resend_after_days) : '');
    setPreview(null);
    setAudienceKey((k) => k + 1);
    uploadId.current = rule?.id?.replace(/-/g, '').slice(0, 12) || newUploadId();
    setOpen(true);
  };

  // 次の実行で送られる人数（内容が変わるたびに少し待ってから計算）
  const previewKey = JSON.stringify({ trigger, audience: normalizeAudience(audience), resend });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const body = { ...JSON.parse(previewKey), resend_after_days: resend ? Number(resend) : null, preview: true, id: editingId ?? undefined, name: 'preview' };
        const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json) setPreview({ count: json.count ?? 0, sample: Array.isArray(json.sample) ? json.sample : [] });
      } catch {
        /* 見積りは補助 */
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, base, previewKey, resend, editingId]);

  const previewMessages = useMemo(
    () =>
      broadcastItemsToPreview(items, {
        ref: (id) => {
          const m = messages.find((x) => x.id === id);
          return m ? payloadsToPreview(m.payloads && m.payloads.length > 0 ? m.payloads : m.payload ? [m.payload] : []) : null;
        },
        sticker: (id) => {
          const s = stickers.find((x) => x.id === id);
          return s ? s.preview_url || s.url : null;
        },
      }),
    [items, messages, stickers]
  );

  const changeItemJson = (key: string, text: string) => {
    const setContents = (contents: Record<string, unknown> | null) => setItems((list) => list.map((x) => (x.key === key && x.type === 'flex' ? { ...x, contents } : x)));
    if (!text.trim()) {
      setItemJson((s) => ({ ...s, [key]: { text, error: 'Flex の JSON を入力してください' } }));
      setContents(null);
      return;
    }
    try {
      let parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed && parsed.type === 'flex' && parsed.contents && typeof parsed.contents === 'object') parsed = parsed.contents as Record<string, unknown>;
      const err = validateFlexContents(parsed);
      setItemJson((s) => ({ ...s, [key]: { text, error: err } }));
      setContents(err ? null : parsed);
    } catch {
      setItemJson((s) => ({ ...s, [key]: { text, error: 'JSON として読み取れません（カンマや括弧の抜けを確認してください）' } }));
      setContents(null);
    }
  };

  const uploadImage = async (slot: string, file: File, current: string | undefined, apply: (url: string) => void) => {
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('storeId', storeId);
      fd.append('menuId', `automation_${uploadId.current}_${slot}`);
      if (current) fd.append('oldImageUrl', current);
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'アップロードに失敗しました');
      apply(json.url);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'アップロードに失敗しました', variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      toast({ title: '自動配信の名前を入力してください', variant: 'destructive' });
      return;
    }
    if (trigger.type === 'tag_added' && trigger.tags.length === 0) {
      toast({ title: 'タグを 1 つ以上選んでください', variant: 'destructive' });
      return;
    }
    const jsonError = Object.entries(itemJson).find(([key, s]) => s.error && items.some((x) => x.key === key))?.[1].error;
    const itemsError = jsonError ?? validateBroadcastItems(items, { requireContent: enabled });
    if (itemsError) {
      toast({ title: enabled && items.length === 0 ? 'ON にするには、送るメッセージを 1 つ以上追加してください' : itemsError, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const body: BroadcastAutomationInput = { name, enabled, trigger, audience: normalizeAudience(audience), items, resend_after_days: resend ? Number(resend) : null };
      const res = await fetch(editingId ? `${base}/${editingId}` : base, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '保存に失敗しました');
      toast({ title: enabled ? '保存しました（ON）' : '保存しました（OFF のままです）' });
      setOpen(false);
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '保存に失敗しました', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (rule: BroadcastAutomation) => {
    try {
      const body: BroadcastAutomationInput = { name: rule.name, enabled: !rule.enabled, trigger: rule.trigger, audience: rule.audience, items: rule.items, resend_after_days: rule.resend_after_days };
      const res = await fetch(`${base}/${rule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '切り替えに失敗しました');
      toast({ title: rule.enabled ? 'OFF にしました' : 'ON にしました' });
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '切り替えに失敗しました', variant: 'destructive' });
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`${base}/${deleting.id}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '削除に失敗しました');
      toast({ title: '削除しました' });
      setDeleting(null);
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '削除に失敗しました', variant: 'destructive' });
    }
  };

  // 実行時刻を待たずに、今日の判定をいま行う（1 日 1 回の制限はそのまま）
  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch(`${base}/run`, { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '実行に失敗しました');
      const skipped = Array.isArray(json.skipped) ? json.skipped.length : 0;
      toast({
        title: json.checked === 0 ? '今日の判定はすでに済んでいます（ON のルールが無い場合もこの表示です）' : json.created > 0 ? `${json.recipients} 人への送信を開始しました` : '今日送る相手はいませんでした',
        description: skipped > 0 ? `見送り ${skipped} 件（配信一覧で理由を確認できます）` : undefined,
      });
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '実行に失敗しました', variant: 'destructive' });
    } finally {
      setRunning(false);
      setRunConfirm(false);
    }
  };

  const formName = (id: string) => options.forms.find((f) => f.id === id)?.name ?? id;
  const hasEnabled = rules.some((r) => r.enabled);

  return (
    <div className="space-y-3" data-slot="broadcast-automations">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h3 className="text-sm font-semibold">自動配信</h3>
            <p className="text-xs text-muted-foreground">
              条件に当てはまったお客様へ、毎日 {automationTime} ごろに自動で送ります（時刻は「設定」で変更できます）。作っただけでは送られず、ON にしたルールだけが動きます。
              送った分は配信一覧に「【自動】…」として並び、今月の配信通数に数えます。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">テンプレートから作る:</span>
            {AUTOMATION_TEMPLATES.map((t) => (
              <Button key={t.id} type="button" size="sm" variant="outline" className="h-7 text-xs" title={t.description} onClick={() => openEditor(null, t)}>＋ {t.label}</Button>
            ))}
          </div>
          {hasEnabled && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => setRunConfirm(true)}>{running ? '実行中…' : '今日の判定を今すぐ実行'}</Button>
              <span className="text-[11px] text-muted-foreground">{automationTime} を待たずに、ON のルールを今すぐ判定して送ります（判定は 1 日 1 回。今日すでに済んでいれば何も起きません）</span>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">読み込み中…</p>
      ) : rules.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">自動配信のルールはまだありません。上のテンプレートから作ってください。</CardContent></Card>
      ) : (
        rules.map((r) => (
          <Card key={r.id} data-slot="list-item" className={r.enabled ? '' : 'opacity-80'}>
            <CardContent className="flex flex-wrap items-start justify-between gap-2 p-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  <Badge variant="outline" className={r.enabled ? 'border-green-300 bg-green-50 text-green-700' : 'text-muted-foreground'} data-slot="status-chip">{r.enabled ? 'ON' : 'OFF'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">きっかけ: {describeAutomationTrigger(r.trigger)}{r.resend_after_days ? `（次に送るまで ${r.resend_after_days} 日あける）` : ''}</p>
                {Object.keys(r.audience).length > 0 && <p className="text-xs text-muted-foreground">絞り込み: {describeAudience(r.audience, { formName })}</p>}
                <p className="text-xs text-muted-foreground">内容: {describeBroadcastItems(r.items)}</p>
                <p className="text-xs tabular-nums">直近 30 日の送信 {recent[r.id] ?? 0} 人{r.last_run_date ? ` ・ 最後の判定 ${r.last_run_date}` : ''}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant={r.enabled ? 'outline' : 'default'} onClick={() => toggle(r)}>{r.enabled ? 'OFF にする' : 'ON にする'}</Button>
                <Button size="sm" variant="outline" onClick={() => openEditor(r)}>編集</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(r)}>削除</Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="flex max-h-[92dvh] max-w-[calc(100%-1rem)] flex-col overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="border-b px-5 pb-3 pt-5">
            <DialogTitle>{editingId ? '自動配信を編集' : '自動配信を作成'}</DialogTitle>
            <DialogDescription>きっかけに当てはまったお客様へ、1 日 1 回の判定で自動的に送ります。</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
              <div className="min-w-0 space-y-5">
                <div className="space-y-1">
                  <Label htmlFor="automation_name" className="text-xs">名前（管理用） <span className="text-destructive">*</span></Label>
                  <Input id="automation_name" value={name} maxLength={BROADCAST_NAME_MAX - 4} onChange={(e) => setName(e.target.value)} placeholder="例: 休眠のお客様へ" />
                </div>

                <section className="space-y-3 rounded-lg border p-3">
                  <h4 className="text-sm font-medium">① きっかけ</h4>
                  <div className="flex flex-wrap gap-1">
                    {AUTOMATION_TEMPLATES.map((t) => (
                      <Chip key={t.id} active={trigger.type === t.id} onClick={() => { if (trigger.type !== t.id) setTrigger(t.trigger); }}>{t.label}</Chip>
                    ))}
                  </div>
                  <TriggerFields trigger={trigger} onChange={setTrigger} tags={options.tags} />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    同じお客様に次に送るまで
                    <Input type="number" inputMode="numeric" min={1} value={resend} onChange={(e) => setResend(e.target.value.replace(/[^0-9]/g, ''))} placeholder="—" className="h-8 w-20 text-xs" />
                    日あける
                    <span className="text-[11px] text-muted-foreground">（空 = 同じきっかけでは 1 回だけ。短い間隔で何度も届くのを防ぎます）</span>
                  </div>
                </section>

                <section className="space-y-3 rounded-lg border p-3">
                  <h4 className="text-sm font-medium">② さらに絞り込む <span className="text-xs font-normal text-muted-foreground">任意</span></h4>
                  <AudienceEditor key={audienceKey} value={audience} onChange={setAudience} options={options} />
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-slot="automation-preview">
                    {preview ? (
                      <>
                        いま ON にすると、次の判定で <span className="font-semibold tabular-nums">{preview.count} 人</span> に送られます
                        {preview.sample.length > 0 && <span className="block truncate text-[11px] text-muted-foreground">例: {preview.sample.join('、')}{preview.count > preview.sample.length ? ' ほか' : ''}</span>}
                        <span className="block text-[11px] text-muted-foreground">以後は、新しく当てはまったお客様にだけ送ります（配信停止・ブロック中・LINE 未連携の方は除きます）</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">人数を計算しています…</span>
                    )}
                  </div>
                </section>

                <section className="space-y-2 rounded-lg border p-3">
                  <h4 className="text-sm font-medium">③ メッセージ</h4>
                  <BroadcastItemsEditor items={items} onChange={setItems} messages={messages} stickers={stickers} uploading={uploading} onUpload={uploadImage} jsonState={itemJson} onJsonChange={changeItemJson} />
                </section>

                <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  <span>
                    このルールを ON にする
                    <span className="block text-[11px] text-muted-foreground">ON にすると、毎日 {automationTime} ごろの判定で自動的に送られます。月間上限を超える日は送らずに見送ります。</span>
                  </span>
                </label>
              </div>
              <div className="space-y-3 self-start lg:sticky lg:top-0">
                <h4 className="text-sm font-medium">プレビュー</h4>
                <FlexPreview contents={null} messages={previewMessages.length > 0 ? previewMessages : undefined} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
            <Button type="button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
            <Button type="button" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>閉じる</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={runConfirm} onOpenChange={(o) => { if (!o) setRunConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>今日の判定を今すぐ実行しますか？</AlertDialogTitle>
            <AlertDialogDescription>ON になっているルールに当てはまるお客様へ、すぐにメッセージが送られます（取り消せません）。今日の分はこれで済み、{automationTime} の自動実行では送られません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={runNow}>実行する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{deleting?.name}」を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>このルールの送信記録も消えます（同じルールを作り直すと、同じお客様にもう一度送られることがあります）。すでに送った配信の記録は残ります。</AlertDialogDescription>
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
