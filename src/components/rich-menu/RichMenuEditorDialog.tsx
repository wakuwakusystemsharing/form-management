'use client';

/**
 * リッチメニューの作成・編集（名前・大きさ・画像・ボタンの範囲と動き）
 * 保存しただけでは公式 LINE には出ない（一覧の「反映する」で出す）
 */
import { useEffect, useRef, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchWithAuth } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import {
  DEFAULT_CHAT_BAR_TEXT,
  RICH_MENU_ACTION_LABELS,
  RICH_MENU_KEYWORDS,
  RICH_MENU_LIMITS,
  RICH_MENU_SIZES,
  GRID_COLS_MAX,
  GRID_ROWS_MAX,
  applyRichMenuLayout,
  buildGridAreas,
  findFreeRect,
  nextAreaId,
  rectPercent,
  setRectField,
  type RectField,
  describeRichMenuAction,
  layoutDropsActions,
  layoutsForSize,
  validateRichMenu,
  type LineRichMenu,
  type RichMenuAction,
  type RichMenuArea,
  type RichMenuInput,
  type RichMenuSize,
} from '@/lib/line-rich-menu';
import type { RichMenuFormOption, RichMenuMessageOption } from '@/lib/line-rich-menu-service';
import RichMenuAreaCanvas from './RichMenuAreaCanvas';
import RichMenuImagePicker from './RichMenuImagePicker';
import RichMenuPhonePreview from './RichMenuPhonePreview';
import AudienceEditor, { type AudienceOptions } from '@/components/broadcast/AudienceEditor';
import { describeAudience } from '@/lib/broadcast-audience';
import { isRuleEmpty } from '@/lib/line-rich-menu-rules';

export interface RichMenuEditorDialogProps {
  open: boolean;
  storeId: string;
  /** null = 新しく作る */
  menu: LineRichMenu | null;
  forms: RichMenuFormOption[];
  /** 「応答メッセージを返す」で選べる、保存済みの LINE メッセージ */
  messages?: RichMenuMessageOption[];
  /** その店舗のメニュー（「別のメニューに切り替える」の切り替え先と、プレビューでの切り替えに使う） */
  menus?: LineRichMenu[];
  /** 「条件に合うお客様だけ」の条件に使う選択肢（タグ・メニュー・フォーム・アンケート） */
  audienceOptions?: AudienceOptions;
  /** お客様ごとのメニューを使えないときの理由（使えるときは null） */
  ruleUnavailable?: string | null;
  onClose: () => void;
  onSaved: (menu: LineRichMenu) => void;
}

const emptyInput = (): RichMenuInput => ({ name: '', size: 'large', image_url: '', areas: [], chat_bar_text: DEFAULT_CHAT_BAR_TEXT, open_by_default: true, rule: null });
const EMPTY_OPTIONS: AudienceOptions = { tags: [], menus: [], forms: [], surveys: [] };
const ACTION_TYPES: RichMenuAction['type'][] = ['form', 'message', 'reply', 'uri', 'switch', 'none'];
const EMPTY_MESSAGES: RichMenuMessageOption[] = [];

function defaultAction(type: RichMenuAction['type'], forms: RichMenuFormOption[], others: LineRichMenu[] = []): RichMenuAction {
  if (type === 'switch') return { type: 'switch', menu_id: others[0]?.id || '' };
  if (type === 'form') return { type: 'form', form_id: forms.find((f) => f.openable)?.id || forms[0]?.id || '' };
  if (type === 'message') return { type: 'message', text: RICH_MENU_KEYWORDS[0].text };
  if (type === 'reply') return { type: 'reply', mode: 'text', text: '', message_id: '' };
  if (type === 'uri') return { type: 'uri', uri: '' };
  return { type: 'none' };
}

