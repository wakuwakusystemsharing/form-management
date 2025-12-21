import React, { useState } from 'react';
import { SurveyForm, SurveyConfig } from '@/types/survey';
import SurveyQuestionEditor from './SurveyQuestionEditor';

interface SurveyFormEditorProps {
  form: SurveyForm;
  onUpdate: (form: SurveyForm) => void;
}

export default function SurveyFormEditor({ form, onUpdate }: SurveyFormEditorProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'questions'>('basic');

  const handleBasicInfoUpdate = (updates: Partial<SurveyConfig['basic_info']>) => {
    onUpdate({
      ...form,
      config: {
        ...form.config,
        basic_info: {
          ...form.config.basic_info,
          ...updates
        }
      }
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* タブナビゲーション */}
      <div className="flex border-b border-gray-700 mb-6">
        <button
          onClick={() => setActiveTab('basic')}
          className={`px-4 py-2 font-medium text-sm transition-colors ${
            activeTab === 'basic'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          基本情報
        </button>
        <button
          onClick={() => setActiveTab('questions')}
          className={`px-4 py-2 font-medium text-sm transition-colors ${
            activeTab === 'questions'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          質問項目
        </button>
      </div>

      {/* コンテンツエリア */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'basic' && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                フォーム名 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.config.basic_info.title}
                onChange={(e) => handleBasicInfoUpdate({ title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-600 rounded-md bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                LIFF ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.config.basic_info.liff_id}
                onChange={(e) => handleBasicInfoUpdate({ liff_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-600 rounded-md bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                テーマカラー
              </label>
              <div className="flex items-center space-x-3">
                <input
                  type="color"
                  value={form.config.basic_info.theme_color}
                  onChange={(e) => handleBasicInfoUpdate({ theme_color: e.target.value })}
                  className="w-20 h-10 border border-gray-600 rounded cursor-pointer"
                />
                <span className="text-gray-400 text-sm">{form.config.basic_info.theme_color}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                送信ボタンのテキスト
              </label>
              <input
                type="text"
                value={form.config.ui_settings.submit_button_text}
                onChange={(e) => onUpdate({
                  ...form,
                  config: {
                    ...form.config,
                    ui_settings: {
                      ...form.config.ui_settings,
                      submit_button_text: e.target.value
                    }
                  }
                })}
                className="w-full px-3 py-2 border border-gray-600 rounded-md bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {activeTab === 'questions' && (
          <SurveyQuestionEditor
            questions={form.config.questions}
            onChange={(questions) => onUpdate({
              ...form,
              config: {
                ...form.config,
                questions
              }
            })}
          />
        )}
      </div>
    </div>
  );
}
