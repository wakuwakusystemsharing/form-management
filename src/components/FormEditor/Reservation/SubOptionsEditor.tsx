'use client';

/**
 * オプションのオプション（追加のオプション）の編集欄
 * オプション編集（メニューオプション）とカテゴリー共通オプションの編集モーダルで、「追加質問」の上に出す。
 * 純粋ロジックは src/lib/sub-options.ts
 */
import React from 'react';
import type { MenuSubOption } from '@/types/form';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import { DEFAULT_SUB_OPTIONS_LABEL, newSubOption, SUB_OPTION_NAME_MAX, SUB_OPTIONS_LABEL_MAX, SUB_OPTIONS_MAX, type SubOptionsEditorValue } from '@/lib/sub-options';

export type SubOptionsValue = SubOptionsEditorValue;

interface Props {
  value: SubOptionsValue;
  onChange: (value: SubOptionsValue) => void;
  theme?: ThemeType;
}

const digits = (v: string): number => {
  const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

export default function SubOptionsEditor({ value, onChange, theme = 'dark' }: Props) {
  const themeClasses = getThemeClasses(theme);
  const list = value.sub_options;
  const set = (patch: Partial<SubOptionsValue>) => onChange({ ...value, ...patch });
  const update = (id: string, patch: Partial<MenuSubOption>) => set({ sub_options: list.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    [next[index], next[to]] = [next[to], next[index]];
    set({ sub_options: next });
  };
  const input = `px-2 py-1.5 rounded-md text-sm ${themeClasses.input}`;

  return (
    <div className="space-y-3" data-slot="sub-options-editor">
      <div className="flex items-center justify-between gap-2">
        <h4 className={`text-md font-medium ${themeClasses.text.primary} border-b ${themeClasses.divider} pb-2 flex-1`}>
          オプションのオプション{list.length > 0 ? `（${list.length}）` : ''}
        </h4>
        <button
          type="button"
          onClick={() => set({ sub_options: [...list, newSubOption()] })}
          disabled={list.length >= SUB_OPTIONS_MAX}
          className={`px-3 py-1 text-sm rounded-md disabled:opacity-40 ${themeClasses.button.primary}`}
        >
          追加
        </button>
      </div>
      <p className={`text-xs ${themeClasses.text.tertiary}`}>
        このオプションを選んだお客様に、さらに選んでもらう項目です（例: ヘッドスパ → 15分 / 30分）。フォームではこのオプションのすぐ下に表示され、料金と所要時間は合計に足されます。
      </p>

      {list.length === 0 ? (
        <p className={`text-xs text-center py-3 rounded ${themeClasses.emptyState}`}>まだありません。「追加」から作れます</p>
      ) : (
        <>
          <div className="space-y-2">
            {list.map((sub, i) => (
              <div key={sub.id} className={`space-y-2 rounded-md p-2 ${themeClasses.card}`} data-slot="sub-option-row">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={sub.name}
                    maxLength={SUB_OPTION_NAME_MAX}
                    onChange={(e) => update(sub.id, { name: e.target.value })}
                    placeholder="名前（例: 30分コース）"
                    className={`flex-1 min-w-0 ${input}`}
                  />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={`h-8 w-7 rounded disabled:opacity-30 ${themeClasses.button.secondary}`} title="上へ">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className={`h-8 w-7 rounded disabled:opacity-30 ${themeClasses.button.secondary}`} title="下へ">↓</button>
                  <button type="button" onClick={() => set({ sub_options: list.filter((s) => s.id !== sub.id) })} className={`h-8 px-2 rounded text-xs ${themeClasses.button.delete}`}>削除</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`text-xs ${themeClasses.text.secondary}`}>
                    料金（円）
                    <input type="text" inputMode="numeric" value={sub.price ? String(sub.price) : ''} onChange={(e) => update(sub.id, { price: digits(e.target.value) })} placeholder="0" className={`mt-0.5 w-full ${input}`} />
                  </label>
                  <label className={`text-xs ${themeClasses.text.secondary}`}>
                    所要時間（分）
                    <input type="text" inputMode="numeric" value={sub.duration ? String(sub.duration) : ''} onChange={(e) => update(sub.id, { duration: digits(e.target.value) })} placeholder="0" className={`mt-0.5 w-full ${input}`} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <label className={`flex items-center gap-1 text-xs ${themeClasses.text.secondary}`}>
                    <input type="checkbox" checked={sub.hide_price === true} onChange={(e) => update(sub.id, { hide_price: e.target.checked || undefined })} />
                    料金を非表示
                  </label>
                  <label className={`flex items-center gap-1 text-xs ${themeClasses.text.secondary}`}>
                    <input type="checkbox" checked={sub.hide_duration === true} onChange={(e) => update(sub.id, { hide_duration: e.target.checked || undefined })} />
                    所要時間を非表示
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className={`space-y-2 rounded-md p-2 ${themeClasses.card}`}>
            <label className={`block text-xs ${themeClasses.text.secondary}`}>
              選べる数
              <select value={value.sub_options_mode} onChange={(e) => set({ sub_options_mode: e.target.value === 'single' ? 'single' : 'multiple' })} className={`mt-0.5 w-full px-2 py-1.5 rounded-md text-sm ${themeClasses.select}`}>
                <option value="multiple">複数選べる</option>
                <option value="single">1 つだけ選べる（別のものを選ぶと切り替わる）</option>
              </select>
            </label>
            <label className={`flex items-start gap-2 text-sm ${themeClasses.text.primary}`}>
              <input type="checkbox" className="mt-1" checked={value.sub_options_required} onChange={(e) => set({ sub_options_required: e.target.checked })} />
              <span>
                必須にする
                <span className={`block text-xs ${themeClasses.text.tertiary}`}>このオプションを選んだお客様は、上の項目から 1 つ以上選ばないと予約できません</span>
              </span>
            </label>
            <label className={`block text-xs ${themeClasses.text.secondary}`}>
              見出し（任意。空なら「{DEFAULT_SUB_OPTIONS_LABEL}」）
              <input type="text" value={value.sub_options_label} maxLength={SUB_OPTIONS_LABEL_MAX} onChange={(e) => set({ sub_options_label: e.target.value })} placeholder={`例: コースの長さ`} className={`mt-0.5 w-full ${input}`} />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
