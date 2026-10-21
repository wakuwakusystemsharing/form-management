'use client';

import React from 'react';
import type { BusinessHours, FormConfig, SpecialBusinessDay, StaffScheduleSettings } from '@/types/form';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import { ExtraMinutesPicker, InfoTooltip } from './MultipleDatesSettingsEditor';
import { HOLIDAY_TYPES } from '@/lib/holiday-types';
import { STAFF_SCHEDULE_ITEMS, pickFormValueForStaffItem } from '@/lib/staff-schedule';
import { describeAdvanceRule } from '@/lib/advance-rules';
import ConditionalAdvanceRulesEditor from './ConditionalAdvanceRulesEditor';

/**
 * スタッフごとの「希望日時設定」エディタ（メニュー構成 → 詳細設定 → スタッフ選択 → 各スタッフの「希望日時設定」）
 *
 * 営業時間・ルールタブのうち、Googleカレンダー連携モード設定（営業時間 / 祝日 / 臨時営業日 / ✕にする時間帯 / 時間間隔 / 追加で表示する分）と
 * 予約ルール設定（予約受付開始日 / 予約受付開始時間 / 事前予約可能日数 / 祝日を予約不可 / 営業時間を超える予約を許可）を
 * 項目ごとに「フォームの設定を使う / このスタッフ用に設定」で切り替える。未設定の項目はフォームの設定どおり。
 */
interface StaffScheduleEditorProps {
  schedule: StaffScheduleSettings | undefined;
  calendarSettings: FormConfig['calendar_settings'];
  onChange: (next: StaffScheduleSettings | undefined) => void;
  theme?: ThemeType;
}

const DAY_LABELS: Array<[keyof BusinessHours & string, string]> = [
  ['monday', '月曜日'], ['tuesday', '火曜日'], ['wednesday', '水曜日'], ['thursday', '木曜日'],
  ['friday', '金曜日'], ['saturday', '土曜日'], ['sunday', '日曜日'],
];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 営業時間 × 時間間隔 × 追加分 から、✕にする時間帯のプルダウン選択肢を作る */
function slotOptions(hours: BusinessHours | undefined, interval: number, extraMinutes: number[]): string[] {
  const open = Object.values(hours || {}).filter((h) => h && !h.closed);
  if (open.length === 0) return [];
  const start = Math.min(...open.map((h) => toMin(h.open || '09:00')));
  const end = Math.max(...open.map((h) => toMin(h.close || '18:00')));
  const mins = new Set<number>();
  for (let m = start; m < end; m += interval) mins.add(m);
  for (let h = Math.floor(start / 60); h * 60 < end; h++) extraMinutes.forEach((mm) => { const m = h * 60 + mm; if (m >= start && m < end) mins.add(m); });
  return [...mins].sort((a, b) => a - b).map(fmt);
}

