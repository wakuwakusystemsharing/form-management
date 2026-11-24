'use client';

/**
 * 予約カレンダー（月 / 週 / 日）
 *
 * - 店舗管理者ページの「カレンダー」タブと、テナント側 店舗ページの「カレンダー」タブで共用
 * - 日付・重なり・ドラッグの位置の計算は純粋ロジック `src/lib/reservation-calendar.ts`
 * - 予約を押すと onSelectReservation で予約の行を渡す（詳細の表示は呼び出し側）
 * - 予約の帯はマウスでつかんで別の日時に落とせる（パソコンのみ。保存は PATCH /api/reservations/{id}）
 * - 空いている所を押すと、その日時で店舗側手動予約フォームを開く（forms に手動予約できるフォームがあるとき）
 * - 予約以外の予定（Google カレンダー）は灰色で「予定あり」とだけ出す
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import {
  CALENDAR_VIEWS,
  DRAG_THRESHOLD_PX,
  WEEKDAY_LABELS,
  buildMonthGrid,
  calendarRange,
  calendarTitle,
  countOverlappingEvents,
  describeSlot,
  dragSnapMinutes,
  eventsForDate,
  isDraggableEvent,
  isSameSlot,
  jstNowMinutes,
  jstToday,
  layoutDayEvents,
  minutesToTime,
  monthCellEvents,
  moveTarget,
  overlapsBusy,
  parseYmd,
  shiftAnchor,
  slotAtPointer,
  timeToMinutes,
  toCalendarEvents,
  visibleHourRange,
  weekDates,
  weekdayOf,
  type BusyBlock,
  type CalendarEvent,
  type CalendarReservationInput,
  type CalendarView,
} from '@/lib/reservation-calendar';

const VIEW_STORAGE_KEY = 'reservation_calendar_view';
const HOUR_HEIGHT = 48; // 1 時間の高さ（px）
const FOCUS_RELOAD_MS = 5000; // 画面に戻ってきたときの読み込み直しの間隔（これより短い間は読み込まない）

interface CalendarData {
  reservations: CalendarReservationInput[];
  busy: BusyBlock[];
  google: 'ok' | 'none' | 'error';
}

/** カレンダーが使うフォームの情報 */
export interface CalendarFormInfo {
  id: string;
  name: string;
  /** フォームの時間間隔（分）。ドラッグで落とすときの刻みに使う */
  timeInterval?: number | null;
  /** 店舗側手動予約フォームを開けるフォームか（LINE タイプのフォーム） */
  manual?: boolean;
}

export interface ReservationCalendarProps {
  storeId: string;
  /** 予約を押したとき。予約一覧の API と同じ形の行を渡す */
  onSelectReservation?: (reservation: any) => void;
  /** ドラッグで日時を変えたあと。更新後の予約の行を渡す（一覧の表示を合わせるため） */
  onReservationChanged?: (reservation: any) => void;
  /** 値が変わると読み込み直す（予約を編集・キャンセルしたあとなど） */
  reloadSignal?: unknown;
  /** その店舗の予約フォーム（ドラッグの刻みと、空いている所からの手動予約に使う） */
  forms?: CalendarFormInfo[];
  className?: string;
}

/** ドラッグ中の落とし先 */
interface DragTarget {
  id: string;
  date: string;
  startMin: number;
  durationMinutes: number;
}

type PointerDownHandler = (e: React.PointerEvent<HTMLElement>, ev: CalendarEvent, mode: 'grid' | 'month') => void;

function initialView(): CalendarView {
  if (typeof window === 'undefined') return 'week';
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === 'month' || saved === 'week' || saved === 'day') return saved;
  } catch {}
  // スマホは日表示から始める
  return window.innerWidth < 768 ? 'day' : 'week';
}

