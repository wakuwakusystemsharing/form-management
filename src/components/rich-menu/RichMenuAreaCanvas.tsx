'use client';

/**
 * リッチメニューの画像と、その上のボタンの範囲。
 * - 何も無い所をドラッグ → 新しいボタンを作る
 * - ボタンをドラッグ → 動かす / 選んだボタンの 四隅・四辺のつまみをドラッグ → 大きさを変える
 * - 動かしている最中は、ほかのボタンの辺・画像の端に吸い付く（すき間なく並べやすくする）
 * - 選んだボタンは、矢印キーで 1% ずつ動かせる（Shift + 矢印 = 大きさ）。Delete で消す
 * 位置は画像全体に対する割合（0〜1）で持つ。計算は `src/lib/line-rich-menu.ts`
 */
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  AREA_SNAP,
  RESIZE_HANDLES,
  RICH_MENU_LIMITS,
  RICH_MENU_SIZES,
  isUsableRect,
  magnetRect,
  moveRect,
  nextAreaId,
  overlapsOthers,
  rectFromDrag,
  resizeRectBy,
  type ResizeHandle,
  type RichMenuArea,
  type RichMenuSize,
} from '@/lib/line-rich-menu';

type Rect = Pick<RichMenuArea, 'x' | 'y' | 'w' | 'h'>;
type Gesture =
  | { kind: 'create'; startX: number; startY: number }
  | { kind: 'move'; id: string; startX: number; startY: number; origin: Rect }
  | { kind: 'resize'; id: string; handle: ResizeHandle; startX: number; startY: number; origin: Rect };

