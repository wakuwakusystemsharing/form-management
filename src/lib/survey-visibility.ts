import type { SurveyFollowUpQuestion, SurveyQuestion, SurveyQuestionOption } from '@/types/survey';
import { FOLLOW_UP_OTHER_VALUE, getEnabledFollowUps, isChoiceFollowUpType } from './survey-follow-ups';

/**
 * アンケート質問の「フォームを開いたときは非表示 + 表示トリガー」の純粋ロジック（編集 UI・生成 HTML 共通）。
 * - トリガー = 「別の質問（または その選択肢の追加質問）で、この選択肢が選ばれていたら表示」
 * - `path` は追加質問の位置（選択肢 index と追加質問 index を交互に並べた配列。生成 HTML の `fu-{qid}-{path}` と同じ）。
 *   空 / 未設定 = 質問自身の選択肢
 * - `value` は選択肢の送信値（`opt.value || opt.label`）。「その他」は `__other__`
 */
export interface SurveyShowTrigger {
  question_id: string;
  path?: number[];
  value: string;
}

export type SurveyShowTriggersMode = 'any' | 'all';

export type SurveyImagePosition = 'above' | 'middle' | 'below';

export const SURVEY_IMAGE_POSITION_OPTIONS: Array<{ value: SurveyImagePosition; label: string }> = [
  { value: 'above', label: '質問名の上' },
  { value: 'middle', label: '質問名と入力欄の間' },
  { value: 'below', label: '入力欄の下' },
];

/** トリガーに選べる選択肢 1 件（編集画面のプルダウン用） */
export interface SurveyTriggerChoice {
  key: string;        // プルダウンの値（path + value を 1 つにしたもの）
  label: string;      // 表示（例: 「紹介 › ご紹介者との関係: 友人」）
  path: number[];
  value: string;
}

/** 選択肢を持つ質問か（トリガー元になれる） */
export function isSurveyChoiceQuestion(q: Pick<SurveyQuestion, 'type'> | null | undefined): boolean {
  return !!q && (q.type === 'radio' || q.type === 'checkbox' || q.type === 'select');
}

export function optionTriggerValue(opt: Pick<SurveyQuestionOption, 'label' | 'value'>): string {
  return (opt.value || opt.label || '').toString();
}

export function encodeTriggerKey(path: number[] | undefined, value: string): string {
  return JSON.stringify([Array.isArray(path) ? path : [], value]);
}

export function decodeTriggerKey(key: string): { path: number[]; value: string } | null {
  try {
    const parsed = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [path, value] = parsed;
    if (!Array.isArray(path) || typeof value !== 'string') return null;
    return { path: path.filter((n) => Number.isInteger(n) && n >= 0), value };
  } catch {
    return null;
  }
}

/**
 * ある質問のトリガーにできる選択肢を列挙する（質問自身の選択肢 + 追加質問の選択肢を再帰）。
 * 「その他」（allow_other）も含める
 */
export function listSurveyTriggerChoices(q: SurveyQuestion): SurveyTriggerChoice[] {
  if (!isSurveyChoiceQuestion(q)) return [];
  const out: SurveyTriggerChoice[] = [];
  const walk = (options: SurveyQuestionOption[] | undefined, path: number[], prefix: string) => {
    (options || []).forEach((opt, i) => {
      const value = optionTriggerValue(opt);
      if (!value) return;
      out.push({ key: encodeTriggerKey(path, value), label: prefix + (opt.label || value), path, value });
      getEnabledFollowUps(opt).forEach((fu, j) => {
        if (!isChoiceFollowUpType(fu.type)) return;
        const fuPath = path.concat([i, j]);
        const fuPrefix = `${prefix}${opt.label || value} › ${fu.title || '追加質問'}: `;
        walk(fu.options, fuPath, fuPrefix);
        if (fu.allow_other) {
          out.push({ key: encodeTriggerKey(fuPath, FOLLOW_UP_OTHER_VALUE), label: `${fuPrefix}その他`, path: fuPath, value: FOLLOW_UP_OTHER_VALUE });
        }
      });
    });
  };
  walk(q.options, [], '');
  if (q.allow_other) {
    out.push({ key: encodeTriggerKey([], FOLLOW_UP_OTHER_VALUE), label: 'その他', path: [], value: FOLLOW_UP_OTHER_VALUE });
  }
  return out;
}

/** path をたどって追加質問の定義を取り出す（見つからなければ null） */
export function findFollowUpByPath(q: SurveyQuestion, path: number[]): SurveyFollowUpQuestion | null {
  let options: SurveyQuestionOption[] | undefined = q.options;
  let current: SurveyFollowUpQuestion | null = null;
  for (let k = 0; k + 1 < path.length; k += 2) {
    const opt = (options || [])[path[k]];
    if (!opt) return null;
    const fu = getEnabledFollowUps(opt)[path[k + 1]];
    if (!fu) return null;
    current = fu;
    options = fu.options;
  }
  return current;
}

/** 設定として有効なトリガーだけ残す（存在しない質問 / 自分自身 / 空の値を除く） */
export function sanitizeSurveyShowTriggers(
  triggers: unknown,
  selfId: string,
  questions: SurveyQuestion[],
): SurveyShowTrigger[] {
  if (!Array.isArray(triggers)) return [];
  const ids = new Set(questions.map((q) => q.id));
  const out: SurveyShowTrigger[] = [];
  triggers.forEach((t) => {
    if (!t || typeof t !== 'object') return;
    const { question_id, path, value } = t as Record<string, unknown>;
    if (typeof question_id !== 'string' || !question_id || question_id === selfId || !ids.has(question_id)) return;
    if (typeof value !== 'string' || !value) return;
    const p = Array.isArray(path) ? path.filter((n) => Number.isInteger(n) && n >= 0) as number[] : [];
    out.push(p.length > 0 ? { question_id, path: p, value } : { question_id, value });
  });
  return out;
}

/**
 * 現在の選択状態から非表示にする質問 ID を求める（生成 HTML の JS と同じ規則。テスト・サーバー側で使う）。
 * - `selectedValues(questionId, path)` は その質問（または追加質問）で選ばれている送信値の配列を返す
 * - トリガー元の質問が非表示なら成立しない（連鎖）。固定点まで繰り返す
 */
export function computeHiddenSurveyQuestionIds(
  questions: SurveyQuestion[],
  selectedValues: (questionId: string, path: number[]) => string[],
): string[] {
  const hidden = new Set<string>();
  const triggerActive = (t: SurveyShowTrigger): boolean => {
    if (hidden.has(t.question_id)) return false;
    return selectedValues(t.question_id, t.path || []).indexOf(t.value) !== -1;
  };
  for (let iter = 0; iter < questions.length + 1; iter++) {
    let changed = false;
    questions.forEach((q) => {
      if (q.hidden_by_default !== true) return;
      const triggers = Array.isArray(q.show_triggers) ? q.show_triggers : [];
      const mode: SurveyShowTriggersMode = q.show_triggers_mode === 'all' ? 'all' : 'any';
      const shown = triggers.length > 0 && (mode === 'all' ? triggers.every(triggerActive) : triggers.some(triggerActive));
      const nowHidden = !shown;
      if (nowHidden !== hidden.has(q.id)) {
        changed = true;
        if (nowHidden) hidden.add(q.id); else hidden.delete(q.id);
      }
    });
    if (!changed) break;
  }
  return questions.filter((q) => hidden.has(q.id)).map((q) => q.id);
}
