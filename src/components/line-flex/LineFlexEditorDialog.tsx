'use client';

/**
 * 公式 LINE Flex Message の作成・編集ダイアログ
 * 左: テンプレートの項目入力（+ 上級者向け JSON 編集）/ 右: プレビュー（直接さわって編集できる）+ 選んだパーツの設定。下: 保存・テスト送信
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import FlexPreview, { type FlexPreviewEdit } from './FlexPreview';
import FlexPartInspector, { type FlexEditOp } from './FlexPartInspector';
import { getAt } from '@/lib/flex-tree';
import { applyFlexEdit, isTemplateLinked } from '@/lib/flex-edit';
import { describeLineFlexItems, itemsToPreview, LINE_FLEX_ATTACH_MAX, LINE_FLEX_ITEM_LABELS, LINE_FLEX_ITEMS_MAX, LINE_TEXT_MESSAGE_MAX, validateLineFlexItems } from '@/lib/line-flex-items';
import type {
  BookingCardData,
  CouponCardData,
  FlexButtonInput,
  FlexContainer,
  LineFlexItem,
  LineFlexMessage,
  LineFlexMessageInput,
  LineFlexTemplate,
  LineFlexTemplateData,
  MenuCarouselData,
  MenuCarouselItem,
  MenuListData,
  NoticeCardData,
  StaffCarouselData,
  StepsCardData,
  StoreCardData,
} from '@/types/line-flex';
import {
  defaultTemplateData,
  formLiffUrl,
  LINE_FLEX_ALT_TEXT_MAX,
  LINE_FLEX_BUTTONS_MAX,
  LINE_FLEX_CAROUSEL_MAX,
  LINE_FLEX_KEYWORD_MAX,
  LINE_FLEX_MENU_LIST_MAX,
  LINE_FLEX_NAME_MAX,
  LINE_FLEX_STEPS_MAX,
  LINE_FLEX_TEMPLATES,
  menuCarouselFromForm,
  menuListFromForm,
  normalizeKeywords,
  resolveFlexContents,
  storeCardFromStore,
  validateFlexContents,
} from '@/lib/line-flex-templates';

export interface FlexFormOption {
  id: string;
  name: string;
  liffUrl: string;
  form: unknown; // メニュー構成の取り込み用（予約フォーム全体）
}

export interface FlexStoreInfo {
  name?: string;
  phone?: string | null;
  address?: string | null;
  website_url?: string | null;
  logo_url?: string | null;
  theme_color?: string | null;
}

interface Props {
  storeId: string;
  store: FlexStoreInfo | null;
  forms: FlexFormOption[];
  /** 同じ店舗の LINE メッセージ一覧（「保存済みの LINE メッセージ」を追加メッセージとして選ぶ用。自分自身は除外して使う） */
  others?: LineFlexMessage[];
  open: boolean;
  initial: LineFlexMessage | null; // null = 新規
  onClose: () => void;
  onSaved: (message: LineFlexMessage) => void;
}

interface CustomerOption {
  id: string;
  name: string;
  line_user_id: string;
  line_display_name?: string | null;
}

function randomId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join('');
}
function rowKey(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** 「元に戻す」用に覚えておく内容（Flex 本体を決める 3 つ） */
interface EditSnapshot {
  template: LineFlexTemplate;
  data: LineFlexTemplateData;
  flexOverride: FlexContainer | null;
}
const sameSnapshot = (a: EditSnapshot, b: EditSnapshot) => a.template === b.template && a.data === b.data && a.flexOverride === b.flexOverride;
const HISTORY_MAX = 50;
/** 続けて入力している間（この ms 以内の変更）は 1 回ぶんの「元に戻す」にまとめる */
const HISTORY_COALESCE_MS = 800;
const nowMs = (): number => Date.now();

// ---------------------------------------------------------------------------
// 小さな入力部品（render の外で定義。中で定義すると入力のたびにフォーカスが外れる）
// ---------------------------------------------------------------------------

function ImageField({ slot, value, uploading, onUpload, onChange }: { slot: string; value: string | undefined; uploading: string | null; onUpload: (slot: string, file: File, current: string | undefined) => void; onChange: (url: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="h-16 w-24 rounded border object-cover" />
      ) : (
        <span className="text-xs text-muted-foreground">画像は未設定です</span>
      )}
      <label className="inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-xs hover:bg-muted">
        {uploading === slot ? 'アップロード中…' : value ? '画像を変更' : '画像をアップロード'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading === slot}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(slot, f, value);
            e.target.value = '';
          }}
        />
      </label>
      {value && (
        <button type="button" className="text-xs text-destructive hover:underline" onClick={() => onChange('')}>
          削除
        </button>
      )}
      <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="https:// の画像 URL を直接入力でも可" className="h-8 text-xs flex-1 min-w-[12rem]" />
    </div>
  );
}

