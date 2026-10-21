'use client';

import React, { useState } from 'react';
import type { SurveyFollowUpQuestion, SurveyFollowUpType, SurveyQuestionOption } from '@/types/survey';
import {
  SURVEY_FOLLOW_UP_MAX_DEPTH,
  countFollowUpsDeep,
  createFollowUp,
  getOptionFollowUps,
  setOptionFollowUps,
  isChoiceFollowUpType,
} from '@/lib/survey-follow-ups';
import TagInput from '@/components/customers/TagInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageSquarePlus, Plus, Tag, X } from 'lucide-react';

/** 追加質問の回答タイプの選択肢（アンケート / 抽選の事前質問 共通） */
const FOLLOW_UP_TYPE_OPTIONS: Array<{ value: SurveyFollowUpType; label: string }> = [
  { value: 'text', label: 'テキスト入力 (1行)' },
  { value: 'textarea', label: 'テキスト入力 (複数行)' },
  { value: 'birthday', label: '誕生日選択' },
  { value: 'select', label: 'ドロップダウン選択' },
  { value: 'radio', label: '単一選択 (ボタン)' },
  { value: 'checkbox', label: '複数選択 (ボタン)' },
];

/** 追加質問ボタンの表示用: 「追加質問(3)」のように配下の件数（入れ子含む）を付ける */
export function followUpButtonLabel(option: SurveyQuestionOption): string {
  const n = countFollowUpsDeep([option]);
  return n > 0 ? `追加質問(${n})` : '追加質問';
}

interface OptionFollowUpsEditorProps {
  /** 追加質問を付ける選択肢 */
  option: SurveyQuestionOption;
  /** 選択肢の表示名（空なら「選択肢 N」） */
  optionLabel: string;
  /** 親（質問 or 追加質問）の文言。追加質問の文言が空のときのプレースホルダに使う */
  parentTitle: string;
  /** 1 = 質問の選択肢に付く追加質問。`SURVEY_FOLLOW_UP_MAX_DEPTH` まで入れ子にできる */
  depth: number;
  /** input の id の接頭辞（画面内で一意） */
  idPrefix: string;
  /** タグ候補を取得する店舗 ID */
  storeId?: string;
  onChange: (option: SurveyQuestionOption) => void;
}

/**
 * 1 つの選択肢に付く追加質問の一覧を編集する（複数 OK）。
 * 追加質問が radio / checkbox / select のときは、その選択肢ごとにタグと（上限の深さまで）さらに追加質問を付けられる
 */
