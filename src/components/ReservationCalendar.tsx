'use client';

/**
 * 予約カレンダー（月 / 週 / 日）
 *
 * - 店舗管理者ページの「カレンダー」タブと、テナント側 店舗ページの「カレンダー」タブで共用
 * - 日付・重なりの計算は純粋ロジック `src/lib/reservation-calendar.ts`
 * - 予約を押すと onSelectReservation で予約の行を渡す（詳細の表示は呼び出し側）
 * - 予約以外の予定（Google カレンダー）は灰色で「予定あり」とだけ出す
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchWithAuth } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import {
  CALENDAR_VIEWS,
  WEEKDAY_LABELS,
  buildMonthGrid,
  calendarRange,
  calendarTitle,
  eventsForDate,
  jstNowMinutes,
  jstToday,
  layoutDayEvents,
  minutesToTime,
  monthCellEvents,
  parseYmd,
  shiftAnchor,
  toCalendarEvents,
  visibleHourRange,
  weekDates,
  type BusyBlock,
  type CalendarEvent,
  type CalendarReservationInput,
  type CalendarView,
} from '@/lib/reservation-calendar';

const VIEW_STORAGE_KEY = 'reservation_calendar_view';
const HOUR_HEIGHT = 48; // 1 時間の高さ（px）

interface CalendarData {
  reservations: CalendarReservationInput[];
  busy: BusyBlock[];
  google: 'ok' | 'none' | 'error';
}

export interface ReservationCalendarProps {
  storeId: string;
  /** 予約を押したとき。予約一覧の API と同じ形の行を渡す */
   
  onSelectReservation?: (reservation: any) => void;
  /** 値が変わると読み込み直す（予約を編集・キャンセルしたあとなど） */
  reloadSignal?: unknown;
  className?: string;
}

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

export default function ReservationCalendar({ storeId, onSelectReservation, reloadSignal, className }: ReservationCalendarProps) {
  const [view, setView] = useState<CalendarView>(initialView);
  const [anchor, setAnchor] = useState<string>(() => jstToday());
  const [showCancelled, setShowCancelled] = useState(false);
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);

  const range = useMemo(() => calendarRange(view, anchor), [view, anchor]);

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
      } catch {
        if (!cancelled) setError('予約カレンダーの取得に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, range.from, range.to, reloadSignal]);

  // 「いま」の線を 1 分ごとに動かす
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const today = useMemo(() => jstToday(), [nowTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowMinutes = useMemo(() => jstNowMinutes(), [nowTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(() => toCalendarEvents(data?.reservations || [], { includeCancelled: showCancelled }), [data, showCancelled]);
  const busy = useMemo(() => data?.busy || [], [data]);
  const rowsById = useMemo(() => new Map((data?.reservations || []).map((r) => [r.id, r])), [data]);
  const cancelledCount = useMemo(() => (data?.reservations || []).filter((r) => r.status === 'cancelled').length, [data]);

  const openEvent = (ev: CalendarEvent) => {
    const row = rowsById.get(ev.id);
    if (row && onSelectReservation) onSelectReservation(row);
  };
  const openDay = (date: string) => {
    setAnchor(date);
    changeView('day');
  };

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

      <div className={cn('rounded-lg border bg-card transition-opacity', loading && 'opacity-60')} aria-busy={loading || undefined}>
        {view === 'month' ? (
          <MonthView anchor={anchor} today={today} events={events} busy={busy} onOpenEvent={openEvent} onOpenDay={openDay} />
        ) : (
          <TimeGridView dates={view === 'week' ? weekDates(anchor) : [anchor]} today={today} nowMinutes={nowMinutes} events={events} busy={busy} onOpenEvent={openEvent} onOpenDay={view === 'week' ? openDay : undefined} />
        )}
      </div>

      {!loading && !error && data && events.length === 0 && <p className="text-center text-sm text-muted-foreground">この期間の予約はありません</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 月表示
// ---------------------------------------------------------------------------

function MonthView({
  anchor,
  today,
  events,
  busy,
  onOpenEvent,
  onOpenDay,
}: {
  anchor: string;
  today: string;
  events: CalendarEvent[];
  busy: BusyBlock[];
  onOpenEvent: (ev: CalendarEvent) => void;
  onOpenDay: (date: string) => void;
}) {
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
            return (
              <div key={cell.date} className={cn('min-h-24 min-w-0 border-r p-1 last:border-r-0 md:min-h-28', !cell.inMonth && 'bg-muted/40')} data-date={cell.date}>
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
                      aria-label={eventAriaLabel(ev)}
                      className={cn('block w-full truncate rounded border px-1 py-0.5 text-left text-[11px] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', eventColor(ev))}
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
}: {
  dates: string[];
  today: string;
  nowMinutes: number;
  events: CalendarEvent[];
  busy: BusyBlock[];
  onOpenEvent: (ev: CalendarEvent) => void;
  onOpenDay?: (date: string) => void;
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

  return (
    <div className="overflow-x-auto" data-slot="reservation-calendar-grid">
      <div className={cn(!single && 'min-w-[44rem]')}>
        {/* 日付の見出し */}
        <div className="grid border-b" style={columns}>
          <div />
          {dates.map((date) => {
            const p = parseYmd(date);
            const wd = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
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
            <div key={d.date} className="relative border-l" style={{ height: hours.length * HOUR_HEIGHT }} data-date={d.date}>
              {hours.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_HEIGHT }} aria-hidden="true" />
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
              {d.busyAllDay && <div className="absolute inset-0 bg-slate-200/50" aria-hidden="true" />}
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
                    aria-label={eventAriaLabel(ev)}
                    title={eventAriaLabel(ev)}
                    className={cn(
                      // ボタンは中身を上下の中央に置くので、上から並べる指定を入れる
                      'absolute z-10 flex flex-col items-stretch justify-start overflow-hidden rounded border px-1 py-0.5 text-left text-[11px] leading-4 shadow-sm hover:z-30 hover:shadow focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      eventColor(ev)
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