function UrlPicker({ forms, onPick }: { forms: FlexFormOption[]; onPick: (url: string) => void }) {
  const options = forms.filter((f) => f.liffUrl);
  if (options.length === 0) return null;
  return (
    <Select onValueChange={(v) => onPick(v)}>
      <SelectTrigger className="h-8 w-[11rem] text-xs"><SelectValue placeholder="予約フォームの URL を入れる" /></SelectTrigger>
      <SelectContent>
        {options.map((f) => (
          <SelectItem key={f.id} value={f.liffUrl} className="text-xs">{f.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ButtonsEditor({ buttons, forms, onChange, max }: { buttons: FlexButtonInput[]; forms: FlexFormOption[]; onChange: (b: FlexButtonInput[]) => void; max: number }) {
  return (
    <div className="space-y-2">
      {buttons.map((b, i) => (
        <div key={b.key} className="flex flex-wrap items-center gap-2 rounded border p-2">
          <Input value={b.label} maxLength={40} onChange={(e) => onChange(buttons.map((x) => (x.key === b.key ? { ...x, label: e.target.value } : x)))} placeholder="ボタンの文言" className="h-8 w-32 text-xs" />
          <Input value={b.url} onChange={(e) => onChange(buttons.map((x) => (x.key === b.key ? { ...x, url: e.target.value } : x)))} placeholder="https://… または tel:0312345678" className="h-8 flex-1 min-w-[12rem] text-xs" />
          <UrlPicker forms={forms} onPick={(url) => onChange(buttons.map((x) => (x.key === b.key ? { ...x, url } : x)))} />
          <button type="button" className="text-xs text-destructive hover:underline" onClick={() => onChange(buttons.filter((x) => x.key !== b.key))}>削除</button>
          {i === 0 && <span className="text-[10px] text-muted-foreground">1 つ目が強調色</span>}
        </div>
      ))}
      {buttons.length < max && (
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange([...buttons, { key: rowKey(), label: '', url: '' }])}>
          ＋ ボタンを追加（{buttons.length}/{max}）
        </Button>
      )}
    </div>
  );
}

function SingleButtonField({ value, forms, onChange, placeholder = '予約する' }: { value: FlexButtonInput | null | undefined; forms: FlexFormOption[]; onChange: (b: FlexButtonInput | null) => void; placeholder?: string }) {
  const btn = value ?? { key: 'b1', label: '', url: '' };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={btn.label} maxLength={40} onChange={(e) => onChange({ ...btn, label: e.target.value })} placeholder={`ボタンの文言（例: ${placeholder}）`} className="h-8 w-40 text-xs" />
      <Input value={btn.url} onChange={(e) => onChange({ ...btn, url: e.target.value })} placeholder="https://… または tel:0312345678" className="h-8 flex-1 min-w-[12rem] text-xs" />
      <UrlPicker forms={forms} onPick={(url) => onChange({ ...btn, url })} />
      {(btn.label || btn.url) && (
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => onChange(null)}>ボタンなし</button>
      )}
    </div>
  );
}

function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

function RowTools({ index, length, onMove, onRemove }: { index: number; length: number; onMove: (dir: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={index === 0} onClick={() => onMove(-1)}>↑</Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={index === length - 1} onClick={() => onMove(1)}>↓</Button>
      <button type="button" className="text-xs text-destructive hover:underline" onClick={onRemove}>削除</button>
    </div>
  );
}

function ColorField({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value || '#06C755'} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border" />
      <Input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="#06C755" className="h-8 w-28 text-xs" />
      <span className="text-[11px] text-muted-foreground">ボタン・金額の色</span>
    </div>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// 追加のメッセージ（まとめて送る並び）
// ---------------------------------------------------------------------------

type ItemJsonState = Record<string, { text: string; error: string | null }>;

const ITEM_ADD_BUTTONS: Array<{ type: Exclude<LineFlexItem['type'], 'main'>; label: string }> = [
  { type: 'text', label: '＋ テキスト' },
  { type: 'image', label: '＋ 画像' },
  { type: 'video', label: '＋ 動画' },
  { type: 'flex', label: '＋ Flex（JSON）' },
  { type: 'ref', label: '＋ 保存済みの LINE メッセージ' },
];

function newItem(type: Exclude<LineFlexItem['type'], 'main'>): LineFlexItem {
  const key = rowKey();
  switch (type) {
    case 'text':
      return { key, type, text: '' };
    case 'image':
      return { key, type, url: '' };
    case 'video':
      return { key, type, url: '', preview_url: '' };
    case 'flex':
      return { key, type, alt_text: '', contents: null };
    default:
      return { key, type: 'ref', message_id: '' };
  }
}

function ItemsEditor({
  items,
  onChange,
  others,
  selfId,
  uploading,
  onUpload,
  jsonState,
  onJsonChange,
  attachChecked,
}: {
  items: LineFlexItem[];
  onChange: (items: LineFlexItem[]) => void;
  others: LineFlexMessage[];
  selfId: string;
  uploading: string | null;
  onUpload: (slot: string, file: File, current: string | undefined, apply: (url: string) => void) => void;
  jsonState: ItemJsonState;
  onJsonChange: (key: string, text: string) => void;
  attachChecked: boolean;
}) {
  const update = (key: string, patch: Partial<LineFlexItem>) => onChange(items.map((x) => (x.key === key ? ({ ...x, ...patch } as LineFlexItem) : x)));
  const candidates = others.filter((o) => o.id !== selfId);
  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.key} className="space-y-2 rounded border p-2" data-slot="flex-item">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-bold">{i + 1}</span>
              <span className="text-xs font-medium">{LINE_FLEX_ITEM_LABELS[item.type]}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={i === 0} onClick={() => onChange(moveItem(items, i, -1))}>↑</Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, 1))}>↓</Button>
                {item.type !== 'main' && (
                  <button type="button" className="text-xs text-destructive hover:underline" onClick={() => onChange(items.filter((x) => x.key !== item.key))}>削除</button>
                )}
              </div>
            </div>
            {item.type === 'text' && (
              <Textarea value={item.text} maxLength={LINE_TEXT_MESSAGE_MAX} rows={3} onChange={(e) => update(item.key, { text: e.target.value })} placeholder="例: ご予約はこちらからどうぞ！" className="text-xs" />
            )}
            {item.type === 'image' && (
              <div className="space-y-1">
                <ImageField slot={`item_${item.key}`} value={item.url} uploading={uploading} onUpload={(slot, f, cur) => onUpload(slot, f, cur, (url) => update(item.key, { url }))} onChange={(url) => update(item.key, { url })} />
                <p className="text-[11px] text-muted-foreground">JPEG / PNG（5MB まで）。トークでは画像として表示され、タップで拡大できます</p>
              </div>
            )}
            {item.type === 'video' && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">動画の URL（https:// の mp4 ファイル。YouTube などのページ URL は不可）</Label>
                  <Input value={item.url} onChange={(e) => update(item.key, { url: e.target.value })} placeholder="https://…/movie.mp4" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">サムネイル画像（必須。再生前に表示されます）</Label>
                  <ImageField slot={`thumb_${item.key}`} value={item.preview_url} uploading={uploading} onUpload={(slot, f, cur) => onUpload(slot, f, cur, (url) => update(item.key, { preview_url: url }))} onChange={(url) => update(item.key, { preview_url: url })} />
                </div>
                <p className="text-[11px] text-muted-foreground">動画は 200MB まで・1 分以内が目安（LINE の仕様）。動画ファイルはお持ちのサーバーやストレージに置いて URL を貼ってください</p>
              </div>
            )}
            {item.type === 'flex' && (
              <div className="space-y-1">
                <Input value={item.alt_text} maxLength={400} onChange={(e) => update(item.key, { alt_text: e.target.value })} placeholder="通知に出る文（代替テキスト。空なら「メッセージが届いています」）" className="h-8 text-xs" />
                <Textarea value={jsonState[item.key]?.text ?? ''} onChange={(e) => onJsonChange(item.key, e.target.value)} rows={6} spellCheck={false} className="font-mono text-[11px]" placeholder='{"type":"bubble", ...}' />
                {jsonState[item.key]?.error ? <p className="text-xs text-destructive">{jsonState[item.key].error}</p> : <p className="text-[11px] text-muted-foreground">Flex Message Simulator などで作った JSON（bubble / carousel）を貼り付け</p>}
              </div>
            )}
            {item.type === 'ref' && (
              <div className="space-y-1">
                {candidates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">この店舗に他の保存済み LINE メッセージがありません</p>
                ) : (
                  <Select value={item.message_id} onValueChange={(v) => update(item.key, { message_id: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="LINE メッセージを選ぶ" /></SelectTrigger>
                    <SelectContent>
                      {candidates.map((o) => (
                        <SelectItem key={o.id} value={o.id} className="text-xs">{o.name}{o.enabled ? '' : '（無効）'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground">参照先の Flex 本体 1 通が入ります（参照先を編集すると、こちらの送信内容も自動で更新）。タップ数は参照先で数えます</p>
              </div>
            )}
          </div>
        ))}
      </div>
      {items.length < LINE_FLEX_ITEMS_MAX ? (
        <div className="flex flex-wrap items-center gap-1">
          {ITEM_ADD_BUTTONS.map((b) => (
            <Button key={b.type} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange([...items, newItem(b.type)])}>{b.label}</Button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">1 回に送れるのは {LINE_FLEX_ITEMS_MAX} 通までです（LINE の仕様）</p>
      )}
      {attachChecked && items.length > LINE_FLEX_ATTACH_MAX && (
        <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          予約確認・リマインダー・フォローに添えるときは本体と合わせて 5 通までなので、このメッセージは先頭 {LINE_FLEX_ATTACH_MAX} 通までが送られます。
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function LineFlexEditorDialog({ storeId, store, forms, others = [], open, initial, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [id, setId] = useState<string>(initial?.id ?? randomId());
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [template, setTemplate] = useState<LineFlexTemplate>(initial?.template ?? 'booking_card');
  const [data, setData] = useState<LineFlexTemplateData>(initial?.data ?? defaultTemplateData('booking_card', store?.theme_color ?? undefined));
  const [altText, setAltText] = useState(initial?.alt_text ?? '');
  const [keywordsText, setKeywordsText] = useState((initial?.keywords ?? []).join(', '));
  const [attachConfirm, setAttachConfirm] = useState(initial?.attach_confirm ?? false);
  const [attachReminder, setAttachReminder] = useState(initial?.attach_reminder ?? false);
  const [attachFollow, setAttachFollow] = useState(initial?.attach_follow ?? false);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [trackTaps, setTrackTaps] = useState(initial?.track_taps ?? true);
  const [flexOverride, setFlexOverride] = useState<FlexContainer | null>(initial?.flex_override ?? null);
  const [jsonOpen, setJsonOpen] = useState(initial?.template === 'custom' || !!initial?.flex_override);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  // まとめて送る並び（main = 上の「内容」の Flex）
  const [items, setItems] = useState<LineFlexItem[]>(initial?.items ?? [{ key: 'main', type: 'main' }]);
  const [itemJson, setItemJson] = useState<ItemJsonState>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  // プレビューを直接さわって編集する: 選択中のパーツ / 元に戻す・やり直す / 操作のエラー
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: EditSnapshot[]; future: EditSnapshot[] }>({ past: [], future: [] });
  const [editError, setEditError] = useState<string | null>(null);
  const lastChangeAt = useRef(0);
  // テスト送信
  const [testOpen, setTestOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [testTarget, setTestTarget] = useState<CustomerOption | null>(null);
  const [testSending, setTestSending] = useState(false);

  // 開くたびに初期化
  useEffect(() => {
    if (!open) return;
    const next = initial;
    setId(next?.id ?? randomId());
    setSavedId(next?.id ?? null);
    setName(next?.name ?? '');
    setTemplate(next?.template ?? 'booking_card');
    setData(next?.data ?? defaultTemplateData('booking_card', store?.theme_color ?? undefined));
    setAltText(next?.alt_text ?? '');
    setKeywordsText((next?.keywords ?? []).join(', '));
    setAttachConfirm(next?.attach_confirm ?? false);
    setAttachReminder(next?.attach_reminder ?? false);
    setAttachFollow(next?.attach_follow ?? false);
    setEnabled(next?.enabled ?? true);
    setTrackTaps(next?.track_taps ?? true);
    setFlexOverride(next?.flex_override ?? null);
    setJsonOpen(next?.template === 'custom' || !!next?.flex_override);
    setJsonText(next?.flex_override ? JSON.stringify(next.flex_override, null, 2) : '');
    setJsonError(null);
    const nextItems = next?.items && next.items.length > 0 ? next.items : [{ key: 'main', type: 'main' } as LineFlexItem];
    setItems(nextItems);
    const js: ItemJsonState = {};
    for (const it of nextItems) if (it.type === 'flex') js[it.key] = { text: it.contents ? JSON.stringify(it.contents, null, 2) : '', error: null };
    setItemJson(js);
    setDirty(false);
    setSelectedPath(null);
    setHistory({ past: [], future: [] });
    setEditError(null);
    setTestOpen(false);
    setTestTarget(null);
    setCustomerQuery('');
    setCustomers([]);
  }, [open, initial, store?.theme_color]);

  const contents = useMemo(() => resolveFlexContents({ template, data, flex_override: flexOverride }), [template, data, flexOverride]);
  const generated = useMemo(() => (template === 'custom' ? null : resolveFlexContents({ template, data, flex_override: null })), [template, data]);
  const contentsError = validateFlexContents(contents);
  const keywords = normalizeKeywords(keywordsText);
  const itemsError = validateLineFlexItems(items, { selfId: id });
  const previewMessages = useMemo(
    () =>
      itemsToPreview(items, contentsError ? null : contents, altText, (refId) => {
        const o = others.find((x) => x.id === refId && x.id !== id);
        if (!o) return null;
        const c = o.payload && typeof o.payload.contents === 'object' ? (o.payload.contents as FlexContainer) : resolveFlexContents(o);
        return { contents: c, altText: o.alt_text };
      }),
    [items, contents, contentsError, altText, others, id]
  );

  /**
   * 変更の直前の状態を「元に戻す」用に覚える（イベントの中で、値を変える前後どちらで呼んでもよい = ここで見える値は変更前）。
   * force = false は入力中の連続した変更を 1 回にまとめる
   */
  const pushHistory = (force: boolean) => {
    const now = nowMs();
    const skip = !force && now - lastChangeAt.current < HISTORY_COALESCE_MS;
    lastChangeAt.current = now;
    if (skip) return;
    const snap: EditSnapshot = { template, data, flexOverride };
    setHistory((h) => {
      const top = h.past[h.past.length - 1];
      if (top && sameSnapshot(top, snap)) return h;
      return { past: [...h.past, snap].slice(-HISTORY_MAX), future: [] };
    });
  };
  const touch = () => {
    pushHistory(false);
    setDirty(true);
  };
  const restoreSnapshot = (snap: EditSnapshot) => {
    setTemplate(snap.template);
    setData(snap.data);
    setFlexOverride(snap.flexOverride);
    setJsonText(snap.flexOverride ? JSON.stringify(snap.flexOverride, null, 2) : '');
    setJsonError(null);
    setEditError(null);
    setDirty(true);
    lastChangeAt.current = 0;
  };
  const undo = () => {
    const current: EditSnapshot = { template, data, flexOverride };
    const past = [...history.past];
    let snap: EditSnapshot | undefined;
    // 名前などだけを変えたときの「いまと同じ内容」の記録は飛ばす
    while (past.length > 0) {
      const s = past.pop() as EditSnapshot;
      if (!sameSnapshot(s, current)) {
        snap = s;
        break;
      }
    }
    if (!snap) {
      setHistory({ past, future: history.future });
      return;
    }
    setHistory({ past, future: [...history.future, current] });
    restoreSnapshot(snap);
  };
  const redo = () => {
    const future = [...history.future];
    const snap = future.pop();
    if (!snap) return;
    setHistory({ past: [...history.past, { template, data, flexOverride }], future });
    restoreSnapshot(snap);
  };
  const changeItems = (next: LineFlexItem[]) => {
    setItems(next);
    touch();
  };
  const changeItemJson = (key: string, text: string) => {
    touch();
    if (!text.trim()) {
      setItemJson((s) => ({ ...s, [key]: { text, error: 'Flex の JSON を入力してください' } }));
      setItems((list) => list.map((x) => (x.key === key && x.type === 'flex' ? { ...x, contents: null } : x)));
      return;
    }
    try {
      let parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed && parsed.type === 'flex' && parsed.contents && typeof parsed.contents === 'object') parsed = parsed.contents as Record<string, unknown>;
      const err = validateFlexContents(parsed);
      setItemJson((s) => ({ ...s, [key]: { text, error: err } }));
      setItems((list) => list.map((x) => (x.key === key && x.type === 'flex' ? { ...x, contents: err ? null : parsed } : x)));
    } catch {
      setItemJson((s) => ({ ...s, [key]: { text, error: 'JSON として読み取れません（カンマや括弧の抜けを確認してください）' } }));
      setItems((list) => list.map((x) => (x.key === key && x.type === 'flex' ? { ...x, contents: null } : x)));
    }
  };
  const changeTemplate = (next: LineFlexTemplate) => {
    setTemplate(next);
    setData(defaultTemplateData(next, store?.theme_color ?? undefined));
    setFlexOverride(null);
    setJsonText('');
    setJsonError(null);
    setJsonOpen(next === 'custom');
    touch();
  };

  const applyJson = (text: string) => {
    setJsonText(text);
    touch();
    if (!text.trim()) {
      setFlexOverride(null);
      setJsonError(template === 'custom' ? 'Flex の JSON を入力してください' : null);
      return;
    }
    try {
      let parsed = JSON.parse(text) as Record<string, unknown>;
      // { type: 'flex', altText, contents } ごと貼られたら contents を使う
      if (parsed && parsed.type === 'flex' && parsed.contents && typeof parsed.contents === 'object') parsed = parsed.contents as Record<string, unknown>;
      const err = validateFlexContents(parsed);
      setJsonError(err);
      if (!err) setFlexOverride(parsed);
    } catch {
      setJsonError('JSON として読み取れません（カンマや括弧の抜けを確認してください）');
    }
  };

  const openJsonFromTemplate = () => {
    setJsonOpen(true);
    if (!jsonText && generated) setJsonText(JSON.stringify(generated, null, 2));
  };
  const resetToTemplate = () => {
    setFlexOverride(null);
    setJsonText(generated ? JSON.stringify(generated, null, 2) : '');
    setJsonError(null);
    touch();
  };

  // ---- プレビューを直接さわって編集する ----
  // 選択中のパーツが無くなったら（削除・テンプレート変更など）選択なしとして扱う
  const selected = selectedPath !== null && contents && !contentsError && getAt(contents, selectedPath) ? selectedPath : null;

  const applyEdit = (op: FlexEditOp) => {
    setEditError(null);
    const r = applyFlexEdit({ template, data, flexOverride }, op, selected);
    if (!r) return;
    if (r.error) {
      setEditError(r.error);
      return;
    }
    pushHistory(!r.typing);
    if (r.data) setData(r.data);
    if (r.flexOverride) {
      if (r.becameFree) toast({ title: '自由編集に切り替えました', description: '左の入力項目とは連動しなくなります。「テンプレートに戻す」か「元に戻す」で戻せます。' });
      setFlexOverride(r.flexOverride);
      setJsonText(JSON.stringify(r.flexOverride, null, 2));
      setJsonError(null);
    }
    setDirty(true);
    if (r.selected !== undefined) setSelectedPath(r.selected);
  };
  // 画像のアップロード完了時など、あとから呼ばれる場面でも最新の状態に対して操作する
  const applyEditRef = useRef(applyEdit);
  useEffect(() => {
    applyEditRef.current = applyEdit;
  });

  const previewEdit: FlexPreviewEdit = {
    selected,
    onSelect: setSelectedPath,
    onTextCommit: (path, text) => applyEdit({ type: 'text', path, text }),
    onMoveTo: (path, index) => applyEdit({ type: 'moveTo', path, index }),
    onAction: (action, path) => {
      if (action === 'prev') applyEdit({ type: 'move', path, dir: -1 });
      else if (action === 'next') applyEdit({ type: 'move', path, dir: 1 });
      else applyEdit({ type: action, path });
    },
  };

  const uploadImage = async (slot: string, file: File, current: string | undefined, apply: (url: string) => void) => {
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('storeId', storeId);
      fd.append('menuId', `flex_${id}_${slot}`);
      if (current) fd.append('oldImageUrl', current);
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'アップロードに失敗しました');
      apply(json.url);
      touch();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'アップロードに失敗しました', variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (contentsError) {
      toast({ title: contentsError, variant: 'destructive' });
      return;
    }
    if (jsonError) {
      toast({ title: jsonError, variant: 'destructive' });
      return;
    }
    const itemJsonError = Object.values(itemJson).find((s) => s.error)?.error;
    if (itemJsonError) {
      toast({ title: `追加のメッセージ: ${itemJsonError}`, variant: 'destructive' });
      return;
    }
    if (itemsError) {
      toast({ title: itemsError, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const body: LineFlexMessageInput = {
        id,
        name,
        template,
        data,
        flex_override: flexOverride,
        alt_text: altText,
        keywords,
        attach_confirm: attachConfirm,
        attach_reminder: attachReminder,
        attach_follow: attachFollow,
        enabled,
        track_taps: trackTaps,
        items,
      };
      const url = savedId ? `/api/stores/${storeId}/line-messages/${savedId}` : `/api/stores/${storeId}/line-messages`;
      const res = await fetch(url, { method: savedId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '保存に失敗しました');
      const saved = json.message as LineFlexMessage;
      setSavedId(saved.id);
      setId(saved.id);
      setDirty(false);
      toast({ title: '保存しました' });
      onSaved(saved);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '保存に失敗しました', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const searchCustomers = async (q: string) => {
    setCustomerQuery(q);
    try {
      const res = await fetch(`/api/stores/${storeId}/customers?search=${encodeURIComponent(q)}&limit=20`, { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      const list = (Array.isArray(json.customers) ? json.customers : []) as CustomerOption[];
      setCustomers(list.filter((c) => !!c.line_user_id));
    } catch {
      /* ignore */
    }
  };

  const sendTest = async () => {
    if (!savedId || !testTarget) return;
    setTestSending(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/line-messages/${savedId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ line_user_id: testTarget.line_user_id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'テスト送信に失敗しました');
      toast({ title: `${testTarget.name || testTarget.line_display_name || '送信先'} へテスト送信しました` });
      setTestOpen(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'テスト送信に失敗しました', variant: 'destructive' });
    } finally {
      setTestSending(false);
    }
  };

  // ---- テンプレートごとの入力 ----
  const bc = data as BookingCardData;
  const mc = data as MenuCarouselData;
  const sc = data as StoreCardData;
  const cc = data as CouponCardData;
  const nc = data as NoticeCardData;
  const ml = data as MenuListData;
  const st = data as StaffCarouselData;
  const sp = data as StepsCardData;
  const setBc = (patch: Partial<BookingCardData>) => { setData({ ...bc, ...patch }); touch(); };
  const setMc = (patch: Partial<MenuCarouselData>) => { setData({ ...mc, ...patch }); touch(); };
  const setSc = (patch: Partial<StoreCardData>) => { setData({ ...sc, ...patch }); touch(); };
  const setCc = (patch: Partial<CouponCardData>) => { setData({ ...cc, ...patch }); touch(); };
  const setNc = (patch: Partial<NoticeCardData>) => { setData({ ...nc, ...patch }); touch(); };
  const setMl = (patch: Partial<MenuListData>) => { setData({ ...ml, ...patch }); touch(); };
  const setSt = (patch: Partial<StaffCarouselData>) => { setData({ ...st, ...patch }); touch(); };
  const setSp = (patch: Partial<StepsCardData>) => { setData({ ...sp, ...patch }); touch(); };
  const updateItem = (key: string, patch: Partial<MenuCarouselItem>) => setMc({ items: mc.items.map((x) => (x.key === key ? { ...x, ...patch } : x)) });

  const renderTemplateFields = () => {
    switch (template) {
      case 'booking_card':
        return (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">画像（任意。横長がきれいに収まります）</Label>
              <ImageField slot="hero" value={bc.image_url} uploading={uploading} onUpload={(slot, f, cur) => uploadImage(slot, f, cur, (url) => setBc({ image_url: url }))} onChange={(url) => setBc({ image_url: url })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">見出し</Label>
              <Input value={bc.title} maxLength={60} onChange={(e) => setBc({ title: e.target.value })} placeholder="例: ご予約はこちらから" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">説明文</Label>
              <Textarea value={bc.text} maxLength={500} rows={3} onChange={(e) => setBc({ text: e.target.value })} placeholder="例: 24 時間いつでも LINE から予約できます" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">ボタン（最大 {LINE_FLEX_BUTTONS_MAX} つ）</Label>
              <ButtonsEditor buttons={bc.buttons ?? []} forms={forms} onChange={(buttons) => setBc({ buttons })} max={LINE_FLEX_BUTTONS_MAX} />
            </div>
            <ColorField value={bc.color} onChange={(v) => setBc({ color: v })} />
          </div>
        );
      case 'menu_carousel':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
              <span className="text-xs">予約フォームのメニュー構成から下書きを作る:</span>
              <Select onValueChange={(formId) => { const f = forms.find((x) => x.id === formId); if (f) setMc(menuCarouselFromForm(f.form as never, mc)); }}>
                <SelectTrigger className="h-8 w-[12rem] text-xs"><SelectValue placeholder="フォームを選ぶ" /></SelectTrigger>
                <SelectContent>
                  {forms.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">先頭 {LINE_FLEX_CAROUSEL_MAX} 件まで。取り込み後に編集できます</span>
            </div>
            <div className="space-y-2">
              {(mc.items ?? []).map((item, i) => (
                <div key={item.key} className="space-y-2 rounded border p-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">カード {i + 1}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={i === 0} onClick={() => { const n = [...mc.items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setMc({ items: n }); }}>↑</Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={i === mc.items.length - 1} onClick={() => { const n = [...mc.items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setMc({ items: n }); }}>↓</Button>
                      <button type="button" className="text-xs text-destructive hover:underline" onClick={() => setMc({ items: mc.items.filter((x) => x.key !== item.key) })}>削除</button>
                    </div>
                  </div>
                  <ImageField slot={`item_${item.key}`} value={item.image_url} uploading={uploading} onUpload={(slot, f, cur) => uploadImage(slot, f, cur, (url) => updateItem(item.key, { image_url: url }))} onChange={(url) => updateItem(item.key, { image_url: url })} />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input value={item.name} maxLength={40} onChange={(e) => updateItem(item.key, { name: e.target.value })} placeholder="メニュー名" className="h-8 text-xs" />
                    <Input value={item.price ?? ''} maxLength={20} onChange={(e) => updateItem(item.key, { price: e.target.value })} placeholder="料金（例: ¥3,300）" className="h-8 text-xs" />
                    <Input value={item.duration ?? ''} maxLength={20} onChange={(e) => updateItem(item.key, { duration: e.target.value })} placeholder="所要時間（例: 60分）" className="h-8 text-xs" />
                  </div>
                  <Textarea value={item.description ?? ''} maxLength={200} rows={2} onChange={(e) => updateItem(item.key, { description: e.target.value })} placeholder="説明（任意）" className="text-xs" />
                </div>
              ))}
              {(mc.items?.length ?? 0) < LINE_FLEX_CAROUSEL_MAX && (
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMc({ items: [...(mc.items ?? []), { key: rowKey(), name: '', price: '', duration: '', description: '', image_url: '', button: null }] })}>
                  ＋ カードを追加（{mc.items?.length ?? 0}/{LINE_FLEX_CAROUSEL_MAX}）
                </Button>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">全カード共通のボタン（任意）</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={mc.button_label ?? ''} maxLength={40} onChange={(e) => setMc({ button_label: e.target.value })} placeholder="ボタンの文言（例: 予約する）" className="h-8 w-40 text-xs" />
                <Input value={mc.button_url ?? ''} onChange={(e) => setMc({ button_url: e.target.value })} placeholder="https://…" className="h-8 flex-1 min-w-[12rem] text-xs" />
                <UrlPicker forms={forms} onPick={(url) => setMc({ button_url: url })} />
              </div>
            </div>
            <ColorField value={mc.color} onChange={(v) => setMc({ color: v })} />
          </div>
        );
      case 'store_card':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSc(storeCardFromStore(store, forms.find((f) => f.liffUrl)?.liffUrl, sc))}>
                店舗情報から埋める
              </Button>
              <span className="text-[11px] text-muted-foreground">店舗名・電話・住所（地図リンク）・公式サイト・ロゴを取り込みます</span>
            </div>
            <ImageField slot="hero" value={sc.image_url} uploading={uploading} onUpload={(slot, f, cur) => uploadImage(slot, f, cur, (url) => setSc({ image_url: url }))} onChange={(url) => setSc({ image_url: url })} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">店舗名</Label><Input value={sc.name} maxLength={60} onChange={(e) => setSc({ name: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">営業時間</Label><Input value={sc.hours ?? ''} maxLength={80} onChange={(e) => setSc({ hours: e.target.value })} placeholder="例: 10:00〜19:00（火曜定休）" /></div>
              <div className="space-y-1"><Label className="text-xs">電話番号</Label><Input value={sc.phone ?? ''} maxLength={20} onChange={(e) => setSc({ phone: e.target.value })} placeholder="例: 03-1234-5678" /></div>
              <div className="space-y-1"><Label className="text-xs">住所</Label><Input value={sc.address ?? ''} maxLength={120} onChange={(e) => setSc({ address: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">地図の URL</Label><Input value={sc.map_url ?? ''} onChange={(e) => setSc({ map_url: e.target.value })} placeholder="https://maps.google.com/…" /></div>
              <div className="space-y-1"><Label className="text-xs">公式サイトの URL</Label><Input value={sc.website_url ?? ''} onChange={(e) => setSc({ website_url: e.target.value })} placeholder="https://…" /></div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">予約ボタンの URL</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={sc.booking_url ?? ''} onChange={(e) => setSc({ booking_url: e.target.value })} placeholder="https://liff.line.me/…" className="flex-1 min-w-[12rem]" />
                  <UrlPicker forms={forms} onPick={(url) => setSc({ booking_url: url })} />
                </div>
              </div>
            </div>
            <ColorField value={sc.color} onChange={(v) => setSc({ color: v })} />
          </div>
        );
      case 'coupon_card':
        return (
          <div className="space-y-3">
            <ImageField slot="hero" value={cc.image_url} uploading={uploading} onUpload={(slot, f, cur) => uploadImage(slot, f, cur, (url) => setCc({ image_url: url }))} onChange={(url) => setCc({ image_url: url })} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">見出し</Label><Input value={cc.title} maxLength={40} onChange={(e) => setCc({ title: e.target.value })} placeholder="例: LINE 友だち限定クーポン" /></div>
              <div className="space-y-1"><Label className="text-xs">大きく出す文字</Label><Input value={cc.highlight} maxLength={20} onChange={(e) => setCc({ highlight: e.target.value })} placeholder="例: 10% OFF / 500円引き" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">説明文</Label><Textarea value={cc.description ?? ''} maxLength={300} rows={2} onChange={(e) => setCc({ description: e.target.value })} placeholder="例: このメッセージをご来店時にご提示ください" /></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label className="text-xs">有効期限</Label><Input value={cc.expires ?? ''} maxLength={40} onChange={(e) => setCc({ expires: e.target.value })} placeholder="例: 2026年12月31日まで" /></div>
              <div className="space-y-1"><Label className="text-xs">利用条件</Label><Input value={cc.conditions ?? ''} maxLength={60} onChange={(e) => setCc({ conditions: e.target.value })} placeholder="例: 他クーポン併用不可" /></div>
              <div className="space-y-1"><Label className="text-xs">提示コード（任意）</Label><Input value={cc.code ?? ''} maxLength={20} onChange={(e) => setCc({ code: e.target.value })} placeholder="例: LINE10" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">ボタン（任意）</Label><SingleButtonField value={cc.button} forms={forms} onChange={(button) => setCc({ button })} /></div>
            <ColorField value={cc.color} onChange={(v) => setCc({ color: v })} />
          </div>
        );
      case 'notice_card':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label className="text-xs">分類（帯の上の小さな文字）</Label><Input value={nc.label ?? ''} maxLength={20} onChange={(e) => setNc({ label: e.target.value })} placeholder="例: お知らせ / 重要" /></div>
              <div className="space-y-1 sm:col-span-2"><Label className="text-xs">見出し</Label><Input value={nc.title} maxLength={60} onChange={(e) => setNc({ title: e.target.value })} placeholder="例: 年末年始の営業について" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">日付（任意）</Label><Input value={nc.date ?? ''} maxLength={40} onChange={(e) => setNc({ date: e.target.value })} placeholder="例: 2026年12月28日" /></div>
            <div className="space-y-1"><Label className="text-xs">本文</Label><Textarea value={nc.body} maxLength={800} rows={4} onChange={(e) => setNc({ body: e.target.value })} placeholder="例: 12月31日〜1月3日は休業いたします。" /></div>
            <div className="space-y-1"><Label className="text-xs">画像（任意）</Label><ImageField slot="hero" value={nc.image_url} uploading={uploading} onUpload={(slot, f, cur) => uploadImage(slot, f, cur, (url) => setNc({ image_url: url }))} onChange={(url) => setNc({ image_url: url })} /></div>
            <div className="space-y-1"><Label className="text-xs">ボタン（任意）</Label><SingleButtonField value={nc.button} forms={forms} onChange={(button) => setNc({ button })} placeholder="詳しく見る" /></div>
            <ColorField value={nc.color} onChange={(v) => setNc({ color: v })} />
          </div>
        );
      case 'menu_list':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
              <span className="text-xs">予約フォームのメニュー構成から下書きを作る:</span>
              <Select onValueChange={(formId) => { const f = forms.find((x) => x.id === formId); if (f) setMl(menuListFromForm(f.form as never, ml)); }}>
                <SelectTrigger className="h-8 w-[12rem] text-xs"><SelectValue placeholder="フォームを選ぶ" /></SelectTrigger>
                <SelectContent>
                  {forms.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">先頭 {LINE_FLEX_MENU_LIST_MAX} 件まで</span>
            </div>
            <div className="space-y-1"><Label className="text-xs">見出し</Label><Input value={ml.title} maxLength={40} onChange={(e) => setMl({ title: e.target.value })} placeholder="例: メニュー・料金" /></div>
            <div className="space-y-1">
              <Label className="text-xs">行（最大 {LINE_FLEX_MENU_LIST_MAX}）</Label>
              {(ml.items ?? []).map((item, i) => (
                <div key={item.key} className="flex flex-wrap items-center gap-2 rounded border p-2">
                  <Input value={item.name} maxLength={40} onChange={(e) => setMl({ items: ml.items.map((x) => (x.key === item.key ? { ...x, name: e.target.value } : x)) })} placeholder="メニュー名" className="h-8 flex-1 min-w-[8rem] text-xs" />
                  <Input value={item.price ?? ''} maxLength={20} onChange={(e) => setMl({ items: ml.items.map((x) => (x.key === item.key ? { ...x, price: e.target.value } : x)) })} placeholder="料金" className="h-8 w-28 text-xs" />
                  <Input value={item.note ?? ''} maxLength={40} onChange={(e) => setMl({ items: ml.items.map((x) => (x.key === item.key ? { ...x, note: e.target.value } : x)) })} placeholder="補足（所要時間など）" className="h-8 w-40 text-xs" />
                  <RowTools index={i} length={ml.items.length} onMove={(dir) => setMl({ items: moveItem(ml.items, i, dir) })} onRemove={() => setMl({ items: ml.items.filter((x) => x.key !== item.key) })} />
                </div>
              ))}
              {(ml.items?.length ?? 0) < LINE_FLEX_MENU_LIST_MAX && (
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMl({ items: [...(ml.items ?? []), { key: rowKey(), name: '', price: '', note: '' }] })}>＋ 行を追加</Button>
              )}
            </div>
            <div className="space-y-1"><Label className="text-xs">注記（任意）</Label><Input value={ml.footnote ?? ''} maxLength={80} onChange={(e) => setMl({ footnote: e.target.value })} placeholder="例: ※ 価格は税込です" /></div>
            <div className="space-y-1"><Label className="text-xs">ボタン（任意）</Label><SingleButtonField value={ml.button} forms={forms} onChange={(button) => setMl({ button })} /></div>
            <ColorField value={ml.color} onChange={(v) => setMl({ color: v })} />
          </div>
        );
      case 'staff_carousel':
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              {(st.items ?? []).map((item, i) => (
                <div key={item.key} className="space-y-2 rounded border p-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">スタッフ {i + 1}</span>
                    <RowTools index={i} length={st.items.length} onMove={(dir) => setSt({ items: moveItem(st.items, i, dir) })} onRemove={() => setSt({ items: st.items.filter((x) => x.key !== item.key) })} />
                  </div>
                  <ImageField slot={`staff_${item.key}`} value={item.image_url} uploading={uploading} onUpload={(slot, f, cur) => uploadImage(slot, f, cur, (url) => setSt({ items: st.items.map((x) => (x.key === item.key ? { ...x, image_url: url } : x)) }))} onChange={(url) => setSt({ items: st.items.map((x) => (x.key === item.key ? { ...x, image_url: url } : x)) })} />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input value={item.name} maxLength={30} onChange={(e) => setSt({ items: st.items.map((x) => (x.key === item.key ? { ...x, name: e.target.value } : x)) })} placeholder="名前" className="h-8 text-xs" />
                    <Input value={item.role ?? ''} maxLength={40} onChange={(e) => setSt({ items: st.items.map((x) => (x.key === item.key ? { ...x, role: e.target.value } : x)) })} placeholder="役職・得意分野（例: カラー担当）" className="h-8 text-xs" />
                  </div>
                  <Textarea value={item.comment ?? ''} maxLength={200} rows={2} onChange={(e) => setSt({ items: st.items.map((x) => (x.key === item.key ? { ...x, comment: e.target.value } : x)) })} placeholder="ひとこと（任意）" className="text-xs" />
                </div>
              ))}
              {(st.items?.length ?? 0) < LINE_FLEX_CAROUSEL_MAX && (
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSt({ items: [...(st.items ?? []), { key: rowKey(), name: '', role: '', comment: '', image_url: '', button: null }] })}>
                  ＋ スタッフを追加（{st.items?.length ?? 0}/{LINE_FLEX_CAROUSEL_MAX}）
                </Button>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">全カード共通のボタン（任意）</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={st.button_label ?? ''} maxLength={40} onChange={(e) => setSt({ button_label: e.target.value })} placeholder="ボタンの文言（例: このスタッフで予約）" className="h-8 w-48 text-xs" />
                <Input value={st.button_url ?? ''} onChange={(e) => setSt({ button_url: e.target.value })} placeholder="https://…" className="h-8 flex-1 min-w-[12rem] text-xs" />
                <UrlPicker forms={forms} onPick={(url) => setSt({ button_url: url })} />
              </div>
            </div>
            <ColorField value={st.color} onChange={(v) => setSt({ color: v })} />
          </div>
        );
      case 'steps_card':
        return (
          <div className="space-y-3">
            <div className="space-y-1"><Label className="text-xs">見出し</Label><Input value={sp.title} maxLength={40} onChange={(e) => setSp({ title: e.target.value })} placeholder="例: ご利用の流れ" /></div>
            <div className="space-y-1">
              <Label className="text-xs">ステップ（最大 {LINE_FLEX_STEPS_MAX}）</Label>
              {(sp.steps ?? []).map((step, i) => (
                <div key={step.key} className="space-y-2 rounded border p-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: sp.color || '#06C755' }}>{i + 1}</span>
                    <Input value={step.title} maxLength={40} onChange={(e) => setSp({ steps: sp.steps.map((x) => (x.key === step.key ? { ...x, title: e.target.value } : x)) })} placeholder="ステップ名" className="h-8 flex-1 text-xs" />
                    <RowTools index={i} length={sp.steps.length} onMove={(dir) => setSp({ steps: moveItem(sp.steps, i, dir) })} onRemove={() => setSp({ steps: sp.steps.filter((x) => x.key !== step.key) })} />
                  </div>
                  <Input value={step.text ?? ''} maxLength={120} onChange={(e) => setSp({ steps: sp.steps.map((x) => (x.key === step.key ? { ...x, text: e.target.value } : x)) })} placeholder="説明（任意）" className="h-8 text-xs" />
                </div>
              ))}
              {(sp.steps?.length ?? 0) < LINE_FLEX_STEPS_MAX && (
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSp({ steps: [...(sp.steps ?? []), { key: rowKey(), title: '', text: '' }] })}>＋ ステップを追加</Button>
              )}
            </div>
            <div className="space-y-1"><Label className="text-xs">ボタン（任意）</Label><SingleButtonField value={sp.button} forms={forms} onChange={(button) => setSp({ button })} /></div>
            <ColorField value={sp.color} onChange={(v) => setSp({ color: v })} />
          </div>
        );
      default:
        return (
          <p className="text-xs text-muted-foreground">
            LINE の <a href="https://developers.line.biz/flex-simulator/" target="_blank" rel="noreferrer" className="underline">Flex Message Simulator</a> などで作った JSON を下の欄に貼り付けてください（bubble / carousel、または type: flex のメッセージ全体）。
          </p>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-6xl max-h-[92dvh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle>{initial ? 'LINE メッセージを編集' : 'LINE メッセージを作成'}</DialogTitle>
          <DialogDescription>テンプレートに項目を入れるだけで、公式 LINE に送れる Flex Message ができます。右側のプレビューは、文字や画像をクリックして直接編集することもできます。</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            {/* 左: 入力 */}
            <div className="space-y-5 min-w-0">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="flex_name" className="text-xs">管理用の名前 <span className="text-destructive">*</span></Label>
                  <Input id="flex_name" value={name} maxLength={LINE_FLEX_NAME_MAX} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="例: メニュー案内（リッチメニュー用）" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">テンプレート</Label>
                  <Select value={template} onValueChange={(v) => changeTemplate(v as LineFlexTemplate)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LINE_FLEX_TEMPLATES.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">{LINE_FLEX_TEMPLATES.find((t) => t.id === template)?.description}</p>
                </div>
              </div>

              <section className="space-y-2 rounded-lg border p-3">
                <h4 className="text-sm font-medium">内容</h4>
                {flexOverride && template !== 'custom' && (
                  <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                    <span className="min-w-0 flex-1">
                      自由編集中（プレビューでの見た目の変更・パーツの追加、または JSON の直接編集）のため、下の項目を変えても反映されません。「テンプレートに戻す」で項目入力に戻せます（自由編集の内容は消えます）。
                    </span>
                    <Button type="button" size="sm" variant="outline" className="h-6 bg-white text-[11px]" onClick={resetToTemplate}>テンプレートに戻す</Button>
                  </div>
                )}
                {renderTemplateFields()}
              </section>

              <section className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">上級者向け: JSON を直接編集</h4>
                  {template !== 'custom' && (
                    <div className="flex items-center gap-2">
                      {flexOverride && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={resetToTemplate}>テンプレートに戻す</Button>}
                      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => (jsonOpen ? setJsonOpen(false) : openJsonFromTemplate())}>
                        {jsonOpen ? '閉じる' : 'JSON を開く'}
                      </Button>
                    </div>
                  )}
                </div>
                {jsonOpen && (
                  <div className="space-y-1">
                    <Textarea value={jsonText} onChange={(e) => applyJson(e.target.value)} rows={12} spellCheck={false} className="font-mono text-[11px]" placeholder='{"type":"bubble", ...}' />
                    {jsonError ? <p className="text-xs text-destructive">{jsonError}</p> : <p className="text-[11px] text-muted-foreground">編集するとテンプレートの項目より JSON が優先されます（LINE の Flex Message 仕様に従ってください）</p>}
                  </div>
                )}
              </section>

              <section className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">送る内容の並び <span className="text-xs font-normal text-muted-foreground">{items.length} / {LINE_FLEX_ITEMS_MAX} 通{describeLineFlexItems(items) ? `（${describeLineFlexItems(items)}）` : ''}</span></h4>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  上の「内容」で作った Flex に続けて、テキスト・画像・動画・別の Flex を一度に送れます（LINE の上限は 1 回 5 通）。↑↓ で順番を変えられ、右のプレビューにこの順番で並びます。
                </p>
                <ItemsEditor
                  items={items}
                  onChange={changeItems}
                  others={others}
                  selfId={id}
                  uploading={uploading}
                  onUpload={uploadImage}
                  jsonState={itemJson}
                  onJsonChange={changeItemJson}
                  attachChecked={attachConfirm || attachReminder || attachFollow}
                />
                {itemsError && items.length > 1 && <p className="text-xs text-destructive">{itemsError}</p>}
              </section>

              <section className="space-y-3 rounded-lg border p-3">
                <h4 className="text-sm font-medium">送り方</h4>
                <div className="space-y-1">
                  <Label htmlFor="flex_keywords" className="text-xs">キーワード自動応答（お客様がこの言葉をそのまま送ると、このメッセージを返します。カンマ区切りで最大 {LINE_FLEX_KEYWORD_MAX} 個）</Label>
                  <Input id="flex_keywords" value={keywordsText} onChange={(e) => { setKeywordsText(e.target.value); touch(); }} placeholder="例: メニュー, 料金" />
                  {keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {keywords.map((k) => (
                        <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{k}</span>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    公式 LINE 管理画面のリッチメニューで、アクションの種類を「テキスト」にしてこのキーワードを設定すると、タップでこのメッセージが出ます。
                    「予約確認」「キャンセル」はシステムが使うため登録できません。
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">自動メッセージに添える</Label>
                  <Check checked={attachConfirm} onChange={(v) => { setAttachConfirm(v); touch(); }} label="予約完了時の【ご予約確認】のあとに送る" hint="お客様が LINE の予約フォームから予約したとき" />
                  <Check checked={attachReminder} onChange={(v) => { setAttachReminder(v); touch(); }} label="予約リマインダーのあとに送る" hint="前日・当日・直前リマインダーすべて" />
                  <Check checked={attachFollow} onChange={(v) => { setAttachFollow(v); touch(); }} label="フォローメッセージのあとに送る" hint="来店後のお礼メッセージ" />
                </div>
              </section>

              <section className="space-y-3 rounded-lg border p-3">
                <h4 className="text-sm font-medium">その他</h4>
                <div className="space-y-1">
                  <Label htmlFor="flex_alt" className="text-xs">通知・トーク一覧に出る文（代替テキスト） <span className="text-destructive">*</span></Label>
                  <Input id="flex_alt" value={altText} maxLength={LINE_FLEX_ALT_TEXT_MAX} onChange={(e) => { setAltText(e.target.value); touch(); }} placeholder="例: メニューのご案内" />
                </div>
                <Check checked={trackTaps} onChange={(v) => { setTrackTaps(v); touch(); }} label="ボタンのタップ数を計測する" hint="ボタンの URL を計測リンク経由にします（リンク先は変わりません）。OFF にすると直接リンクになります" />
                <Check checked={enabled} onChange={(v) => { setEnabled(v); touch(); }} label="有効" hint="OFF にするとキーワード応答・差し込みを止めます（内容は残ります）" />
              </section>
            </div>

            {/* 右: プレビュー */}
            <div className="lg:sticky lg:top-0 self-start space-y-3 lg:max-h-[calc(92dvh-11rem)] lg:overflow-y-auto">
              <h4 className="text-sm font-medium">プレビュー <span className="text-[11px] font-normal text-muted-foreground">クリックして直接編集できます</span></h4>
              <FlexPreview contents={contentsError ? null : contents} altText={altText} messages={previewMessages.length > 0 ? previewMessages : undefined} edit={contents && !contentsError ? previewEdit : undefined} />
              {contentsError && contents && <p className="text-xs text-destructive">{contentsError}</p>}
              <FlexPartInspector
                contents={contentsError ? null : contents}
                selected={selected}
                onSelect={setSelectedPath}
                onOp={(op) => applyEditRef.current(op)}
                templateLinked={isTemplateLinked({ template, data, flexOverride })}
                formUrls={forms.filter((f) => f.liffUrl).map((f) => ({ name: f.name, url: f.liffUrl }))}
                uploading={uploading}
                onUpload={(slot, file, apply) => uploadImage(slot, file, undefined, apply)}
                canUndo={history.past.length > 0}
                canRedo={history.future.length > 0}
                onUndo={undo}
                onRedo={redo}
                error={editError}
              />
            </div>
          </div>
        </div>

        <div className="border-t px-5 py-3 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={save} disabled={saving}>{saving ? '保存中…' : savedId ? '更新' : '保存'}</Button>
          <Button type="button" variant="outline" disabled={!savedId} title={!savedId ? '先に保存してください' : undefined} onClick={() => { setTestOpen((v) => !v); if (customers.length === 0) searchCustomers(''); }}>
            テスト送信
          </Button>
          {dirty && savedId && <span className="text-[11px] text-amber-700">未保存の変更があります（テスト送信は保存済みの内容で送られます）</span>}
          <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>閉じる</Button>
        </div>

        {testOpen && savedId && (
          <div className="border-t bg-muted/30 px-5 py-3 space-y-2">
            <p className="text-xs">送信先（LINE 連携済みの顧客から選びます。自分のアカウントで友だち追加して予約などをしておくと一覧に出ます）。無料通数を 1 通使います。</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={customerQuery} onChange={(e) => searchCustomers(e.target.value)} placeholder="名前・電話番号で検索" className="h-8 w-56 text-xs" />
              <Select value={testTarget?.id ?? ''} onValueChange={(v) => setTestTarget(customers.find((c) => c.id === v) ?? null)}>
                <SelectTrigger className="h-8 w-64 text-xs"><SelectValue placeholder={customers.length ? '顧客を選ぶ' : '該当する顧客がいません'} /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name || c.line_display_name || c.id}{c.line_display_name && c.name ? `（LINE: ${c.line_display_name}）` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" disabled={!testTarget || testSending} onClick={sendTest}>{testSending ? '送信中…' : 'この顧客に送る'}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { formLiffUrl };
