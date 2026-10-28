/**
 * 予約の受付時に、カスタム項目の選択肢に付けたタグを予約に紐付いた顧客へ付与する（サーバー専用）
 * - 顧客はアンケートと同じ `findCustomerByLineOrPhone`（LINE ユーザー ID → 電話番号）で店舗内を検索
 *   （予約 API が `customer_id` を決めたときと同じ探し方なので同じ顧客に付く）
 * - 失敗しても予約は成功扱いにするため、呼び出し側で try/catch すること
 */
import { findCustomerByLineOrPhone, updateCustomer } from '@/lib/customer-utils';
import { collectReservationCustomFieldTags } from '@/lib/reservation-tags';
import { mergeCustomerTags } from '@/lib/survey-tags';
import type { FormConfig } from '@/types/form';

export interface ApplyReservationTagsResult {
  applied: string[];
  customerId: string | null;
  reason?: 'no_tags' | 'customer_not_found' | 'no_config';
}

export async function applyReservationCustomFieldTags(params: {
  storeId: string;
  lineUserId: string | null | undefined;
  phone: string | null | undefined;
  formConfig: Pick<FormConfig, 'custom_fields'> | null | undefined;
  customFields: Record<string, unknown> | null | undefined;
}): Promise<ApplyReservationTagsResult> {
  const { storeId, lineUserId, phone, formConfig, customFields } = params;
  if (!formConfig) return { applied: [], customerId: null, reason: 'no_config' };

  const tags = collectReservationCustomFieldTags(formConfig, customFields);
  if (tags.length === 0) return { applied: [], customerId: null, reason: 'no_tags' };

  const customer = await findCustomerByLineOrPhone(storeId, lineUserId || null, phone || null);
  if (!customer) return { applied: tags, customerId: null, reason: 'customer_not_found' };

  const merged = mergeCustomerTags(customer.tags, tags);
  const before = Array.isArray(customer.tags) ? customer.tags : [];
  const changed = merged.length !== before.length || merged.some((t, i) => before[i] !== t);
  if (changed) {
    await updateCustomer(customer.id, { tags: merged });
  }
  return { applied: tags, customerId: customer.id };
}
