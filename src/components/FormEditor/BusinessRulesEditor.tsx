'use client';

import React, { useState } from 'react';
import { Form, BusinessHours } from '@/types/form';
import { getThemeClasses, ThemeType } from './FormEditorTheme';

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

  const [expandedSections, setExpandedSections] = useState({
    businessHours: true,
    bookingRules: true
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

  const toggleSection = (section: 'businessHours' | 'bookingRules') => {
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
                  <div className="flex items-center space-x-4">
                    <div className={`w-16 text-sm font-medium ${themeClasses.text.secondary}`}>
                      {label}
                    </div>
                    
                    <label className="flex items-center space-x-2">
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
                      <>
                        <input
                          type="time"
                          value={businessHours[day]?.open || '09:00'}
                          onChange={(e) => handleBusinessHoursChange(day, 'open', e.target.value)}
                          className={themeClasses.input}
                        />
                        <span className={`text-sm ${themeClasses.text.secondary}`}>〜</span>
                        <input
                          type="time"
                          value={businessHours[day]?.close || '18:00'}
                          onChange={(e) => handleBusinessHoursChange(day, 'close', e.target.value)}
                          className={themeClasses.input}
                        />
                      </>
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
        </button>

        {expandedSections.bookingRules && (
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
