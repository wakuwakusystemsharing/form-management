'use client';

import React from 'react';
import type { ConditionalAdvanceRule } from '@/types/form';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import { InfoTooltip } from './MultipleDatesSettingsEditor';
import { describeAdvanceRule } from '@/lib/advance-rules';

/**
 * 条件付き予約受付開始時間設定の編集 UI（営業時間・ルールタブ / スタッフごとの希望日時設定で共用）
 * 各行: 「常に / 現在時刻が◯時以降 / 現在時刻が◯時より前 / ◯時〜◯時」の条件 → 「N 日後の ◯時から予約可能」
 */
interface Props {
  rules: ConditionalAdvanceRule[];
  onChange: (next: ConditionalAdvanceRule[]) => void;
  theme?: ThemeType;
  /** 見出しを出すか（スタッフの希望日時設定では行の見出しが別にあるので出さない） */
  showHeading?: boolean;
}

type CondKind = 'always' | 'from' | 'until' | 'between';

const newId = () => `car_${Math.random().toString(36).slice(2, 10)}`;

const ConditionalAdvanceRulesEditor: React.FC<Props> = ({ rules, onChange, theme = 'light', showHeading = true }) => {
  const themeClasses = getThemeClasses(theme);
  const update = (index: number, patch: Partial<ConditionalAdvanceRule>) => {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const condKind = (r: ConditionalAdvanceRule): CondKind =>
    r.from_time && r.until_time ? 'between' : r.from_time ? 'from' : r.until_time ? 'until' : 'always';
  const setCondKind = (index: number, kind: CondKind) => {
    const r = rules[index];
    const patch: Partial<ConditionalAdvanceRule> = {
      from_time: kind === 'from' || kind === 'between' ? (r.from_time || '15:00') : undefined,
      until_time: kind === 'until' || kind === 'between' ? (r.until_time || (kind === 'between' ? '23:59' : '15:00')) : undefined,
    };
    const next = { ...r, ...patch };
    if (!next.from_time) delete next.from_time;
    if (!next.until_time) delete next.until_time;
    onChange(rules.map((x, i) => (i === index ? next : x)));
  };

  return (
    <div className="space-y-2">
      {showHeading && (
        <div className="flex items-center gap-1.5">
          <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>条件付き予約受付開始時間設定</label>
          <InfoTooltip
            theme={theme}
            text={'「現在時刻が◯時以降なら N 日後の◯時から」のようなルールを追加します。\n予約受付開始日と合わせて、いちばん先になる条件が使われます。\n\n例1: 常に「2日後」の「09:30」から → 10/21 なら 10/23 09:30 以降だけ〇\n例2: 現在時刻が「15:00」以降なら「2日後」から → 15:00 までは翌日も予約でき、15:00 を過ぎると翌日は✕\n\nカレンダー表示・第三希望日時選択の両モードに適用されます。'}
          />
        </div>
      )}
      {rules.length === 0 && (
        <p className={`text-xs ${themeClasses.text.tertiary}`}>未設定（予約受付開始日・予約受付開始時間の設定どおり）</p>
      )}
      {rules.map((r, index) => (
        <div key={r.id} className={`rounded-lg p-3 space-y-2 ${theme === 'light' ? 'border border-gray-300 bg-gray-50' : 'border border-gray-700 bg-gray-900/50'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <select value={condKind(r)} onChange={(e) => setCondKind(index, e.target.value as CondKind)} className={`${themeClasses.input} w-auto`}>
              <option value="always">常に</option>
              <option value="from">現在時刻が ◯時 以降のとき</option>
              <option value="until">現在時刻が ◯時 より前のとき</option>
              <option value="between">現在時刻が ◯時〜◯時 のとき</option>
            </select>
            {(condKind(r) === 'from' || condKind(r) === 'between') && (
              <input type="time" value={r.from_time || ''} onChange={(e) => update(index, { from_time: e.target.value })} className={themeClasses.timeInput} aria-label="以降" />
            )}
            {condKind(r) === 'between' && <span className={`text-sm ${themeClasses.text.secondary}`}>〜</span>}
            {(condKind(r) === 'until' || condKind(r) === 'between') && (
              <input type="time" value={r.until_time || ''} onChange={(e) => update(index, { until_time: e.target.value })} className={themeClasses.timeInput} aria-label="より前" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm ${themeClasses.text.secondary}`}>→</span>
            <input
              type="number"
              min={0}
              max={365}
              value={r.min_days}
              onChange={(e) => { const v = parseInt(e.target.value, 10); update(index, { min_days: Number.isFinite(v) ? Math.min(Math.max(v, 0), 365) : 0 }); }}
              className={`${themeClasses.input} w-20`}
              aria-label="何日後"
            />
            <span className={`text-sm ${themeClasses.text.secondary}`}>日後の</span>
            <input
              type="time"
              value={r.start_time || ''}
              onChange={(e) => { const next = { ...r }; if (e.target.value) next.start_time = e.target.value; else delete next.start_time; onChange(rules.map((x, i) => (i === index ? next : x))); }}
              className={themeClasses.timeInput}
              aria-label="何時から"
            />
            <span className={`text-sm ${themeClasses.text.secondary}`}>から予約可能（時刻が空なら営業開始から）</span>
            <button
              type="button"
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
              className={`ml-auto p-1.5 rounded ${theme === 'light' ? 'text-gray-500 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-red-400 hover:bg-red-900/30'}`}
              title="削除"
              aria-label="ルールを削除"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
          <p className={`text-xs ${themeClasses.text.tertiary}`}>{describeAdvanceRule(r)}</p>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rules, { id: newId(), min_days: 2, start_time: '09:30' }])}
        className={`px-2 py-1 text-xs rounded-md ${themeClasses.button.secondary}`}
      >
        ＋ 条件を追加
      </button>
    </div>
  );
};

export default ConditionalAdvanceRulesEditor;
