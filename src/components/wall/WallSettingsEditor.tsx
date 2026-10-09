'use client';

/**
 * 寄せ書きウォール: ボードの設定（編集モーダルの中身）
 * 予約 / アンケート / 抽選フォームの編集画面と同じく、タブで分けて設定する
 *   基本情報 / 受付ルール / 見た目 / NGワード
 * 見た目はテーマの値だけで変わる（店舗ごとにコードを分けない）。見た目タブは右側（スマホは下）にプレビュー
 */
import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import WallBoardView, { WALL_CSS, wallRootFrameAttr, wallRootStyle } from './WallBoardView';
import {
  DEFAULT_NOTE_COLORS,
  WALL_ACCESS_MODE_LABELS,
  WALL_FONTS,
  WALL_MODERATION_LABELS,
  WALL_NG_WORDS_MAX,
  WALL_NOTE_PINS,
  WALL_NOTE_SHAPES,
  WALL_NOTE_TEXTURES,
  WALL_THEME_PRESETS,
  wallThemeVars,
} from '@/lib/wall-themes';
import type { WallAccessMode, WallBoardSettings, WallModeration, WallPublicPost, WallTheme } from '@/types/wall';

const SAMPLE_BASE = { created_at: new Date().toISOString(), is_mine: false, reaction: null, topic_id: null, topic_title: null, note_color: null, note_deco: null, empathy_count: null, empathized: false } as const;
const SAMPLE_POSTS: WallPublicPost[] = [
  { ...SAMPLE_BASE, id: 'sample-a1b2', body: 'スタッフさんがとても丁寧で、また来たくなりました！', reaction: 'thanks', empathy_count: 3 },
  { ...SAMPLE_BASE, id: 'sample-c3d4', body: '季節のメニューおいしかったです🍰', is_mine: true, note_deco: '★' },
  { ...SAMPLE_BASE, id: 'sample-e5f6', body: '店内の雰囲気が落ち着いていて好きです', topic_title: '今のお題' },
];

type TabId = 'basic' | 'rules' | 'look' | 'ng';

function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="color" aria-label={label} value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} className="h-9 w-11 cursor-pointer rounded border p-0.5" />
      <span className="font-mono text-xs text-muted-foreground">{value || '未設定'}</span>
    </label>
  );
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" title={title} onClick={onClick} className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-primary ring-2 ring-primary/40' : 'hover:bg-muted'}`}>
      {children}
    </button>
  );
}

export interface WallSettingsEditorProps {
  storeId: string;
  /** 保存に成功したとき（保存後の設定を渡す） */
  onSaved?: (settings: WallBoardSettings) => void;
}

