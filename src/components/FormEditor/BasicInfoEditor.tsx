'use client';

import React from 'react';
import { Form } from '@/types/form';
import { getThemeClasses, ThemeType } from './FormEditorTheme';

interface BasicInfoEditorProps {
  form: Form;
  onUpdate: (form: Form) => void;
  theme?: ThemeType;
  userRole?: 'service_admin' | 'store_admin';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const BasicInfoEditor: React.FC<BasicInfoEditorProps> = ({ 
  form, 
  onUpdate, 
  theme = 'dark',
  userRole = 'service_admin'
}) => {
  const themeClasses = getThemeClasses(theme);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <svg className={`w-6 h-6 ${themeClasses.text.secondary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <h2 className={`text-xl font-semibold ${themeClasses.text.primary}`}>基本情報</h2>
      </div>

      <div>
        <label className={`block text-sm ${themeClasses.label} mb-2`}>
          フォーム名 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={(form as any).form_name || form.config?.basic_info?.form_name || ''}
          onChange={(e) => {
            if ((form as any).form_name !== undefined) {
              // 新形式
              onUpdate({
                ...form,
                form_name: e.target.value
              } as any);
            } else {
              // 旧形式
              onUpdate({
                ...form,
                config: {
                  ...form.config,
                  basic_info: {
                    ...form.config?.basic_info,
                    form_name: e.target.value
                  }
                }
              });
            }
          }}
          className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
          placeholder="例：ヘアサロン予約フォーム"
          required
        />
      </div>

      <div>
        <label className={`block text-sm ${themeClasses.label} mb-2`}>
          店舗名 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={(form as any).store_name || form.config?.basic_info?.store_name || ''}
          onChange={(e) => {
            if ((form as any).store_name !== undefined) {
              // 新形式
              onUpdate({
                ...form,
                store_name: e.target.value
              } as any);
            } else {
              // 旧形式
              onUpdate({
                ...form,
                config: {
                  ...form.config,
                  basic_info: {
                    ...form.config?.basic_info,
                    store_name: e.target.value
                  }
                }
              });
            }
          }}
          className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
          placeholder="例：サロン ド ビューティー"
          required
        />
      </div>

      {/* システム管理者のみ表示 */}
      {userRole === 'service_admin' && (
        <>
          <div>
            <label className={`block text-sm ${themeClasses.label} mb-2`}>
              LINE LIFF ID <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={(form as any).liff_id || form.config?.basic_info?.liff_id || ''}
              onChange={(e) => {
                if ((form as any).liff_id !== undefined) {
                  // 新形式
                  onUpdate({
                    ...form,
                    liff_id: e.target.value
                  } as any);
                } else {
                  // 旧形式
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      basic_info: {
                        ...form.config?.basic_info,
                        liff_id: e.target.value
                      }
                    }
                  });
                }
              }}
              className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
              placeholder="例：1234567890-abcdefgh"
              required
            />
            <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>LINE Developersで作成したLIFF ID</p>
          </div>

          <div>
            <label className={`block text-sm ${themeClasses.label} mb-2`}>
              Google App Script エンドポイント <span className="text-red-400">*</span>
            </label>
            <input
              type="url"
              value={form.config?.gas_endpoint || ''}
              onChange={(e) => {
                onUpdate({
                  ...form,
                  config: {
                    ...form.config,
                    gas_endpoint: e.target.value
                  }
                });
              }}
              className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
              placeholder="例：https://script.google.com/macros/s/xxx/exec"
              required
            />
            <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>予約データ送信用のGASエンドポイント</p>
          </div>
        </>
      )}

      <div>
        <label className={`block text-sm ${themeClasses.label} mb-2`}>
          テーマカラー
        </label>
        <div className="flex items-center space-x-3">
          <input
            type="color"
            value={form.config?.basic_info?.theme_color || '#3B82F6'}
            onChange={(e) => {
              onUpdate({
                ...form,
                config: {
                  ...form.config,
                  basic_info: {
                    ...form.config?.basic_info,
                    theme_color: e.target.value
                  }
                }
              });
            }}
            className={`w-20 h-10 rounded-md cursor-pointer ${theme === 'dark' ? 'border border-gray-500' : 'border border-gray-300'}`}
          />
          <span className={`text-sm ${themeClasses.text.secondary}`}>フォームのメインカラー</span>
        </div>
      </div>

      {/* システム管理者のみ表示 */}
      {userRole === 'service_admin' && (
        <div>
          <label className={`block text-sm ${themeClasses.label} mb-2`}>
            公開ステータス
          </label>
          <select
            value={form.status}
            onChange={(e) => onUpdate({
              ...form,
              status: e.target.value as 'active' | 'inactive'
            })}
            className={`w-full px-3 py-2 rounded-md ${themeClasses.select}`}
          >
            <option value="inactive">非公開（下書き）</option>
            <option value="active">公開中</option>
          </select>
          <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>
            {form.status === 'active' ? '顧客がフォームにアクセス可能です' : 'フォームは非公開です（管理者のみ確認可能）'}
          </p>
        </div>
      )}
    </div>
  );
};

export default BasicInfoEditor;
