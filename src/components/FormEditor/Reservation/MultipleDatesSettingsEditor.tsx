'use client';

import React from 'react';
import type { MultipleDatesSettings, SpecialBusinessDay } from '@/types/form';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import {
  createDefaultWeekdayHours,
  type ExtraSlot,
  type HolidayHoursEntry,
  type TimeInterval,
} from '@/lib/multiple-dates-settings';

// ホバーで説明文を表示する ? アイコン
export function InfoTooltip({ text, theme = 'light' }: { text: string; theme?: ThemeType }) {
  return (
    <span className="relative group inline-flex items-center align-middle">
      <svg
        className={`w-3.5 h-3.5 cursor-help ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span
        className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-md border px-3 py-2 text-xs shadow-md opacity-0 transition-opacity group-hover:opacity-100 whitespace-pre-line text-left ${
          theme === 'dark'
            ? 'bg-gray-800 border-gray-600 text-gray-100'
            : 'bg-white border-gray-200 text-gray-700'
        }`}
      >
        {text}
      </span>
    </span>
  );
}

/** 「追加で表示する分」の選択（5 分刻み）。時間間隔の行に加えて、毎時この分の行も表示する */
export const ExtraMinutesPicker: React.FC<{ value: number[]; interval: number; onChange: (mins: number[]) => void; theme: ThemeType }> = ({ value, interval, onChange, theme }) => {
  const candidates = Array.from({ length: 11 }, (_, i) => (i + 1) * 5);
  const toggle = (m: number, on: boolean) => {
    const next = new Set(value);
    if (on) next.add(m); else next.delete(m);
    onChange([...next].sort((a, b) => a - b));
  };
  const light = theme === 'light';
  return (
    <div className="flex flex-wrap gap-1.5">
      {candidates.map((m) => {
        const onGrid = interval > 0 && m % interval === 0;
        const checked = value.includes(m);
        return (
          <label
            key={m}
            title={onGrid ? `${m}分は時間間隔の行に含まれています` : `毎時 ${m} 分の行を追加`}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs cursor-pointer select-none ${
              checked
                ? (light ? 'border-[rgb(244,144,49)] bg-orange-50 text-[rgb(200,100,10)]' : 'border-cyan-500 bg-cyan-950/40 text-cyan-300')
                : (light ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-gray-600 text-gray-300 hover:bg-gray-700')
            } ${onGrid ? 'opacity-50' : ''}`}
          >
            <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => toggle(m, e.target.checked)} />
            {m}分
          </label>
        );
      })}
    </div>
  );
};

/** 時間間隔 × 開始〜終了 から時間のリストを作る（「追加の時間帯」の表示位置プルダウン用） */
export const buildTimeList = (open: string, close: string, interval: number): string[] => {
  const out: string[] = [];
  const [sh, sm] = (open || '09:00').split(':').map(Number);
  const [eh, em] = (close || '18:00').split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return out;
  let h = sh, m = sm, guard = 0;
  while ((h < eh || (h === eh && m < em)) && guard++ < 400) {
    out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += interval;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }
  return out;
};

const TRASH_ICON = (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
);

interface MultipleDatesSettingsEditorProps {
  settings: MultipleDatesSettings;
  onChange: (next: MultipleDatesSettings) => void;
  theme?: ThemeType;
  /** 見出し（既定: 第三希望日時モード設定） */
  title?: string;
  /** 臨時営業日の注記の末尾（予約: 受付します / アンケート: 選べます） */
  specialDayNote?: string;
}

/**
 * 第三希望日時選択の設定 UI。
 * 予約フォームの「営業時間・ルール → 日時選択モード → 第三希望日時」と、アンケートの質問型「第三希望日時選択」で共通。
 * 時間間隔 / 追加で表示する分 / ✕にする時間帯（曜日指定） / 選択可能日数 / 必須選択 / 非表示設定 /
 * 曜日別の受付時間（カスタム・追加の時間帯） / 祝日 / 臨時営業日
 */
export default function MultipleDatesSettingsEditor({
  settings,
  onChange,
  theme = 'dark',
  title = '第三希望日時モード設定',
  specialDayNote = '受付します',
}: MultipleDatesSettingsEditorProps) {
  const themeClasses = getThemeClasses(theme);
  const accentClasses = theme === 'light'
    ? 'accent-[rgb(244,144,49)] focus:ring-[rgb(244,144,49)]'
    : 'accent-cyan-500 focus:ring-cyan-500';
  const defaultWeekdayHours = createDefaultWeekdayHours();
  const weekdayLabels = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];

  const patch = (p: Partial<MultipleDatesSettings>) => onChange({ ...settings, ...p });
  const set = (key: keyof MultipleDatesSettings, value: unknown) => patch({ [key]: value } as Partial<MultipleDatesSettings>);

  // ---- ✕にする時間帯の曜日指定ヘルパー（エントリ無し = 全曜日✕） ----
  const blockedWeekdayOrder = [1, 2, 3, 4, 5, 6, 0];
  const blockedWeekdayShort = ['日', '月', '火', '水', '木', '金', '土'];
  const getBlockedWeekdaysFor = (map: { [time: string]: number[] } | undefined, time: string): number[] => {
    const arr = map?.[time];
    return Array.isArray(arr) && arr.length > 0 ? arr : [0, 1, 2, 3, 4, 5, 6];
  };
  const toggleBlockedWeekday = (map: { [time: string]: number[] } | undefined, time: string, day: number): { [time: string]: number[] } | null => {
    const cur = getBlockedWeekdaysFor(map, time);
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day];
    if (next.length === 0) {
      alert('少なくとも1つの曜日を選択してください（✕にしない場合はこの時間帯を削除してください）');
      return null;
    }
    const newMap = { ...(map || {}) };
    if (next.length === 7) delete newMap[time];
    else newMap[time] = next.sort((a, b) => a - b);
    return newMap;
  };
  const renameBlockedWeekdayKey = (map: { [time: string]: number[] } | undefined, oldTime: string, newTime: string) => {
    const newMap = { ...(map || {}) };
    if (newMap[oldTime]) {
      newMap[newTime] = newMap[oldTime];
      delete newMap[oldTime];
    }
    return newMap;
  };
  const removeBlockedWeekdayKey = (map: { [time: string]: number[] } | undefined, time: string, remainingTimes: string[]) => {
    const newMap = { ...(map || {}) };
    if (!remainingTimes.includes(time)) delete newMap[time];
    return newMap;
  };

  // 時間間隔 × 受付時間から、フォームに表示される時間スロット一覧を生成（✕にする時間帯のプルダウン用）
  const generateSlotOptions = (hours: Array<{ open?: string; close?: string; closed?: boolean }>, interval: number, extraMinutes: number[] = []): string[] => {
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    const openDays = hours.filter((h) => h && !h.closed);
    if (openDays.length === 0) return [];
    const start = Math.min(...openDays.map((h) => toMin(h.open || '09:00')));
    const end = Math.max(...openDays.map((h) => toMin(h.close || '18:00')));
    const mins = new Set<number>();
    for (let m = start; m < end; m += interval) mins.add(m);
    for (let h = Math.floor(start / 60); h * 60 < end; h++) {
      extraMinutes.forEach((mm) => { const m = h * 60 + mm; if (m >= start && m < end) mins.add(m); });
    }
    return [...mins].sort((a, b) => a - b).map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  };
  const slotOptions = () => {
    const hoursList = settings.weekday_hours
      ? Object.values(settings.weekday_hours)
      : [{ open: settings.start_time, close: settings.end_time, closed: false }];
    return generateSlotOptions(hoursList, settings.time_interval || 30, settings.extra_minutes || []);
  };

  const toggleRequiredChoice = (idx: number) => {
    if (idx === 1) return; // 第一希望は常に必須
    const current = settings.required_choices || [1, 2, 3];
    set('required_choices', current.includes(idx) ? current.filter((n) => n !== idx) : [...current, idx].sort());
  };
  const toggleVisibleChoice = (idx: number) => {
    const current = settings.visible_choices || [1, 2, 3];
    const next = current.includes(idx) ? current.filter((n) => n !== idx) : [...new Set([...current, idx])].sort();
    if (next.length === 0) {
      alert('少なくとも1つの希望日時は表示する必要があります');
      return;
    }
    set('visible_choices', next);
  };

  // ---- 曜日別の受付時間 ----
  const handleWeekdayHoursChange = (dayIndex: string, field: 'open' | 'close' | 'closed' | 'custom' | 'custom_slots' | 'extra_slots', value: string | boolean | string[] | ExtraSlot[]) => {
    const currentHours = settings.weekday_hours || defaultWeekdayHours;
    const updatedHours = { ...currentHours, [dayIndex]: { ...currentHours[dayIndex], [field]: value } };
    patch({
      weekday_hours: updatedHours,
      // レガシーフィールドも同期（exclude_weekdays）
      exclude_weekdays: Object.entries(updatedHours).filter(([, h]) => h.closed).map(([k]) => parseInt(k)),
    });
  };
  const copyMondayWeekdayHoursToAll = () => {
    if (!window.confirm('月曜日の設定（受付/時間）をすべての曜日にコピーしますか？')) return;
    const currentHours = settings.weekday_hours || defaultWeekdayHours;
    const monday = currentHours['1'] || { open: '09:00', close: '18:00', closed: false };
    const updatedHours = { ...currentHours };
    [0, 1, 2, 3, 4, 5, 6].forEach((i) => {
      updatedHours[String(i)] = { ...monday, custom_slots: monday.custom_slots ? [...monday.custom_slots] : undefined };
    });
    patch({
      weekday_hours: updatedHours,
      exclude_weekdays: Object.entries(updatedHours).filter(([, h]) => h.closed).map(([k]) => parseInt(k)),
    });
  };
  const handleHolidayHoursChange = (p: Partial<HolidayHoursEntry>) => {
    const current = settings.holiday_hours || { enabled: false, open: '09:00', close: '18:00', custom: false, custom_slots: [] };
    patch({ holiday_hours: { ...current, ...p } });
  };

  // 追加の時間帯（午前中 / 16:00以降 など）の編集行
  const renderExtraSlots = (
    slots: ExtraSlot[],
    open: string,
    close: string,
    update: (next: ExtraSlot[]) => void
  ) => (
    <div className={`mt-2 ml-0 sm:ml-20 space-y-1.5 rounded-md p-2 ${theme === 'light' ? 'bg-gray-50 border border-gray-200' : 'bg-gray-800/60 border border-gray-700'}`}>
      <p className={`text-xs ${themeClasses.text.tertiary}`}>追加の時間帯（「時間を選択」のリストに差し込まれます。テキストは自由です）</p>
      {slots.map((slot, slotIndex) => {
        const times = buildTimeList(open, close, settings.time_interval || 30);
        const updateSlot = (p: Partial<ExtraSlot>) => {
          const next = [...slots];
          next[slotIndex] = { ...next[slotIndex], ...p };
          update(next);
        };
        return (
          <div key={slotIndex} className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              type="text"
              value={slot.label}
              maxLength={30}
              onChange={(ev) => updateSlot({ label: ev.target.value })}
              placeholder="例: 午前中 / 午後 / 16:00以降"
              className={`${themeClasses.input} text-sm flex-1 min-w-0`}
            />
            <div className="flex items-center gap-2">
              <span className={`text-xs whitespace-nowrap ${themeClasses.text.tertiary}`}>表示位置</span>
              <select value={slot.after || 'end'} onChange={(ev) => updateSlot({ after: ev.target.value })} className={`${themeClasses.input} text-sm`}>
                <option value="start">リストの先頭</option>
                {times.map((t) => <option key={t} value={t}>{t} の後</option>)}
                <option value="end">リストの末尾</option>
              </select>
              <button
                type="button"
                onClick={() => update(slots.filter((_, i) => i !== slotIndex))}
                title="削除"
                className={`p-1.5 rounded text-red-400 hover:text-red-300 flex-shrink-0 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
              >
                {TRASH_ICON}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  // カスタム受付時間（自由入力の時間帯テキスト）の編集行
  const renderCustomSlots = (slots: string[], update: (next: string[]) => void) => (
    <div className="flex-1 space-y-1 min-w-0">
      {slots.map((slot, slotIndex) => (
        <div key={slotIndex} className="flex items-center gap-2">
          <input
            type="text"
            value={slot}
            onChange={(ev) => { const next = [...slots]; next[slotIndex] = ev.target.value; update(next); }}
            placeholder="例: 10:00~12:00 / 16:00以降"
            className={`${themeClasses.input} text-sm flex-1 min-w-0`}
          />
          <button
            type="button"
            onClick={() => update(slots.filter((_, i) => i !== slotIndex))}
            title="削除"
            className={`p-1.5 rounded text-red-400 hover:text-red-300 flex-shrink-0 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
          >
            {TRASH_ICON}
          </button>
        </div>
      ))}
      <button type="button" onClick={() => update([...slots, ''])} className={`px-2 py-1 text-xs rounded-md ${themeClasses.button.secondary}`}>
        ＋ 時間帯を追加
      </button>
      <p className={`text-xs ${themeClasses.text.tertiary}`}>入力したテキストがそのまま「時間を選択」の選択肢になります</p>
    </div>
  );

  const checkboxClass = `rounded ${accentClasses} ${theme === 'light' ? 'border-gray-300 bg-gray-100' : 'border-gray-600 bg-gray-700'}`;
  const copyButtonClass = theme === 'light'
    ? 'border border-[rgb(244,144,49)]/40 text-[rgb(200,100,10)] hover:bg-[rgb(244,144,49)] hover:text-white'
    : 'border border-cyan-500/40 text-cyan-300 hover:bg-cyan-600 hover:text-white';

  // 臨時営業日
  const renderSpecialBusinessDays = (days: SpecialBusinessDay[], update: (next: SpecialBusinessDay[]) => void) => {
    const updateDay = (index: number, p: Partial<SpecialBusinessDay>) => update(days.map((d, i) => (i === index ? { ...d, ...p } : d)));
    const dateLabel = (ymd: string): string => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
      if (!m) return '';
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (Number.isNaN(d.getTime())) return '';
      return `（${['日', '月', '火', '水', '木', '金', '土'][d.getDay()]}）`;
    };
    return (
      <div className={`rounded-lg p-3 ${theme === 'light' ? 'border border-gray-300 bg-gray-50' : 'border border-gray-700 bg-gray-900/50'}`}>
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
          <div className={`w-full sm:w-16 text-sm font-medium ${themeClasses.text.secondary} flex-shrink-0 sm:pt-1.5`}>臨時営業日</div>
          <div className="flex-1 min-w-0 space-y-2">
            {days.length === 0 && (
              <span className={`inline-block px-2 py-1 text-xs rounded ${theme === 'light' ? 'bg-gray-200 text-gray-600 border border-gray-300' : 'bg-gray-700 text-gray-400 border border-gray-600'}`}>未設定</span>
            )}
            {days.map((day, index) => {
              const invalid = !!day.open && !!day.close && day.close <= day.open;
              return (
                <div key={index} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-1">
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input type="date" value={day.date} onChange={(e) => updateDay(index, { date: e.target.value })} className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`} />
                    <span className={`text-sm ${themeClasses.text.secondary} w-8 flex-shrink-0`}>{dateLabel(day.date)}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input type="time" value={day.open} onChange={(e) => updateDay(index, { open: e.target.value })} className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`} />
                    <span className={`text-sm ${themeClasses.text.secondary}`}>〜</span>
                    <input type="time" value={day.close} onChange={(e) => updateDay(index, { close: e.target.value })} className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`} />
                    <button
                      type="button"
                      onClick={() => update(days.filter((_, i) => i !== index))}
                      className={`ml-1 p-1.5 rounded ${theme === 'light' ? 'text-gray-500 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-red-400 hover:bg-red-900/30'}`}
                      title="削除"
                      aria-label="臨時営業日を削除"
                    >
                      {TRASH_ICON}
                    </button>
                  </div>
                  {invalid && <span className="text-xs text-red-500">終了時間は開始時間より後にしてください</span>}
                </div>
              );
            })}
            <button type="button" onClick={() => update([...days, { date: '', open: '09:00', close: '18:00' }])} className={`px-2 py-1 text-xs rounded transition-colors ${copyButtonClass}`}>
              ＋ 臨時営業日を追加
            </button>
          </div>
        </div>
        <p className={`text-xs ${themeClasses.text.tertiary} mt-2`}>
          追加した日付は、上の曜日設定が定休日でも、祝日設定や「祝日を予約不可にする」の対象でも、指定した時間で{specialDayNote}。
          日付または時間が未入力の行は保存時に無視されます。
        </p>
      </div>
    );
  };

  const holidayHours: HolidayHoursEntry = settings.holiday_hours || { enabled: false, open: '09:00', close: '18:00', custom: false, custom_slots: [] };

  return (
    <div className={`${themeClasses.highlight} rounded-lg p-4`} data-slot="multiple-dates-settings">
      <h4 className={`text-sm font-medium mb-4 ${theme === 'light' ? 'text-[rgb(244,144,49)]' : 'text-cyan-300'}`}>{title}</h4>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* 時間間隔 */}
        <div>
          <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>時間間隔</label>
          <select
            value={settings.time_interval}
            onChange={(e) => set('time_interval', parseInt(e.target.value) as TimeInterval)}
            className={themeClasses.input}
          >
            {[10, 15, 20, 30, 45, 60, 120].map((n) => <option key={n} value={n}>{n}分間隔</option>)}
          </select>
          <div className="mt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>追加で表示する分</label>
              <InfoTooltip theme={theme} text={'時間間隔の選択肢に加えて、受付時間内の毎時この分も時間の選択肢に表示します。\n例: 30分間隔 + 10分 → 09:00, 09:10, 09:30, 10:00, 10:10, …'} />
            </div>
            <ExtraMinutesPicker value={settings.extra_minutes || []} interval={settings.time_interval || 30} theme={theme} onChange={(mins) => set('extra_minutes', mins)} />
          </div>
        </div>

        {/* デフォルトで✕にする時間帯 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>デフォルトで✕にする時間帯</label>
            <InfoTooltip theme={theme} text={'設定した時刻は、希望日時の時間選択の選択肢に表示されなくなります。\n例: 13:00 を追加 → どの日でも 13:00 は選べない\n曜日ボタンで✕にする曜日を絞れます（例: 月〜金のみ✕、土日は〇）'} />
          </div>
          <div className="space-y-2">
            {(settings.blocked_times || []).map((t, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2">
                  <select
                    value={t}
                    onChange={(e) => {
                      const next = [...(settings.blocked_times || [])];
                      next[idx] = e.target.value;
                      patch({ blocked_times: next, blocked_time_weekdays: renameBlockedWeekdayKey(settings.blocked_time_weekdays, t, e.target.value) });
                    }}
                    className={themeClasses.input}
                  >
                    {(() => {
                      const slots = slotOptions();
                      const opts = slots.includes(t) || !t ? slots : [t, ...slots];
                      return opts.map((slot) => <option key={slot} value={slot}>{slot}</option>);
                    })()}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const next = (settings.blocked_times || []).filter((_, i) => i !== idx);
                      patch({ blocked_times: next, blocked_time_weekdays: removeBlockedWeekdayKey(settings.blocked_time_weekdays, t, next) });
                    }}
                    title="削除"
                    className={`p-1.5 rounded text-red-400 hover:text-red-300 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
                  >
                    {TRASH_ICON}
                  </button>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {blockedWeekdayOrder.map((day) => {
                    const selected = getBlockedWeekdaysFor(settings.blocked_time_weekdays, t).includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const nextMap = toggleBlockedWeekday(settings.blocked_time_weekdays, t, day);
                          if (nextMap) patch({ blocked_time_weekdays: nextMap });
                        }}
                        title={`${blockedWeekdayShort[day]}曜日を✕にする`}
                        className={`w-7 h-7 text-xs rounded-full border transition-colors ${
                          selected
                            ? (theme === 'light' ? 'bg-[rgb(244,144,49)] border-[rgb(244,144,49)] text-white' : 'bg-cyan-600 border-cyan-600 text-white')
                            : (theme === 'light' ? 'bg-white border-gray-300 text-gray-400' : 'bg-gray-800 border-gray-600 text-gray-500')
                        }`}
                      >
                        {blockedWeekdayShort[day]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const slots = slotOptions();
                const used = settings.blocked_times || [];
                const nextSlot = slots.find((slot) => !used.includes(slot)) || slots[0] || '12:00';
                set('blocked_times', [...used, nextSlot]);
              }}
              className={`px-2 py-1 text-xs rounded-md ${themeClasses.button.secondary}`}
            >
              ＋ 時間帯を追加
            </button>
          </div>
        </div>

        {/* 選択可能日数 */}
        <div>
          <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>選択可能日数</label>
          <input
            type="number"
            min="7"
            max="90"
            value={settings.date_range_days}
            onChange={(e) => set('date_range_days', parseInt(e.target.value) || 30)}
            className={themeClasses.input}
          />
          <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>本日から何日後まで選択可能にするか</p>
        </div>

        {/* 必須選択 */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-1.5 mb-2">
            <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>必須選択</label>
            <InfoTooltip theme={theme} text={'チェックした希望日時を選択しないと送信できません。\nチェックを外した希望日時は任意入力になります。\n\n※ 第一希望は常に必須です。'} />
          </div>
          <div className="flex flex-wrap gap-4">
            {[1, 2, 3].map((idx) => {
              const labels: { [key: number]: string } = { 1: '第一希望', 2: '第二希望', 3: '第三希望' };
              const checked = (settings.required_choices || [1, 2, 3]).includes(idx);
              return (
                <label key={idx} className={`flex items-center space-x-2 ${idx === 1 ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={checked} disabled={idx === 1} onChange={() => toggleRequiredChoice(idx)} className={checkboxClass} />
                  <span className={`text-sm ${themeClasses.text.secondary}`}>{labels[idx]}{idx === 1 ? '（常に必須）' : ''}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* 非表示設定 */}
      <div className="mb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>非表示設定</label>
          <InfoTooltip theme={theme} text={'チェックを外した希望日時はフォームに表示されません。\n非表示の希望は「必須選択」で必須になっていても、送信時のチェック対象になりません。\n\n※ 少なくとも1つは表示が必要です。'} />
        </div>
        <div className="flex flex-wrap gap-4">
          {[1, 2, 3].map((idx) => {
            const labels: { [key: number]: string } = { 1: '第一希望', 2: '第二希望', 3: '第三希望' };
            const visibleChecked = (settings.visible_choices || [1, 2, 3]).includes(idx);
            return (
              <label key={idx} className="flex items-center space-x-2 cursor-pointer">
                <input type="checkbox" checked={visibleChecked} onChange={() => toggleVisibleChoice(idx)} className={checkboxClass} />
                <span className={`text-sm ${themeClasses.text.secondary}`}>{labels[idx]}を表示</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* 曜日別時間設定 */}
      <div>
        <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>曜日別の受付時間</label>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6, 0].map((index) => {
            const dayKey = String(index);
            const hours = (settings.weekday_hours || defaultWeekdayHours)[dayKey] || { open: '09:00', close: '18:00', closed: false };
            return (
              <div key={index} className={`rounded-lg p-3 ${theme === 'light' ? 'border border-gray-300 bg-white' : 'border border-gray-700 bg-gray-900/50'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className={`w-full sm:w-16 text-sm font-medium ${themeClasses.text.secondary} flex-shrink-0 flex items-center justify-between sm:block`}>
                    <span>{weekdayLabels[index]}</span>
                    {index === 1 && (
                      <button type="button" onClick={copyMondayWeekdayHoursToAll} title="月曜日の設定を他のすべての曜日にコピー" className={`px-2 py-1 text-xs rounded-md flex-shrink-0 sm:hidden ${copyButtonClass}`}>
                        時間設定コピー
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <label className="flex items-center space-x-2">
                      <input type="checkbox" checked={!hours.closed} onChange={(e) => handleWeekdayHoursChange(dayKey, 'closed', !e.target.checked)} className={checkboxClass} />
                      <span className={`text-sm ${themeClasses.text.secondary}`}>受付</span>
                    </label>
                    {!hours.closed && (
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" checked={!!hours.custom} onChange={(e) => handleWeekdayHoursChange(dayKey, 'custom', e.target.checked)} className={checkboxClass} />
                        <span className={`text-sm ${themeClasses.text.secondary}`}>カスタム</span>
                      </label>
                    )}
                  </div>

                  {!hours.closed && !hours.custom && (
                    <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-1">
                      <input type="time" value={hours.open} onChange={(e) => handleWeekdayHoursChange(dayKey, 'open', e.target.value)} className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`} />
                      <span className={`text-sm ${themeClasses.text.secondary} hidden sm:inline`}>〜</span>
                      <input type="time" value={hours.close} onChange={(e) => handleWeekdayHoursChange(dayKey, 'close', e.target.value)} className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`} />
                      <button
                        type="button"
                        onClick={() => handleWeekdayHoursChange(dayKey, 'extra_slots', [...(hours.extra_slots || []), { label: '', after: 'end' }])}
                        title="「午前中」「16:00以降」など、時間のリストに追加の選択肢を差し込む"
                        className={`px-2 py-1 text-xs rounded-md flex-shrink-0 sm:ml-2 ${themeClasses.button.secondary}`}
                      >
                        ＋ 時間帯を追加{(hours.extra_slots || []).length > 0 ? `（${(hours.extra_slots || []).length}）` : ''}
                      </button>
                    </div>
                  )}

                  {!hours.closed && hours.custom && renderCustomSlots(hours.custom_slots || [], (next) => handleWeekdayHoursChange(dayKey, 'custom_slots', next))}

                  {hours.closed && (
                    <span className={`px-2 py-1 text-xs rounded ${theme === 'light' ? 'bg-gray-200 text-gray-600 border border-gray-300' : 'bg-gray-700 text-gray-400 border border-gray-600'}`}>定休日</span>
                  )}

                  {index === 1 && (
                    <button type="button" onClick={copyMondayWeekdayHoursToAll} title="月曜日の設定を他のすべての曜日にコピー" className={`px-2 py-1 text-xs rounded-md flex-shrink-0 sm:ml-auto hidden sm:block ${copyButtonClass}`}>
                      時間設定コピー
                    </button>
                  )}
                </div>
                {!hours.closed && !hours.custom && (hours.extra_slots || []).length > 0 && renderExtraSlots(hours.extra_slots || [], hours.open, hours.close, (next) => handleWeekdayHoursChange(dayKey, 'extra_slots', next))}
              </div>
            );
          })}

          {/* 祝日の受付時間（ONのとき祝日は曜日設定より優先） */}
          <div className={`rounded-lg p-3 ${theme === 'light' ? 'border border-gray-300 bg-white' : 'border border-gray-700 bg-gray-900/50'}`}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className={`w-full sm:w-16 text-sm font-medium ${themeClasses.text.secondary} flex-shrink-0`}>祝日</div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <label className="flex items-center space-x-2">
                  <input type="checkbox" checked={holidayHours.enabled === true} onChange={(e) => handleHolidayHoursChange({ enabled: e.target.checked })} className={checkboxClass} />
                  <span className={`text-sm ${themeClasses.text.secondary}`}>祝日設定を使う</span>
                </label>
                {holidayHours.enabled === true && (
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" checked={!!holidayHours.custom} onChange={(e) => handleHolidayHoursChange({ custom: e.target.checked })} className={checkboxClass} />
                    <span className={`text-sm ${themeClasses.text.secondary}`}>カスタム</span>
                  </label>
                )}
              </div>

              {holidayHours.enabled !== true && (
                <span className={`px-2 py-1 text-xs rounded ${theme === 'light' ? 'bg-gray-200 text-gray-600 border border-gray-300' : 'bg-gray-700 text-gray-400 border border-gray-600'}`}>曜日の設定に従う</span>
              )}

              {holidayHours.enabled === true && !holidayHours.custom && (
                <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-1">
                  <input type="time" value={holidayHours.open || '09:00'} onChange={(e) => handleHolidayHoursChange({ open: e.target.value })} className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`} />
                  <span className={`text-sm ${themeClasses.text.secondary} hidden sm:inline`}>〜</span>
                  <input type="time" value={holidayHours.close || '18:00'} onChange={(e) => handleHolidayHoursChange({ close: e.target.value })} className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`} />
                  <button
                    type="button"
                    onClick={() => handleHolidayHoursChange({ extra_slots: [...(holidayHours.extra_slots || []), { label: '', after: 'end' }] })}
                    title="「午前中」「16:00以降」など、時間のリストに追加の選択肢を差し込む"
                    className={`px-2 py-1 text-xs rounded-md flex-shrink-0 sm:ml-2 ${themeClasses.button.secondary}`}
                  >
                    ＋ 時間帯を追加{(holidayHours.extra_slots || []).length > 0 ? `（${(holidayHours.extra_slots || []).length}）` : ''}
                  </button>
                </div>
              )}

              {holidayHours.enabled === true && holidayHours.custom === true && renderCustomSlots(holidayHours.custom_slots || [], (next) => handleHolidayHoursChange({ custom_slots: next }))}
            </div>
            {holidayHours.enabled === true && !holidayHours.custom && (holidayHours.extra_slots || []).length > 0 && renderExtraSlots(holidayHours.extra_slots || [], holidayHours.open || '09:00', holidayHours.close || '18:00', (next) => handleHolidayHoursChange({ extra_slots: next }))}
            <p className={`text-xs ${themeClasses.text.tertiary} mt-2`}>
              ONにすると、祝日（振替休日含む）は曜日の設定より優先してこの時間で受付します。
              予約ルール設定の「祝日を予約不可にする」がONの祝日はそちらが優先されます。
            </p>
          </div>

          {/* 臨時営業日（曜日・祝日設定より優先して受付） */}
          {renderSpecialBusinessDays(settings.special_business_days || [], (next) => set('special_business_days', next))}
        </div>
      </div>
    </div>
  );
}
