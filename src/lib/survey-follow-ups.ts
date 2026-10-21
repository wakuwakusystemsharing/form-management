/**
 * アンケート / 抽選フォームの「選択肢ごとの追加質問」の純粋ロジック（クライアント / サーバー共用。DOM 非依存）
 * - 1 つの選択肢に複数の追加質問（`follow_ups`）。旧形式 `follow_up`（1 件）も読み取れる
 * - 追加質問の選択肢にもさらに追加質問を付けられる（入れ子。深さは `SURVEY_FOLLOW_UP_MAX_DEPTH` まで）
 * - 回答のキー（`responses` のキー）の決め方は静的 HTML のランタイム（`survey-follow-up-runtime-js.ts`）と同じ
 */
import type { SurveyFollowUpQuestion, SurveyFollowUpType, SurveyQuestion, SurveyQuestionOption } from '@/types/survey';

/** 追加質問の入れ子の最大深さ（質問 → 追加質問 = 1、その追加質問 = 2、さらにその追加質問 = 3。質問を含めて 4 段階） */
export const SURVEY_FOLLOW_UP_MAX_DEPTH = 3;

/** 選択肢に付いている追加質問の一覧（旧形式 `follow_up` も含む。無効なものも含む = 並び順の index を保つため） */
export function getOptionFollowUps(opt: SurveyQuestionOption | null | undefined): SurveyFollowUpQuestion[] {
  if (!opt) return [];
  if (Array.isArray(opt.follow_ups)) return opt.follow_ups.filter((fu) => fu && typeof fu === 'object');
  if (opt.follow_up && typeof opt.follow_up === 'object') return [opt.follow_up];
  return [];
}

/** 有効な追加質問だけ */
export function getEnabledFollowUps(opt: SurveyQuestionOption | null | undefined): SurveyFollowUpQuestion[] {
  return getOptionFollowUps(opt).filter((fu) => fu.enabled === true);
}

/** 追加質問の一覧を選択肢に書き戻す（新形式 `follow_ups` に統一し、旧形式 `follow_up` は消す） */
export function setOptionFollowUps(opt: SurveyQuestionOption, list: SurveyFollowUpQuestion[]): SurveyQuestionOption {
  const next: SurveyQuestionOption = { ...opt };
  delete next.follow_up;
  if (list.length > 0) next.follow_ups = list;
  else delete next.follow_ups;
  return next;
}

export function isChoiceFollowUpType(type: SurveyFollowUpType | string | undefined): boolean {
  return type === 'radio' || type === 'checkbox' || type === 'select';
}

export function createFollowUp(partial: Partial<SurveyFollowUpQuestion> = {}): SurveyFollowUpQuestion {
  return {
    id: `fu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    title: '',
    type: 'text',
    ...partial,
  };
}

/** 追加質問の表示タイトル（文言が空なら「親の質問名（選択肢名）」） */
export function followUpTitle(fu: SurveyFollowUpQuestion, parentTitle: string, optionLabel: string): string {
  const t = String(fu.title || '').trim();
  return t || `${parentTitle}（${optionLabel}）`;
}

/**
 * `responses` に入れるキー。同名キーが既にあれば「（選択肢名）」を付け、それも重複すれば末尾に番号を付ける。
 * 静的 HTML のランタイム `fuResponseKey` と同じ規則
 */
export function resolveFollowUpResponseKey(title: string, optionLabel: string, exists: (key: string) => boolean): string {
  if (!exists(title)) return title;
  const withLabel = `${title}（${optionLabel}）`;
  if (!exists(withLabel)) return withLabel;
  let n = 2;
  while (exists(`${withLabel} ${n}`)) n++;
  return `${withLabel} ${n}`;
}

/** 回答のキー候補（`resolveFollowUpResponseKey` が生成しうる順）。回答から追加質問の値を探すときに使う */
export function followUpResponseKeyCandidates(title: string, optionLabel: string, max = 10): string[] {
  const withLabel = `${title}（${optionLabel}）`;
  const out = [title, withLabel];
  for (let n = 2; n < 2 + max; n++) out.push(`${withLabel} ${n}`);
  return out;
}

/** 質問（または追加質問）の配下にある有効な追加質問の総数（入れ子を含む。編集画面のバッジ用） */
export function countFollowUpsDeep(options: SurveyQuestionOption[] | undefined): number {
  let n = 0;
  for (const opt of options || []) {
    for (const fu of getEnabledFollowUps(opt)) {
      n += 1 + (isChoiceFollowUpType(fu.type) ? countFollowUpsDeep(fu.options) : 0);
    }
  }
  return n;
}

/** 追加質問の最大深さ（入れ子が無ければ 0。編集画面・検証用） */
export function followUpDepth(options: SurveyQuestionOption[] | undefined): number {
  let depth = 0;
  for (const opt of options || []) {
    for (const fu of getOptionFollowUps(opt)) {
      const d = 1 + (isChoiceFollowUpType(fu.type) ? followUpDepth(fu.options) : 0);
      if (d > depth) depth = d;
    }
  }
  return depth;
}

/**
 * 質問一覧の追加質問をすべて新形式（`follow_ups`）に揃える（旧形式 `follow_up` を移行。入れ子も再帰）
 * 編集画面で保存する前に通す。データの意味は変えない
 */
export function normalizeQuestionFollowUps(questions: SurveyQuestion[]): SurveyQuestion[] {
  return questions.map((q) => (Array.isArray(q.options) ? { ...q, options: normalizeOptions(q.options) } : q));
}

function normalizeOptions(options: SurveyQuestionOption[]): SurveyQuestionOption[] {
  return options.map((opt) => {
    const list = getOptionFollowUps(opt).map((fu) =>
      isChoiceFollowUpType(fu.type) && Array.isArray(fu.options) ? { ...fu, options: normalizeOptions(fu.options) } : fu
    );
    return setOptionFollowUps(opt, list);
  });
}
