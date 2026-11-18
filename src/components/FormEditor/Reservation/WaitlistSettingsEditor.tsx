'use client';

import React, { useState } from 'react';
import { Form } from '@/types/form';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import { InfoTooltip } from './MultipleDatesSettingsEditor';
import {
  WAITLIST_DEADLINE_OPTIONS,
  WAITLIST_KEYWORD,
  WAITLIST_MAX_PER_USER_LIMIT,
  resolveWaitlistSettings,
  type WaitlistSettings,
} from '@/lib/waitlist';

/**
 * 営業時間・ルール → 「空き待ち（キャンセル待ち）設定」。
 * 満席（✕）の時間にお客様が空き待ちを登録でき、空きが出たら LINE で知らせる機能の ON / OFF と設定。
 * 既定は OFF。LINE フォーム × カレンダー表示モードのときだけ使える
 */
const WaitlistSettingsEditor: React.FC<{
  form: Form;
  onUpdate: (form: Form) => void;
  theme?: ThemeType;
}> = ({ form, onUpdate, theme = 'dark' }) => {
  const themeClasses = getThemeClasses(theme);
  const [open, setOpen] = useState(false);
  const cs = form.config?.calendar_settings;
  const settings = resolveWaitlistSettings(cs);
  const isWeb = (form.config as { form_type?: string } | undefined)?.form_type === 'web';
  const isCalendarMode = (cs?.booking_mode || 'calendar') === 'calendar';
  const usable = !isWeb && isCalendarMode;

  const update = (patch: Partial<WaitlistSettings>) => {
    onUpdate({
      ...form,
      config: {
        ...form.config,
        calendar_settings: {
          ...form.config?.calendar_settings,
          waitlist: { ...settings, ...patch },
        },
      },
    });
  };

  return (
    <div className={themeClasses.card} data-slot="waitlist-settings">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between p-4 text-left transition-colors ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
      >
        <div className="flex items-center space-x-2">
          <svg className={`w-5 h-5 ${themeClasses.text.primary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
          </svg>
          <h3 className={`text-lg font-medium ${themeClasses.text.primary}`}>空き待ち（キャンセル待ち）設定</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${settings.enabled && usable ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
            {settings.enabled && usable ? 'ON' : 'OFF'}
          </span>
        </div>
        <svg className={`w-5 h-5 ${themeClasses.text.secondary} transform transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className={`p-4 border-t ${themeClasses.divider} space-y-5`}>
          <p className={`text-xs ${themeClasses.text.secondary}`}>
            予約カレンダーの満席（✕）の時間に、お客様が「空き待ち」を登録できるようにします。キャンセルや日時変更でその時間が空くと、登録した方全員に
            LINE でお知らせし、先に予約した方で枠が埋まります。埋まったら、予約しなかった方へ「埋まりました」と自動でお知らせします（空き待ちは続きます）。
          </p>

          {!usable && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              {isWeb
                ? '空き待ちは LINE の予約フォームだけで使えます（Web 予約フォームでは使えません）。'
                : '空き待ちは、日時選択モードが「Googleカレンダー連携」のときだけ使えます。'}
            </p>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>空き待ちを受け付ける</label>
                <InfoTooltip
                  theme={theme}
                  text={'ONにすると、予約フォームのカレンダーで満席（✕）の時間をタップして空き待ちを登録できます。\n・空きが出ると登録者全員に LINE でお知らせします（先着順）。\n・お知らせの送信は、公式 LINE の月間の送信数（通数）を使います。\n・ON / OFF を変えたあとは「保存＆デプロイ」が必要です。'}
                />
              </div>
              <button
                type="button"
                data-testid="waitlist-enabled"
                disabled={!usable}
                onClick={() => update({ enabled: !settings.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.enabled && usable ? themeClasses.toggle.enabled : themeClasses.toggle.disabled
                } ${usable ? '' : 'opacity-50 cursor-not-allowed'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.enabled && usable ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <p className={`text-xs ${themeClasses.text.tertiary}`}>
              {settings.enabled && usable
                ? `お客様は満席（✕）の時間をタップして空き待ちを登録できます。公式 LINE で「${WAITLIST_KEYWORD}」と送ると、登録中の空き待ちの確認・取り消しができます。`
                : '空き待ちは受け付けません（満席の時間はこれまでどおり選べないだけです）。'}
            </p>
          </div>

          {settings.enabled && usable && (
            <>
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>1 人が同時に登録できる件数</label>
                  <InfoTooltip theme={theme} text={'1 人のお客様が同時に登録しておける空き待ちの数です。上限に達すると、取り消すか、日時が過ぎるまで新しく登録できません。'} />
                </div>
                <select
                  data-testid="waitlist-max-per-user"
                  value={settings.max_per_user}
                  onChange={(e) => update({ max_per_user: parseInt(e.target.value, 10) || 1 })}
                  className={themeClasses.input}
                >
                  {Array.from({ length: WAITLIST_MAX_PER_USER_LIMIT }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n} 件まで</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>受付締切</label>
                  <InfoTooltip
                    theme={theme}
                    text={'ご希望日時の何時間前まで、空き待ちの登録と空きのお知らせを行うかを設定します。\n締切を過ぎてから空いた枠は、お知らせしません。\n「予約受付開始時間」などで予約できない時間になった枠も、お知らせしません。'}
                  />
                </div>
                <select
                  data-testid="waitlist-deadline-hours"
                  value={settings.deadline_hours}
                  onChange={(e) => update({ deadline_hours: parseInt(e.target.value, 10) || 0 })}
                  className={themeClasses.input}
                >
                  {WAITLIST_DEADLINE_OPTIONS.map((h) => (
                    <option key={h} value={h}>{h === 0 ? 'ご希望の時刻まで' : `ご希望日時の ${h} 時間前まで`}</option>
                  ))}
                  {!WAITLIST_DEADLINE_OPTIONS.includes(settings.deadline_hours as (typeof WAITLIST_DEADLINE_OPTIONS)[number]) && (
                    <option value={settings.deadline_hours}>ご希望日時の {settings.deadline_hours} 時間前まで</option>
                  )}
                </select>
              </div>

              <ul className={`text-xs ${themeClasses.text.tertiary} list-disc pl-5 space-y-1`}>
                <li>登録した空き待ちは、店舗ページの予約一覧にある「空き待ち」で確認・取り消しができます。</li>
                <li>空きの確認は、予約のキャンセル・日時変更の直後と、10 分おきに自動で行います（Google カレンダーの予定を直接消したときも 10 分以内にお知らせします）。</li>
                <li>ご希望の日時を過ぎた空き待ちは自動で終了します。</li>
                <li>リッチメニューに「{WAITLIST_KEYWORD}」と送るボタンを置くと、お客様が確認しやすくなります。</li>
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default WaitlistSettingsEditor;
