'use client';

import React, { useState } from 'react';
import { SurveyQuestion, SurveyQuestionType, SurveyQuestionOption, SurveyContentBlock } from '@/types/survey';
import OptionFollowUpsEditor, { followUpButtonLabel } from './SurveyFollowUpEditor';
import SurveyQuestionDisplaySettings from './SurveyQuestionDisplaySettings';
import { countFollowUpsDeep, createFollowUp, getOptionFollowUps, setOptionFollowUps } from '@/lib/survey-follow-ups';
import {
  AddContentBlockButton,
  ColoredTextPreview,
  ColoredTextToolbar,
  SurveyContentBlockCard,
  createSurveyContentBlock,
} from './SurveyContentBlockEditor';
import { Button } from '@/components/ui/button';
import TagInput from '@/components/customers/TagInput';
import MultipleDatesSettingsEditor from '../Reservation/MultipleDatesSettingsEditor';
import { createDefaultMultipleDatesSettings, normalizeMultipleDatesSettings } from '@/lib/multiple-dates-settings';
import { SELECT_SEARCH_DEFAULT_UNKNOWN_LABEL, SELECT_SEARCH_UNKNOWN_LABEL_MAX } from '@/lib/searchable-select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowUp, ArrowDown, X, Plus, GripVertical, MessageSquarePlus, Tag } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface SurveyQuestionEditorProps {
  questions: SurveyQuestion[];
  onChange: (questions: SurveyQuestion[]) => void;
  /** 質問間のテキスト / 画像ブロック（指定すると「テキスト/画像表示を追加」ボタンが出る） */
  contentBlocks?: SurveyContentBlock[];
  onContentBlocksChange?: (blocks: SurveyContentBlock[]) => void;
  /** 画像アップロード先の店舗 ID（contentBlocks を使う場合に必須） */
  storeId?: string;
  /** 回答タイプに「第三希望日時選択」を出すか（既定 true。抽選フォームの事前質問では使わない） */
  allowMultipleDates?: boolean;
}