/** 公開ページの URL（お客様がアクセスする Next.js ページ） */
export function wallPageUrl(storeId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/wall/${storeId}`;
}

export default function WallSettingsEditor({ storeId, onSaved }: WallSettingsEditorProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<WallBoardSettings | null>(null);
  const [themeColor, setThemeColor] = useState<string | null>(null);
  const [ngText, setNgText] = useState('');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabId>('basic');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/settings`, { credentials: 'include', cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast({ title: '設定の取得に失敗しました', description: json.error, variant: 'destructive' });
          return;
        }
        setSettings(json.settings);
        setThemeColor(json.theme_color ?? null);
        setNgText((json.settings.ng_words ?? []).join('\n'));
      } catch {
        if (!cancelled) toast({ title: '設定の取得に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
      }
    })();
    return () => { cancelled = true; };
  }, [storeId, toast]);

  if (!settings) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        <span data-slot="loading" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent align-middle" /> 読み込み中…
      </p>
    );
  }

  const set = (patch: Partial<WallBoardSettings>) => setSettings({ ...settings, ...patch });
  const setTheme = (patch: Partial<WallTheme>) => setSettings({ ...settings, theme: { ...settings.theme, ...patch } });
  const ngWords = ngText.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
  const liffUrl = settings.liff_id ? `https://liff.line.me/${settings.liff_id}` : '';
  const pageUrl = wallPageUrl(storeId);
  const googleFont = wallThemeVars(settings.theme).googleFont;
  const colors = settings.theme.note_colors;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'コピーしました' });
    } catch {
      toast({ title: 'コピーできませんでした', variant: 'destructive' });
    }
  };

  const save = async () => {
    if (ngWords.length > WALL_NG_WORDS_MAX) {
      toast({ title: `NGワードは ${WALL_NG_WORDS_MAX} 件までです`, variant: 'destructive' });
      setTab('ng');
      return;
    }
    if (settings.enabled && !settings.liff_id) {
      toast({ title: '公開するには LIFF ID を入力してください', variant: 'destructive' });
      setTab('basic');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(storeId)}/wall/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, ng_words: ngWords }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: '保存に失敗しました', description: json.error, variant: 'destructive' });
        return;
      }
      setSettings(json.settings);
      setNgText((json.settings.ng_words ?? []).join('\n'));
      toast({ title: '寄せ書きの設定を保存しました' });
      onSaved?.(json.settings);
    } catch {
      toast({ title: '保存に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex h-full flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic" className="text-xs sm:text-sm">基本情報</TabsTrigger>
            <TabsTrigger value="rules" className="text-xs sm:text-sm">受付ルール</TabsTrigger>
            <TabsTrigger value="look" className="text-xs sm:text-sm">見た目</TabsTrigger>
            <TabsTrigger value="ng" className="text-xs sm:text-sm">NGワード</TabsTrigger>
          </TabsList>

          {/* 基本情報 */}
          <TabsContent value="basic" className="mt-6 space-y-6">
            <label className="flex items-center gap-3">
              <input type="checkbox" className="h-5 w-5" checked={settings.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
              <span className="font-medium">寄せ書きを公開する</span>
            </label>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="wall-liff-id">LIFF ID</label>
              <Input id="wall-liff-id" value={settings.liff_id} placeholder="例: 2001234567-AbCdEfGh" onChange={(e) => set({ liff_id: e.target.value.trim() })} />
              <p className="text-xs text-muted-foreground">LINE Developers で LIFF アプリを作成し、エンドポイント URL に下の「ページの URL」を設定してください（サイズは Full 推奨）。LIFF アプリは、店舗設定の「LINE ログインチャネル ID」に登録したチャネルと同じ LINE ログインチャネルに作ってください（違うチャネルだと本人確認に失敗し、付箋を貼れません）。</p>
            </div>
            <div className="grid gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0 text-muted-foreground">ページの URL</span>
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{pageUrl}</code>
                <Button size="sm" variant="outline" onClick={() => copy(pageUrl)}><Copy />コピー</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0 text-muted-foreground">リッチメニュー用</span>
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{liffUrl || 'LIFF ID を入力すると表示されます'}</code>
                <Button size="sm" variant="outline" disabled={!liffUrl} onClick={() => copy(liffUrl)}><Copy />コピー</Button>
                <Button size="sm" variant="ghost" disabled={!liffUrl} onClick={() => window.open(liffUrl, '_blank')} title="開く"><ExternalLink /></Button>
              </div>
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <h4 className="text-sm font-semibold">見出しと文言</h4>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="wall-title">見出し</label>
                <Input id="wall-title" value={settings.theme.title} maxLength={30} onChange={(e) => setTheme({ title: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="wall-subtitle">説明文</label>
                <Input id="wall-subtitle" value={settings.theme.subtitle} maxLength={60} onChange={(e) => setTheme({ subtitle: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="wall-placeholder">入力欄の例文</label>
                <Input id="wall-placeholder" value={settings.theme.placeholder} maxLength={60} onChange={(e) => setTheme({ placeholder: e.target.value })} />
              </div>
            </div>
          </TabsContent>

          {/* 受付ルール */}
          <TabsContent value="rules" className="mt-6 space-y-6">
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">表示のしかた</h4>
              {(Object.keys(WALL_MODERATION_LABELS) as WallModeration[]).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="wall-moderation" checked={settings.moderation === m} onChange={() => set({ moderation: m })} />
                  {WALL_MODERATION_LABELS[m]}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">即公開でも、NGワードを含む付箋は「承認待ち」になり、お店が確認するまで表示されません。</p>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">1 人が 1 日に貼れる枚数</h4>
              <div className="flex items-center gap-2 text-sm">
                <select
                  aria-label="1 人が 1 日に貼れる枚数"
                  data-slot="select-trigger"
                  className="h-9 rounded-md border bg-background px-2"
                  value={settings.daily_max}
                  onChange={(e) => set({ daily_max: Number(e.target.value) })}
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n} 枚</option>
                  ))}
                </select>
                <span className="text-muted-foreground">まで（同じお客様・同じ日。自分で削除した分も数えます）</span>
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">見られる人・貼れる人</h4>
              {(Object.keys(WALL_ACCESS_MODE_LABELS) as WallAccessMode[]).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="wall-access" checked={settings.access_mode === m} onChange={() => set({ access_mode: m })} />
                  {WALL_ACCESS_MODE_LABELS[m]}
                </label>
              ))}
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">「わかる！」（共感）ボタン</h4>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={settings.empathy_enabled} onChange={(e) => set({ empathy_enabled: e.target.checked })} />
                お客様が他の人の付箋に「わかる！」を押せるようにする
              </label>
              <label className={`flex items-center gap-2 text-sm ${settings.empathy_enabled ? '' : 'opacity-50'}`}>
                <input type="checkbox" className="h-4 w-4" disabled={!settings.empathy_enabled} checked={settings.empathy_show_count} onChange={(e) => set({ empathy_show_count: e.target.checked })} />
                押された数を付箋に小さく表示する（OFF にすると数はお店の管理画面でだけ見えます）
              </label>
              <p className="text-xs text-muted-foreground">1 人 1 付箋 1 回まで。誰が押したかはお客様にもお店にも表示されません。並び順には使いません。</p>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">付箋の色・飾りをお客様が選べる</h4>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={settings.customer_pick_enabled} onChange={(e) => set({ customer_pick_enabled: e.target.checked })} />
                貼るときに、「見た目」タブの「付箋の色」の中から色を選び、飾り（★ ♪ 🍀 など 8 種類から 1 つ）を付けられるようにする
              </label>
              <p className="text-xs text-muted-foreground">選ばなければ今までどおり自動で決まります。世界観を崩さないよう、色はお店が決めた色の中からだけ選べます。</p>
            </section>
          </TabsContent>

          {/* 見た目 */}
          <TabsContent value="look" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-5">
                <div className="space-y-1">
                  <span className="text-sm font-medium">背景</span>
                  <div className="flex flex-wrap gap-2">
                    {WALL_THEME_PRESETS.map((p) => (
                      <Chip key={p.id} active={settings.theme.preset === p.id} onClick={() => setTheme({ preset: p.id, background_color: '' })}>
                        <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full border align-middle" style={{ background: p.base_color }} />
                        {p.label}
                      </Chip>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <ColorInput label="背景色" value={settings.theme.background_color} onChange={(v) => setTheme({ background_color: v })} />
                    {settings.theme.background_color && (
                      <Button size="sm" variant="ghost" onClick={() => setTheme({ background_color: '' })}>背景の模様に戻す</Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-medium">付箋の色（3〜8 色）</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {colors.map((c, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <input type="color" aria-label={`付箋の色 ${i + 1}`} value={c} onChange={(e) => setTheme({ note_colors: colors.map((x, j) => (j === i ? e.target.value : x)) })} className="h-9 w-11 cursor-pointer rounded border p-0.5" />
                        {colors.length > 3 && (
                          <button type="button" aria-label={`付箋の色 ${i + 1} を削除`} className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setTheme({ note_colors: colors.filter((_, j) => j !== i) })}>✕</button>
                        )}
                      </div>
                    ))}
                    {colors.length < 8 && (
                      <Button size="sm" variant="outline" onClick={() => setTheme({ note_colors: [...colors, DEFAULT_NOTE_COLORS[colors.length % DEFAULT_NOTE_COLORS.length]] })}>＋ 色を追加</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setTheme({ note_colors: [...DEFAULT_NOTE_COLORS] })}>既定の色に戻す</Button>
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border p-3">
                  <span className="text-sm font-medium">付箋のデザイン</span>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">形</span>
                    <div className="flex flex-wrap gap-2">
                      {WALL_NOTE_SHAPES.map((o) => <Chip key={o.id} title={o.description} active={settings.theme.note_shape === o.id} onClick={() => setTheme({ note_shape: o.id })}>{o.label}</Chip>)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">留め方</span>
                    <div className="flex flex-wrap gap-2">
                      {WALL_NOTE_PINS.map((o) => <Chip key={o.id} active={settings.theme.note_pin === o.id} onClick={() => setTheme({ note_pin: o.id })}>{o.label}</Chip>)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">紙</span>
                    <div className="flex flex-wrap gap-2">
                      {WALL_NOTE_TEXTURES.map((o) => <Chip key={o.id} active={settings.theme.note_texture === o.id} onClick={() => setTheme({ note_texture: o.id })}>{o.label}</Chip>)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-muted-foreground">文字色</span>
                    <ColorInput label="付箋の文字色" value={settings.theme.note_text_color} onChange={(v) => setTheme({ note_text_color: v })} />
                    {settings.theme.note_text_color && (
                      <Button size="sm" variant="ghost" onClick={() => setTheme({ note_text_color: '' })}>既定の色に戻す</Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-medium">文字の種類</span>
                  <div className="flex flex-wrap gap-3">
                    {WALL_FONTS.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-sm">
                        <input type="radio" name="wall-font" checked={settings.theme.font === f.id} onChange={() => setTheme({ font: f.id })} />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">プレビュー</h4>
                {googleFont && (
                  <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${googleFont}&display=swap`} />
                )}
                <style>{WALL_CSS}</style>
                <div className="overflow-hidden rounded-xl border">
                  <div className="wall-root is-preview" data-frame={wallRootFrameAttr(settings.theme)} style={{ ...wallRootStyle(settings.theme, themeColor), minHeight: 0 }}>
                    <header className="wall-header">
                      <h1 className="wall-title">{settings.theme.title}</h1>
                      <p className="wall-subtitle">{settings.theme.subtitle}</p>
                    </header>
                    <div style={{ paddingBottom: 8 }}>
                      <WallBoardView theme={settings.theme} posts={SAMPLE_POSTS} readOnly onEmpathy={settings.empathy_enabled && settings.empathy_show_count ? () => {} : undefined} />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">付箋の色・傾きは投稿ごとに自動で決まります（例文はプレビュー用です）。見出し・説明文は「基本情報」タブで変えられます。</p>
              </div>
            </div>
          </TabsContent>

          {/* NGワード */}
          <TabsContent value="ng" className="mt-6 space-y-2">
            <h4 className="text-sm font-semibold">NGワード（お店で追加）</h4>
            <Textarea rows={8} value={ngText} onChange={(e) => setNgText(e.target.value)} placeholder={'1 行に 1 語（例: スタッフの名前）'} />
            <p className="text-xs text-muted-foreground">
              誹謗中傷・差別・宣伝・URL・電話番号・メールアドレスなどは最初から止まります。ここにはお店独自の語を追加できます（1 語 30 文字・{WALL_NG_WORDS_MAX} 語まで。現在 {ngWords.length} 語）。含まれる付箋は「承認待ち」になります。
            </p>
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex flex-col items-stretch justify-end gap-3 border-t p-4 sm:flex-row sm:items-center sm:p-6">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          <Save className="mr-2 h-4 w-4" />
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
    </div>
  );
}
