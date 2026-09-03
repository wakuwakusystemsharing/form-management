/**
 * 抽選フォーム設定の検証（クライアント / サーバー共用の純粋関数）
 *
 * 編集画面（クライアント）でも使うため、DB や fs に依存するモジュールを import しない。
 */
import type { LotteryConfig } from '@/types/lottery';
import type { SurveyQuestion } from '@/types/survey';
import { validatePrizes } from '@/lib/lottery-engine';

/**
 * 保存（PUT）時の config 検証。エラー文言の配列を返す（空 = OK）。
 * 賞品まわりは validatePrizes、それ以外（締切・事前質問）はここで見る。
 */
export function validateLotteryConfigForSave(config: LotteryConfig): string[] {
  const errors = validatePrizes(config).map((e) => e.message);
  if (!config.basic_info.title.trim()) errors.push('タイトルを入力してください');
  if (config.lottery_type === 'deferred') {
    const end = config.basic_info.period?.end_at;
    if (!end || Number.isNaN(new Date(end).getTime())) {
      errors.push('後日抽選では応募締切（受付期間の終了日時）が必須です');
    }
  }
  const period = config.basic_info.period;
  if (period?.start_at && period?.end_at) {
    const s = new Date(period.start_at).getTime();
    const e = new Date(period.end_at).getTime();
    if (!Number.isNaN(s) && !Number.isNaN(e) && s > e) errors.push('受付期間の開始日時が終了日時より後になっています');
  }
  const seenQuestionIds = new Set<string>();
  for (const q of config.entry_rules.pre_questions) {
    if (!q || typeof q !== 'object' || !q.id) {
      errors.push('事前質問の ID が不正です');
      continue;
    }
    if (seenQuestionIds.has(q.id)) errors.push(`事前質問の ID が重複しています（${q.id}）`);
    seenQuestionIds.add(q.id);
    if (!q.title || !q.title.trim()) errors.push('事前質問のタイトルを入力してください');
  }
  return [...new Set(errors)];
}

/** 事前質問の必須チェック。回答は質問 ID またはタイトルをキーとして受け付ける */
export function findMissingRequiredAnswers(questions: SurveyQuestion[], answers: Record<string, unknown> | null): string[] {
  const missing: string[] = [];
  for (const q of questions) {
    if (!q.required) continue;
    const value = answers?.[q.id] ?? answers?.[q.title];
    const empty =
      value === undefined || value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);
    if (empty) missing.push(q.title);
  }
  return missing;
}
