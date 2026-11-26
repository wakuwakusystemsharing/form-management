/**
 * アンケート回答の送信時に、回答を回答者の顧客情報へ入れる（サーバー専用）
 * - 顧客は LINE ユーザー ID で店舗内を探す。居なければ、入れる回答があるときだけ顧客を作る
 * - LINE ユーザー ID の無い回答（LINE の外で開いたフォーム）では何もしない
 * - 電話番号は、同じ店舗のほかの顧客がすでに使っていれば入れない（別の人の番号で上書きしない）
 * - 例外は呼び出し側で try/catch する（回答の保存は成功扱いのまま）
 */
import { createCustomer, findCustomerByLineOrPhone, updateCustomer } from '@/lib/customer-utils';
import { loadSurveyConfig } from '@/lib/survey-tags-apply';
import { buildCustomerFieldPatch, buildCustomerRowFromSurvey, collectSurveyCustomerFieldValues, type SurveyCustomerFieldValue } from '@/lib/survey-customer-fields';
import type { CustomerInsert, CustomerUpdate } from '@/types/form';

export interface ApplySurveyCustomerFieldsResult {
  customerId: string | null;
  created: boolean;
  /** 書き換えた（新しく入れた）項目 */
  fields: string[];
  reason?: 'no_line_user' | 'form_not_found' | 'no_values' | 'no_change';
  error?: string;
}

/** ほかの顧客が使っている電話番号は外す */
async function dropTakenPhone(storeId: string, selfId: string | null, values: SurveyCustomerFieldValue[]): Promise<SurveyCustomerFieldValue[]> {
  const phone = values.find((v) => v.target === 'phone');
  if (!phone) return values;
  const owner = await findCustomerByLineOrPhone(storeId, null, phone.value);
  return owner && owner.id !== selfId ? values.filter((v) => v !== phone) : values;
}

export async function applySurveyCustomerFields(params: {
  storeId: string;
  surveyFormId: string;
  responses: Record<string, unknown>;
  lineUserId: string | null | undefined;
  lineDisplayName?: string | null;
  lineFriend?: boolean;
  now?: Date;
}): Promise<ApplySurveyCustomerFieldsResult> {
  const { storeId, surveyFormId, responses, lineUserId } = params;
  if (!lineUserId) return { customerId: null, created: false, fields: [], reason: 'no_line_user' };

  const config = await loadSurveyConfig(surveyFormId);
  if (!config) return { customerId: null, created: false, fields: [], reason: 'form_not_found' };

  const collected = collectSurveyCustomerFieldValues(config, responses, params.now ?? new Date());
  if (collected.length === 0) return { customerId: null, created: false, fields: [], reason: 'no_values' };

  let customer = await findCustomerByLineOrPhone(storeId, lineUserId, null);

  if (!customer) {
    const values = await dropTakenPhone(storeId, null, collected);
    const row = buildCustomerRowFromSurvey({ storeId, lineUserId, lineDisplayName: params.lineDisplayName, lineFriend: params.lineFriend, values });
    try {
      const created = await createCustomer(row as unknown as CustomerInsert);
      const base = new Set(['store_id', 'line_user_id', 'name', 'line_display_name', 'line_friend_flag', 'customer_type', 'tags']);
      const fields = Object.keys(row).filter((k) => !base.has(k));
      if (values.some((v) => v.target === 'name')) fields.unshift('name');
      return { customerId: created.id, created: true, fields };
    } catch (e) {
      // 同時に届いた別の処理（友だち追加の通知など）が先に顧客を作ったときは、その顧客に入れる
      customer = await findCustomerByLineOrPhone(storeId, lineUserId, null);
      if (!customer) return { customerId: null, created: false, fields: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  const values = await dropTakenPhone(storeId, customer.id, collected);
  const patch = buildCustomerFieldPatch(customer as unknown as Parameters<typeof buildCustomerFieldPatch>[0], values);
  const fields = Object.keys(patch).filter((k) => k !== 'line_friend_only');
  if (Object.keys(patch).length === 0) return { customerId: customer.id, created: false, fields: [], reason: 'no_change' };
  await updateCustomer(customer.id, patch as CustomerUpdate);
  return { customerId: customer.id, created: false, fields };
}
