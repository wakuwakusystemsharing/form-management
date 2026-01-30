'use client';

import React from 'react';
import { SurveyQuestion, SurveyQuestionType } from '@/types/survey';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowUp, ArrowDown, X, Plus } from 'lucide-react';
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
}

export default function SurveyQuestionEditor({ questions, onChange }: SurveyQuestionEditorProps) {
  const [deleteIndex, setDeleteIndex] = React.useState<number | null>(null);

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
    const newQuestions = [...questions];
    newQuestions.splice(index, 1);
    onChange(newQuestions);
    setDeleteIndex(null);
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
            <Card key={q.id}>
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
                        <SelectItem value="radio">単一選択 (ボタン)</SelectItem>
                        <SelectItem value="checkbox">複数選択 (ボタン)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center space-x-2 pt-8">
                    <Checkbox
                      id={`required-${index}`}
                      checked={q.required}
                      onCheckedChange={(checked) => updateQuestion(index, { required: checked as boolean })}
                    />
                    <Label htmlFor={`required-${index}`} className="cursor-pointer">
                      必須項目にする
                    </Label>
                  </div>
                </div>

                {/* 説明文（同意項目などで使用） */}
                <div className="space-y-2">
                  <Label>説明文・補足（任意）</Label>
                  <Textarea
                    value={q.description || ''}
                    onChange={(e) => updateQuestion(index, { description: e.target.value })}
                    rows={2}
                    placeholder="質問の下に表示される説明文を入力（同意事項など）"
                  />
                </div>

                {/* 選択肢設定 (radio/checkboxのみ) */}
                {(q.type === 'radio' || q.type === 'checkbox') && (
                  <Card className="bg-muted">
                    <CardHeader>
                      <CardTitle className="text-sm">選択肢</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {q.options?.map((opt, optIndex) => (
                        <div key={optIndex} className="flex items-center gap-2">
                          <Input
                            type="text"
                            value={opt.label}
                            onChange={(e) => {
                              const newOptions = [...(q.options || [])];
                              newOptions[optIndex] = { ...newOptions[optIndex], label: e.target.value, value: e.target.value };
                              updateQuestion(index, { options: newOptions });
                            }}
                            placeholder={`選択肢 ${optIndex + 1}`}
                            className="flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              const newOptions = [...(q.options || [])];
                              newOptions.splice(optIndex, 1);
                              updateQuestion(index, { options: newOptions });
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
                        onClick={() => {
                          const newOptions = [...(q.options || [])];
                          newOptions.push({ label: '', value: '' });
                          updateQuestion(index, { options: newOptions });
                        }}
                        className="w-full"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        選択肢を追加
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
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
