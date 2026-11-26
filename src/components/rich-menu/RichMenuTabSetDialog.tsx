'use client';

/**
 * タブ付きメニューをまとめて作る。
 * タブの名前を入れるだけで、上の帯のボタンでたがいに切り替わる下書きを、タブの数だけ作る。
 * 画像と、帯の下のボタンは、できた下書きを 1 つずつ開いて入れる
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchWithAuth } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import {
  DEFAULT_CHAT_BAR_TEXT,
  RICH_MENU_LIMITS,
  RICH_MENU_SIZES,
  SWITCH_GROUP_MAX,
  TAB_SET_MIN,
  TAB_SET_STRIP_RATIO,
  validateRichMenuTabSetInput,
  type LineRichMenu,
  type RichMenuSize,
} from '@/lib/line-rich-menu';

interface Props {
  open: boolean;
  storeId: string;
  /** あと何個メニューを作れるか */
  remaining: number;
  onClose: () => void;
  onCreated: (menus: LineRichMenu[]) => void;
}

const DEFAULT_TABS = ['メニュー 1', 'メニュー 2'];

export default function RichMenuTabSetDialog({ open, storeId, remaining, onClose, onCreated }: Props) {
  const [size, setSize] = useState<RichMenuSize>('large');
  const [tabs, setTabs] = useState<string[]>(DEFAULT_TABS);
  const [chatBarText, setChatBarText] = useState(DEFAULT_CHAT_BAR_TEXT);
  const [preview, setPreview] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 開いたときだけ初期化する
  const wasOpen = useRef(false);
  // 保存の 2 回押しを止める（状態が変わる前の連打は、状態では止められない）
  const lock = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setSize('large');
      setTabs(DEFAULT_TABS);
      setChatBarText(DEFAULT_CHAT_BAR_TEXT);
      setPreview(0);
      setError(null);
    }
    wasOpen.current = open;
  }, [open]);

  const max = Math.min(SWITCH_GROUP_MAX, remaining);
  const input = { size, tabs: tabs.map((t) => t.trim()), chat_bar_text: chatBarText.trim() || DEFAULT_CHAT_BAR_TEXT };
  const errors = validateRichMenuTabSetInput(input);
  const strip = TAB_SET_STRIP_RATIO[size];
  const { width, height } = RICH_MENU_SIZES[size];
  const shown = Math.min(preview, tabs.length - 1);

  const setTab = (i: number, value: string) => {
    setTabs((cur) => cur.map((t, j) => (j === i ? value : t)));
    setError(null);
  };

  const create = async () => {
    if (lock.current || errors.length > 0) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/stores/${storeId}/rich-menus/tab-set`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.menus) {
        setError(json?.error || `作成に失敗しました（エラーコード: ${res.status}）`);
        return;
      }
      onCreated(json.menus as LineRichMenu[]);
    } catch {
      setError('通信に失敗しました。もう一度お試しください');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-slot-name="rich-menu-tab-set">
        <DialogHeader>
          <DialogTitle>タブ付きメニューを作る</DialogTitle>
          <DialogDescription>タブを押すと切り替わるメニューを、まとめて作ります。タブの名前を入れると、たがいに切り替わる下書きがタブの数だけできます。</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>大きさ</Label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(RICH_MENU_SIZES) as RichMenuSize[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={cn('rounded-md border p-3 text-left text-sm transition-colors', size === s ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
                >
                  <span className="font-medium">{RICH_MENU_SIZES[s].label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{RICH_MENU_SIZES[s].description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>タブ（左から順。{TAB_SET_MIN}〜{SWITCH_GROUP_MAX} 個）</Label>
            <div className="space-y-2">
              {tabs.map((name, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-xs text-muted-foreground">タブ {i + 1}</span>
                  <Input aria-label={`タブ ${i + 1} の名前`} value={name} maxLength={RICH_MENU_LIMITS.nameMax} onFocus={() => setPreview(i)} onChange={(e) => setTab(i, e.target.value)} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`タブ ${i + 1} を消す`} disabled={tabs.length <= TAB_SET_MIN} onClick={() => setTabs((cur) => cur.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={tabs.length >= max} onClick={() => setTabs((cur) => [...cur, `メニュー ${cur.length + 1}`])}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              タブを足す
            </Button>
            {remaining < SWITCH_GROUP_MAX && <p className="text-xs text-muted-foreground">リッチメニューは、あと {remaining} 個まで作れます。</p>}
            <p className="text-xs text-muted-foreground">タブの名前は、そのまま下書きの名前になります（あとで変えられます）。</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tab-set-chat-bar">メニューバーの文言</Label>
            <Input id="tab-set-chat-bar" value={chatBarText} maxLength={RICH_MENU_LIMITS.chatBarTextMax} onChange={(e) => setChatBarText(e.target.value)} />
          </div>

          {/* できあがる下書きのボタンの並び */}
          <div className="space-y-2">
            <Label>できあがるボタンの並び（「{tabs[shown]?.trim() || `タブ ${shown + 1}`}」のメニュー）</Label>
            <div className="mx-auto w-full max-w-md overflow-hidden rounded-md border bg-muted/40" style={{ aspectRatio: `${width} / ${height}` }} data-slot-name="rich-menu-tab-set-preview">
              <div className="flex" style={{ height: `${strip * 100}%` }}>
                {tabs.map((name, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPreview(i)}
                    className={cn('flex min-w-0 flex-1 items-center justify-center border-b border-r px-1 text-[11px] last:border-r-0', i === shown ? 'bg-background font-semibold' : 'bg-muted text-muted-foreground')}
                  >
                    <span className="truncate">{name.trim() || `タブ ${i + 1}`}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-center px-3 text-center text-xs text-muted-foreground" style={{ height: `${(1 - strip) * 100}%` }}>
                ここは、あとで自由にボタンを分けられます
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              上の帯が、タブのボタンです。ほかのタブを押すと、そのメニューに切り替わります。画像は、この帯にタブの絵を入れて、メニューごとに 1 枚ずつ用意してください（{width}×{height} ピクセル。帯の高さは約 {Math.round(height * strip)} ピクセル）。
            </p>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            作ったあとの流れ: ① できた下書きを 1 つずつ「編集」で開いて、画像と、帯の下のボタンを入れる → ② いちばん左のタブのメニューで「反映する」を押す（つながっているメニューが、まとめて公式 LINE に出ます）。
          </div>

          {(error || errors.length > 0) && <p className="text-sm text-destructive">{error || errors[0]}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>やめる</Button>
          <Button type="button" onClick={create} disabled={saving || errors.length > 0} data-slot-name="rich-menu-tab-set-create">
            {saving ? '作成中…' : `${tabs.length} 個の下書きを作る`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
