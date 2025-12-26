'use client';

import React, { useState } from 'react';
import { Form, BusinessHours } from '@/types/form';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';

interface BusinessRulesEditorProps {
  form: Form;
  onUpdate: (form: Form) => void;
  theme?: ThemeType;
}

const BusinessRulesEditor: React.FC<BusinessRulesEditorProps> = ({ form, onUpdate, theme = 'dark' }) => {
  const themeClasses = getThemeClasses(theme);
  
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

  const [bookingMode, setBookingMode] = useState<'calendar' | 'multiple_dates'>(
    form.config?.calendar_settings?.booking_mode || 'calendar'
  );

  const [multipleDatesSettings, setMultipleDatesSettings] = useState<{
    time_interval: 15 | 30 | 60;
    date_range_days: number;
    exclude_weekdays: number[];
    start_time: string;
    end_time: string;
  }>(
    form.config?.calendar_settings?.multiple_dates_settings || {
      time_interval: 30,
      date_range_days: 30,
      exclude_weekdays: [0],
      start_time: '09:00',
      end_time: '18:00'
    }
  );

  const [expandedSections, setExpandedSections] = useState({
    businessHours: true,
    bookingRules: true,
    dateTimeMode: true
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

  const toggleSection = (section: 'businessHours' | 'bookingRules' | 'dateTimeMode') => {
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

      {/* 営業時間設定 */}
      <div className={themeClasses.card}>
        <button
          onClick={() => toggleSection('businessHours')}
          className={`w-full flex items-center justify-between p-4 text-left transition-colors ${
            theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'
          }`}
        >
          <div className="flex items-center space-x-2">
            <svg className={`w-5 h-5 ${themeClasses.text.primary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className={`text-lg font-medium ${themeClasses.text.primary}`}>営業時間設定</h3>
          </div>
          <svg 
            className={`w-5 h-5 ${themeClasses.text.secondary} transform transition-transform ${expandedSections.businessHours ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {expandedSections.businessHours && (
          <div className={`p-4 border-t ${themeClasses.divider}`}>
            {/* 曜日別設定 */}
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
                        className={`rounded text-cyan-600 focus:ring-cyan-500 ${
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
        )}
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
                    className="text-cyan-600 focus:ring-cyan-500"
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
                    className="text-cyan-600 focus:ring-cyan-500"
                  />
                  <div>
                    <div className={`font-medium ${themeClasses.text.primary}`}>第三希望日時選択</div>
                    <div className={`text-sm ${themeClasses.text.secondary}`}>第一〜第三希望日時を選択（Google Calendar連携なし）</div>
                  </div>
                </label>
              </div>
            </div>

            {/* 第三希望日時モード用設定 */}
            {bookingMode === 'multiple_dates' && (
              <div className={`rounded-lg p-4 ${theme === 'light' ? 'bg-blue-50 border border-blue-200' : 'bg-blue-900/20 border border-blue-700'}`}>
                <h4 className={`text-sm font-medium mb-4 ${theme === 'light' ? 'text-blue-700' : 'text-blue-300'}`}>第三希望日時モード設定</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 時間間隔 */}
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>
                      時間間隔
                    </label>
                    <select
                      value={multipleDatesSettings.time_interval}
                      onChange={(e) => handleMultipleDatesSettingsChange('time_interval', parseInt(e.target.value) as 15 | 30 | 60)}
                      className={themeClasses.input}
                    >
                      <option value={15}>15分間隔</option>
                      <option value={30}>30分間隔</option>
                      <option value={60}>60分間隔</option>
                    </select>
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

                  {/* 開始時間 */}
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>
                      開始時間
                    </label>
                    <input
                      type="time"
                      value={multipleDatesSettings.start_time}
                      onChange={(e) => handleMultipleDatesSettingsChange('start_time', e.target.value)}
                      className={themeClasses.timeInput}
                    />
                  </div>

                  {/* 終了時間 */}
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>
                      終了時間
                    </label>
                    <input
                      type="time"
                      value={multipleDatesSettings.end_time}
                      onChange={(e) => handleMultipleDatesSettingsChange('end_time', e.target.value)}
                      className={themeClasses.timeInput}
                    />
                  </div>
                </div>

                {/* 除外曜日 */}
                <div className="mt-4">
                  <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>
                    除外曜日（定休日）
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {weekdayLabels.map((day, index) => (
                      <label key={index} className="flex items-center space-x-1">
                        <input
                          type="checkbox"
                          checked={multipleDatesSettings.exclude_weekdays.includes(index)}
                          onChange={(e) => {
                            const currentExcluded = [...multipleDatesSettings.exclude_weekdays];
                            if (e.target.checked) {
                              currentExcluded.push(index);
                            } else {
                              const idx = currentExcluded.indexOf(index);
                              if (idx > -1) currentExcluded.splice(idx, 1);
                            }
                            handleMultipleDatesSettingsChange('exclude_weekdays', currentExcluded);
                          }}
                          className="text-cyan-600 focus:ring-cyan-500"
                        />
                        <span className={`text-sm ${themeClasses.text.secondary}`}>{day}</span>
                      </label>
                    ))}
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
              <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-2`}>
                事前予約可能日数
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={advanceBookingDays}
                onChange={(e) => handleAdvanceBookingDaysChange(parseInt(e.target.value) || 30)}
                className={themeClasses.input}
              />
              <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>何日先まで予約を受け付けるか</p>
            </div>
            
            <div className={`${themeClasses.highlight} rounded-lg p-4`}>
              <h4 className={`text-sm font-medium mb-2 ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-300'}`}>現在の設定:</h4>
              <p className={`text-sm ${theme === 'light' ? 'text-cyan-600' : 'text-cyan-200'}`}>
                • 事前予約: {advanceBookingDays}日先まで
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BusinessRulesEditor;