const StaffScheduleEditor: React.FC<StaffScheduleEditorProps> = ({ schedule, calendarSettings, onChange, theme = 'light' }) => {
  const themeClasses = getThemeClasses(theme);
  const accentClasses = theme === 'light' ? 'accent-[rgb(244,144,49)] focus:ring-[rgb(244,144,49)]' : 'accent-cyan-500 focus:ring-cyan-500';
  const cs = calendarSettings || ({} as FormConfig['calendar_settings']);
  const sc: StaffScheduleSettings = schedule || {};

  const commit = (next: StaffScheduleSettings) => {
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as StaffScheduleSettings;
    onChange(Object.keys(cleaned).length > 0 ? cleaned : undefined);
  };
  const set = (patch: Partial<StaffScheduleSettings>) => commit({ ...sc, ...patch });
  const isOverridden = (key: keyof StaffScheduleSettings) => sc[key] !== undefined && sc[key] !== null;
  const toggleItem = (key: keyof StaffScheduleSettings, on: boolean) => {
    const item = STAFF_SCHEDULE_ITEMS.find((i) => i.key === key);
    const patch: Partial<StaffScheduleSettings> = {};
    if (on) {
      (patch as Record<string, unknown>)[key] = pickFormValueForStaffItem(cs, key);
      if (item?.companion) (patch as Record<string, unknown>)[item.companion] = pickFormValueForStaffItem(cs, item.companion);
    } else {
      (patch as Record<string, unknown>)[key] = undefined;
      if (item?.companion) (patch as Record<string, unknown>)[item.companion] = undefined;
    }
    set(patch);
  };

  // 表示用の「現在有効な値」（上書きが無ければフォームの値）
  const effInterval = (sc.time_interval || cs.time_interval || 30) as number;
  const effExtra = sc.extra_minutes || cs.extra_minutes || [];
  const effHours = sc.business_hours || cs.business_hours;

  const Row: React.FC<{ itemKey: keyof StaffScheduleSettings; help?: string; summary: string; children: React.ReactNode }> = ({ itemKey, help, summary, children }) => {
    const item = STAFF_SCHEDULE_ITEMS.find((i) => i.key === itemKey);
    const on = isOverridden(itemKey);
    return (
      <div className={`rounded-lg border p-3 ${theme === 'light' ? 'border-gray-200 bg-white' : 'border-gray-700 bg-gray-900/40'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-medium ${themeClasses.text.primary}`}>{item?.label || itemKey}</span>
            {help && <InfoTooltip theme={theme} text={help} />}
          </div>
          <div className="flex items-center gap-1 text-xs" role="radiogroup" aria-label={`${item?.label || itemKey} の設定元`}>
            <button
              type="button"
              role="radio"
              aria-checked={!on}
              onClick={() => toggleItem(itemKey, false)}
              className={`px-2.5 h-7 rounded-full border transition-colors ${!on
                ? (theme === 'light' ? 'bg-[rgb(244,144,49)] border-[rgb(244,144,49)] text-white' : 'bg-cyan-600 border-cyan-600 text-white')
                : (theme === 'light' ? 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50' : 'bg-gray-800 border-gray-600 text-gray-400')}`}
            >
              フォームの設定を使う
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => toggleItem(itemKey, true)}
              className={`px-2.5 h-7 rounded-full border transition-colors ${on
                ? (theme === 'light' ? 'bg-[rgb(244,144,49)] border-[rgb(244,144,49)] text-white' : 'bg-cyan-600 border-cyan-600 text-white')
                : (theme === 'light' ? 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50' : 'bg-gray-800 border-gray-600 text-gray-400')}`}
            >
              このスタッフ用に設定
            </button>
          </div>
        </div>
        {on ? (
          <div className="mt-3">{children}</div>
        ) : (
          <p className={`text-xs mt-2 ${themeClasses.text.tertiary}`}>フォームの設定: {summary}</p>
        )}
      </div>
    );
  };

  const hoursSummary = (hours: BusinessHours | undefined) => {
    if (!hours) return '未設定';
    const openDays = DAY_LABELS.filter(([k]) => hours[k] && !hours[k].closed);
    if (openDays.length === 0) return '全曜日 定休';
    return openDays.map(([k, label]) => `${label.slice(0, 1)} ${hours[k].open}〜${hours[k].close}`).join(' / ');
  };

  const businessHoursEditor = (hours: BusinessHours) => (
    <div className="space-y-2">
      {DAY_LABELS.map(([day, label]) => {
        const h = hours[day] || { open: '09:00', close: '18:00', closed: false };
        const update = (patch: Partial<{ open: string; close: string; closed: boolean }>) => set({ business_hours: { ...hours, [day]: { ...h, ...patch } } });
        return (
          <div key={day} className="flex flex-wrap items-center gap-2">
            <span className={`w-14 text-sm ${themeClasses.text.secondary}`}>{label}</span>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={!h.closed} onChange={(e) => update({ closed: !e.target.checked })} className={`rounded ${accentClasses}`} />
              <span className={themeClasses.text.secondary}>出勤</span>
            </label>
            {h.closed ? (
              <span className={`px-2 py-0.5 text-xs rounded ${theme === 'light' ? 'bg-gray-200 text-gray-600' : 'bg-gray-700 text-gray-400'}`}>休み</span>
            ) : (
              <>
                <input type="time" value={h.open || '09:00'} onChange={(e) => update({ open: e.target.value })} className={themeClasses.timeInput} />
                <span className={`text-sm ${themeClasses.text.secondary}`}>〜</span>
                <input type="time" value={h.close || '18:00'} onChange={(e) => update({ close: e.target.value })} className={themeClasses.timeInput} />
              </>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => {
          const mon = hours.monday || { open: '09:00', close: '18:00', closed: false };
          const next: BusinessHours = {};
          DAY_LABELS.forEach(([k]) => { next[k] = { ...mon }; });
          set({ business_hours: next });
        }}
        className={`px-2 py-1 text-xs rounded-md ${themeClasses.button.secondary}`}
      >
        月曜日の設定を全曜日にコピー
      </button>
    </div>
  );

  const specialDaysEditor = (days: SpecialBusinessDay[]) => (
    <div className="space-y-2">
      {days.length === 0 && <p className={`text-xs ${themeClasses.text.tertiary}`}>未設定（このスタッフの臨時営業日はありません）</p>}
      {days.map((d, i) => {
        const update = (patch: Partial<SpecialBusinessDay>) => set({ special_business_days: days.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        const invalid = !!d.open && !!d.close && d.close <= d.open;
        return (
          <div key={i} className="flex flex-wrap items-center gap-1">
            <input type="date" value={d.date} onChange={(e) => update({ date: e.target.value })} className={themeClasses.timeInput} />
            <input type="time" value={d.open} onChange={(e) => update({ open: e.target.value })} className={themeClasses.timeInput} />
            <span className={`text-sm ${themeClasses.text.secondary}`}>〜</span>
            <input type="time" value={d.close} onChange={(e) => update({ close: e.target.value })} className={themeClasses.timeInput} />
            <button type="button" onClick={() => set({ special_business_days: days.filter((_, j) => j !== i) })} className="text-xs text-red-500 px-1" aria-label="臨時営業日を削除">削除</button>
            {invalid && <span className="text-xs text-red-500">終了時間は開始時間より後にしてください</span>}
          </div>
        );
      })}
      <button type="button" onClick={() => set({ special_business_days: [...days, { date: '', open: '09:00', close: '18:00' }] })} className={`px-2 py-1 text-xs rounded-md ${themeClasses.button.secondary}`}>
        ＋ 臨時営業日を追加
      </button>
      <p className={`text-xs ${themeClasses.text.tertiary}`}>日付または時間が未入力の行は保存時に無視されます。</p>
    </div>
  );

  const blockedTimesEditor = (times: string[], weekdays: { [time: string]: number[] }) => {
    const slots = slotOptions(effHours, effInterval, effExtra);
    const daysFor = (t: string) => (Array.isArray(weekdays[t]) && weekdays[t].length > 0 ? weekdays[t] : [0, 1, 2, 3, 4, 5, 6]);
    return (
      <div className="space-y-2">
        {times.map((t, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex items-center gap-2">
              <select
                value={t}
                onChange={(e) => {
                  const nextTimes = times.map((x, i) => (i === idx ? e.target.value : x));
                  const nextMap = { ...weekdays };
                  if (nextMap[t]) { nextMap[e.target.value] = nextMap[t]; delete nextMap[t]; }
                  set({ blocked_times: nextTimes, blocked_time_weekdays: nextMap });
                }}
                className={themeClasses.input}
              >
                {(slots.includes(t) || !t ? slots : [t, ...slots]).map((slot) => <option key={slot} value={slot}>{slot}</option>)}
              </select>
              <button type="button" onClick={() => { const nextMap = { ...weekdays }; delete nextMap[t]; set({ blocked_times: times.filter((_, i) => i !== idx), blocked_time_weekdays: nextMap }); }} className="text-xs text-red-500 px-1">削除</button>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {WEEKDAY_ORDER.map((day) => {
                const selected = daysFor(t).includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      const cur = daysFor(t);
                      const next = selected ? cur.filter((d) => d !== day) : [...cur, day].sort((a, b) => a - b);
                      if (next.length === 0) return; // 全曜日解除は不可（削除で対応）
                      set({ blocked_time_weekdays: { ...weekdays, [t]: next } });
                    }}
                    title={`${WEEKDAY_SHORT[day]}曜日を✕にする`}
                    className={`w-7 h-7 text-xs rounded-full border ${selected
                      ? (theme === 'light' ? 'bg-[rgb(244,144,49)] border-[rgb(244,144,49)] text-white' : 'bg-cyan-600 border-cyan-600 text-white')
                      : (theme === 'light' ? 'bg-white border-gray-300 text-gray-400' : 'bg-gray-800 border-gray-600 text-gray-500')}`}
                  >
                    {WEEKDAY_SHORT[day]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => { const nextSlot = slots.find((s) => !times.includes(s)) || slots[0] || '12:00'; set({ blocked_times: [...times, nextSlot] }); }}
          className={`px-2 py-1 text-xs rounded-md ${themeClasses.button.secondary}`}
        >
          ＋ 時間帯を追加
        </button>
      </div>
    );
  };

  const numberInput = (key: 'min_advance_days' | 'min_advance_hours' | 'advance_booking_days', min: number, max: number, fallback: number) => (
    <input
      type="number"
      min={min}
      max={max}
      value={sc[key] ?? fallback}
      onChange={(e) => { const v = parseInt(e.target.value, 10); set({ [key]: Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback }); }}
      className={`${themeClasses.input} max-w-[8rem]`}
    />
  );

  const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${checked ? themeClasses.toggle.enabled : themeClasses.toggle.disabled}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );

  const calendarItems = STAFF_SCHEDULE_ITEMS.filter((i) => i.group === 'calendar');
  const ruleItems = STAFF_SCHEDULE_ITEMS.filter((i) => i.group === 'rules');

  const renderItem = (key: keyof StaffScheduleSettings) => {
    switch (key) {
      case 'business_hours':
        return (
          <Row key={key} itemKey={key} summary={hoursSummary(cs.business_hours)} help={'このスタッフが予約を受け付ける曜日と時間です。\n「出勤」を外した曜日は、このスタッフは終日✕になります。'}>
            {businessHoursEditor(sc.business_hours || {})}
          </Row>
        );
      case 'holiday_hours':
        return (
          <Row key={key} itemKey={key} summary={cs.holiday_hours?.enabled ? `祝日 ${cs.holiday_hours.open}〜${cs.holiday_hours.close}` : '曜日の設定に従う'} help="ONにすると、祝日はこのスタッフの曜日設定より優先してこの時間で受付します。">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={sc.holiday_hours?.enabled === true} onChange={(e) => set({ holiday_hours: { ...(sc.holiday_hours || { open: '09:00', close: '18:00', enabled: false }), enabled: e.target.checked } })} className={`rounded ${accentClasses}`} />
                <span className={themeClasses.text.secondary}>祝日設定を使う</span>
              </label>
              {sc.holiday_hours?.enabled && (
                <>
                  <input type="time" value={sc.holiday_hours.open} onChange={(e) => set({ holiday_hours: { ...sc.holiday_hours!, open: e.target.value } })} className={themeClasses.timeInput} />
                  <span className={`text-sm ${themeClasses.text.secondary}`}>〜</span>
                  <input type="time" value={sc.holiday_hours.close} onChange={(e) => set({ holiday_hours: { ...sc.holiday_hours!, close: e.target.value } })} className={themeClasses.timeInput} />
                </>
              )}
            </div>
          </Row>
        );
      case 'special_business_days':
        return (
          <Row key={key} itemKey={key} summary={(cs.special_business_days || []).length > 0 ? `${(cs.special_business_days || []).length} 日` : '未設定'} help="登録した日付は、曜日設定が休みでも、祝日を予約不可にしていても、この時間でこのスタッフは受付します。">
            {specialDaysEditor(sc.special_business_days || [])}
          </Row>
        );
      case 'blocked_times':
        return (
          <Row key={key} itemKey={key} summary={(cs.blocked_times || []).length > 0 ? (cs.blocked_times || []).join(', ') : '未設定'} help="設定した時刻の枠は、このスタッフではカレンダーで✕になります。曜日ボタンで✕にする曜日を絞れます。">
            {blockedTimesEditor(sc.blocked_times || [], sc.blocked_time_weekdays || {})}
          </Row>
        );
      case 'time_interval':
        return (
          <Row key={key} itemKey={key} summary={`${cs.time_interval || 30}分間隔`} help="このスタッフを指名しているときのカレンダーの時間間隔です（指名なしのときはフォームの設定）。">
            <select value={sc.time_interval || 30} onChange={(e) => set({ time_interval: parseInt(e.target.value, 10) as StaffScheduleSettings['time_interval'] })} className={`${themeClasses.input} max-w-[10rem]`}>
              {[10, 15, 20, 30, 45, 60, 120].map((v) => <option key={v} value={v}>{v}分間隔</option>)}
            </select>
          </Row>
        );
      case 'extra_minutes':
        return (
          <Row key={key} itemKey={key} summary={(cs.extra_minutes || []).length > 0 ? (cs.extra_minutes || []).map((m) => `${m}分`).join(', ') : '未設定'} help="時間間隔の行に加えて、毎時この分の行も表示します（このスタッフを指名しているときのみ）。">
            <ExtraMinutesPicker value={sc.extra_minutes || []} interval={effInterval} theme={theme} onChange={(mins) => set({ extra_minutes: mins })} />
          </Row>
        );
      case 'min_advance_days':
        return (
          <Row key={key} itemKey={key} summary={(cs.min_advance_days ?? 0) === 0 ? '当日から予約可能' : `${cs.min_advance_days}日後から予約可能`} help="何日後から予約を受け付けるか（0 = 当日から）。">
            {numberInput('min_advance_days', 0, 365, 0)}
          </Row>
        );
      case 'min_advance_hours':
        return (
          <Row key={key} itemKey={key} summary={(cs.min_advance_hours ?? 0) === 0 ? '制限なし' : `現在時刻の${cs.min_advance_hours}時間後から予約可能`} help="現在時刻から何時間後以降の枠を予約可能にするか（0 = 制限なし）。">
            {numberInput('min_advance_hours', 0, 168, 0)}
          </Row>
        );
      case 'conditional_advance_rules':
        return (
          <Row key={key} itemKey={key} summary={(cs.conditional_advance_rules || []).length > 0 ? (cs.conditional_advance_rules || []).map(describeAdvanceRule).join(' / ') : '未設定'} help={'「現在時刻が◯時以降なら N 日後の◯時から」のルール。このスタッフの予約受付開始日と合わせて、いちばん先になる条件が使われます。'}>
            <ConditionalAdvanceRulesEditor rules={sc.conditional_advance_rules || []} theme={theme} showHeading={false} onChange={(next) => set({ conditional_advance_rules: next })} />
          </Row>
        );
      case 'advance_booking_days':
        return (
          <Row key={key} itemKey={key} summary={`${cs.advance_booking_days || 30}日先まで`} help="何日先まで予約を受け付けるか。">
            {numberInput('advance_booking_days', 1, 365, 30)}
          </Row>
        );
      case 'holidays_as_closed':
        return (
          <Row key={key} itemKey={key} summary={cs.holidays_as_closed ? `ON（${HOLIDAY_TYPES.length - (cs.excluded_holiday_types || []).length} 種類の祝日を✕）` : 'OFF'} help="ONにすると日本の祝日はこのスタッフでは✕になります。チェックを外した祝日は営業可。">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Toggle checked={sc.holidays_as_closed === true} onChange={(v) => set({ holidays_as_closed: v })} />
                <span className={`text-sm ${themeClasses.text.secondary}`}>{sc.holidays_as_closed ? '祝日を予約不可にする' : '祝日も受付する'}</span>
              </div>
              {sc.holidays_as_closed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {HOLIDAY_TYPES.map((h) => {
                    const excluded = sc.excluded_holiday_types || [];
                    const checked = !excluded.includes(h.id);
                    return (
                      <label key={h.id} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={checked} onChange={() => set({ excluded_holiday_types: checked ? [...excluded, h.id] : excluded.filter((x) => x !== h.id) })} className={accentClasses} />
                        <span className={themeClasses.text.primary}>{h.label}<span className={`ml-1 text-xs ${themeClasses.text.secondary}`}>({h.rule})</span></span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </Row>
        );
      case 'allow_exceed_business_hours':
        return (
          <Row key={key} itemKey={key} summary={cs.allow_exceed_business_hours ? 'ON' : 'OFF'} help="ONにすると、施術終了時間がこのスタッフの終了時間を超えても予約可能になります。">
            <div className="flex items-center gap-2">
              <Toggle checked={sc.allow_exceed_business_hours === true} onChange={(v) => set({ allow_exceed_business_hours: v })} />
              <span className={`text-sm ${themeClasses.text.secondary}`}>{sc.allow_exceed_business_hours ? '許可する' : '許可しない'}</span>
            </div>
          </Row>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className={`text-sm font-semibold ${theme === 'light' ? 'text-[rgb(244,144,49)]' : 'text-cyan-300'}`}>Googleカレンダー連携モード設定</h4>
        {calendarItems.map((i) => renderItem(i.key))}
      </div>
      <div className="space-y-2">
        <h4 className={`text-sm font-semibold ${theme === 'light' ? 'text-[rgb(244,144,49)]' : 'text-cyan-300'}`}>予約ルール設定</h4>
        {ruleItems.map((i) => renderItem(i.key))}
      </div>
    </div>
  );
};

export default StaffScheduleEditor;
