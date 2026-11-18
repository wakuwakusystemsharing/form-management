/**
 * 追加質問の入れ子（追加質問の選択肢に、さらに追加質問を付ける）の純粋ロジック。
 *
 * 予約フォームの追加質問（メニュー / オプション / カスタム項目の選択肢に付ける `AdditionalQuestion`）は、
 * 回答タイプが 単一選択 / 複数選択 / ドロップダウン のとき、選択肢ごとに `additional_questions` を持てる。
 * 深さは `ADDITIONAL_QUESTION_MAX_DEPTH` 段まで（1 段目 = メニューやカスタム項目の選択肢に直接付けた追加質問）。
 *
 * 生成 HTML（static-generator-reservation.ts の `getAdditionalQuestionEntries`）にも同じ規則の実装がある。直すときは両方。
 */
import type { AdditionalQuestion } from '@/types/form';

/** 追加質問を入れ子にできる段数（アンケートの追加質問と同じ 3 段） */
export const ADDITIONAL_QUESTION_MAX_DEPTH = 3;

/** 選択肢を持つ回答タイプか（選択肢ごとの追加質問を付けられる） */
export function isChoiceQuestionType(type: unknown): boolean {
  return type === 'radio' || type === 'checkbox' || type === 'select';
}

/** 描画・集計の対象になる追加質問か（ID と質問名があるもの） */
function isUsable(q: unknown): q is AdditionalQuestion {
  const f = q as { id?: unknown; title?: unknown } | null;
  return !!f && typeof f.id === 'string' && f.id !== '' && typeof f.title === 'string' && f.title !== '';
}

export interface AdditionalQuestionNode {
  question: AdditionalQuestion;
  /** 1 = いちばん上の追加質問 */
  depth: number;
  /** 親の追加質問（いちばん上なら null）と、その質問でこの選択肢が選ばれたら表示する値 */
  parent: { question: AdditionalQuestion; value: string } | null;
  /** 祖先の追加質問の ID（上から順） */
  path: string[];
}

/**
 * 追加質問を入れ子ごと 1 列に並べる（親 → その子 → 次の親 の順）。
 * 上限の段数を超えたもの、選択肢を持たない回答タイプの下にあるものは含めない。
 */
export function flattenAdditionalQuestions(list: unknown): AdditionalQuestionNode[] {
  const out: AdditionalQuestionNode[] = [];
  const walk = (items: unknown, depth: number, parent: AdditionalQuestionNode['parent'], path: string[]) => {
    if (!Array.isArray(items) || depth > ADDITIONAL_QUESTION_MAX_DEPTH) return;
    for (const q of items) {
      if (!isUsable(q)) continue;
      out.push({ question: q, depth, parent, path });
      if (!isChoiceQuestionType(q.type)) continue;
      for (const opt of q.options || []) {
        if (!opt) continue;
        walk(opt.additional_questions, depth + 1, { question: q, value: opt.value }, [...path, q.id]);
      }
    }
  };
  walk(list, 1, null, []);
  return out;
}

/** 選択肢に付いている追加質問の数（入れ子の下も数える。編集画面のボタン「追加質問(N)」用。質問名が空でも数える） */
export function countAdditionalQuestionsDeep(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const q of list) {
    if (!q) continue;
    n += 1;
    const f = q as AdditionalQuestion;
    if (!isChoiceQuestionType(f.type)) continue;
    for (const opt of f.options || []) n += countAdditionalQuestionsDeep(opt?.additional_questions);
  }
  return n;
}