export default function SurveyQuestionEditor({ questions, onChange, contentBlocks, onContentBlocksChange, storeId, allowMultipleDates = true }: SurveyQuestionEditorProps) {
  const [deleteIndex, setDeleteIndex] = React.useState<number | null>(null);
  // 説明文の文字色ツールバー用（質問 ID → textarea）
  const descriptionRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({});
  const blocksEnabled = !!onContentBlocksChange && !!storeId;
  const blocks = contentBlocks || [];
  const blocksAt = (anchor: string, position: 'above' | 'below') =>
    blocks.filter((b) => b.anchor === anchor && (b.position || 'above') === position);
  const addBlock = (anchor: string, position: 'above' | 'below') => {
    onContentBlocksChange?.([...blocks, createSurveyContentBlock(anchor, position)]);
  };
  const updateBlock = (id: string, patch: Partial<SurveyContentBlock>) => {
    onContentBlocksChange?.(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };
  const deleteBlock = (id: string) => {
    if (!confirm('このテキスト/画像表示を削除しますか？')) return;
    onContentBlocksChange?.(blocks.filter((b) => b.id !== id));
  };
  const renderBlocks = (anchor: string, position: 'above' | 'below') =>
    blocksAt(anchor, position).map((b) => (
      <SurveyContentBlockCard key={b.id} block={b} storeId={storeId || ''} onChange={(patch) => updateBlock(b.id, patch)} onDelete={() => deleteBlock(b.id)} />
    ));
  // 選択肢のドラッグ&ドロップ並び替え（質問ID + 選択肢インデックス）
  const [dragOpt, setDragOpt] = React.useState<{ qId: string; index: number } | null>(null);
  const [dragOverOpt, setDragOverOpt] = React.useState<{ qId: string; index: number } | null>(null);

  const addQuestion = () => {
    const newQuestion: SurveyQuestion = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'text',
      title: '新しい質問',
      required: false,
      options: []
    };
    onChange([...questions, newQuestion]);
  };

  const updateQuestion = (index: number, updates: Partial<SurveyQuestion>) => {
    const newQuestions = [...questions];
    newQuestions[index] = { ...newQuestions[index], ...updates };
    onChange(newQuestions);
  };

  const removeQuestion = (index: number) => {
    const removedId = questions[index]?.id;
    const newQuestions = [...questions];
    newQuestions.splice(index, 1);
    onChange(newQuestions);
    // その質問に紐づくテキスト/画像表示は、直前の質問の下（無ければ次の質問の上）へ移す
    if (blocksEnabled && removedId && blocks.some((b) => b.anchor === removedId)) {
      const prev = newQuestions[index - 1];
      const next = newQuestions[index];
      onContentBlocksChange?.(blocks.map((b) => {
        if (b.anchor !== removedId) return b;
        if (prev) return { ...b, anchor: prev.id, position: 'below' as const };
        if (next) return { ...b, anchor: next.id, position: 'above' as const };
        return b;
      }));
    }
    setDeleteIndex(null);
  };

  const updateOptions = (index: number, options: SurveyQuestionOption[]) => {
    updateQuestion(index, { options });
  };

  const handleOptionDrop = (qIndex: number, qId: string, dropIndex: number) => {
    if (dragOpt && dragOpt.qId === qId && dragOpt.index !== dropIndex) {
      const options = [...(questions[qIndex].options || [])];
      const [moved] = options.splice(dragOpt.index, 1);
      options.splice(dropIndex, 0, moved);
      updateOptions(qIndex, options);
    }
    setDragOpt(null);
    setDragOverOpt(null);
  };

  // 追加質問パネルの開閉（`${questionId}:${optIndex}`）。初めて開くときに追加質問が無ければ 1 つ作る
  const [openFuPanels, setOpenFuPanels] = useState<Set<string>>(new Set());
  const toggleFollowUpPanel = (qIndex: number, optIndex: number) => {
    const q = questions[qIndex];
    const key = `${q.id}:${optIndex}`;
    const opt = (q.options || [])[optIndex];
    if (!openFuPanels.has(key) && opt && getOptionFollowUps(opt).length === 0) {
      const options = [...(q.options || [])];
      options[optIndex] = setOptionFollowUps(opt, [createFollowUp()]);
      updateOptions(qIndex, options);
    }
    setOpenFuPanels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // タグ設定パネルの開閉（`${questionId}:${optIndex}`）
  const [openTagPanels, setOpenTagPanels] = useState<Set<string>>(new Set());
  const toggleTagPanel = (questionId: string, optIndex: number) => {
    const key = `${questionId}:${optIndex}`;
    setOpenTagPanels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const moveQuestion = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === questions.length - 1)
    ) {
      return;
    }
    const newQuestions = [...questions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newQuestions[index], newQuestions[targetIndex]] = [newQuestions[targetIndex], newQuestions[index]];
    onChange(newQuestions);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">質問項目設定</h3>
        <Button onClick={addQuestion} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          質問を追加
        </Button>
      </div>

      <div className="space-y-4">
        {questions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            質問がありません。上記の「質問を追加」ボタンから追加してください。
          </div>
        ) : (
          questions.map((q, index) => (
            <React.Fragment key={q.id}>
            {blocksEnabled && renderBlocks(q.id, 'above')}
            {blocksEnabled && <AddContentBlockButton onClick={() => addBlock(q.id, 'above')} label={index === 0 ? 'Q1 の上にテキスト/画像表示を追加' : `Q${index} と Q${index + 1} の間にテキスト/画像表示を追加`} />}
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Q{index + 1}</Badge>
                    <Input
                      type="text"
                      value={q.title}
                      onChange={(e) => updateQuestion(index, { title: e.target.value })}
                      placeholder="質問タイトル"
                      className="flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveQuestion(index, 'up')}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveQuestion(index, 'down')}
                      disabled={index === questions.length - 1}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteIndex(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>回答タイプ</Label>
                    <Select
                      value={q.type}
                      onValueChange={(value) => updateQuestion(index, {
                        type: value as SurveyQuestionType,
                        // 第三希望日時選択に切り替えたときは予約フォームと同じ既定設定を用意する
                        ...(value === 'multiple_dates' && !q.multiple_dates ? { multiple_dates: createDefaultMultipleDatesSettings() } : {}),
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">テキスト入力 (1行)</SelectItem>
                        <SelectItem value="textarea">テキスト入力 (複数行)</SelectItem>
                        <SelectItem value="date">日付選択</SelectItem>
                        <SelectItem value="datetime">日時選択</SelectItem>
                        <SelectItem value="birthday">誕生日選択</SelectItem>
                        {allowMultipleDates && <SelectItem value="multiple_dates">第三希望日時選択</SelectItem>}
                        <SelectItem value="select">ドロップダウン選択</SelectItem>
                        <SelectItem value="radio">単一選択 (ボタン)</SelectItem>
                        <SelectItem value="checkbox">複数選択 (ボタン)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4 pt-8 flex-wrap">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`required-${index}`}
                        checked={q.required}
                        onCheckedChange={(checked) => updateQuestion(index, { required: checked as boolean })}
                      />
                      <Label htmlFor={`required-${index}`} className="cursor-pointer">
                        必須項目にする
                      </Label>
                    </div>
                    <div
                      className="flex items-center space-x-2"
                      title="回答した内容をお客様の端末（ブラウザ）に保存し、次回フォームを開いたときに復元します。データは端末内にのみ保存され、他のお客様に表示されることはありません。"
                    >
                      <Checkbox
                        id={`restore-${index}`}
                        checked={q.restore_enabled === true}
                        onCheckedChange={(checked) => updateQuestion(index, { restore_enabled: checked as boolean })}
                      />
                      <Label htmlFor={`restore-${index}`} className="cursor-pointer">
                        復元機能をオンにする
                      </Label>
                    </div>
                  </div>
                </div>

                {/* 画像（上 / 間 / 下）+ フォームを開いたときは非表示 + 表示トリガー（アンケートのみ。抽選の事前質問では出さない） */}
                {storeId && (
                  <SurveyQuestionDisplaySettings
                    question={q}
                    index={index}
                    questions={questions}
                    storeId={storeId}
                    onChange={(patch) => updateQuestion(index, patch)}
                  />
                )}

                {/* 説明文（同意項目などで使用） */}
                <div className="space-y-2">
                  <Label>説明文・補足（任意）</Label>
                  <Textarea
                    ref={(el) => { descriptionRefs.current[q.id] = el; }}
                    value={q.description || ''}
                    onChange={(e) => updateQuestion(index, { description: e.target.value })}
                    rows={3}
                    placeholder="質問の下に表示される説明文を入力（同意事項など）"
                  />
                  <ColoredTextToolbar
                    getTextarea={() => descriptionRefs.current[q.id] ?? null}
                    value={q.description || ''}
                    onChange={(description) => updateQuestion(index, { description })}
                  />
                  <ColoredTextPreview text={q.description || ''} accentColor="#9ca3af" />
                </div>

                {/* 第三希望日時選択の設定（予約フォームの日時選択モードと同じ） */}
                {q.type === 'multiple_dates' && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      予約フォームの「第三希望日時選択」と同じ設定です。回答は「第一希望: 2026年10月01日（木） 10:00 / 第二希望: …」の形で保存されます。
                      「必須項目にする」がオンのときは下の「必須選択」でチェックした希望が必須になります（第一希望は常に必須）。
                    </p>
                    <MultipleDatesSettingsEditor
                      settings={normalizeMultipleDatesSettings(q.multiple_dates)}
                      onChange={(next) => updateQuestion(index, { multiple_dates: next })}
                      theme="light"
                      title="第三希望日時の設定"
                      specialDayNote="選べます"
                    />
                  </div>
                )}

                {/* 選択肢設定 (radio/checkbox/select) */}
                {(q.type === 'radio' || q.type === 'checkbox' || q.type === 'select') && (
                  <Card className="bg-muted">
                    <CardHeader>
                      <CardTitle className="text-sm">選択肢</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        左端のハンドルをドラッグして選択肢を並び替えできます（並び順はアンケートフォームにも反映されます）。
                      </p>
                      {q.options?.map((opt, optIndex) => {
                        const isDragOver = dragOverOpt?.qId === q.id && dragOverOpt.index === optIndex && dragOpt?.qId === q.id && dragOpt.index !== optIndex;
                        const isDragging = dragOpt?.qId === q.id && dragOpt.index === optIndex;
                        const fuCount = countFollowUpsDeep([opt]);
                        const fuOpen = openFuPanels.has(`${q.id}:${optIndex}`);
                        return (
                          <div
                            key={optIndex}
                            className={`rounded-md transition-shadow ${isDragOver ? 'ring-2 ring-primary' : ''} ${isDragging ? 'opacity-60' : ''}`}
                            onDragOver={(e) => { if (dragOpt?.qId === q.id) { e.preventDefault(); setDragOverOpt({ qId: q.id, index: optIndex }); } }}
                            onDrop={(e) => { if (dragOpt?.qId === q.id) { e.preventDefault(); handleOptionDrop(index, q.id, optIndex); } }}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 rounded touch-none"
                                draggable
                                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragOpt({ qId: q.id, index: optIndex }); }}
                                onDragEnd={() => { setDragOpt(null); setDragOverOpt(null); }}
                                title="ドラッグで並び替え"
                                aria-label="ドラッグで並び替え"
                              >
                                <GripVertical className="h-4 w-4" />
                              </button>
                              <Input
                                type="text"
                                value={opt.label}
                                onChange={(e) => {
                                  const newOptions = [...(q.options || [])];
                                  newOptions[optIndex] = { ...newOptions[optIndex], label: e.target.value, value: e.target.value };
                                  updateOptions(index, newOptions);
                                }}
                                placeholder={`選択肢 ${optIndex + 1}`}
                                className="flex-1"
                              />
                              {q.type === 'select' && q.select_search?.enabled === true && (
                                <Input
                                  type="text"
                                  value={opt.kana || ''}
                                  onChange={(e) => {
                                    const newOptions = [...(q.options || [])];
                                    const kana = e.target.value;
                                    newOptions[optIndex] = { ...newOptions[optIndex], kana: kana.trim() ? kana : undefined };
                                    updateOptions(index, newOptions);
                                  }}
                                  title="ふりがな（任意）。五十音ボタンでの絞り込みと名前検索に使います。漢字で始まる選択肢は、ふりがなが無いと五十音ボタンで探せません"
                                  placeholder="ふりがな（任意）"
                                  className="w-32 shrink-0"
                                />
                              )}
                              <Button
                                type="button"
                                variant={(opt.tags || []).length > 0 ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => toggleTagPanel(q.id, optIndex)}
                                title="この選択肢を選んで送信した人（LINE で紐付いた顧客）に付けるタグを設定"
                                className="shrink-0"
                              >
                                <Tag className="mr-1 h-4 w-4" />
                                タグ{(opt.tags || []).length > 0 ? `(${(opt.tags || []).length})` : ''}
                              </Button>
                              <Button
                                type="button"
                                variant={fuCount > 0 ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => toggleFollowUpPanel(index, optIndex)}
                                title={fuOpen ? '追加質問の設定を閉じる' : 'この選択肢が選ばれたときに表示する追加質問を設定（複数・入れ子可）'}
                                className="shrink-0"
                              >
                                <MessageSquarePlus className="mr-1 h-4 w-4" />
                                {followUpButtonLabel(opt)}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  const newOptions = [...(q.options || [])];
                                  newOptions.splice(optIndex, 1);
                                  updateOptions(index, newOptions);
                                }}
                                className="text-destructive hover:text-destructive"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>

                            {/* タグの設定パネル */}
                            {openTagPanels.has(`${q.id}:${optIndex}`) && (
                              <div className="mt-2 ml-8 rounded-md border bg-muted/30 p-3 space-y-2">
                                <p className="text-xs text-muted-foreground">
                                  「{opt.label || `選択肢 ${optIndex + 1}`}」を選んで送信した人に、顧客管理で使えるタグを自動で付けます（LINE で顧客に紐付いた回答のみ。配信の絞り込みなどに使えます）
                                </p>
                                <TagInput
                                  id={`opt-tags-${q.id}-${optIndex}`}
                                  value={opt.tags || []}
                                  onChange={(tags) => {
                                    const newOptions = [...(q.options || [])];
                                    newOptions[optIndex] = { ...newOptions[optIndex], tags: tags.length > 0 ? tags : undefined };
                                    updateOptions(index, newOptions);
                                  }}
                                  storeId={storeId}
                                />
                                <div className="flex justify-end">
                                  <Button type="button" variant="ghost" size="sm" onClick={() => toggleTagPanel(q.id, optIndex)}>閉じる</Button>
                                </div>
                              </div>
                            )}
                            {/* 追加質問の設定パネル（複数・入れ子） */}
                            {fuOpen && (
                              <OptionFollowUpsEditor
                                option={opt}
                                optionLabel={opt.label || `選択肢 ${optIndex + 1}`}
                                parentTitle={q.title || `Q${index + 1}`}
                                depth={1}
                                idPrefix={`fu-${q.id}-${optIndex}`}
                                storeId={storeId}
                                onChange={(nextOpt) => {
                                  const newOptions = [...(q.options || [])];
                                  newOptions[optIndex] = nextOpt;
                                  updateOptions(index, newOptions);
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const newOptions = [...(q.options || [])];
                          newOptions.push({ label: '', value: '' });
                          updateOptions(index, newOptions);
                        }}
                        className="w-full"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        選択肢を追加
                      </Button>
                      <div className="flex items-center space-x-2 pt-2">
                        <Checkbox
                          id={`allow-other-${index}`}
                          checked={q.allow_other || false}
                          onCheckedChange={(checked) => updateQuestion(index, { allow_other: checked as boolean })}
                        />
                        <Label htmlFor={`allow-other-${index}`} className="cursor-pointer">
                          {q.type === 'select' ? '「その他」の選択肢を追加（選択時に理由入力欄を表示）' : '「その他」ボタンを追加（選択時に理由入力欄を表示）'}
                        </Label>
                      </div>
                      {/* ドロップダウン選択: 検索・絞り込み機能（選択肢が多いとき用） */}
                      {q.type === 'select' && (
                        <div className="rounded-md border bg-background p-3 space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`select-search-${index}`}
                              checked={q.select_search?.enabled === true}
                              onCheckedChange={(checked) => updateQuestion(index, {
                                select_search: checked === true
                                  ? { enabled: true, unknown_enabled: q.select_search?.unknown_enabled !== false, unknown_label: q.select_search?.unknown_label || '' }
                                  : undefined,
                              })}
                            />
                            <Label htmlFor={`select-search-${index}`} className="cursor-pointer">
                              検索・絞り込み機能を使う（選択肢が多いときにおすすめ）
                            </Label>
                          </div>
                          <p className="text-xs text-muted-foreground ml-6">
                            フォームでは「名前で検索」の入力欄と「あ・か・さ…」の五十音ボタンで選択肢を絞り込めます。
                            漢字で始まる選択肢は、上の各選択肢の「ふりがな」を入れると五十音ボタンでも探せます（名前検索はふりがな無しでも使えます）。「その他」は絞り込みに関係なく常にリストの末尾に出ます。
                          </p>
                          {q.select_search?.enabled === true && (
                            <div className="ml-6 space-y-2">
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`select-search-unknown-${index}`}
                                  checked={q.select_search.unknown_enabled !== false}
                                  onCheckedChange={(checked) => updateQuestion(index, { select_search: { ...q.select_search, enabled: true, unknown_enabled: checked === true } })}
                                />
                                <Label htmlFor={`select-search-unknown-${index}`} className="cursor-pointer">
                                  「不明」を独立したボタンとして表示する（絞り込みに関係なく常に押せる位置に出ます）
                                </Label>
                              </div>
                              {q.select_search.unknown_enabled !== false && (
                                <div className="flex items-center gap-2 ml-6 flex-wrap">
                                  <span className="text-xs text-muted-foreground shrink-0">ボタンの表示名</span>
                                  <Input
                                    type="text"
                                    value={q.select_search.unknown_label || ''}
                                    maxLength={SELECT_SEARCH_UNKNOWN_LABEL_MAX}
                                    onChange={(e) => updateQuestion(index, { select_search: { ...q.select_search, enabled: true, unknown_label: e.target.value } })}
                                    placeholder={SELECT_SEARCH_DEFAULT_UNKNOWN_LABEL}
                                    className="w-48"
                                  />
                                  <span className="text-xs text-muted-foreground">空のときは「{SELECT_SEARCH_DEFAULT_UNKNOWN_LABEL}」。この文言がそのまま回答として保存されます</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
            {blocksEnabled && renderBlocks(q.id, 'below')}
            {blocksEnabled && index === questions.length - 1 && <AddContentBlockButton onClick={() => addBlock(q.id, 'below')} label={`Q${index + 1} の下にテキスト/画像表示を追加`} />}
            </React.Fragment>
          ))
        )}
      </div>

      <AlertDialog open={deleteIndex !== null} onOpenChange={(open) => !open && setDeleteIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>質問を削除</AlertDialogTitle>
            <AlertDialogDescription>
              この質問を削除してもよろしいですか？この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteIndex !== null && removeQuestion(deleteIndex)}>
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
