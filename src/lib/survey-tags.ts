/**
 * アンケートの選択肢に付けたタグを、回答内容から集める純粋ロジック（クライアント / サーバー共用）
 * - 回答は静的 HTML が送る形式: { [質問タイトル]: 値 }。radio / select は選択肢のラベル、checkbox は ", " 区切り
 * - 「その他」は理由テキストになるためタグ対象外
 * - 追加質問（複数・入れ子）の選択肢に付けたタグも集める。追加質問の回答は `followUpTitle` をキーに保存されている
 *   （同名があれば「（選択肢名）」「（選択肢名） 2」… = `followUpResponseKeyCandidates`）
 */
import type { SurveyConfig, SurveyQuestionOption } from '@/types/survey';
import { normalizeTags } from '@/lib/customer-chart';
import { followUpResponseKeyCandidates, followUpTitle, getEnabledFollowUps, isChoiceFollowUpType } from '@/lib/survey-follow-ups';

type ResponseMap = Record<string, unknown>;

function optionTags(opt: SurveyQuestionOption | undefined): string[] {
  return normalizeTags(opt?.tags);
}

function selectedLabels(type: string, raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  const text = String(raw);
  if (!text) return [];
  if (type === 'checkbox') {
    // 送信形式は ", " 区切り。ラベル自体に ", " を含む選択肢は完全一致でも拾う
    const parts = text.split(', ').map((s) => s.trim()).filter(Boolean);
    return parts.includes(text) ? parts : [text, ...parts];
  }
  return [text];
}

/**
 * 選択肢一覧のうち回答で選ばれたもののタグを集め、その選択肢の追加質問（入れ子）も再帰的にたどる
 * @param consumed 既に対応付けた回答キー（同名の追加質問が複数あるときに同じ回答を二重に使わないため）
 */
function collectFromOptions(
  parentTitle: string,
  options: SurveyQuestionOption[],
  labels: string[],
  responses: ResponseMap,
  consumed: Set<string>,
  collected: string[]
): void {
  for (const opt of options) {
    if (!opt) continue;
    const selected = labels.includes(opt.label) || labels.includes(opt.value);
    if (!selected) continue;
    collected.push(...optionTags(opt));
    for (const fu of getEnabledFollowUps(opt)) {
      if (!isChoiceFollowUpType(fu.type) || !Array.isArray(fu.options) || fu.options.length === 0) continue;
      const title = followUpTitle(fu, parentTitle, opt.label);
      const key = followUpResponseKeyCandidates(title, opt.label).find(
        (k) => Object.prototype.hasOwnProperty.call(responses, k) && !consumed.has(k)
      );
      if (!key) continue;
      consumed.add(key);
      const fuLabels = selectedLabels(fu.type, responses[key]);
      if (fuLabels.length === 0) continue;
      collectFromOptions(title, fu.options, fuLabels, responses, consumed, collected);
    }
  }
}

/**
 * 回答で選ばれた選択肢に設定されたタグをすべて集める（重複除去・正規化済み。追加質問の選択肢も含む）
 */
export function collectSurveyOptionTags(config: SurveyConfig | null | undefined, responses: ResponseMap | null | undefined): string[] {
  if (!config || !responses || typeof responses !== 'object') return [];
  const collected: string[] = [];
  const consumed = new Set<string>();
  for (const question of config.questions || []) {
    if (!question || !Array.isArray(question.options) || question.options.length === 0) continue;
    if (question.type !== 'radio' && question.type !== 'checkbox' && question.type !== 'select') continue;
    const labels = selectedLabels(question.type, responses[question.title]);
    if (labels.length === 0) continue;
    consumed.add(question.title);
    collectFromOptions(question.title, question.options, labels, responses, consumed, collected);
  }
  return normalizeTags(collected);
}

/**
 * 既存タグに新しいタグを追加した結果（順序は既存 → 追加。上限は normalizeTags に従う）
 */
export function mergeCustomerTags(existing: unknown, added: string[]): string[] {
  return normalizeTags([...normalizeTags(existing), ...added]);
}

function countTaggedInOptions(options: SurveyQuestionOption[] | undefined): number {
  let n = 0;
  for (const opt of options || []) {
    if (optionTags(opt).length > 0) n++;
    for (const fu of getEnabledFollowUps(opt)) {
      if (isChoiceFollowUpType(fu.type)) n += countTaggedInOptions(fu.options);
    }
  }
  return n;
}

/**
 * アンケート設定の中でタグが設定されている選択肢の数（追加質問の選択肢も含む。編集画面の表示用）
 */
export function countTaggedOptions(config: SurveyConfig | null | undefined): number {
  let n = 0;
  for (const q of config?.questions || []) n += countTaggedInOptions(q?.options);
  return n;
}
