/**
 * 予約フォームのカスタム項目の選択肢に付けたタグを、送信内容から集める純粋ロジック（クライアント / サーバー共用）
 * - 送信内容は静的 HTML が `customer_info.custom_fields` で送る形式: { [項目 ID]: 値 }
 *   （単一選択 / ドロップダウンは選択肢の value、複数選択は配列。古い形式の ", " 区切り文字列も受け付ける）
 * - 対象はカスタム項目（`config.custom_fields`）の選択肢のみ（追加質問の選択肢は対象外）
 */
import type { FormConfig } from '@/types/form';
import { normalizeTags } from '@/lib/customer-chart';

type CustomFieldValues = Record<string, unknown>;

function selectedValues(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  const text = String(raw);
  if (!text) return [];
  const parts = text.split(', ').map((s) => s.trim()).filter(Boolean);
  return parts.includes(text) ? parts : [text, ...parts];
}

/** 送信内容で選ばれたカスタム項目の選択肢に設定されたタグをすべて集める（重複除去・正規化済み） */
export function collectReservationCustomFieldTags(
  config: Pick<FormConfig, 'custom_fields'> | null | undefined,
  customFields: CustomFieldValues | null | undefined
): string[] {
  if (!config || !customFields || typeof customFields !== 'object') return [];
  const collected: string[] = [];
  for (const field of config.custom_fields || []) {
    if (!field || !Array.isArray(field.options) || field.options.length === 0) continue;
    if (field.type !== 'radio' && field.type !== 'checkbox' && field.type !== 'select') continue;
    const values = selectedValues(customFields[field.id]);
    if (values.length === 0) continue;
    for (const opt of field.options) {
      if (!opt || !Array.isArray(opt.tags) || opt.tags.length === 0) continue;
      if (values.includes(opt.value) || values.includes(opt.label)) collected.push(...opt.tags);
    }
  }
  return normalizeTags(collected);
}

/** 設定画面の表示用: タグを付けた選択肢の数 */
export function countReservationTaggedOptions(config: Pick<FormConfig, 'custom_fields'> | null | undefined): number {
  let n = 0;
  for (const field of config?.custom_fields || []) {
    for (const opt of field?.options || []) if (Array.isArray(opt?.tags) && opt.tags.length > 0) n++;
  }
  return n;
}