export default function RichMenuEditorDialog({ open, storeId, menu, forms, messages = EMPTY_MESSAGES, menus = [], audienceOptions = EMPTY_OPTIONS, ruleUnavailable = null, onClose, onSaved }: RichMenuEditorDialogProps) {
  const [input, setInput] = useState<RichMenuInput>(emptyInput);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 「マス目で作る」の数
  const [gridCols, setGridCols] = useState(4);
  const [gridRows, setGridRows] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  // 右側の表示: ボタンの範囲を編集する / スマホでの見え方を確かめる
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  // プレビューで切り替えのボタンを押したとき、切り替え先のメニューを見せる（null = いま編集しているメニュー）
  const [previewMenuId, setPreviewMenuId] = useState<string | null>(null);
  // 開いたときだけ初期化する（開いている間に親が渡し直しても、入力中の内容を消さない）
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setInput(menu ? { name: menu.name, size: menu.size, image_url: menu.image_url, areas: menu.areas, chat_bar_text: menu.chat_bar_text, open_by_default: menu.open_by_default, rule: menu.rule } : emptyInput());
      setSelectedId(null);
      setError(null);
      setChanged(false);
      setMode('edit');
      setPreviewMenuId(null);
    }
    wasOpen.current = open;
  }, [open, menu]);

  const patch = (p: Partial<RichMenuInput>) => {
    setInput((cur) => ({ ...cur, ...p }));
    setChanged(true);
    setError(null);
  };
  const selectedIndex = input.areas.findIndex((a) => a.id === selectedId);
  const selected: RichMenuArea | null = selectedIndex >= 0 ? input.areas[selectedIndex] : null;
  const setAction = (action: RichMenuAction) => patch({ areas: input.areas.map((a) => (a.id === selectedId ? { ...a, action } : a)) });
  const formName = (id: string) => forms.find((f) => f.id === id)?.name ?? null;
  // 切り替え先に選べるのは、このメニュー以外
  const others = menus.filter((m) => m.id !== menu?.id && !m.rule);
  const isRule = !!input.rule;
  // 公式 LINE に出しているあいだは、「全員」と「条件に合うお客様だけ」を入れ替えられない
  const kindLocked = menu?.status === 'published';
  // お客様ごとのメニューでは、切り替えは使えない
  const actionTypes = isRule ? ACTION_TYPES.filter((t) => t !== 'switch') : ACTION_TYPES;
  const menuName = (id: string) => menus.find((m) => m.id === id)?.name ?? null;
  const messageName = (id: string) => messages.find((m) => m.id === id)?.name ?? null;
  const describe = (action: RichMenuAction) => describeRichMenuAction(action, formName, menuName, messageName);
  // 「文字を送る」: トークに文字を出さない設定は、文字を変えても保つ
  const messageSilent = selected?.action.type === 'message' && selected.action.silent === true;
  const setMessageText = (text: string, silent = messageSilent) => setAction({ type: 'message', text, ...(silent ? { silent: true } : {}) });
  const layouts = layoutsForSize(input.size);

  const applyLayout = (layoutId: string) => {
    const dropped = layoutDropsActions(layoutId, input.size, input.areas);
    if (dropped > 0 && !window.confirm(`この型にすると、ボタンが減ります。動きを設定したボタン ${dropped} 個が消えますが、よろしいですか？`)) return;
    const areas = applyRichMenuLayout(layoutId, input.size, input.areas);
    if (!areas) return;
    patch({ areas });
    setSelectedId(areas[0]?.id ?? null);
  };
  // ---- ボタンを自由に置く ----
  const areasFull = input.areas.length >= RICH_MENU_LIMITS.areasMax;
  /** 空いている場所に、新しいボタンを 1 つ足す（空きが無ければ知らせる） */
  const addArea = () => {
    if (areasFull) return;
    const rect = findFreeRect(input.areas);
    if (!rect) {
      setError('空いている場所がありません。いまのボタンを小さくするか、動かしてから足してください');
      return;
    }
    const id = nextAreaId(input.areas);
    patch({ areas: [...input.areas, { id, ...rect, action: { type: 'none' } }] });
    setSelectedId(id);
  };
  /** 選んだボタンと同じ大きさ・同じ動きのボタンを、空いている場所に足す */
  const duplicateArea = () => {
    if (!selected || areasFull) return;
    const free = findFreeRect(input.areas);
    if (!free) {
      setError('空いている場所がありません。いまのボタンを小さくするか、動かしてから複製してください');
      return;
    }
    // 同じ大きさで入るなら同じ大きさ、入らなければ空いている大きさで
    const same = { x: free.x, y: free.y, w: Math.min(selected.w, 1 - free.x), h: Math.min(selected.h, 1 - free.y) };
    const fits = !input.areas.some((a) => a.x < same.x + same.w && same.x < a.x + a.w && a.y < same.y + same.h && same.y < a.y + a.h);
    const id = nextAreaId(input.areas);
    patch({ areas: [...input.areas, { id, ...(fits ? same : free), action: selected.action }] });
    setSelectedId(id);
  };
  const clearAreas = () => {
    if (input.areas.length === 0) return;
    const active = input.areas.filter((a) => a.action.type !== 'none').length;
    if (!window.confirm(active > 0 ? `ボタンをすべて消します。動きを設定したボタン ${active} 個も消えますが、よろしいですか？` : 'ボタンをすべて消します。よろしいですか？')) return;
    patch({ areas: [] });
    setSelectedId(null);
  };
  /** マス目で作る（横 × 縦に等分）。いまの動きは上から順に引き継ぐ */
  const applyGrid = () => {
    const areas = buildGridAreas(gridCols, gridRows, input.areas);
    if (!areas) {
      setError(`ボタンは ${RICH_MENU_LIMITS.areasMax} 個までです。マス目を減らしてください`);
      return;
    }
    const dropped = input.areas.slice(areas.length).filter((a) => a.action.type !== 'none').length;
    if (dropped > 0 && !window.confirm(`このマス目にすると、ボタンが減ります。動きを設定したボタン ${dropped} 個が消えますが、よろしいですか？`)) return;
    patch({ areas });
    setSelectedId(areas[0]?.id ?? null);
  };
  /** 選んだボタンの位置・大きさを数字（%）で直す */
  const setSelectedRect = (field: RectField, value: string) => {
    if (!selected || value === '') return;
    const rect = setRectField(selected, field, Number(value));
    patch({ areas: input.areas.map((a) => (a.id === selected.id ? { ...a, ...rect } : a)) });
  };

  // プレビューに出すメニュー（切り替え先を見ているときは、保存済みのそのメニュー）
  const previewMenu = previewMenuId ? menus.find((m) => m.id === previewMenuId) ?? null : null;

  const changeSize = (size: RichMenuSize) => {
    if (size === input.size) return;
    // 形が変わるので、画像は選び直してもらう（ボタンの範囲は割合で持っているのでそのまま）
    patch({ size, image_url: '' });
  };

  const requestClose = () => {
    if (saving) return;
    if (changed && !window.confirm('保存していない変更があります。閉じてよろしいですか？')) return;
    onClose();
  };

  const save = async () => {
    if (saving) return;
    const errors = validateRichMenu(input);
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(menu ? `/api/stores/${storeId}/rich-menus/${menu.id}` : `/api/stores/${storeId}/rich-menus`, {
        method: menu ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setError(json?.error || '保存に失敗しました');
        return;
      }
      setChanged(false);
      onSaved(json as LineRichMenu);
    } catch {
      setError('保存に失敗しました。通信の状態を確認して、もう一度お試しください');
    } finally {
      setSaving(false);
    }
  };

  // 反映するまでに直す所（保存はできる）
  const publishHints = validateRichMenu(input, { forPublish: true, formIds: forms.map((f) => f.id), menuIds: menus.map((m) => m.id), selfId: menu?.id ?? null, messageIds: messages.map((m) => m.id) }).filter((e) => !validateRichMenu(input).includes(e));
  const dims = RICH_MENU_SIZES[input.size];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto [scrollbar-gutter:stable]" data-slot="rich-menu-editor">
        <DialogHeader>
          <DialogTitle>{menu ? 'リッチメニューを編集' : 'リッチメニューを作る'}</DialogTitle>
          <DialogDescription>保存しただけでは、公式 LINE には出ません。保存したあと、一覧の「反映する」を押すと出ます。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* 左: 基本の設定 */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rich-menu-name">名前（管理用。お客様には見えません）</Label>
              <Input id="rich-menu-name" value={input.name} maxLength={RICH_MENU_LIMITS.nameMax} placeholder="例: いつものメニュー" onChange={(e) => patch({ name: e.target.value })} />
            </div>

            <div className="space-y-2 rounded-md border p-3" data-slot="rich-menu-audience">
              <span className="text-sm font-medium">だれに出すか</span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="だれに出すか">
                {(
                  [
                    [false, '全員', '友だち全員に出すメニュー'],
                    [true, '条件に合うお客様だけ', 'タグ・来店回数などで出し分ける'],
                  ] as const
                ).map(([rule, label, description]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={isRule === rule}
                    disabled={kindLocked && isRule !== rule}
                    onClick={() => {
                      if (isRule === rule) return;
                      patch({ rule: rule ? { audience: {}, order: 0 } : null });
                    }}
                    className={cn(
                      'rounded-md border p-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                      isRule === rule ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                    )}
                  >
                    <span className="block font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{description}</span>
                  </button>
                ))}
              </div>
              {kindLocked && <p className="text-xs text-muted-foreground">公式 LINE に出しているあいだは、ここは変えられません（先に反映をやめてください）。</p>}
              {input.rule && (
                <div className="space-y-2">
                  {ruleUnavailable && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{ruleUnavailable}（保存はできます）</p>}
                  <AudienceEditor value={input.rule.audience} onChange={(audience) => patch({ rule: { ...(input.rule as NonNullable<RichMenuInput['rule']>), audience } })} options={audienceOptions} />
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-xs" data-slot="rich-menu-audience-text">
                    {isRuleEmpty(input.rule) ? '条件を 1 つ以上選んでください。' : `出す相手: ${describeAudience(input.rule.audience, { formName: (id) => forms.find((f) => f.id === id)?.name ?? id })}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    条件に合うお客様には、全員向けのメニューの代わりに、このメニューが出ます。条件に合わなくなると、全員向けのメニューに戻ります。LINE と連携しているお客様だけが対象です。
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">大きさ</span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="大きさ">
                {(Object.keys(RICH_MENU_SIZES) as RichMenuSize[]).map((size) => (
                  <button
                    key={size}
                    type="button"
                    role="radio"
                    aria-checked={input.size === size}
                    onClick={() => changeSize(size)}
                    className={cn('rounded-md border p-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', input.size === size ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
                  >
                    <span className="block font-medium">{RICH_MENU_SIZES[size].label}</span>
                    <span className="block text-xs text-muted-foreground">{RICH_MENU_SIZES[size].description}</span>
                  </button>
                ))}
              </div>
              {menu && input.size !== menu.size && <p className="text-xs text-amber-700">大きさを変えたので、画像を選び直してください。</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rich-menu-bar">メニューバーの文言（{RICH_MENU_LIMITS.chatBarTextMax} 文字まで）</Label>
              <Input id="rich-menu-bar" value={input.chat_bar_text} maxLength={RICH_MENU_LIMITS.chatBarTextMax} placeholder={DEFAULT_CHAT_BAR_TEXT} onChange={(e) => patch({ chat_bar_text: e.target.value })} />
              <p className="text-xs text-muted-foreground">トーク画面のいちばん下に出る、メニューを開け閉めするバーの文字です。</p>
            </div>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(244,144,49)]" checked={input.open_by_default} onChange={(e) => patch({ open_by_default: e.target.checked })} />
              <span>
                トーク画面を開いたとき、最初からメニューを開いておく
                <span className="block text-xs text-muted-foreground">外すと、お客様がバーを押したときにメニューが開きます。</span>
              </span>
            </label>

            {/* 選んだボタンの動き */}
            <div className="space-y-3 rounded-md border p-3" data-slot="rich-menu-area-editor">
              {selected ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">ボタン {selectedIndex + 1} を押したときの動き</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => {
                        patch({ areas: input.areas.filter((a) => a.id !== selected.id) });
                        setSelectedId(null);
                      }}
                    >
                      <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                      このボタンを消す
                    </Button>
                  </div>
                  <select
                    aria-label="動きの種類"
                    value={selected.action.type}
                    onChange={(e) => setAction(defaultAction(e.target.value as RichMenuAction['type'], forms, others))}
                    className="h-10 w-full rounded-md border bg-background px-2 text-base md:text-sm"
                  >
                    {(selected.action.type === 'switch' ? ACTION_TYPES : actionTypes).map((t) => (
                      <option key={t} value={t}>
                        {RICH_MENU_ACTION_LABELS[t]}
                      </option>
                    ))}
                  </select>

                  {selected.action.type === 'form' &&
                    (forms.length === 0 ? (
                      <p className="text-xs text-amber-700">予約フォームがまだありません。先に予約フォームを作ってください。</p>
                    ) : (
                      <div className="space-y-1">
                        <select aria-label="開く予約フォーム" value={selected.action.form_id} onChange={(e) => setAction({ type: 'form', form_id: e.target.value })} className="h-10 w-full rounded-md border bg-background px-2 text-base md:text-sm">
                          {!forms.some((f) => f.id === (selected.action as { form_id: string }).form_id) && <option value={selected.action.form_id}>（選んでください）</option>}
                          {forms.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                              {f.openable ? '' : '（開く URL がありません）'}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">フォームの URL は、反映するときに自動で入ります。</p>
                      </div>
                    ))}

                  {selected.action.type === 'message' && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {RICH_MENU_KEYWORDS.map((k) => (
                          <button
                            key={k.text}
                            type="button"
                            title={k.description}
                            onClick={() => setMessageText(k.text)}
                            className={cn('rounded-full border px-3 py-1 text-xs transition-colors', (selected.action as { text: string }).text === k.text ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}
                          >
                            {k.label}
                          </button>
                        ))}
                      </div>
                      <Input aria-label="送る文字" value={selected.action.text} maxLength={RICH_MENU_LIMITS.messageTextMax} placeholder="お客様のトークに送られる文字" onChange={(e) => setMessageText(e.target.value)} />
                      <label className="flex items-start gap-2 text-sm" data-slot-name="rich-menu-silent">
                        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={messageSilent} onChange={(e) => setMessageText((selected.action as { text: string }).text, e.target.checked)} />
                        <span>トークに文字を出さずに動かす</span>
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {messageSilent
                          ? '押しても、お客様のトークには何も出ません。この文字が送られてきたのと同じ返事を、このシステムが返します。上の言葉と、「LINE メッセージ」のキーワード自動応答に登録した言葉に使えます（公式 LINE の管理画面で設定した応答メッセージは、文字が送られないので反応しません）。'
                          : '押すと、お客様のトークにこの文字が送られます。上の言葉は、このシステムが自動で返事をする言葉です。キーワード自動応答に登録した言葉も入れられます。'}
                      </p>
                    </div>
                  )}

                  {selected.action.type === 'reply' && (
                    <div className="space-y-2" data-slot-name="rich-menu-reply">
                      <div className="flex flex-wrap gap-1.5">
                        {([['text', 'ここに文章を書く'], ['message', '「LINE メッセージ」から選ぶ']] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setAction({ ...(selected.action as Extract<RichMenuAction, { type: 'reply' }>), mode })}
                            className={cn('rounded-full border px-3 py-1 text-xs transition-colors', (selected.action as { mode: string }).mode === mode ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {selected.action.mode === 'text' ? (
                        <>
                          <textarea
                            aria-label="返す文章"
                            value={selected.action.text}
                            maxLength={RICH_MENU_LIMITS.replyTextMax}
                            rows={4}
                            placeholder={'例: 営業時間は 10:00〜19:00 です。\n定休日は火曜日です。'}
                            onChange={(e) => setAction({ ...(selected.action as Extract<RichMenuAction, { type: 'reply' }>), text: e.target.value })}
                            className="w-full rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                          />
                          <p className="text-right text-[11px] text-muted-foreground tabular-nums">{selected.action.text.length} / {RICH_MENU_LIMITS.replyTextMax}</p>
                        </>
                      ) : messages.length === 0 ? (
                        <p className="text-xs text-amber-700">LINE メッセージがまだありません。「LINE メッセージ」のタブで作ると、ここで選べます（カードや画像も返せます）。</p>
                      ) : (
                        <select
                          aria-label="返す LINE メッセージ"
                          value={selected.action.message_id}
                          onChange={(e) => setAction({ ...(selected.action as Extract<RichMenuAction, { type: 'reply' }>), message_id: e.target.value })}
                          className="h-10 w-full rounded-md border bg-background px-2 text-base md:text-sm"
                        >
                          {!messages.some((m) => m.id === (selected.action as { message_id: string }).message_id) && <option value={selected.action.message_id}>（選んでください）</option>}
                          {messages.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                              {m.enabled ? '' : '（無効のため返しません）'}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="text-xs text-muted-foreground">
                        押しても、お客様のトークには何も出ません。このシステムが、上の内容を返信します（返信なので、公式 LINE の通数は使いません）。
                        返す内容だけを直したときは、保存するだけで変わります（反映し直さなくて大丈夫です）。
                      </p>
                    </div>
                  )}

                  {selected.action.type === 'uri' && (
                    <div className="space-y-1">
                      <Input aria-label="開く URL" value={selected.action.uri} maxLength={RICH_MENU_LIMITS.uriMax} placeholder="https://… / 電話は tel:0312345678" inputMode="url" onChange={(e) => setAction({ type: 'uri', uri: e.target.value })} />
                      <p className="text-xs text-muted-foreground">ホームページ・地図・Instagram などの URL を入れます。</p>
                    </div>
                  )}

                  {selected.action.type === 'switch' &&
                    (others.length === 0 ? (
                      <p className="text-xs text-amber-700">切り替え先にできるメニューが、まだありません。先にもう 1 つメニューを作って保存してください。</p>
                    ) : (
                      <div className="space-y-1">
                        <select aria-label="切り替え先のメニュー" value={selected.action.menu_id} onChange={(e) => setAction({ type: 'switch', menu_id: e.target.value })} className="h-10 w-full rounded-md border bg-background px-2 text-base md:text-sm">
                          {!others.some((m) => m.id === (selected.action as { menu_id: string }).menu_id) && <option value={selected.action.menu_id}>（選んでください）</option>}
                          {others.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">
                          押すと、メニューがその場で切り替わります（タブのように使えます）。切り替え先のメニューにも、このメニューへ戻るボタンを作っておくと行き来できます。反映するときは、切り替え先のメニューも一緒に公式 LINE に出ます。
                        </p>
                      </div>
                    ))}

                  {selected.action.type === 'none' && <p className="text-xs text-muted-foreground">押しても何も起きません（飾りの部分に使います）。</p>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">右の画像の上でボタンを選ぶと、押したときの動きを設定できます。</p>
              )}
            </div>
          </div>

          {/* 右: 画像とボタンの範囲 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">画像とボタン</p>
                <p className="text-xs text-muted-foreground">
                  {dims.width}×{dims.height} に切り抜いて保存します。
                </p>
              </div>
              <RichMenuImagePicker storeId={storeId} size={input.size} hasImage={!!input.image_url} disabled={saving} onUploaded={(url) => patch({ image_url: url })} onError={(m) => setError(m)} />
            </div>
            <div className="inline-flex rounded-md border bg-background p-0.5" role="group" aria-label="右側の表示" data-slot="rich-menu-mode">
              {(
                [
                  ['edit', 'ボタンを編集'],
                  ['preview', 'スマホでの見え方'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    setPreviewMenuId(null);
                  }}
                  className={cn('rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', mode === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'edit' ? (
              <>
                <div className="space-y-1.5" data-slot="rich-menu-layouts">
                  <p className="text-xs font-medium">型から作る（押すと、ボタンの範囲がきれいに並びます）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {layouts.map((layout) => (
                      <button
                        key={layout.id}
                        type="button"
                        onClick={() => applyLayout(layout.id)}
                        title={layout.label}
                        aria-label={`型: ${layout.label}`}
                        data-layout={layout.id}
                        className="group rounded-md border p-1 transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="relative block w-14 overflow-hidden rounded-sm bg-muted" style={{ aspectRatio: `${dims.width} / ${dims.height}` }} aria-hidden="true">
                          {layout.rects.map((r, i) => (
                            <span key={i} className="absolute border border-background bg-slate-400 group-hover:bg-primary/60" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
                          ))}
                        </span>
                        <span className="mt-0.5 block text-center text-[10px] leading-3 text-muted-foreground">{layout.rects.length}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* 自由に作る: 足す・複製・すべて消す・マス目 */}
                <div className="space-y-1.5" data-slot-name="rich-menu-free-tools">
                  <p className="text-xs font-medium">自由に作る（{input.areas.length} / {RICH_MENU_LIMITS.areasMax} 個）</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button type="button" size="sm" variant="outline" onClick={addArea} disabled={areasFull} data-slot-name="rich-menu-add-area">
                      <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                      ボタンを足す
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={duplicateArea} disabled={!selected || areasFull} title="選んだボタンと同じ大きさ・同じ動きのボタンを足します">
                      <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
                      複製
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={clearAreas} disabled={input.areas.length === 0}>
                      すべて消す
                    </Button>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground" data-slot-name="rich-menu-grid">
                      マス目:
                      <select aria-label="マス目の横の数" value={gridCols} onChange={(e) => setGridCols(Number(e.target.value))} className="h-8 rounded-md border bg-background px-1 text-sm">
                        {Array.from({ length: GRID_COLS_MAX }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>横 {n}</option>
                        ))}
                      </select>
                      ×
                      <select aria-label="マス目の縦の数" value={gridRows} onChange={(e) => setGridRows(Number(e.target.value))} className="h-8 rounded-md border bg-background px-1 text-sm">
                        {Array.from({ length: GRID_ROWS_MAX }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>縦 {n}</option>
                        ))}
                      </select>
                      <Button type="button" size="sm" variant="outline" onClick={applyGrid} data-slot-name="rich-menu-grid-apply">
                        {gridCols * gridRows} 個で作る
                      </Button>
                    </span>
                  </div>
                </div>
                <RichMenuAreaCanvas
                  size={input.size}
                  imageUrl={input.image_url}
                  areas={input.areas}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onChange={(areas, id) => {
                    patch({ areas });
                    setSelectedId(id);
                  }}
                />
                {selected && (
                  <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-2" data-slot-name="rich-menu-rect-fields">
                    <span className="pb-1.5 text-xs font-medium">ボタン {selectedIndex + 1} の位置と大きさ（%）</span>
                    {(
                      [
                        ['x', '左から'],
                        ['y', '上から'],
                        ['w', '幅'],
                        ['h', '高さ'],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                        {label}
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          step={1}
                          aria-label={`ボタンの${label}（%）`}
                          value={rectPercent(selected[field])}
                          onChange={(e) => setSelectedRect(field, e.target.value)}
                          className="h-8 w-16 rounded-md border bg-background px-2 text-sm text-foreground tabular-nums"
                        />
                      </label>
                    ))}
                  </div>
                )}
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  <li>「ボタンを足す」か、画像の何も無い所をなぞると、ボタンができます（{RICH_MENU_LIMITS.areasMax} 個まで）。</li>
                  <li>ボタンはつかんで動かせます。選んだボタンの四隅・四辺のつまみを引くと、大きさを変えられます。</li>
                  <li>ほかのボタンや画像の端に近づけると、ぴったり吸い付きます（Alt キーを押しているあいだは吸い付きません）。</li>
                  <li>選んだボタンは、矢印キーで少しずつ動かせます（Shift + 矢印で大きさ、Delete で削除）。</li>
                  <li>ボタンどうしは重ねられません（赤くなったら、重ならない所まで動かしてください）。</li>
                </ul>
              </>
            ) : (
              <div className="mx-auto w-full max-w-[402px]">
                {previewMenu && (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900" data-slot="rich-menu-preview-switched">
                    <span>切り替え先の「{previewMenu.name}」を表示しています（保存済みの内容）。</span>
                    <button type="button" className="underline underline-offset-2" onClick={() => setPreviewMenuId(null)}>
                      編集中のメニューに戻る
                    </button>
                  </div>
                )}
                <RichMenuPhonePreview
                  key={previewMenu?.id ?? 'editing'}
                  size={previewMenu ? previewMenu.size : input.size}
                  imageUrl={previewMenu ? previewMenu.image_url : input.image_url}
                  areas={previewMenu ? previewMenu.areas : input.areas}
                  chatBarText={previewMenu ? previewMenu.chat_bar_text : input.chat_bar_text}
                  openByDefault={previewMenu ? true : input.open_by_default}
                  describe={describe}
                  onSwitch={(id) => {
                    // このメニューへ戻る切り替えなら、編集中の内容を見せる
                    if (id === menu?.id) setPreviewMenuId(null);
                    else if (menus.some((m) => m.id === id)) setPreviewMenuId(id);
                  }}
                />
              </div>
            )}

            {input.areas.length > 0 && (
              <ul className="space-y-1" data-slot="rich-menu-area-list">
                {input.areas.map((a, i) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      aria-pressed={a.id === selectedId}
                      className={cn('flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors', a.id === selectedId ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
                    >
                      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm bg-black/70 px-1 text-[11px] font-bold text-white">{i + 1}</span>
                      <span className="min-w-0 truncate">{describe(a.action)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {publishHints.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" data-slot="rich-menu-hints">
                <p className="font-medium">反映するまでに、次の所を直してください（保存はできます）</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {publishHints.slice(0, 5).map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose} disabled={saving}>
            閉じる
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
