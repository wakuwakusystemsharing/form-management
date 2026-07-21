'use client';

import React, { useState } from 'react';
import { Form, BusinessHours } from '@/types/form';
import { GOOGLE_EVENT_COLORS } from '@/lib/google-event-colors';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';

interface BusinessRulesEditorProps {
  form: Form;
  onUpdate: (form: Form) => void;
  theme?: ThemeType;
}

// ホバーで説明文を表示する ? アイコン
function InfoTooltip({ text, theme = 'light' }: { text: string; theme?: ThemeType }) {
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

const BusinessRulesEditor: React.FC<BusinessRulesEditorProps> = ({ form, onUpdate, theme = 'dark' }) => {
  const themeClasses = getThemeClasses(theme);
  const accentClasses = theme === 'light'
    ? 'accent-[rgb(244,144,49)] focus:ring-[rgb(244,144,49)]'
    : 'accent-cyan-500 focus:ring-cyan-500';

  const [businessHours, setBusinessHours] = useState<BusinessHours>(
    form.config?.calendar_settings?.business_hours || {
      monday: { open: '09:00', close: '18:00', closed: false },
      tuesday: { open: '09:00', close: '18:00', closed: false },
      wednesday: { open: '09:00', close: '18:00', closed: false },
      thursday: { open: '09:00', close: '18:00', closed: false },
      friday: { open: '09:00', close: '18:00', closed: false },
      saturday: { open: '09:00', close: '17:00', closed: false },
      sunday: { open: '10:00', close: '16:00', closed: false }
    }
  );

  const [advanceBookingDays, setAdvanceBookingDays] = useState(
    form.config?.calendar_settings?.advance_booking_days || 30
  );

  const [minAdvanceDays, setMinAdvanceDays] = useState(
    form.config?.calendar_settings?.min_advance_days ?? 0
  );

  const [maxConcurrentEvents, setMaxConcurrentEvents] = useState(
    form.config?.calendar_settings?.max_concurrent_events || 1
  );

  const [maxConcurrentReservationsPerUser, setMaxConcurrentReservationsPerUser] = useState(
    form.config?.calendar_settings?.max_concurrent_reservations_per_user ?? 0
  );

  const [holidaysAsClosed, setHolidaysAsClosed] = useState<boolean>(
    !!form.config?.calendar_settings?.holidays_as_closed
  );
  const [excludedHolidayTypes, setExcludedHolidayTypes] = useState<string[]>(
    Array.isArray(form.config?.calendar_settings?.excluded_holiday_types)
      ? (form.config!.calendar_settings!.excluded_holiday_types as string[])
      : []
  );

  const [bookingMode, setBookingMode] = useState<'calendar' | 'multiple_dates'>(
    form.config?.calendar_settings?.booking_mode || 'calendar'
  );

  const [calendarTimeInterval, setCalendarTimeInterval] = useState<10 | 15 | 20 | 30 | 45 | 60 | 120>(
    (form.config?.calendar_settings?.time_interval as 10 | 15 | 20 | 30 | 45 | 60 | 120) || 30
  );

  const defaultWeekdayHours: { [key: string]: { open: string; close: string; closed: boolean } } = {
    '0': { open: '09:00', close: '18:00', closed: true },
    '1': { open: '09:00', close: '18:00', closed: false },
    '2': { open: '09:00', close: '18:00', closed: false },
    '3': { open: '09:00', close: '18:00', closed: false },
    '4': { open: '09:00', close: '18:00', closed: false },
    '5': { open: '09:00', close: '18:00', closed: false },
    '6': { open: '09:00', close: '18:00', closed: false },
  };

  const [multipleDatesSettings, setMultipleDatesSettings] = useState<{
    time_interval: 10 | 15 | 20 | 30 | 45 | 60 | 120;
    date_range_days: number;
    exclude_weekdays: number[];
    start_time: string;
    end_time: string;
    weekday_hours?: { [key: string]: { open: string; close: string; closed: boolean } };
    required_choices?: number[];
    blocked_times?: string[];
  }>(
    (() => {
      const existing = form.config?.calendar_settings?.multiple_dates_settings;
      return {
        time_interval: existing?.time_interval || 30,
        date_range_days: existing?.date_range_days || 30,
        exclude_weekdays: existing?.exclude_weekdays || [0],
        start_time: existing?.start_time || '09:00',
        end_time: existing?.end_time || '18:00',
        weekday_hours: existing?.weekday_hours || defaultWeekdayHours,
        required_choices: existing?.required_choices || [1, 2, 3],
        blocked_times: existing?.blocked_times || [],
      };
    })()
  );

  const [expandedSections, setExpandedSections] = useState({
    businessHours: true,
    bookingRules: true,
    dateTimeMode: true,
    reservationSummary: true
  });

  const dayLabels = {
    monday: '月曜日',
    tuesday: '火曜日',
    wednesday: '水曜日',
    thursday: '木曜日',
    friday: '金曜日',
    saturday: '土曜日',
    sunday: '日曜日'
  };

  const weekdayLabels = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];

  const handleBusinessHoursChange = (day: string, field: 'open' | 'close' | 'closed', value: string | boolean) => {
    const updatedHours = {
      ...businessHours,
      [day]: {
        ...businessHours[day],
        [field]: value
      }
    };
    setBusinessHours(updatedHours);
    
    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          business_hours: updatedHours
        }
      }
    };
    onUpdate(updatedForm);
  };

  const handleAdvanceBookingDaysChange = (days: number) => {
    setAdvanceBookingDays(days);

    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          advance_booking_days: days
        }
      }
    };
    onUpdate(updatedForm);
  };

  const handleMinAdvanceDaysChange = (days: number) => {
    const safeValue = Number.isFinite(days) && days >= 0 ? Math.floor(days) : 0;
    setMinAdvanceDays(safeValue);

    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          min_advance_days: safeValue
        }
      }
    };
    onUpdate(updatedForm);
  };

  const handleCalendarTimeIntervalChange = (value: 10 | 15 | 20 | 30 | 45 | 60 | 120) => {
    setCalendarTimeInterval(value);

    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          time_interval: value
        }
      }
    };
    onUpdate(updatedForm);
  };

  const handleMaxConcurrentEventsChange = (value: number) => {
    const safeValue = Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
    setMaxConcurrentEvents(safeValue);

    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          max_concurrent_events: safeValue
        }
      }
    };
    onUpdate(updatedForm);
  };

  const handleMaxConcurrentReservationsPerUserChange = (value: number) => {
    const safeValue = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    setMaxConcurrentReservationsPerUser(safeValue);

    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          max_concurrent_reservations_per_user: safeValue
        }
      }
    };
    onUpdate(updatedForm);
  };

  const handleHolidaysAsClosedChange = (value: boolean) => {
    setHolidaysAsClosed(value);
    onUpdate({
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          holidays_as_closed: value
        }
      }
    });
  };

  const updateExcludedHolidayTypes = (next: string[]) => {
    setExcludedHolidayTypes(next);
    onUpdate({
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          excluded_holiday_types: next
        }
      }
    });
  };

  const toggleExcludedHolidayType = (typeId: string) => {
    const next = excludedHolidayTypes.includes(typeId)
      ? excludedHolidayTypes.filter((t) => t !== typeId)
      : [...excludedHolidayTypes, typeId];
    updateExcludedHolidayTypes(next);
  };

  const HOLIDAY_TYPES: { id: string; label: string; rule: string }[] = [
    { id: 'new_year', label: '元日', rule: '1/1' },
    { id: 'coming_of_age', label: '成人の日', rule: '1月第2月曜' },
    { id: 'national_foundation', label: '建国記念の日', rule: '2/11' },
    { id: 'emperor_birthday', label: '天皇誕生日', rule: '2/23' },
    { id: 'vernal_equinox', label: '春分の日', rule: '3/20 or 3/21' },
    { id: 'showa', label: '昭和の日', rule: '4/29' },
    { id: 'constitution', label: '憲法記念日', rule: '5/3' },
    { id: 'greenery', label: 'みどりの日', rule: '5/4' },
    { id: 'childrens', label: 'こどもの日', rule: '5/5' },
    { id: 'marine', label: '海の日', rule: '7月第3月曜' },
    { id: 'mountain', label: '山の日', rule: '8/11' },
    { id: 'respect_for_aged', label: '敬老の日', rule: '9月第3月曜' },
    { id: 'autumnal_equinox', label: '秋分の日', rule: '9/22 or 9/23' },
    { id: 'sports', label: 'スポーツの日', rule: '10月第2月曜' },
    { id: 'culture', label: '文化の日', rule: '11/3' },
    { id: 'labor_thanksgiving', label: '勤労感謝の日', rule: '11/23' },
    { id: 'substitute', label: '振替休日', rule: '祝日が日曜の場合の翌平日' },
    { id: 'national_day', label: '国民の休日', rule: '祝日に挟まれた平日' },
  ];

  const handleBookingModeChange = (mode: 'calendar' | 'multiple_dates') => {
    setBookingMode(mode);
    
    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          booking_mode: mode
        }
      }
    };
    onUpdate(updatedForm);
  };

  const handleMultipleDatesSettingsChange = (key: string, value: unknown) => {
    const updatedSettings = {
      ...multipleDatesSettings,
      [key]: value
    };
    setMultipleDatesSettings(updatedSettings);

    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          multiple_dates_settings: updatedSettings
        }
      }
    };
    onUpdate(updatedForm);
  };

  // 時間間隔 × 営業時間から、フォームに表示される時間スロット一覧を生成
  // （デフォルトで✕にする時間帯 のプルダウン選択肢用。営業中の曜日の最も早い開始〜最も遅い終了）
  const generateSlotOptions = (
    hours: Array<{ open?: string; close?: string; closed?: boolean }>,
    interval: number
  ): string[] => {
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    const openDays = hours.filter(h => h && !h.closed);
    if (openDays.length === 0) return [];
    const start = Math.min(...openDays.map(h => toMin(h.open || '09:00')));
    const end = Math.max(...openDays.map(h => toMin(h.close || '18:00')));
    const out: string[] = [];
    for (let m = start; m < end; m += interval) {
      out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
    return out;
  };

  const toggleRequiredChoice = (idx: number) => {
    if (idx === 1) return; // 第一希望は常に必須
    const current = multipleDatesSettings.required_choices || [1, 2, 3];
    const next = current.includes(idx)
      ? current.filter((n) => n !== idx)
      : [...current, idx].sort();
    handleMultipleDatesSettingsChange('required_choices', next);
  };

  const handleWeekdayHoursChange = (dayIndex: string, field: 'open' | 'close' | 'closed', value: string | boolean) => {
    const currentHours = multipleDatesSettings.weekday_hours || defaultWeekdayHours;
    const updatedHours = {
      ...currentHours,
      [dayIndex]: {
        ...currentHours[dayIndex],
        [field]: value
      }
    };

    // レガシーフィールドも同期（exclude_weekdays）
    const excludeWeekdays = Object.entries(updatedHours)
      .filter(([, h]) => h.closed)
      .map(([k]) => parseInt(k));

    const updatedSettings = {
      ...multipleDatesSettings,
      weekday_hours: updatedHours,
      exclude_weekdays: excludeWeekdays,
    };
    setMultipleDatesSettings(updatedSettings);

    const updatedForm = {
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          multiple_dates_settings: updatedSettings
        }
      }
    };
    onUpdate(updatedForm);
  };

  const toggleSection = (section: 'businessHours' | 'bookingRules' | 'dateTimeMode' | 'reservationSummary') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <svg className={`w-6 h-6 ${themeClasses.text.primary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className={`text-xl font-semibold ${themeClasses.text.primary}`}>営業時間・ルール設定</h2>
      </div>

        {/* 日時選択モード設定 */}
      <div className={themeClasses.card}>
        <button
          onClick={() => toggleSection('dateTimeMode')}
          className={`w-full flex items-center justify-between p-4 text-left transition-colors ${
            theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'
          }`}
        >
          <div className="flex items-center space-x-2">
            <svg className={`w-5 h-5 ${themeClasses.text.primary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h3 className={`text-lg font-medium ${themeClasses.text.primary}`}>日時選択モード</h3>
          </div>
          <svg 
            className={`w-5 h-5 ${themeClasses.text.secondary} transform transition-transform ${expandedSections.dateTimeMode ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {expandedSections.dateTimeMode && (
          <div className={`p-4 border-t ${themeClasses.divider} space-y-6`}>
            {/* モード選択 */}
            <div>
              <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-3`}>
                予約日時の選択方式
              </label>
              <div className="space-y-3">
                <label className="flex items-center space-x-3">
                  <input
                    type="radio"
                    value="calendar"
                    checked={bookingMode === 'calendar'}
                    onChange={(e) => handleBookingModeChange(e.target.value as 'calendar')}
                    className={accentClasses}
                  />
                  <div>
                    <div className={`font-medium ${themeClasses.text.primary}`}>カレンダー表示</div>
                    <div className={`text-sm ${themeClasses.text.secondary}`}>Google Calendarと連携してリアルタイムの空き状況を表示</div>
                  </div>
                </label>
                <label className="flex items-center space-x-3">
                  <input
                    type="radio"
                    value="multiple_dates"
                    checked={bookingMode === 'multiple_dates'}
                    onChange={(e) => handleBookingModeChange(e.target.value as 'multiple_dates')}
                    className={accentClasses}
                  />
                  <div>
                    <div className={`font-medium ${themeClasses.text.primary}`}>第三希望日時選択</div>
                    <div className={`text-sm ${themeClasses.text.secondary}`}>第一〜第三希望日時を選択（Google Calendar連携なし）</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Google カレンダー連携モード設定 */}
            {bookingMode === 'calendar' && (
              <div className={`${themeClasses.highlight} rounded-lg p-4`}>
                <h4 className={`text-sm font-medium mb-4 ${theme === 'light' ? 'text-[rgb(244,144,49)]' : 'text-cyan-300'}`}>Googleカレンダー連携モード設定</h4>

                <div className="max-w-xs">
                  <div className="flex items-center gap-1.5 mb-2">
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                      時間間隔
                    </label>
                    <InfoTooltip
                      theme={theme}
                      text="予約フォームのカレンダーに表示する時間スロットの間隔"
                    />
                  </div>
                  <select
                    value={calendarTimeInterval}
                    onChange={(e) => handleCalendarTimeIntervalChange(parseInt(e.target.value) as 10 | 15 | 20 | 30 | 45 | 60 | 120)}
                    className={themeClasses.input}
                  >
                    <option value={10}>10分間隔</option>
                    <option value={15}>15分間隔</option>
                    <option value={20}>20分間隔</option>
                    <option value={30}>30分間隔</option>
                    <option value={45}>45分間隔</option>
                    <option value={60}>60分間隔</option>
                    <option value={120}>120分間隔</option>
                  </select>
                </div>

                {/* デフォルトで✕にする時間帯 */}
                <div className="mt-4 max-w-xs">
                  <div className="flex items-center gap-1.5 mb-2">
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                      デフォルトで✕にする時間帯
                    </label>
                    <InfoTooltip
                      theme={theme}
                      text={'設定した時刻のスロットは、予約フォームのカレンダーで常に✕になります。\n例: 13:00 を追加 → 毎日 13:00 の枠が✕'}
                    />
                  </div>
                  <div className="space-y-2">
                    {(form.config?.calendar_settings?.blocked_times || []).map((t, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          value={t}
                          onChange={(e) => {
                            const next = [...(form.config?.calendar_settings?.blocked_times || [])];
                            next[idx] = e.target.value;
                            onUpdate({ ...form, config: { ...form.config, calendar_settings: { ...form.config?.calendar_settings, blocked_times: next } } });
                          }}
                          className={themeClasses.input}
                        >
                          {(() => {
                            const slots = generateSlotOptions(Object.values(businessHours), calendarTimeInterval);
                            // 時間間隔や営業時間の変更で選択肢から外れた保存済みの値も表示は維持
                            const opts = slots.includes(t) || !t ? slots : [t, ...slots];
                            return opts.map(slot => (
                              <option key={slot} value={slot}>{slot}</option>
                            ));
                          })()}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const next = (form.config?.calendar_settings?.blocked_times || []).filter((_, i) => i !== idx);
                            onUpdate({ ...form, config: { ...form.config, calendar_settings: { ...form.config?.calendar_settings, blocked_times: next } } });
                          }}
                          title="削除"
                          className={`p-1.5 rounded text-red-400 hover:text-red-300 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const slots = generateSlotOptions(Object.values(businessHours), calendarTimeInterval);
                        const used = form.config?.calendar_settings?.blocked_times || [];
                        const nextSlot = slots.find(slot => !used.includes(slot)) || slots[0] || '12:00';
                        onUpdate({ ...form, config: { ...form.config, calendar_settings: { ...form.config?.calendar_settings, blocked_times: [...used, nextSlot] } } });
                      }}
                      className={`px-2 py-1 text-xs rounded-md ${themeClasses.button.secondary}`}
                    >
                      ＋ 時間帯を追加
                    </button>
                  </div>
                </div>

                {/* 予約イベントの色変更 */}
                <div className="mt-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                      予約イベントの色変更
                    </label>
                    <InfoTooltip
                      theme={theme}
                      text={'予約が入ったときに Google カレンダーへ作成される予定の色を選べます。\n「デフォルト」はカレンダー自体の色（従来どおり）です。\n\n※ Google カレンダーの仕様上、予定に指定できる色はこの11色です。'}
                    />
                  </div>
                  {form.config?.staff_selection?.enabled === true ? (
                    <p className={`text-xs p-3 rounded ${theme === 'light' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-amber-900/30 text-amber-300 border border-amber-700'}`}>
                      スタッフ選択が有効なため、予約イベントの色は<strong>スタッフごと</strong>に設定します。
                      <br />メニュー構成 → 詳細設定 → スタッフ選択の各スタッフで色を選んでください。
                    </p>
                  ) : (
                  <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdate({
                        ...form,
                        config: {
                          ...form.config,
                          calendar_settings: {
                            ...form.config?.calendar_settings,
                            event_color_id: ''
                          }
                        }
                      })}
                      className={`px-2.5 h-8 rounded-full border-2 text-xs font-medium transition-all ${
                        !(form.config?.calendar_settings?.event_color_id)
                          ? (theme === 'light' ? 'border-[rgb(244,144,49)] text-[rgb(244,144,49)]' : 'border-cyan-400 text-cyan-300')
                          : (theme === 'light' ? 'border-gray-300 text-gray-500 hover:border-gray-400' : 'border-gray-600 text-gray-400 hover:border-gray-500')
                      }`}
                    >
                      デフォルト
                    </button>
                    {GOOGLE_EVENT_COLORS.map((color) => {
                      const selected = form.config?.calendar_settings?.event_color_id === color.id;
                      return (
                        <button
                          key={color.id}
                          type="button"
                          title={color.name}
                          onClick={() => onUpdate({
                            ...form,
                            config: {
                              ...form.config,
                              calendar_settings: {
                                ...form.config?.calendar_settings,
                                event_color_id: color.id
                              }
                            }
                          })}
                          className={`w-8 h-8 rounded-full transition-all ${
                            selected
                              ? 'ring-2 ring-offset-2 scale-110 ' + (theme === 'light' ? 'ring-[rgb(244,144,49)] ring-offset-white' : 'ring-cyan-400 ring-offset-gray-800')
                              : 'hover:scale-105'
                          }`}
                          style={{ backgroundColor: color.hex }}
                        />
                      );
                    })}
                  </div>
                  <p className={`text-xs ${themeClasses.text.secondary} mt-2`}>
                    選択中: {
                      GOOGLE_EVENT_COLORS.find(c => c.id === form.config?.calendar_settings?.event_color_id)?.name
                      || 'デフォルト（カレンダーの色）'
                    }
                  </p>
                  </>
                  )}
                </div>

                {/* 営業時間設定（カレンダー表示モードの受付時間） */}
                <div className="mt-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                      営業時間設定
                    </label>
                    <InfoTooltip
                      theme={theme}
                      text={'カレンダーに〇が表示される受付時間を曜日別に設定します。\n「営業」のチェックを外した曜日は終日✕になります。'}
                    />
                  </div>
            <div className="space-y-3">
              {Object.entries(dayLabels).map(([day, label]) => (
                <div key={day} className={`rounded-lg p-3 ${
                  theme === 'light' 
                    ? 'border border-gray-300 bg-gray-50' 
                    : 'border border-gray-700 bg-gray-900/50'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    <div className={`w-full sm:w-16 text-sm font-medium ${themeClasses.text.secondary} flex-shrink-0`}>
                      {label}
                    </div>
                    
                    <label className="flex items-center space-x-2 flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={!businessHours[day]?.closed}
                        onChange={(e) => handleBusinessHoursChange(day, 'closed', !e.target.checked)}
                        className={`rounded ${accentClasses} ${
                          theme === 'light'
                            ? 'border-gray-300 bg-gray-100'
                            : 'border-gray-600 bg-gray-700'
                        }`}
                      />
                      <span className={`text-sm ${themeClasses.text.secondary}`}>営業</span>
                    </label>

                    {!businessHours[day]?.closed && (
                      <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-1">
                        <input
                          type="time"
                          value={businessHours[day]?.open || '09:00'}
                          onChange={(e) => handleBusinessHoursChange(day, 'open', e.target.value)}
                          className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`}
                        />
                        <span className={`text-sm ${themeClasses.text.secondary} hidden sm:inline`}>〜</span>
                        <input
                          type="time"
                          value={businessHours[day]?.close || '18:00'}
                          onChange={(e) => handleBusinessHoursChange(day, 'close', e.target.value)}
                          className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`}
                        />
                      </div>
                    )}

                    {businessHours[day]?.closed && (
                      <span className={`px-2 py-1 text-xs rounded ${
                        theme === 'light'
                          ? 'bg-gray-200 text-gray-600 border border-gray-300'
                          : 'bg-gray-700 text-gray-400 border border-gray-600'
                      }`}>
                        定休日
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
                </div>
              </div>
            )}

            {/* 第三希望日時モード用設定 */}
            {bookingMode === 'multiple_dates' && (
              <div className={`${themeClasses.highlight} rounded-lg p-4`}>
                <h4 className={`text-sm font-medium mb-4 ${theme === 'light' ? 'text-[rgb(244,144,49)]' : 'text-cyan-300'}`}>第三希望日時モード設定</h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {/* 時間間隔 */}
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>
                      時間間隔
                    </label>
                    <select
                      value={multipleDatesSettings.time_interval}
                      onChange={(e) => handleMultipleDatesSettingsChange('time_interval', parseInt(e.target.value) as 10 | 15 | 20 | 30 | 45 | 60 | 120)}
                      className={themeClasses.input}
                    >
                      <option value={10}>10分間隔</option>
                      <option value={15}>15分間隔</option>
                      <option value={20}>20分間隔</option>
                      <option value={30}>30分間隔</option>
                      <option value={45}>45分間隔</option>
                      <option value={60}>60分間隔</option>
                      <option value={120}>120分間隔</option>
                    </select>
                  </div>

                  {/* デフォルトで✕にする時間帯 */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                        デフォルトで✕にする時間帯
                      </label>
                      <InfoTooltip
                        theme={theme}
                        text={'設定した時刻は、希望日時の時間選択の選択肢に表示されなくなります。\n例: 13:00 を追加 → どの日でも 13:00 は選べない'}
                      />
                    </div>
                    <div className="space-y-2">
                      {(multipleDatesSettings.blocked_times || []).map((t, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={t}
                            onChange={(e) => {
                              const next = [...(multipleDatesSettings.blocked_times || [])];
                              next[idx] = e.target.value;
                              handleMultipleDatesSettingsChange('blocked_times', next);
                            }}
                            className={themeClasses.input}
                          >
                            {(() => {
                              const hoursList = multipleDatesSettings.weekday_hours
                                ? Object.values(multipleDatesSettings.weekday_hours)
                                : [{ open: multipleDatesSettings.start_time, close: multipleDatesSettings.end_time, closed: false }];
                              const slots = generateSlotOptions(hoursList, multipleDatesSettings.time_interval);
                              const opts = slots.includes(t) || !t ? slots : [t, ...slots];
                              return opts.map(slot => (
                                <option key={slot} value={slot}>{slot}</option>
                              ));
                            })()}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleMultipleDatesSettingsChange('blocked_times', (multipleDatesSettings.blocked_times || []).filter((_, i) => i !== idx))}
                            title="削除"
                            className={`p-1.5 rounded text-red-400 hover:text-red-300 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const hoursList = multipleDatesSettings.weekday_hours
                            ? Object.values(multipleDatesSettings.weekday_hours)
                            : [{ open: multipleDatesSettings.start_time, close: multipleDatesSettings.end_time, closed: false }];
                          const slots = generateSlotOptions(hoursList, multipleDatesSettings.time_interval);
                          const used = multipleDatesSettings.blocked_times || [];
                          const nextSlot = slots.find(slot => !used.includes(slot)) || slots[0] || '12:00';
                          handleMultipleDatesSettingsChange('blocked_times', [...used, nextSlot]);
                        }}
                        className={`px-2 py-1 text-xs rounded-md ${themeClasses.button.secondary}`}
                      >
                        ＋ 時間帯を追加
                      </button>
                    </div>
                  </div>

                  {/* 選択可能日数 */}
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>
                      選択可能日数
                    </label>
                    <input
                      type="number"
                      min="7"
                      max="90"
                      value={multipleDatesSettings.date_range_days}
                      onChange={(e) => handleMultipleDatesSettingsChange('date_range_days', parseInt(e.target.value) || 30)}
                      className={themeClasses.input}
                    />
                    <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>本日から何日後まで選択可能にするか</p>
                  </div>

                  {/* 必須選択 */}
                  <div className="md:col-span-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                        必須選択
                      </label>
                      <InfoTooltip
                        theme={theme}
                        text={'チェックした希望日時を選択しないと予約送信できません。\nチェックを外した希望日時は任意入力になります。\n\n※ 第一希望は予約日時として使用されるため常に必須です。'}
                      />
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {[1, 2, 3].map((idx) => {
                        const labels: { [key: number]: string } = { 1: '第一希望', 2: '第二希望', 3: '第三希望' };
                        const checked = (multipleDatesSettings.required_choices || [1, 2, 3]).includes(idx);
                        return (
                          <label
                            key={idx}
                            className={`flex items-center space-x-2 ${idx === 1 ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={idx === 1}
                              onChange={() => toggleRequiredChoice(idx)}
                              className={`rounded ${accentClasses} ${
                                theme === 'light'
                                  ? 'border-gray-300 bg-gray-100'
                                  : 'border-gray-600 bg-gray-700'
                              }`}
                            />
                            <span className={`text-sm ${themeClasses.text.secondary}`}>
                              {labels[idx]}{idx === 1 ? '（常に必須）' : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 曜日別時間設定 */}
                <div>
                  <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>
                    曜日別の受付時間
                  </label>
                  <div className="space-y-2">
                    {weekdayLabels.map((dayLabel, index) => {
                      const dayKey = String(index);
                      const hours = (multipleDatesSettings.weekday_hours || defaultWeekdayHours)[dayKey] || { open: '09:00', close: '18:00', closed: false };
                      return (
                        <div key={index} className={`rounded-lg p-3 ${
                          theme === 'light'
                            ? 'border border-gray-300 bg-white'
                            : 'border border-gray-700 bg-gray-900/50'
                        }`}>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                            <div className={`w-full sm:w-16 text-sm font-medium ${themeClasses.text.secondary} flex-shrink-0`}>
                              {dayLabel}
                            </div>

                            <label className="flex items-center space-x-2 flex-shrink-0">
                              <input
                                type="checkbox"
                                checked={!hours.closed}
                                onChange={(e) => handleWeekdayHoursChange(dayKey, 'closed', !e.target.checked)}
                                className={`rounded ${accentClasses} ${
                                  theme === 'light'
                                    ? 'border-gray-300 bg-gray-100'
                                    : 'border-gray-600 bg-gray-700'
                                }`}
                              />
                              <span className={`text-sm ${themeClasses.text.secondary}`}>受付</span>
                            </label>

                            {!hours.closed && (
                              <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-1">
                                <input
                                  type="time"
                                  value={hours.open}
                                  onChange={(e) => handleWeekdayHoursChange(dayKey, 'open', e.target.value)}
                                  className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`}
                                />
                                <span className={`text-sm ${themeClasses.text.secondary} hidden sm:inline`}>〜</span>
                                <input
                                  type="time"
                                  value={hours.close}
                                  onChange={(e) => handleWeekdayHoursChange(dayKey, 'close', e.target.value)}
                                  className={`${themeClasses.timeInput} w-full sm:w-auto min-w-0 flex-shrink-0`}
                                />
                              </div>
                            )}

                            {hours.closed && (
                              <span className={`px-2 py-1 text-xs rounded ${
                                theme === 'light'
                                  ? 'bg-gray-200 text-gray-600 border border-gray-300'
                                  : 'bg-gray-700 text-gray-400 border border-gray-600'
                              }`}>
                                定休日
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 予約ルール設定 */}
      <div className={themeClasses.card}>
        <button
          onClick={() => toggleSection('bookingRules')}
          className={`w-full flex items-center justify-between p-4 text-left transition-colors ${
            theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'
          }`}
        >
          <div className="flex items-center space-x-2">
            <svg className={`w-5 h-5 ${themeClasses.text.primary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className={`text-lg font-medium ${themeClasses.text.primary}`}>予約ルール設定</h3>
          </div>
          <svg 
            className={`w-5 h-5 ${themeClasses.text.secondary} transform transition-transform ${expandedSections.bookingRules ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>        {expandedSections.bookingRules && (
          <div className={`p-4 border-t ${themeClasses.divider} space-y-4`}>
            <div className="max-w-xs">
              <div className="flex items-center gap-1.5 mb-2">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  予約受付開始日
                </label>
                <InfoTooltip
                  theme={theme}
                  text={'何日後から予約を受け付けるかを設定します。\n\n「0」= 当日から予約可能（従来どおり）\n「1」= 翌日から予約可能\n「2」= 2日後から予約可能\n\nカレンダー表示・第三希望日時選択の両モードに適用されます。'}
                />
              </div>
              <input
                type="number"
                min="0"
                max="365"
                value={minAdvanceDays}
                onChange={(e) => handleMinAdvanceDaysChange(parseInt(e.target.value) || 0)}
                className={themeClasses.input}
              />
              <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>
                {minAdvanceDays === 0 ? '当日から予約可能' : `${minAdvanceDays}日後から予約可能`}
              </p>
            </div>

            <div className="max-w-xs">
              <div className="flex items-center gap-1.5 mb-2">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  事前予約可能日数
                </label>
                <InfoTooltip theme={theme} text="何日先まで予約を受け付けるかを設定します" />
              </div>
              <input
                type="number"
                min="1"
                max="365"
                value={advanceBookingDays}
                onChange={(e) => handleAdvanceBookingDaysChange(parseInt(e.target.value) || 30)}
                className={themeClasses.input}
              />
            </div>

            <div className="max-w-xs">
              <div className="flex items-center gap-1.5 mb-2">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  同時刻に埋まるイベント数
                </label>
                <InfoTooltip
                  theme={theme}
                  text={'Googleカレンダー上でこの件数以上のイベントが重なる時間帯は予約不可（✕）になります。\n\n例: 「2」に設定 → 2件のイベントが重なる時間帯から✕。「1」は現状（1件で✕）。'}
                />
              </div>
              <input
                type="number"
                min="1"
                max="99"
                value={maxConcurrentEvents}
                onChange={(e) => handleMaxConcurrentEventsChange(parseInt(e.target.value) || 1)}
                className={themeClasses.input}
              />
            </div>

            <div className="max-w-xs">
              <div className="flex items-center gap-1.5 mb-2">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  同一ユーザーの同時予約数の上限
                </label>
                <InfoTooltip
                  theme={theme}
                  text={'同一ユーザー（LINE ID または電話番号で判定）が同時に持てる未来予約の最大数。\n\n「0」=制限なし。\n「1」=既に1件予約があると2件目はブロックされ、フォーム上にエラーメッセージが表示されます。\n\n予約日時が過ぎるか、予約をキャンセルするとカウントが減ります。'}
                />
              </div>
              <input
                type="number"
                min="0"
                max="99"
                value={maxConcurrentReservationsPerUser}
                onChange={(e) => handleMaxConcurrentReservationsPerUserChange(parseInt(e.target.value) || 0)}
                className={themeClasses.input}
              />
            </div>

            {/* 祝日設定 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                    祝日を予約不可にする
                  </label>
                  <InfoTooltip
                    theme={theme}
                    text="ONにすると日本の祝日（1980〜2099年対応）はカレンダーで✕表示になります"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleHolidaysAsClosedChange(!holidaysAsClosed)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                    holidaysAsClosed ? themeClasses.toggle.enabled : themeClasses.toggle.disabled
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    holidaysAsClosed ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {holidaysAsClosed && (
                <div className={`${themeClasses.highlight} rounded-lg p-4`}>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <p className={`text-xs ${themeClasses.text.secondary}`}>
                      ✕ にする祝日を選択（チェックを外すと営業可）
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateExcludedHolidayTypes([])}
                        className={`text-xs px-2 py-0.5 rounded border ${theme === 'light' ? 'border-gray-300 text-gray-700 hover:bg-gray-100' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}`}
                      >
                        すべて選択
                      </button>
                      <button
                        type="button"
                        onClick={() => updateExcludedHolidayTypes(HOLIDAY_TYPES.map((h) => h.id))}
                        className={`text-xs px-2 py-0.5 rounded border ${theme === 'light' ? 'border-gray-300 text-gray-700 hover:bg-gray-100' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}`}
                      >
                        すべて解除
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {HOLIDAY_TYPES.map((h) => {
                      const checked = !excludedHolidayTypes.includes(h.id);
                      return (
                        <label key={h.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleExcludedHolidayType(h.id)}
                            className={`cursor-pointer ${accentClasses}`}
                          />
                          <span className={`text-sm ${themeClasses.text.primary}`}>
                            {h.label}
                            <span className={`ml-1 text-xs ${themeClasses.text.secondary}`}>({h.rule})</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  営業時間を超える予約を許可
                </label>
                <InfoTooltip
                  theme={theme}
                  text="ONにすると、施術終了時間が閉店時間を超えても予約可能になります"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const newValue = !(form.config?.calendar_settings?.allow_exceed_business_hours || false);
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      calendar_settings: {
                        ...form.config?.calendar_settings,
                        allow_exceed_business_hours: newValue
                      }
                    }
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  form.config?.calendar_settings?.allow_exceed_business_hours
                    ? themeClasses.toggle.enabled
                    : themeClasses.toggle.disabled
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.config?.calendar_settings?.allow_exceed_business_hours ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  希望日時をデフォルトで非表示
                </label>
                <InfoTooltip
                  theme={theme}
                  text={'ONにすると、メニューが選択されるまで希望日時エリアを非表示にします。メニューを選択すると表示され、選択を解除すると再度非表示になります。\n\nOFFにすると、メニューの選択にかかわらず希望日時エリアが常に表示されます。'}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const current = form.config?.calendar_settings?.hide_datetime_until_menu_selected !== false;
                  const newValue = !current;
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      calendar_settings: {
                        ...form.config?.calendar_settings,
                        hide_datetime_until_menu_selected: newValue
                      }
                    }
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  form.config?.calendar_settings?.hide_datetime_until_menu_selected !== false
                    ? themeClasses.toggle.enabled
                    : themeClasses.toggle.disabled
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.config?.calendar_settings?.hide_datetime_until_menu_selected !== false ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  「お名前」フィールドを表示
                </label>
                <InfoTooltip
                  theme={theme}
                  text="OFF にすると入力欄を非表示。LINE 表示名を自動で記録（Web フォームの場合は「未記入」）"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const current = form.config?.calendar_settings?.show_customer_name !== false;
                  const newValue = !current;
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      calendar_settings: {
                        ...form.config?.calendar_settings,
                        show_customer_name: newValue
                      }
                    }
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  form.config?.calendar_settings?.show_customer_name !== false
                    ? themeClasses.toggle.enabled
                    : themeClasses.toggle.disabled
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.config?.calendar_settings?.show_customer_name !== false ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  「電話番号」フィールドを表示
                </label>
                <InfoTooltip
                  theme={theme}
                  text="OFF にすると入力欄を非表示。電話番号は「未記入」として保存されます"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const current = form.config?.calendar_settings?.show_customer_phone !== false;
                  const newValue = !current;
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      calendar_settings: {
                        ...form.config?.calendar_settings,
                        show_customer_phone: newValue
                      }
                    }
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  form.config?.calendar_settings?.show_customer_phone !== false
                    ? themeClasses.toggle.enabled
                    : themeClasses.toggle.disabled
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.config?.calendar_settings?.show_customer_phone !== false ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>


            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  「メールアドレス」フィールドを表示（Web 予約用）
                  {form.config?.form_type === 'web' && (
                    <span className="ml-2 text-xs text-green-600 dark:text-green-400">必須</span>
                  )}
                </label>
                <InfoTooltip
                  theme={theme}
                  text={form.config?.form_type === 'web'
                    ? 'Web 予約フォームでは予約確認メールが唯一の通知手段のため、メールアドレス欄は常に必須で表示されます。\n（このトグルは LINE 予約フォーム用です）'
                    : 'ON にすると予約フォームに「メールアドレス」と「確認用」の 2 欄を表示します。\nWeb 予約フォーム送信時に予約確認メールを自動送信します（LINE 予約には影響なし）。'}
                />
              </div>
              <button
                type="button"
                disabled={form.config?.form_type === 'web'}
                onClick={() => {
                  if (form.config?.form_type === 'web') return;
                  const current = form.config?.calendar_settings?.show_customer_email === true;
                  const newValue = !current;
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      calendar_settings: {
                        ...form.config?.calendar_settings,
                        show_customer_email: newValue
                      }
                    }
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  form.config?.calendar_settings?.show_customer_email === true || form.config?.form_type === 'web'
                    ? themeClasses.toggle.enabled
                    : themeClasses.toggle.disabled
                } ${form.config?.form_type === 'web' ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.config?.calendar_settings?.show_customer_email === true || form.config?.form_type === 'web' ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  店舗側通知メール（Web 予約用）
                </label>
                <InfoTooltip
                  theme={theme}
                  text={'Web 予約が入った際の店舗側通知メールの送信先。\n空のときは店舗オーナーのメールアドレス（基本情報）に送信されます。'}
                />
              </div>
              <input
                type="email"
                placeholder="未設定時は店舗オーナーのメール宛"
                value={form.config?.calendar_settings?.notification_email || ''}
                onChange={(e) => {
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      calendar_settings: {
                        ...form.config?.calendar_settings,
                        notification_email: e.target.value
                      }
                    }
                  });
                }}
                className={themeClasses.input}
              />
            </div>

            <div className={`${themeClasses.highlight} rounded-lg p-4`}>
              <h4 className={`text-sm font-medium mb-2 ${theme === 'light' ? 'text-[rgb(244,144,49)]' : 'text-cyan-300'}`}>現在の設定:</h4>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 予約受付開始: {minAdvanceDays === 0 ? '当日から' : `${minAdvanceDays}日後から`}
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 事前予約: {advanceBookingDays}日先まで
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 営業時間超過: {form.config?.calendar_settings?.allow_exceed_business_hours ? '許可' : '不可'}
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 同時刻の予約不可閾値: {maxConcurrentEvents}件
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 同一ユーザー同時予約上限: {maxConcurrentReservationsPerUser === 0 ? '制限なし' : `${maxConcurrentReservationsPerUser}件まで`}
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 希望日時エリア: {form.config?.calendar_settings?.hide_datetime_until_menu_selected !== false ? 'メニュー選択後に表示' : '常に表示'}
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • お名前フィールド: {form.config?.calendar_settings?.show_customer_name !== false ? '表示' : '非表示'}
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 電話番号フィールド: {form.config?.calendar_settings?.show_customer_phone !== false ? '表示' : '非表示'}
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • メールアドレスフィールド: {(form.config?.calendar_settings?.show_customer_email === true || form.config?.form_type === 'web') ? `表示（送信時に確認メール自動送信）${form.config?.form_type === 'web' ? '・Web予約は必須' : ''}` : '非表示'}
              </p>
              {form.config?.calendar_settings?.notification_email && (
                <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                  • 店舗側通知メール: {form.config.calendar_settings.notification_email}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ご予約内容 */}
      <div className={themeClasses.card}>
        <button
          onClick={() => toggleSection('reservationSummary')}
          className={`w-full flex items-center justify-between p-4 text-left transition-colors ${
            theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'
          }`}
        >
          <div className="flex items-center space-x-2">
            <svg className={`w-5 h-5 ${themeClasses.text.primary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <h3 className={`text-lg font-medium ${themeClasses.text.primary}`}>ご予約内容</h3>
          </div>
          <svg
            className={`w-5 h-5 ${themeClasses.text.secondary} transform transition-transform ${expandedSections.reservationSummary ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expandedSections.reservationSummary && (
          <div className={`p-4 border-t ${themeClasses.divider} space-y-4`}>
            <p className={`text-xs ${themeClasses.text.secondary}`}>
              予約フォームの「ご予約内容」欄の表示に関する設定です。
            </p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  合計金額を表示
                </label>
                <InfoTooltip
                  theme={theme}
                  text="ONにすると「ご予約内容」欄に選択メニュー・オプションの合計金額を表示します"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const newValue = !(form.config?.reservation_summary?.show_total_price === true);
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      reservation_summary: {
                        ...form.config?.reservation_summary,
                        show_total_price: newValue
                      }
                    }
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  form.config?.reservation_summary?.show_total_price === true
                    ? themeClasses.toggle.enabled
                    : themeClasses.toggle.disabled
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.config?.reservation_summary?.show_total_price === true ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                  合計時間を表示
                </label>
                <InfoTooltip
                  theme={theme}
                  text="ONにすると「ご予約内容」欄に選択メニュー・オプションの合計所要時間を表示します"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const newValue = !(form.config?.reservation_summary?.show_total_duration === true);
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      reservation_summary: {
                        ...form.config?.reservation_summary,
                        show_total_duration: newValue
                      }
                    }
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  form.config?.reservation_summary?.show_total_duration === true
                    ? themeClasses.toggle.enabled
                    : themeClasses.toggle.disabled
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.config?.reservation_summary?.show_total_duration === true ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 同意事項 */}
            <div className={`pt-3 border-t ${themeClasses.divider} space-y-3`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                    同意事項
                  </label>
                  <InfoTooltip
                    theme={theme}
                    text={'ONにすると、予約フォームのご予約内容の下に同意事項テキストと「同意する」ボタンを表示します。\n\n「必須項目にする」をONにすると、「同意する」ボタンをタップしないと予約を送信できなくなります。'}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const current = form.config?.reservation_summary?.agreement;
                    onUpdate({
                      ...form,
                      config: {
                        ...form.config,
                        reservation_summary: {
                          ...form.config?.reservation_summary,
                          agreement: {
                            enabled: !(current?.enabled === true),
                            text: typeof current?.text === 'string' ? current.text : '',
                            required: current?.required === true,
                            hide_button: current?.hide_button === true
                          }
                        }
                      }
                    });
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                    form.config?.reservation_summary?.agreement?.enabled === true
                      ? themeClasses.toggle.enabled
                      : themeClasses.toggle.disabled
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      form.config?.reservation_summary?.agreement?.enabled === true ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {form.config?.reservation_summary?.agreement?.enabled === true && (
                <div className="space-y-3">
                  <div>
                    <label className={`block text-xs ${themeClasses.text.secondary} mb-1`}>同意事項テキスト</label>
                    <textarea
                      value={form.config?.reservation_summary?.agreement?.text || ''}
                      onChange={(e) => {
                        const current = form.config?.reservation_summary?.agreement;
                        onUpdate({
                          ...form,
                          config: {
                            ...form.config,
                            reservation_summary: {
                              ...form.config?.reservation_summary,
                              agreement: {
                                enabled: true,
                                text: e.target.value,
                                required: current?.required === true,
                                hide_button: current?.hide_button === true
                              }
                            }
                          }
                        });
                      }}
                      rows={4}
                      placeholder="例：キャンセルは前日までにご連絡ください。当日キャンセルはキャンセル料が発生する場合があります。"
                      className={`w-full ${themeClasses.input} text-sm`}
                    />
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.config?.reservation_summary?.agreement?.required === true}
                      onChange={(e) => {
                        const current = form.config?.reservation_summary?.agreement;
                        onUpdate({
                          ...form,
                          config: {
                            ...form.config,
                            reservation_summary: {
                              ...form.config?.reservation_summary,
                              agreement: {
                                enabled: true,
                                text: typeof current?.text === 'string' ? current.text : '',
                                required: e.target.checked,
                                hide_button: current?.hide_button === true
                              }
                            }
                          }
                        });
                      }}
                      className={`h-4 w-4 text-blue-600 focus:ring-blue-500 rounded ${
                        theme === 'light'
                          ? 'bg-gray-100 border-gray-300'
                          : 'bg-gray-700 border-gray-600'
                      }`}
                    />
                    <span className={`text-sm ${themeClasses.text.secondary}`}>
                      必須項目にする（「同意する」をタップしないと予約送信できません）
                    </span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.config?.reservation_summary?.agreement?.hide_button === true}
                      onChange={(e) => {
                        const current = form.config?.reservation_summary?.agreement;
                        onUpdate({
                          ...form,
                          config: {
                            ...form.config,
                            reservation_summary: {
                              ...form.config?.reservation_summary,
                              agreement: {
                                enabled: true,
                                text: typeof current?.text === 'string' ? current.text : '',
                                required: current?.required === true,
                                hide_button: e.target.checked
                              }
                            }
                          }
                        });
                      }}
                      className={`h-4 w-4 text-blue-600 focus:ring-blue-500 rounded ${
                        theme === 'light'
                          ? 'bg-gray-100 border-gray-300'
                          : 'bg-gray-700 border-gray-600'
                      }`}
                    />
                    <span className={`text-sm ${themeClasses.text.secondary}`}>
                      「同意する」ボタンを非表示にする（テキスト表示のみ）
                    </span>
                  </label>
                  {form.config?.reservation_summary?.agreement?.hide_button === true
                    && form.config?.reservation_summary?.agreement?.required === true && (
                    <p className={`text-xs ${theme === 'light' ? 'text-amber-600' : 'text-amber-400'}`}>
                      ※ ボタン非表示のため「必須項目にする」は動作しません（同意操作ができないため、送信ブロックは行われません）
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className={`${themeClasses.highlight} rounded-lg p-4`}>
              <h4 className={`text-sm font-medium mb-2 ${theme === 'light' ? 'text-[rgb(244,144,49)]' : 'text-cyan-300'}`}>現在の設定:</h4>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 合計金額: {form.config?.reservation_summary?.show_total_price === true ? '表示' : '非表示'}
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 合計時間: {form.config?.reservation_summary?.show_total_duration === true ? '表示' : '非表示'}
              </p>
              <p className={`text-sm ${theme === 'light' ? 'text-[rgb(220,125,35)]' : 'text-cyan-200'}`}>
                • 同意事項: {form.config?.reservation_summary?.agreement?.enabled === true
                  ? (form.config?.reservation_summary?.agreement?.hide_button === true
                    ? '表示（テキストのみ・ボタンなし）'
                    : form.config?.reservation_summary?.agreement?.required === true ? '表示（同意必須）' : '表示（任意）')
                  : '非表示'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 送信時の項目編集 */}
      <div className={themeClasses.card}>
        <div className="p-4">
          <div className="flex items-center space-x-2 mb-1">
            <svg className={`w-5 h-5 ${themeClasses.text.primary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <h3 className={`text-lg font-medium ${themeClasses.text.primary}`}>送信時の項目編集</h3>
          </div>
          <p className={`text-xs ${themeClasses.text.secondary} mb-1`}>
            「予約する」タップ時に公式LINEのトークへ送信されるテキストの項目ごとの表示 / 非表示を設定します。
          </p>
          <p className={`text-xs ${theme === 'light' ? 'text-amber-600' : 'text-amber-400'} mb-3`}>
            ※ 送信テキストの見た目だけの設定です。非表示にしても予約データの保存・Googleカレンダー登録・メール通知の内容は変わりません。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {([
              { key: 'name', label: '《お名前》' },
              { key: 'phone', label: '《電話番号》' },
              { key: 'visit_count', label: '《ご来店回数》' },
              { key: 'staff', label: '《担当スタッフ》' },
              { key: 'menu', label: '《メニュー》' },
              { key: 'options', label: '《オプション》' },
              { key: 'total_price', label: '《合計金額》' },
              { key: 'total_duration', label: '《合計時間》' },
              { key: 'datetime', label: '【希望日時】（希望日/第一〜第三希望日）' },
              { key: 'message', label: '《メッセージ》' },
              { key: 'gender', label: '《性別》' },
              { key: 'coupon', label: '《クーポン》' },
              { key: 'custom_fields', label: 'カスタム項目（追加した項目すべて）' },
            ] as Array<{ key: keyof NonNullable<Form['config']['line_message_items']>; label: string }>).map((item) => {
              const visible = form.config?.line_message_items?.[item.key] !== false;
              return (
                <div key={item.key} className="flex items-center justify-between gap-2">
                  <span className={`text-sm ${themeClasses.text.secondary}`}>{item.label}</span>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(e) => onUpdate({
                        ...form,
                        config: {
                          ...form.config,
                          line_message_items: {
                            ...form.config?.line_message_items,
                            [item.key]: e.target.checked
                          }
                        }
                      })}
                      className="sr-only"
                    />
                    <div className={`w-9 h-5 rounded-full transition-colors ${visible ? (theme === 'light' ? 'bg-[rgb(244,144,49)]' : 'bg-cyan-500') : (theme === 'light' ? 'bg-gray-300' : 'bg-gray-600')}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${visible ? 'translate-x-4' : 'translate-x-0'} mt-0.5 ml-0.5`}></div>
                    </div>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessRulesEditor;