export default function OptionFollowUpsEditor({ option, optionLabel, parentTitle, depth, idPrefix, storeId, onChange }: OptionFollowUpsEditorProps) {
  const list = getOptionFollowUps(option);
  // 配下の選択肢ごとの「タグ」「追加質問」パネルの開閉（`${追加質問 index}:${選択肢 index}`）
  const [openTagPanels, setOpenTagPanels] = useState<Set<string>>(new Set());
  const [openFuPanels, setOpenFuPanels] = useState<Set<string>>(new Set());
  const togglePanel = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const commit = (next: SurveyFollowUpQuestion[]) => onChange(setOptionFollowUps(option, next));
  const updateFollowUp = (fuIndex: number, patch: Partial<SurveyFollowUpQuestion>) => {
    const next = [...list];
    next[fuIndex] = { ...next[fuIndex], ...patch };
    commit(next);
  };
  const updateFollowUpOptions = (fuIndex: number, options: SurveyQuestionOption[]) => updateFollowUp(fuIndex, { options });
  const addFollowUp = () => commit([...list, createFollowUp()]);
  const removeFollowUp = (fuIndex: number) => {
    const next = [...list];
    next.splice(fuIndex, 1);
    commit(next);
  };

  const canNest = depth < SURVEY_FOLLOW_UP_MAX_DEPTH;

  return (
    <div className="ml-8 mt-2 mb-3 space-y-3">
      <div className="text-xs font-medium text-muted-foreground">
        「{optionLabel}」が選択されたときに表示する追加質問（上から順に表示されます）
      </div>
      {list.map((fu, fuIndex) => {
        const fuKey = fu.id || String(fuIndex);
        const fuTitleForChildren = (fu.title || '').trim() || `${parentTitle}（${optionLabel}）`;
        const prefix = `${idPrefix}-fu${fuIndex}`;
        return (
          <div key={fuKey} className={`p-3 rounded-md border bg-background space-y-3 ${fu.enabled === false ? 'opacity-70' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold">
                追加質問 {fuIndex + 1}
                {depth > 1 && <span className="ml-1 font-normal text-muted-foreground">（{depth} 階層目）</span>}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={`${prefix}-enabled`}
                    checked={fu.enabled === true}
                    onCheckedChange={(checked) => updateFollowUp(fuIndex, { enabled: checked === true })}
                  />
                  <Label htmlFor={`${prefix}-enabled`} className="cursor-pointer text-xs">
                    表示する
                  </Label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFollowUp(fuIndex)}
                  className="text-destructive hover:text-destructive h-7 w-7"
                  title="この追加質問を削除"
                  aria-label="この追加質問を削除"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">追加質問の文言</Label>
                <Input
                  type="text"
                  value={fu.title}
                  onChange={(e) => updateFollowUp(fuIndex, { title: e.target.value })}
                  placeholder="例: ご紹介者を入力してください"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">回答タイプ</Label>
                <Select
                  value={fu.type}
                  onValueChange={(value) => updateFollowUp(fuIndex, { type: value as SurveyFollowUpType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOW_UP_TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`${prefix}-required`}
                checked={fu.required === true}
                onCheckedChange={(checked) => updateFollowUp(fuIndex, { required: checked === true })}
              />
              <Label htmlFor={`${prefix}-required`} className="cursor-pointer text-sm">
                必須にする（「{optionLabel}」が選ばれているときのみ）
              </Label>
            </div>

            {isChoiceFollowUpType(fu.type) && (
              <div className="space-y-2">
                <Label className="text-xs">追加質問の選択肢</Label>
                {(fu.options || []).map((fuOpt, optIndex) => {
                  const panelKey = `${fuIndex}:${optIndex}`;
                  const fuOptLabel = fuOpt.label || `選択肢 ${optIndex + 1}`;
                  const nestedCount = countFollowUpsDeep([fuOpt]);
                  return (
                    <div key={optIndex}>
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          value={fuOpt.label}
                          onChange={(e) => {
                            const fuOptions = [...(fu.options || [])];
                            fuOptions[optIndex] = { ...fuOptions[optIndex], label: e.target.value, value: e.target.value };
                            updateFollowUpOptions(fuIndex, fuOptions);
                          }}
                          placeholder={`選択肢 ${optIndex + 1}`}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant={(fuOpt.tags || []).length > 0 ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => togglePanel(setOpenTagPanels, panelKey)}
                          title="この選択肢を選んで送信した人（LINE で紐付いた顧客）に付けるタグを設定"
                          className="shrink-0"
                        >
                          <Tag className="mr-1 h-4 w-4" />
                          タグ{(fuOpt.tags || []).length > 0 ? `(${(fuOpt.tags || []).length})` : ''}
                        </Button>
                        {canNest && (
                          <Button
                            type="button"
                            variant={nestedCount > 0 ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                              // 初めて開くときに追加質問が無ければ 1 つ作る
                              if (!openFuPanels.has(panelKey) && getOptionFollowUps(fuOpt).length === 0) {
                                const fuOptions = [...(fu.options || [])];
                                fuOptions[optIndex] = setOptionFollowUps(fuOpt, [createFollowUp()]);
                                updateFollowUpOptions(fuIndex, fuOptions);
                              }
                              togglePanel(setOpenFuPanels, panelKey);
                            }}
                            title="この選択肢が選ばれたときに表示する追加質問を設定"
                            className="shrink-0"
                          >
                            <MessageSquarePlus className="mr-1 h-4 w-4" />
                            {followUpButtonLabel(fuOpt)}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const fuOptions = [...(fu.options || [])];
                            fuOptions.splice(optIndex, 1);
                            updateFollowUpOptions(fuIndex, fuOptions);
                          }}
                          className="text-destructive hover:text-destructive"
                          aria-label="この選択肢を削除"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {openTagPanels.has(panelKey) && (
                        <div className="mt-2 ml-2 rounded-md border bg-muted/30 p-3 space-y-2">
                          <p className="text-xs text-muted-foreground">
                            「{fuOptLabel}」を選んで送信した人に、顧客管理で使えるタグを自動で付けます（LINE で顧客に紐付いた回答のみ）
                          </p>
                          <TagInput
                            id={`${prefix}-opt${optIndex}-tags`}
                            value={fuOpt.tags || []}
                            onChange={(tags) => {
                              const fuOptions = [...(fu.options || [])];
                              fuOptions[optIndex] = { ...fuOptions[optIndex], tags: tags.length > 0 ? tags : undefined };
                              updateFollowUpOptions(fuIndex, fuOptions);
                            }}
                            storeId={storeId}
                          />
                          <div className="flex justify-end">
                            <Button type="button" variant="ghost" size="sm" onClick={() => togglePanel(setOpenTagPanels, panelKey)}>閉じる</Button>
                          </div>
                        </div>
                      )}
                      {canNest && openFuPanels.has(panelKey) && (
                        <OptionFollowUpsEditor
                          option={fuOpt}
                          optionLabel={fuOptLabel}
                          parentTitle={fuTitleForChildren}
                          depth={depth + 1}
                          idPrefix={`${prefix}-opt${optIndex}`}
                          storeId={storeId}
                          onChange={(nextOpt) => {
                            const fuOptions = [...(fu.options || [])];
                            fuOptions[optIndex] = nextOpt;
                            updateFollowUpOptions(fuIndex, fuOptions);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => updateFollowUpOptions(fuIndex, [...(fu.options || []), { label: '', value: '' }])}
                  className="w-full"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  選択肢を追加
                </Button>
                {!canNest && (
                  <p className="text-xs text-muted-foreground">
                    追加質問は {SURVEY_FOLLOW_UP_MAX_DEPTH} 階層目までです。この選択肢にはこれ以上追加質問を付けられません。
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={addFollowUp} className="w-full">
        <Plus className="mr-2 h-4 w-4" />
        「{optionLabel}」に追加質問を追加
      </Button>
    </div>
  );
}
