/**
 * アンケートの選択肢に付けたタグを、回答内容から集める純粋ロジック（クライアント / サーバー共用）
 * - 回答は静的 HTML が送る形式: { [質問タイトル]: 値 }。radio / select は選択肢のラベル、checkbox は ", " 区切り
 * - 「その他」は理由テキストになるためタグ対象外
 */
import type { SurveyConfig, SurveyQuestion, SurveyQuestionOption } from '@/types/survey';
import { normalizeTags } from '@/lib/customer-chart';

type ResponseMap = Record<string, unknown>;

function optionTags(opt: SurveyQuestionOption | undefined): string[] {
  return normalizeTags(opt?.tags);
}

function selectedLabels(question: SurveyQuestion, raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  const text = String(raw);
  if (!text) return [];
  if (question.type === 'checkbox') {
    // 送信形式は ", " 区切り。ラベル自体に ", " を含む選択肢は完全一致でも拾う
    const parts = text.split(', ').map((s) => s.trim()).filter(Boolean);
    return parts.includes(text) ? parts : [text, ...parts];
  }
  return [text];
}

/**
 * 回答で選ばれた選択肢に設定されたタグをすべて集める（重複除去・正規化済み）
 */
export function collectSurveyOptionTags(config: SurveyConfig | null | undefined, responses: ResponseMap | null | undefined): string[] {
  if (!config || !responses || typeof responses !== 'object') return [];
  const collected: string[] = [];
  for (const question of config.questions || []) {
    if (!question || !Array.isArray(question.options) || question.options.length === 0) continue;
    if (question.type !== 'radio' && question.type !== 'checkbox' && question.type !== 'select') continue;
    const labels = selectedLabels(question, responses[question.title]);
    if (labels.length === 0) continue;
    for (const opt of question.options) {
      const tags = optionTags(opt);
      if (tags.length === 0) continue;
      if (labels.includes(opt.label) || labels.includes(opt.value)) collected.push(...tags);
    }
  }
  return normalizeTags(collected);
}

/**
 * 既存タグに新しいタグを追加した結果（順序は既存 → 追加。上限は normalizeTags に従う）
 */
export function mergeCustomerTags(existing: unknown, added: string[]): string[] {
  return normalizeTags([...normalizeTags(existing), ...added]);
}

/**
 * アンケート設定の中でタグが設定されている選択肢の数（編集画面の表示用）
 */
export function countTaggedOptions(config: SurveyConfig | null | undefined): number {
  let n = 0;
  for (const q of config?.questions || []) {
    for (const opt of q?.options || []) {
      if (optionTags(opt).length > 0) n++;
    }
  }
  return n;
}