/** 予約の状態ごとの色 */
function eventColor(ev: CalendarEvent): string {
  if (ev.cancelled) return 'border-red-200 bg-red-50 text-red-500 line-through opacity-70';
  if (ev.status === 'pending') return 'border-amber-300 bg-amber-50 text-amber-900';
  if (ev.status === 'completed') return 'border-slate-300 bg-slate-100 text-slate-700';
  return 'border-emerald-300 bg-emerald-50 text-emerald-900';
}

function eventTimeLabel(ev: CalendarEvent): string {
  if (ev.kind === 'stay') return '宿泊';
  if (ev.kind === 'untimed' || ev.startMin === null) return '時間未定';
  return minutesToTime(ev.startMin);
}

function eventAriaLabel(ev: CalendarEvent): string {
  return [eventTimeLabel(ev), ev.title, ev.subtitle, ev.staffName ? `担当 ${ev.staffName}` : '', ev.cancelled ? 'キャンセル済み' : ''].filter(Boolean).join(' ');
}

function shortDate(ymd: string): string {
  const p = parseYmd(ymd);
  return `${p.month}/${p.day}`;
}

export default function ReservationCalendar({ storeId, onSelectReservation, onReservationChanged, reloadSignal, forms, className }: ReservationCalendarProps) {
  const { toast } = useToast();
  const [view, setView] = useState<CalendarView>(initialView);
  const [anchor, setAnchor] = useState<string>(() => jstToday());
  const [showCancelled, setShowCancelled] = useState(false);
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const [reloadCount, setReloadCount] = useState(0);
  // ドラッグ
  const [drag, setDrag] = useState<DragTarget | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ event: CalendarEvent; date: string; startMin: number } | null>(null);
  const [saving, setSaving] = useState<{ id: string; date: string; startMin: number } | null>(null);
  // 空いている所から手動予約
  const [manualSlot, setManualSlot] = useState<{ date: string; time: string; formId: string } | null>(null);

  const suppressClickRef = useRef(false);
  const lastLoadedRef = useRef(0);
  const savingRef = useRef(false);

  const range = useMemo(() => calendarRange(view, anchor), [view, anchor]);
  const manualForms = useMemo(() => (forms || []).filter((f) => f.manual), [forms]);
  const intervalByForm = useMemo(() => new Map((forms || []).map((f) => [f.id, f.timeInterval ?? null])), [forms]);

  const changeView = useCallback((next: CalendarView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/stores/${storeId}/reservations/calendar?from=${range.from}&to=${range.to}`, { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json) {
          setError(json?.error || '予約カレンダーの取得に失敗しました');
          return;
        }
        setData({
          reservations: Array.isArray(json.reservations) ? json.reservations : [],
          busy: Array.isArray(json.busy) ? json.busy : [],
          google: json.google === 'ok' || json.google === 'error' ? json.google : 'none',
        });
        setError(null);
        lastLoadedRef.current = Date.now();
      } catch {
        if (!cancelled) setError('予約カレンダーの取得に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, range.from, range.to, reloadSignal, reloadCount]);

  // 「いま」の線を 1 分ごとに動かす
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // 別のタブ（手動予約フォームなど）から戻ってきたら読み込み直す
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== 'visible' || savingRef.current) return;
      if (Date.now() - lastLoadedRef.current < FOCUS_RELOAD_MS) return;
      setReloadCount((n) => n + 1);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const today = useMemo(() => jstToday(), [nowTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowMinutes = useMemo(() => jstNowMinutes(), [nowTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseEvents = useMemo(() => toCalendarEvents(data?.reservations || [], { includeCancelled: showCancelled }), [data, showCancelled]);
  // 保存中の予約は、動かした先に置いて見せる（失敗したら元の位置に戻る）
  const events = useMemo(() => {
    if (!saving) return baseEvents;
    return baseEvents.map((ev) => (ev.id === saving.id && ev.kind === 'timed' ? { ...ev, date: saving.date, endDate: saving.date, startMin: saving.startMin, endMin: Math.min(1440, saving.startMin + ev.durationMinutes) } : ev));
  }, [baseEvents, saving]);
  const busy = useMemo(() => data?.busy || [], [data]);
  const rowsById = useMemo(() => new Map((data?.reservations || []).map((r) => [r.id, r])), [data]);
  const cancelledCount = useMemo(() => (data?.reservations || []).filter((r) => r.status === 'cancelled').length, [data]);

  const openEvent = (ev: CalendarEvent) => {
    if (suppressClickRef.current) return;
    const row = rowsById.get(ev.id);
    if (row && onSelectReservation) onSelectReservation(row);
  };
  const openDay = (date: string) => {
    if (suppressClickRef.current) return;
    setAnchor(date);
    changeView('day');
  };

  // ---- ドラッグで移動（マウスだけ。スマホ・タブレットは予約を開いて「予約内容を編集」から変える）
  const onEventPointerDown: PointerDownHandler = (e, ev, mode) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !isDraggableEvent(ev) || savingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const grabOffsetMin = mode === 'grid' ? ((e.clientY - rect.top) / HOUR_HEIGHT) * 60 : 0;
    const snapMinutes = dragSnapMinutes(intervalByForm.get(rowsById.get(ev.id)?.form_id || '') ?? null);
    let active = false;
    let target: DragTarget | null = null;

    const locate = (x: number, y: number): DragTarget | null => {
      for (const el of document.elementsFromPoint(x, y)) {
        if (!(el instanceof HTMLElement)) continue;
        const date = el.dataset.date;
        if (!date) continue;
        if (el.dataset.calCol !== undefined) {
          const colRect = el.getBoundingClientRect();
          const pointerMin = Number(el.dataset.gridStart || 0) + ((y - colRect.top) / HOUR_HEIGHT) * 60;
          return { id: ev.id, date, startMin: moveTarget({ pointerMin, grabOffsetMin, snapMinutes }), durationMinutes: ev.durationMinutes };
        }
        // 月表示: 日だけ変える（時刻はそのまま）
        if (el.dataset.calCell !== undefined && ev.startMin !== null) return { id: ev.id, date, startMin: ev.startMin, durationMinutes: ev.durationMinutes };
      }
      return null;
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setDrag(null);
      setDraggingId(null);
    };
    const onMove = (me: PointerEvent) => {
      if (!active) {
        if (Math.hypot(me.clientX - startX, me.clientY - startY) < DRAG_THRESHOLD_PX) return;
        active = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        setDraggingId(ev.id);
      }
      target = locate(me.clientX, me.clientY);
      setDrag(target);
    };
    const onUp = () => {
      const dropped = active ? target : null;
      if (active) {
        // 落とした直後のクリック（予約詳細・手動予約）を止める
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);
      }
      cleanup();
      if (dropped && !isSameSlot(ev, dropped.date, dropped.startMin)) setConfirmMove({ event: ev, date: dropped.date, startMin: dropped.startMin });
    };
    const onCancel = () => cleanup();
    const onKey = (ke: KeyboardEvent) => {
      if (ke.key === 'Escape') {
        active = false;
        target = null;
        cleanup();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  };

  const saveMove = async () => {
    const move = confirmMove;
    if (!move || savingRef.current) return;
    const row = rowsById.get(move.event.id) as (CalendarReservationInput & { updated_at?: string }) | undefined;
    setConfirmMove(null);
    savingRef.current = true;
    setSaving({ id: move.event.id, date: move.date, startMin: move.startMin });
    const time = minutesToTime(move.startMin);
    try {
      const res = await fetchWithAuth(`/api/reservations/${move.event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservation_date: move.date, reservation_time: time, expected_updated_at: row?.updated_at }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        toast({ title: '日時を変更できませんでした', description: json?.error || `エラーコード: ${res.status}`, variant: 'destructive' });
        // ほかの人が先に変更していたときは、最新の内容を読み込み直す
        if (json?.code === 'stale') setReloadCount((n) => n + 1);
        return;
      }
      // 読み込み直す前に、手元の表示を保存後の内容にしておく（帯が一瞬もとに戻らないように）
      setData((cur) => (cur ? { ...cur, reservations: cur.reservations.map((r) => (r.id === move.event.id ? { ...r, ...json } : r)) } : cur));
      onReservationChanged?.(json);
      const sync = json.calendar_sync;
      toast({
        title: '日時を変更しました',
        description: `${move.event.title} さん: ${describeSlot(move.date, move.startMin, move.event.durationMinutes)}${sync && sync.ok === false ? '（Google カレンダーの予定は変更できませんでした）' : ''}`,
      });
      setReloadCount((n) => n + 1);
    } catch {
      toast({ title: '日時を変更できませんでした', description: '通信に失敗しました。もう一度お試しください', variant: 'destructive' });
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  // ---- 空いている所から手動予約
  const openManualSlot = (date: string, startMin: number) => {
    if (suppressClickRef.current || manualForms.length === 0) return;
    setManualSlot({ date, time: minutesToTime(startMin), formId: manualForms[0].id });
  };
  const openManualForm = () => {
    if (!manualSlot) return;
    const minutes = timeToMinutes(manualSlot.time);
    const query = minutes === null ? '' : `?date=${manualSlot.date}&time=${encodeURIComponent(minutesToTime(minutes))}`;
    window.open(`/api/stores/${storeId}/forms/${manualSlot.formId}/manual-form${query}`, '_blank', 'noopener');
    setManualSlot(null);
  };

  const moveInfo = confirmMove
    ? (() => {
        const ev = confirmMove.event;
        const endMin = Math.min(1440, confirmMove.startMin + ev.durationMinutes);
        return {
          from: ev.startMin === null ? '' : describeSlot(ev.date, ev.startMin, ev.durationMinutes),
          to: describeSlot(confirmMove.date, confirmMove.startMin, ev.durationMinutes),
          conflicts: countOverlappingEvents(baseEvents, { excludeId: ev.id, date: confirmMove.date, startMin: confirmMove.startMin, endMin }),
          busy: overlapsBusy(busy, { date: confirmMove.date, startMin: confirmMove.startMin, endMin }),
          past: confirmMove.date < today || (confirmMove.date === today && confirmMove.startMin < nowMinutes),
        };
      })()
    : null;

  const canManual = manualForms.length > 0;
  const shared = { events, busy, onOpenEvent: openEvent, onEventPointerDown, drag, draggingId, savingId: saving?.id ?? null };

  return (
    <div className={cn('space-y-3', className)} data-slot="reservation-calendar">
      {/* 操作 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-1 sm:flex-none">
          <Button type="button" variant="outline" size="sm" onClick={() => setAnchor(jstToday())}>
            今日
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="前へ" onClick={() => setAnchor((a) => shiftAnchor(view, a, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="次へ" onClick={() => setAnchor((a) => shiftAnchor(view, a, 1))}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <h3 className="order-last min-w-0 basis-full text-base font-semibold sm:order-none sm:flex-1 sm:basis-auto" aria-live="polite">
          {calendarTitle(view, anchor)}
        </h3>
        <div className="inline-flex rounded-md border bg-background p-0.5" role="group" aria-label="表示の切り替え">
          {CALENDAR_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => changeView(v.id)}
              aria-pressed={view === v.id}
              className={cn(
                'min-w-10 rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === v.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="h-4 w-4 accent-[rgb(244,144,49)]" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
          キャンセルも表示{cancelledCount > 0 ? `（${cancelledCount} 件）` : ''}
        </label>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-50" aria-hidden="true" />確認済み</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-amber-300 bg-amber-50" aria-hidden="true" />保留中</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-slate-300 bg-slate-100" aria-hidden="true" />完了</span>
        {data?.google === 'ok' && (
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-slate-300" aria-hidden="true" />予約以外の予定（Google カレンダー）</span>
        )}
      </div>
      <p className="hidden text-xs text-muted-foreground lg:block" data-slot="reservation-calendar-hint">
        予約の帯はドラッグで別の日時に動かせます。{canManual && view !== 'month' ? '空いている所を押すと、その日時で手動予約フォームを開けます。' : ''}
      </p>
      {canManual && view !== 'month' && <p className="text-xs text-muted-foreground lg:hidden">空いている所を押すと、その日時で手動予約フォームを開けます。</p>}

      {data?.google === 'error' && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          Google カレンダーの予定を読み込めませんでした。予約だけを表示しています。
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className={cn('rounded-lg border bg-card transition-opacity', loading && !saving && 'opacity-60')} aria-busy={loading || undefined}>
        {view === 'month' ? (
          <MonthView anchor={anchor} today={today} onOpenDay={openDay} {...shared} />
        ) : (
          <TimeGridView
            dates={view === 'week' ? weekDates(anchor) : [anchor]}
            today={today}
            nowMinutes={nowMinutes}
            onOpenDay={view === 'week' ? openDay : undefined}
            onSlotClick={canManual ? openManualSlot : undefined}
            {...shared}
          />
        )}
      </div>

      {!loading && !error && data && events.length === 0 && <p className="text-center text-sm text-muted-foreground">この期間の予約はありません</p>}

      {/* ドラッグで動かしたときの確認 */}
      <AlertDialog open={!!confirmMove} onOpenChange={(open) => !open && setConfirmMove(null)}>
        <AlertDialogContent data-slot="reservation-calendar-move-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>予約の日時を変更しますか？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                {confirmMove && moveInfo && (
                  <>
                    <p className="text-foreground">
                      <span className="font-medium">{confirmMove.event.title}</span> さんの予約{confirmMove.event.subtitle ? `（${confirmMove.event.subtitle}）` : ''}
                    </p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3">
                      <dt>変更前</dt>
                      <dd className="tabular-nums">{moveInfo.from}</dd>
                      <dt className="font-medium text-foreground">変更後</dt>
                      <dd className="font-medium tabular-nums text-foreground">{moveInfo.to}</dd>
                    </dl>
                    {moveInfo.conflicts > 0 && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">この時間には、ほかの予約が {moveInfo.conflicts} 件あります。</p>}
                    {moveInfo.busy && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">この時間には、予約以外の予定（Google カレンダー）があります。</p>}
                    {moveInfo.past && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">過ぎた日時です。</p>}
                    <p>Google カレンダーの予定も一緒に変わります。お客様への通知は送られません。</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={() => void saveMove()}>変更する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 空いている所から手動予約 */}
      <Dialog open={!!manualSlot} onOpenChange={(open) => !open && setManualSlot(null)}>
        <DialogContent className="max-w-md" data-slot="reservation-calendar-manual">
          <DialogHeader>
            <DialogTitle>この日時で手動予約を入れる</DialogTitle>
            <DialogDescription>電話や店頭で受けた予約を、店舗側手動予約フォームから登録します。新しいタブで開きます。</DialogDescription>
          </DialogHeader>
          {manualSlot && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3">
                <span className="text-muted-foreground">日付</span>
                <span className="font-medium">
                  {shortDate(manualSlot.date)}({WEEKDAY_LABELS[weekdayOf(manualSlot.date)]})
                </span>
                <label htmlFor="calendar-manual-time" className="text-muted-foreground">
                  時刻
                </label>
                <input
                  id="calendar-manual-time"
                  type="time"
                  step={300}
                  value={manualSlot.time}
                  onChange={(e) => setManualSlot((cur) => (cur ? { ...cur, time: e.target.value } : cur))}
                  className="h-10 w-36 rounded-md border bg-background px-2 text-base md:text-sm"
                />
                {manualForms.length > 1 && (
                  <>
                    <label htmlFor="calendar-manual-form" className="text-muted-foreground">
                      フォーム
                    </label>
                    <select
                      id="calendar-manual-form"
                      value={manualSlot.formId}
                      onChange={(e) => setManualSlot((cur) => (cur ? { ...cur, formId: e.target.value } : cur))}
                      className="h-10 min-w-0 rounded-md border bg-background px-2 text-base md:text-sm"
                    >
                      {manualForms.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                フォームで受け付けていない時間（営業時間外・埋まっている時間など）のときは、フォームの中で日時を選び直します。登録が終わってこの画面に戻ると、カレンダーに反映されます。
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManualSlot(null)}>
              やめる
            </Button>
            <Button type="button" onClick={openManualForm}>
              手動予約フォームを開く
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SharedViewProps {
  events: CalendarEvent[];
  busy: BusyBlock[];
  onOpenEvent: (ev: CalendarEvent) => void;
  onEventPointerDown: PointerDownHandler;
  drag: DragTarget | null;
  draggingId: string | null;
  savingId: string | null;
}

/** ドラッグ中・保存中の帯の見た目 */
function eventStateClass(ev: CalendarEvent, draggingId: string | null, savingId: string | null): string {
  return cn(isDraggableEvent(ev) && 'lg:cursor-grab', draggingId === ev.id && 'opacity-40', savingId === ev.id && 'animate-pulse opacity-70');
}

// ---------------------------------------------------------------------------
// 月表示
// ---------------------------------------------------------------------------

function MonthView({ anchor, today, events, busy, onOpenEvent, onOpenDay, onEventPointerDown, drag, draggingId, savingId }: SharedViewProps & { anchor: string; today: string; onOpenDay: (date: string) => void }) {
  const { year, month } = parseYmd(anchor);
  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const busyDates = useMemo(() => new Set(busy.map((b) => b.date)), [busy]);

  return (
    <div data-slot="reservation-calendar-month">
      <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={w} className={cn('py-2', i === 0 && 'text-red-500', i === 6 && 'text-blue-600')}>
            {w}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].date} className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((cell) => {
            const { shown, more, total } = monthCellEvents(events, cell.date);
            const isToday = cell.date === today;
            const isDropTarget = drag?.date === cell.date;
            return (
              <div
                key={cell.date}
                className={cn('min-h-24 min-w-0 border-r p-1 last:border-r-0 md:min-h-28', !cell.inMonth && 'bg-muted/40', isDropTarget && 'bg-primary/10 ring-2 ring-inset ring-primary')}
                data-date={cell.date}
                data-cal-cell=""
              >
                <button
                  type="button"
                  onClick={() => onOpenDay(cell.date)}
                  aria-label={`${shortDate(cell.date)} の予約 ${total} 件。日表示で開く`}
                  className={cn(
                    'mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    !cell.inMonth && 'text-muted-foreground',
                    cell.inMonth && cell.weekday === 0 && 'text-red-500',
                    cell.inMonth && cell.weekday === 6 && 'text-blue-600',
                    isToday && 'bg-primary text-primary-foreground hover:bg-primary'
                  )}
                >
                  {cell.day}
                </button>
                {busyDates.has(cell.date) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-slate-400 align-middle" title="予約以外の予定あり" aria-label="予約以外の予定あり" />}
                <div className="space-y-0.5">
                  {shown.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onOpenEvent(ev)}
                      onPointerDown={(e) => onEventPointerDown(e, ev, 'month')}
                      aria-label={eventAriaLabel(ev)}
                      className={cn(
                        'block w-full truncate rounded border px-1 py-0.5 text-left text-[11px] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        eventColor(ev),
                        eventStateClass(ev, draggingId, savingId)
                      )}
                    >
                      <span className="font-medium tabular-nums">{eventTimeLabel(ev)}</span> {ev.title}
                    </button>
                  ))}
                  {more > 0 && (
                    <button type="button" onClick={() => onOpenDay(cell.date)} className="block w-full rounded px-1 text-left text-[11px] leading-4 text-muted-foreground underline-offset-2 hover:underline">
                      ほか {more} 件
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 週・日表示
// ---------------------------------------------------------------------------

function TimeGridView({
  dates,
  today,
  nowMinutes,
  events,
  busy,
  onOpenEvent,
  onOpenDay,
  onSlotClick,
  onEventPointerDown,
  drag,
  draggingId,
  savingId,
}: SharedViewProps & {
  dates: string[];
  today: string;
  nowMinutes: number;
  onOpenDay?: (date: string) => void;
  /** 空いている所を押したとき（手動予約できるフォームがあるときだけ渡す） */
  onSlotClick?: (date: string, startMin: number) => void;
}) {
  const { startHour, endHour } = useMemo(() => visibleHourRange(events, busy, dates), [events, busy, dates]);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridStart = startHour * 60;
  const gridEnd = endHour * 60;
  const top = (min: number) => ((Math.max(gridStart, Math.min(gridEnd, min)) - gridStart) / 60) * HOUR_HEIGHT;
  const single = dates.length === 1;
  const perDay = dates.map((date) => {
    const day = eventsForDate(events, date);
    const dayBusy = busy.filter((b) => b.date === date);
    return { date, allDay: day.allDay, positioned: layoutDayEvents(day.timed), busyAllDay: dayBusy.some((b) => b.allDay), busyTimed: dayBusy.filter((b) => !b.allDay) };
  });
  const hasAllDayRow = perDay.some((d) => d.allDay.length > 0 || d.busyAllDay);
  const columns = { gridTemplateColumns: `3rem repeat(${dates.length}, minmax(0, 1fr))` };

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    if (!onSlotClick) return;
    // 予約の帯を押したときは、予約詳細を開くほうを優先する
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSlotClick(date, slotAtPointer(gridStart + ((e.clientY - rect.top) / HOUR_HEIGHT) * 60));
  };

  return (
    <div className="overflow-x-auto" data-slot="reservation-calendar-grid">
      <div className={cn(!single && 'min-w-[44rem]')}>
        {/* 日付の見出し */}
        <div className="grid border-b" style={columns}>
          <div />
          {dates.map((date) => {
            const p = parseYmd(date);
            const wd = weekdayOf(date);
            const isToday = date === today;
            const label = (
              <>
                <span className={cn('text-xs', wd === 0 && 'text-red-500', wd === 6 && 'text-blue-600')}>{WEEKDAY_LABELS[wd]}</span>
                <span className={cn('inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold', isToday && 'bg-primary text-primary-foreground')}>{p.day}</span>
              </>
            );
            return (
              <div key={date} className="border-l py-1.5 text-center">
                {onOpenDay ? (
                  <button type="button" onClick={() => onOpenDay(date)} aria-label={`${shortDate(date)} を日表示で開く`} className="inline-flex flex-col items-center rounded px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {label}
                  </button>
                ) : (
                  <div className="inline-flex flex-col items-center">{label}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* 宿泊・時間未定・終日の予定 */}
        {hasAllDayRow && (
          <div className="grid border-b bg-muted/30" style={columns}>
            <div className="px-1 py-1 text-right text-[10px] leading-4 text-muted-foreground">終日</div>
            {perDay.map((d) => (
              <div key={d.date} className="min-w-0 space-y-0.5 border-l p-1">
                {d.busyAllDay && <div className="truncate rounded bg-slate-300 px-1 py-0.5 text-[11px] leading-4 text-slate-700">予定あり</div>}
                {d.allDay.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onOpenEvent(ev)}
                    aria-label={eventAriaLabel(ev)}
                    className={cn('block w-full truncate rounded border px-1 py-0.5 text-left text-[11px] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', eventColor(ev))}
                  >
                    <span className="font-medium">{eventTimeLabel(ev)}</span> {ev.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 時間の目盛りと予約 */}
        <div className="grid" style={columns}>
          <div className="relative" style={{ height: hours.length * HOUR_HEIGHT }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: i * HOUR_HEIGHT }}>
                {i === 0 ? '' : `${h}:00`}
              </div>
            ))}
          </div>
          {perDay.map((d) => (
            <div
              key={d.date}
              className={cn('relative border-l', onSlotClick && 'cursor-cell hover:bg-accent/30')}
              style={{ height: hours.length * HOUR_HEIGHT }}
              data-date={d.date}
              data-cal-col=""
              data-grid-start={gridStart}
              onClick={(e) => handleColumnClick(e, d.date)}
            >
              {hours.map((h, i) => (
                <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_HEIGHT }} aria-hidden="true" />
              ))}
              {/* 予約以外の予定（灰色） */}
              {d.busyTimed.map((b, i) => (
                <div
                  key={`${b.startMin}-${b.endMin}-${i}`}
                  className="absolute inset-x-0 overflow-hidden bg-slate-200/80 px-1 text-[10px] leading-4 text-slate-600"
                  style={{ top: top(b.startMin), height: Math.max(2, top(b.endMin) - top(b.startMin)) }}
                  title={`予定あり ${minutesToTime(b.startMin)}〜${minutesToTime(b.endMin)}`}
                >
                  予定あり
                </div>
              ))}
              {d.busyAllDay && <div className="pointer-events-none absolute inset-0 bg-slate-200/50" aria-hidden="true" />}
              {/* いまの線 */}
              {d.date === today && nowMinutes >= gridStart && nowMinutes <= gridEnd && (
                <div className="pointer-events-none absolute inset-x-0 z-20 h-0.5 -translate-y-px bg-red-500" style={{ top: top(nowMinutes) }} aria-hidden="true" data-slot="reservation-calendar-now" />
              )}
              {/* 予約 */}
              {d.positioned.map((p) => {
                const height = Math.max(18, top(p.endMin) - top(p.startMin) - 1);
                const ev = p.event;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onOpenEvent(ev)}
                    onPointerDown={(e) => onEventPointerDown(e, ev, 'grid')}
                    aria-label={eventAriaLabel(ev)}
                    title={eventAriaLabel(ev)}
                    className={cn(
                      // ボタンは中身を上下の中央に置くので、上から並べる指定を入れる
                      'absolute z-10 flex flex-col items-stretch justify-start overflow-hidden rounded border px-1 py-0.5 text-left text-[11px] leading-4 shadow-sm hover:z-30 hover:shadow focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      eventColor(ev),
                      eventStateClass(ev, draggingId, savingId)
                    )}
                    style={{ top: top(p.startMin), height, left: `calc(${(p.column / p.columns) * 100}% + 1px)`, width: `calc(${100 / p.columns}% - 2px)` }}
                    data-slot="reservation-calendar-event"
                  >
                    <span className="block truncate font-medium">
                      <span className="tabular-nums">{eventTimeLabel(ev)}</span> {ev.title}
                    </span>
                    {height >= 34 && ev.subtitle && <span className="block truncate opacity-80">{ev.subtitle}</span>}
                    {height >= 50 && ev.staffName && <span className="block truncate opacity-80">担当: {ev.staffName}</span>}
                  </button>
                );
              })}
              {/* ドラッグ中の落とし先 */}
              {drag && drag.date === d.date && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 z-40 rounded border-2 border-dashed border-primary bg-primary/15 px-1 text-[11px] font-semibold leading-4 text-primary"
                  style={{ top: top(drag.startMin), height: Math.max(18, top(drag.startMin + drag.durationMinutes) - top(drag.startMin)) }}
                  data-slot="reservation-calendar-drop"
                >
                  {minutesToTime(drag.startMin)}〜{minutesToTime(Math.min(1440, drag.startMin + drag.durationMinutes))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
