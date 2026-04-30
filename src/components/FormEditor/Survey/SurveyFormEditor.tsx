'use client';

import React, { useState } from 'react';
import { SurveyForm, SurveyConfig } from '@/types/survey';
import SurveyQuestionEditor from './SurveyQuestionEditor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface SurveyFormEditorProps {
  form: SurveyForm;
  onUpdate: (form: SurveyForm) => void;
  userRole?: 'service_admin' | 'store_admin';
}

export default function SurveyFormEditor({ form, onUpdate, userRole = 'service_admin' }: SurveyFormEditorProps) {
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
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'basic' | 'questions')} className="flex flex-col h-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="basic">基本情報</TabsTrigger>
          <TabsTrigger value="questions">質問項目</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="flex-1 overflow-y-auto mt-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="survey_title">
                フォーム名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="survey_title"
                type="text"
                value={form.config.basic_info.title}
                onChange={(e) => handleBasicInfoUpdate({ title: e.target.value })}
                placeholder="例：来店アンケート"
                required
              />
            </div>
            
            {/* システム管理者のみ表示 */}
            {userRole === 'service_admin' && (
              <div className="space-y-2">
                <Label htmlFor="survey_liff_id">
                  LIFF ID <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="survey_liff_id"
                  type="text"
                  value={form.config.basic_info.liff_id}
                  onChange={(e) => handleBasicInfoUpdate({ liff_id: e.target.value })}
                  placeholder="例：1234567890-abcdefgh"
                  required
                />
                <p className="text-xs text-muted-foreground">LINE Developersで作成したLIFF ID</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="survey_theme_color">テーマカラー</Label>
              <div className="flex items-center space-x-3">
                <Input
                  id="survey_theme_color"
                  type="color"
                  value={form.config.basic_info.theme_color}
                  onChange={(e) => handleBasicInfoUpdate({ theme_color: e.target.value })}
                  className="w-20 h-10 rounded-md cursor-pointer border"
                />
                <Input
                  type="text"
                  value={form.config.basic_info.theme_color}
                  onChange={(e) => handleBasicInfoUpdate({ theme_color: e.target.value })}
                  className="flex-1"
                  placeholder="#3B82F6"
                />
              </div>
              <p className="text-xs text-muted-foreground">フォームのメインカラー</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="submit_button_text">送信ボタンのテキスト</Label>
              <Input
                id="submit_button_text"
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
                placeholder="送信"
              />
            </div>

            {/* LIFF 2 通目メッセージ */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="survey_second_message_enabled">送信時に 2 通目のメッセージを送る</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ON にすると、フォーム送信時にこの短いテキストが LINE トークに追加で送信されます。
                  </p>
                </div>
                <button
                  id="survey_second_message_enabled"
                  type="button"
                  role="switch"
                  aria-checked={form.config.basic_info?.second_message?.enabled === true}
                  onClick={() => {
                    const current = form.config.basic_info?.second_message;
                    handleBasicInfoUpdate({
                      second_message: {
                        enabled: !(current?.enabled === true),
                        text: typeof current?.text === 'string' ? current.text : '',
                      },
                    });
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                    form.config.basic_info?.second_message?.enabled === true ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      form.config.basic_info?.second_message?.enabled === true ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <Input
                id="survey_second_message_text"
                type="text"
                value={form.config.basic_info?.second_message?.text || ''}
                disabled={!(form.config.basic_info?.second_message?.enabled === true)}
                onChange={(e) => {
                  const current = form.config.basic_info?.second_message;
                  handleBasicInfoUpdate({
                    second_message: {
                      enabled: current?.enabled === true,
                      text: e.target.value,
                    },
                  });
                }}
                placeholder="例: アンケート回答"
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="questions" className="flex-1 overflow-y-auto mt-6">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
