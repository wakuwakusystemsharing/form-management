'use client';

import React from 'react';
import { SurveyQuestion, SurveyQuestionType, SurveyQuestionOption, SurveyFollowUpQuestion, SurveyFollowUpType, SurveyContentBlock } from '@/types/survey';
import {
  AddContentBlockButton,
  ColoredTextPreview,
  ColoredTextToolbar,
  SurveyContentBlockCard,
  createSurveyContentBlock,
} from './SurveyContentBlockEditor';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowUp, ArrowDown, X, Plus, GripVertical, MessageSquarePlus } from 'lucide-react';
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
}

export default function SurveyQuestionEditor({ questions, onChange, contentBlocks, onContentBlocksChange, storeId }: SurveyQuestionEditorProps) {
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

  const updateFollowUp = (qIndex: number, optIndex: number, updates: Partial<SurveyFollowUpQuestion>) => {
    const options = [...(questions[qIndex].options || [])];
    const current: SurveyFollowUpQuestion = options[optIndex].follow_up || { enabled: false, title: '', type: 'text' };
    options[optIndex] = { ...options[optIndex], follow_up: { ...current, ...updates } };
    updateOptions(qIndex, options);
  };

  const toggleFollowUp = (qIndex: number, optIndex: number) => {
    const opt = (questions[qIndex].options || [])[optIndex];
    const enabled = !(opt.follow_up?.enabled);
    updateFollowUp(qIndex, optIndex, {
      enabled,
      title: opt.follow_up?.title || '',
      type: opt.follow_up?.type || 'text',
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
                      onValueChange={(value) => updateQuestion(index, { type: value as SurveyQuestionType })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">テキスト入力 (1行)</SelectItem>
                        <SelectItem value="textarea">テキスト入力 (複数行)</SelectItem>
                        <SelectItem value="date">日付選択</SelectItem>
                        <SelectItem value="datetime">日時選択</SelectItem>
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
                        const fu = opt.follow_up;
                        const fuEnabled = fu?.enabled === true;
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
                              <Button
                                type="button"
                                variant={fuEnabled ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => toggleFollowUp(index, optIndex)}
                                title={fuEnabled ? '追加質問を無効にする' : 'この選択肢が選ばれたときに表示する追加質問を設定'}
                                className="shrink-0"
                              >
                                <MessageSquarePlus className="mr-1 h-4 w-4" />
                                追加質問
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

                            {/* 追加質問の設定パネル */}
                            {fuEnabled && fu && (
                              <div className="ml-8 mt-2 mb-3 p-3 rounded-md border bg-background space-y-3">
                                <div className="text-xs font-medium text-muted-foreground">
                                  「{opt.label || `選択肢 ${optIndex + 1}`}」が選択されたときに表示する追加質問
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs">追加質問の文言</Label>
                                    <Input
                                      type="text"
                                      value={fu.title}
                                      onChange={(e) => updateFollowUp(index, optIndex, { title: e.target.value })}
                                      placeholder="例: ご紹介者を入力してください"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">回答タイプ</Label>
                                    <Select
                                      value={fu.type}
                                      onValueChange={(value) => updateFollowUp(index, optIndex, { type: value as SurveyFollowUpType })}
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="text">テキスト入力 (1行)</SelectItem>
                                        <SelectItem value="textarea">テキスト入力 (複数行)</SelectItem>
                                        <SelectItem value="select">ドロップダウン選択</SelectItem>
                                        <SelectItem value="radio">単一選択 (ボタン)</SelectItem>
                                        <SelectItem value="checkbox">複数選択 (ボタン)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`fu-required-${q.id}-${optIndex}`}
                                    checked={fu.required === true}
                                    onCheckedChange={(checked) => updateFollowUp(index, optIndex, { required: checked as boolean })}
                                  />
                                  <Label htmlFor={`fu-required-${q.id}-${optIndex}`} className="cursor-pointer text-sm">
                                    必須にする（この選択肢が選ばれているときのみ）
                                  </Label>
                                </div>
                                {(fu.type === 'radio' || fu.type === 'checkbox' || fu.type === 'select') && (
                                  <div className="space-y-2">
                                    <Label className="text-xs">追加質問の選択肢</Label>
                                    {(fu.options || []).map((fuOpt, fuIndex) => (
                                      <div key={fuIndex} className="flex items-center gap-2">
                                        <Input
                                          type="text"
                                          value={fuOpt.label}
                                          onChange={(e) => {
                                            const fuOptions = [...(fu.options || [])];
                                            fuOptions[fuIndex] = { label: e.target.value, value: e.target.value };
                                            updateFollowUp(index, optIndex, { options: fuOptions });
                                          }}
                                          placeholder={`選択肢 ${fuIndex + 1}`}
                                          className="flex-1"
                                        />
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => {
                                            const fuOptions = [...(fu.options || [])];
                                            fuOptions.splice(fuIndex, 1);
                                            updateFollowUp(index, optIndex, { options: fuOptions });
                                          }}
                                          className="text-destructive hover:text-destructive"
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    ))}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => updateFollowUp(index, optIndex, { options: [...(fu.options || []), { label: '', value: '' }] })}
                                      className="w-full"
                                    >
                                      <Plus className="mr-2 h-4 w-4" />
                                      選択肢を追加
                                    </Button>
                                  </div>
                                )}
                              </div>
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