export interface RichMenuAreaCanvasProps {
  size: RichMenuSize;
  imageUrl: string;
  areas: RichMenuArea[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** 渡さなければ表示だけ（一覧の小さな絵） */
  onChange?: (areas: RichMenuArea[], selectedId: string | null) => void;
  className?: string;
}

const pct = (n: number) => `${n * 100}%`;

/** つまみの位置とカーソル */
const HANDLE_STYLE: Record<ResizeHandle, { className: string; cursor: string }> = {
  nw: { className: '-left-1.5 -top-1.5', cursor: 'cursor-nwse-resize' },
  n: { className: 'left-1/2 -top-1.5 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  ne: { className: '-right-1.5 -top-1.5', cursor: 'cursor-nesw-resize' },
  e: { className: '-right-1.5 top-1/2 -translate-y-1/2', cursor: 'cursor-ew-resize' },
  se: { className: '-bottom-1.5 -right-1.5', cursor: 'cursor-nwse-resize' },
  s: { className: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  sw: { className: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
  w: { className: '-left-1.5 top-1/2 -translate-y-1/2', cursor: 'cursor-ew-resize' },
};

export default function RichMenuAreaCanvas({ size, imageUrl, areas, selectedId = null, onSelect, onChange, className }: RichMenuAreaCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  // ドラッグ中の見た目（離したときに確定する）
  const [draft, setDraftState] = useState<{ id: string | null; rect: Rect } | null>(null);
  // 離した瞬間の位置を確実に使うため、最新の値は ref にも持つ（状態だけだと、すばやく離したときに 1 つ前の位置で確定してしまう）
  const draftRef = useRef<{ id: string | null; rect: Rect } | null>(null);
  const setDraft = (next: { id: string | null; rect: Rect } | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const editable = !!onChange;
  const dims = RICH_MENU_SIZES[size];
  const othersOf = (id: string | null): Rect[] => areas.filter((a) => a.id !== id);

  const position = (e: React.PointerEvent): { x: number; y: number } => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const start = (e: React.PointerEvent, g: Gesture) => {
    if (!editable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.stopPropagation();
    e.preventDefault();
    gesture.current = g;
    ref.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = position(e);
    // Alt を押しているあいだは吸い付かない（細かく合わせたいとき）
    const magnet = (rect: Rect, id: string | null, handle: ResizeHandle | 'move') => (e.altKey ? rect : magnetRect(rect, othersOf(id), handle));
    if (g.kind === 'create') setDraft({ id: null, rect: magnet(rectFromDrag(g.startX, g.startY, p.x, p.y), null, p.x >= g.startX ? (p.y >= g.startY ? 'se' : 'ne') : p.y >= g.startY ? 'sw' : 'nw') });
    else if (g.kind === 'move') setDraft({ id: g.id, rect: magnet(moveRect(g.origin, p.x - g.startX, p.y - g.startY), g.id, 'move') });
    else setDraft({ id: g.id, rect: magnet(resizeRectBy(g.origin, g.handle, p.x - g.startX, p.y - g.startY), g.id, g.handle) });
  };

  const finish = (e: React.PointerEvent, commit: boolean) => {
    // 離した位置まで反映してから確定する
    if (commit) onPointerMove(e);
    const g = gesture.current;
    gesture.current = null;
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {}
    const current = draftRef.current;
    setDraft(null);
    if (!g || !onChange) return;
    if (!commit || !current) {
      // 動かさずに離した: 何も無い所なら選択を外す
      if (g.kind === 'create') onSelect?.(null);
      return;
    }
    if (g.kind === 'create') {
      if (!isUsableRect(current.rect) || areas.length >= RICH_MENU_LIMITS.areasMax) {
        onSelect?.(null);
        return;
      }
      const id = nextAreaId(areas);
      onChange([...areas, { id, ...current.rect, action: { type: 'none' } }], id);
      return;
    }
    onChange(areas.map((a) => (a.id === g.id ? { ...a, ...current.rect } : a)), g.id);
  };

  // 矢印キー = 1% ずつ動かす / Shift + 矢印 = 大きさを変える / Delete・Backspace = 消す
  const onAreaKeyDown = (e: React.KeyboardEvent, area: RichMenuArea) => {
    if (!onChange) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onChange(areas.filter((a) => a.id !== area.id), null);
      return;
    }
    const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dir[e.key];
    if (!d) return;
    e.preventDefault();
    const origin = { x: area.x, y: area.y, w: area.w, h: area.h };
    const rect = e.shiftKey ? resizeRectBy(origin, 'se', d[0] * AREA_SNAP, d[1] * AREA_SNAP) : moveRect(origin, d[0] * AREA_SNAP, d[1] * AREA_SNAP);
    onChange(areas.map((a) => (a.id === area.id ? { ...a, ...rect } : a)), area.id);
  };

  return (
    <div
      ref={ref}
      className={cn('relative w-full rounded-md border bg-muted', editable ? 'cursor-crosshair touch-none select-none' : 'overflow-hidden', className)}
      style={{ aspectRatio: `${dims.width} / ${dims.height}` }}
      data-slot="rich-menu-canvas"
      onPointerDown={(e) => {
        const p = position(e);
        start(e, { kind: 'create', startX: p.x, startY: p.y });
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full rounded-md object-cover" />
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-muted-foreground">画像はまだありません</div>
      )}

      {areas.map((area, i) => {
        const rect = draft && draft.id === area.id ? draft.rect : area;
        const selected = selectedId === area.id;
        const bad = overlapsOthers(areas, area.id, rect);
        const inactive = area.action.type === 'none';
        return (
          <div
            key={area.id}
            role={editable ? 'button' : undefined}
            tabIndex={editable ? 0 : undefined}
            aria-label={editable ? `ボタン ${i + 1}` : undefined}
            aria-pressed={editable ? selected : undefined}
            className={cn(
              'absolute flex items-start justify-start border-2 text-[11px] font-bold leading-none focus-visible:outline-none',
              bad ? 'border-red-500 bg-red-500/30' : selected ? 'border-primary bg-primary/25' : inactive ? 'border-dashed border-white/90 bg-black/20' : 'border-white/90 bg-sky-500/25',
              editable && 'cursor-move',
              selected && 'z-10'
            )}
            style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
            data-slot="rich-menu-area"
            data-area-id={area.id}
            onKeyDown={(e) => onAreaKeyDown(e, area)}
            onPointerDown={(e) => {
              if (!editable) return;
              onSelect?.(area.id);
              e.currentTarget.focus({ preventScroll: true });
              const p = position(e);
              start(e, { kind: 'move', id: area.id, startX: p.x, startY: p.y, origin: { x: area.x, y: area.y, w: area.w, h: area.h } });
            }}
          >
            <span className={cn('m-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-0.5 text-white', bad ? 'bg-red-600' : selected ? 'bg-primary text-primary-foreground' : 'bg-black/70')}>{i + 1}</span>
            {editable &&
              selected &&
              RESIZE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  aria-hidden="true"
                  className={cn('absolute h-3.5 w-3.5 rounded-sm border-2 border-white bg-primary shadow', HANDLE_STYLE[handle].className, HANDLE_STYLE[handle].cursor)}
                  data-slot="rich-menu-area-resize"
                  data-handle={handle}
                  onPointerDown={(e) => {
                    const p = position(e);
                    start(e, { kind: 'resize', id: area.id, handle, startX: p.x, startY: p.y, origin: { x: area.x, y: area.y, w: area.w, h: area.h } });
                  }}
                />
              ))}
          </div>
        );
      })}

      {/* 作っている途中の範囲 */}
      {draft && draft.id === null && (
        <div
          className={cn('pointer-events-none absolute border-2 border-dashed', isUsableRect(draft.rect) ? 'border-primary bg-primary/20' : 'border-muted-foreground bg-black/10')}
          style={{ left: pct(draft.rect.x), top: pct(draft.rect.y), width: pct(draft.rect.w), height: pct(draft.rect.h) }}
        />
      )}
    </div>
  );
}
