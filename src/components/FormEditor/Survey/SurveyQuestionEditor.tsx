import React from 'react';
import { SurveyQuestion, SurveyQuestionType } from '@/types/survey';

interface SurveyQuestionEditorProps {
  questions: SurveyQuestion[];
  onChange: (questions: SurveyQuestion[]) => void;
}

export default function SurveyQuestionEditor({ questions, onChange }: SurveyQuestionEditorProps) {
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
    if (confirm('この質問を削除してもよろしいですか？')) {
      const newQuestions = [...questions];
      newQuestions.splice(index, 1);
      onChange(newQuestions);
    }
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
        <h3 className="text-lg font-medium text-gray-200">質問項目設定</h3>
        <button
          onClick={addQuestion}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm"
        >
          + 質問を追加
        </button>
      </div>

      <div className="space-y-4">
        {questions.map((q, index) => (
          <div key={q.id} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center space-x-2">
                <span className="bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs">
                  Q{index + 1}
                </span>
                <input
                  type="text"
                  value={q.title}
                  onChange={(e) => updateQuestion(index, { title: e.target.value })}
                  className="bg-gray-700 border border-gray-600 text-white px-2 py-1 rounded focus:outline-none focus:border-blue-500"
                  placeholder="質問タイトル"
                />
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => moveQuestion(index, 'up')}
                  disabled={index === 0}
                  className="text-gray-400 hover:text-white disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveQuestion(index, 'down')}
                  disabled={index === questions.length - 1}
                  className="text-gray-400 hover:text-white disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  onClick={() => removeQuestion(index)}
                  className="text-red-400 hover:text-red-300 ml-2"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">回答タイプ</label>
                <select
                  value={q.type}
                  onChange={(e) => updateQuestion(index, { type: e.target.value as SurveyQuestionType })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                >
                  <option value="text">テキスト入力 (1行)</option>
                  <option value="textarea">テキスト入力 (複数行)</option>
                  <option value="date">日付選択</option>
                  <option value="radio">単一選択 (ボタン)</option>
                  <option value="checkbox">複数選択 (ボタン)</option>
                </select>
              </div>
              <div className="flex items-center mt-6">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => updateQuestion(index, { required: e.target.checked })}
                    className="form-checkbox h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded"
                  />
                  <span className="text-sm text-gray-300">必須項目にする</span>
                </label>
              </div>
            </div>

            {/* 説明文（同意項目などで使用） */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">説明文・補足（任意）</label>
              <textarea
                value={q.description || ''}
                onChange={(e) => updateQuestion(index, { description: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500 text-sm"
                rows={2}
                placeholder="質問の下に表示される説明文を入力（同意事項など）"
              />
            </div>

            {/* 選択肢設定 (radio/checkboxのみ) */}
            {(q.type === 'radio' || q.type === 'checkbox') && (
              <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
                <label className="block text-xs text-gray-400 mb-2">選択肢</label>
                <div className="space-y-2">
                  {q.options?.map((opt, optIndex) => (
                    <div key={optIndex} className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => {
                          const newOptions = [...(q.options || [])];
                          newOptions[optIndex] = { ...newOptions[optIndex], label: e.target.value, value: e.target.value };
                          updateQuestion(index, { options: newOptions });
                        }}
                        className="flex-1 bg-gray-700 border border-gray-600 text-white px-2 py-1 rounded text-sm"
                        placeholder={`選択肢 ${optIndex + 1}`}
                      />
                      <button
                        onClick={() => {
                          const newOptions = [...(q.options || [])];
                          newOptions.splice(optIndex, 1);
                          updateQuestion(index, { options: newOptions });
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const newOptions = [...(q.options || [])];
                      newOptions.push({ label: '', value: '' });
                      updateQuestion(index, { options: newOptions });
                    }}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    + 選択肢を追加
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
