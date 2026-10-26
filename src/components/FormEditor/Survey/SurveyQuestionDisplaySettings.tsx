'use client';

import React, { useState } from 'react';
import type { SurveyQuestion } from '@/types/survey';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';
import {
  SURVEY_IMAGE_POSITION_OPTIONS,
  decodeTriggerKey,
  encodeTriggerKey,
  isSurveyChoiceQuestion,
  listSurveyTriggerChoices,
} from '@/lib/survey-visibility';

interface Props {
  question: SurveyQuestion;
  index: number;
  questions: SurveyQuestion[];
  /** 画像アップロード先の店舗 ID */
  storeId: string;
  onChange: (patch: Partial<SurveyQuestion>) => void;
}

type Trigger = NonNullable<SurveyQuestion['show_triggers']>[number];

/**
 * 質問ごとの「画像（上 / 間 / 下）」と「フォームを開いたときは非表示 + 表示トリガー」の設定
 * （予約フォームのカスタム項目と同じ考え方。純粋ロジックは src/lib/survey-visibility.ts）
 */
export default function SurveyQuestionDisplaySettings({ question: q, index, questions, storeId, onChange }: Props) {
  const [uploading, setUploading] = useState(false);

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('storeId', storeId);
      formData.append('menuId', `survey_q_${q.id}`);
      if (q.image_url) formData.append('oldImageUrl', q.image_url);
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: formData, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`アップロードに失敗しました: ${json.error || ''}`);
        return;
      }
      onChange({ image_url: json.url });
    } catch (e) {
      console.error('Survey question image upload error:', e);
      alert('アップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  };

  // トリガー元にできる質問（自分以外の 単一選択 / 複数選択 / ドロップダウン）
  const triggerSources = questions
    .map((x, i) => ({ id: x.id, label: `Q${i + 1}. ${x.title || '（無題）'}`, question: x }))
    .filter((s) => s.id !== q.id && isSurveyChoiceQuestion(s.question));
  const triggers: Trigger[] = q.show_triggers || [];
  const mode = q.show_triggers_mode === 'all' ? 'all' : 'any';

  const updateTrigger = (ti: number, patch: Partial<Trigger>) => {
    const next = triggers.map((t, i) => (i === ti ? { ...t, ...patch } : t));
    onChange({ show_triggers: next });
  };
  const removeTrigger = (ti: number) => onChange({ show_triggers: triggers.filter((_, i) => i !== ti) });

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
      {/* 画像 */}
      <div className="space-y-2">
        <Label className="text-sm">画像（任意）</Label>
        {q.image_url ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.image_url} alt="" className="h-16 w-auto rounded border" />
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onChange({ image_url: undefined })}>
              画像を削除
            </Button>
          </div>
        ) : (
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadImage(file);
              e.target.value = '';
            }}
          />
        )}
        {uploading && <p className="text-xs text-muted-foreground">アップロード中...</p>}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">表示位置</span>
          <Select value={q.image_position || 'above'} onValueChange={(v) => onChange({ image_position: v as SurveyQuestion['image_position'] })}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SURVEY_IMAGE_POSITION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* フォームを開いたときは非表示 + 表示トリガー */}
      <div className="space-y-2 border-t border-border/60 pt-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`hidden-${index}`}
            checked={q.hidden_by_default === true}
            onCheckedChange={(checked) => onChange({
              hidden_by_default: checked === true,
              show_triggers: checked === true ? (q.show_triggers || []) : undefined,
              show_triggers_mode: checked === true ? q.show_triggers_mode : undefined,
            })}
          />
          <Label htmlFor={`hidden-${index}`} className="cursor-pointer">フォームを開いたときは非表示にする</Label>
        </div>
        {q.hidden_by_default === true && (
          <div className="space-y-2 pl-6">
            <p className="text-xs text-muted-foreground">
              何をトリガーにして表示しますか？ 非表示の間は必須チェック・回答・タグ付与の対象になりません。トリガー元の質問が非表示のときは成立しません。
            </p>
            {triggers.map((t, ti) => {
              const src = questions.find((x) => x.id === t.question_id);
              const choices = src ? listSurveyTriggerChoices(src) : [];
              const key = encodeTriggerKey(t.path, t.value);
              const keyValid = choices.some((c) => c.key === key);
              return (
                <div key={ti} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={t.question_id || ''}
                    onValueChange={(v) => updateTrigger(ti, { question_id: v, path: undefined, value: '' })}
                  >
                    <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="質問を選択" /></SelectTrigger>
                    <SelectContent>
                      {triggerSources.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs">で</span>
                  <Select
                    value={keyValid ? key : ''}
                    onValueChange={(v) => {
                      const d = decodeTriggerKey(v);
                      if (d) updateTrigger(ti, { path: d.path.length > 0 ? d.path : undefined, value: d.value });
                    }}
                  >
                    <SelectTrigger className="h-8 w-64 text-xs"><SelectValue placeholder="選択肢を選択" /></SelectTrigger>
                    <SelectContent>
                      {choices.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs">が選ばれたら表示</span>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => removeTrigger(ti)} aria-label="トリガーを削除">
                    <X className="h-4 w-4" />
                  </Button>
                  {src && choices.length === 0 && (
                    <span className="w-full text-[10px] text-amber-600">この質問には選択肢がまだありません</span>
                  )}
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={triggerSources.length === 0}
              onClick={() => onChange({ show_triggers: [...triggers, { question_id: triggerSources[0]?.id || '', value: '' }] })}
            >
              + トリガーを追加
            </Button>
            {triggerSources.length === 0 && (
              <p className="text-[10px] text-amber-600">トリガーにできる質問（単一選択 / 複数選択 / ドロップダウン）がありません</p>
            )}
            {triggers.length === 0 && triggerSources.length > 0 && (
              <p className="text-[10px] text-amber-600">トリガーが未設定のため、この質問はフォーム上で常に非表示になります</p>
            )}
            {triggers.length >= 2 && (
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name={`trigger-mode-${q.id}`} checked={mode === 'any'} onChange={() => onChange({ show_triggers_mode: 'any' })} />
                  いずれか 1 つでも選ばれたら表示
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name={`trigger-mode-${q.id}`} checked={mode === 'all'} onChange={() => onChange({ show_triggers_mode: 'all' })} />
                  すべて選ばれたときだけ表示
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
