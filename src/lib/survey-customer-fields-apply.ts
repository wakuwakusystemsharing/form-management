/**
 * アンケート回答の送信時に、回答を回答者の顧客情報へ入れる（サーバー専用）
 * - 顧客は LINE ユーザー ID で店舗内を探す。居なければ、入れる回答があるときだけ顧客を作る
 * - LINE ユーザー ID の無い回答（LINE の外で開いたフォーム）では何もしない
 * - 電話番号は、同じ店舗のほかの顧客がすでに使っていれば入れない（別の人の番号で上書きしない）
 * - アイコン画像: アンケートのフォームは LINE のプロフィール画像を送ってこないので、顧客を作るとき・
 *   アイコン画像がまだ無い顧客のときに、サーバーから LINE に問い合わせて入れる（友だちでない人は取れない = 空のまま）
 * - 例外は呼び出し側で try/catch する（回答の保存は成功扱いのまま）
 */
import { createCustomer, findCustomerByLineOrPhone, updateCustomer } from '@/lib/customer-utils';
import { getAppEnvironment } from '@/lib/env';
import { fetchLineProfile, type LineProfile } from '@/lib/line-friend-customers';
import { createAdminClient } from '@/lib/supabase';
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

export type SurveyLineProfileLoader = (storeId: string, lineUserId: string) => Promise<LineProfile | null>;

/** アンケートの送信を待たせすぎないよう、プロフィールの取得はこの時間で打ち切る */
export const SURVEY_PROFILE_TIMEOUT_MS = 3000;

/**
 * その店舗の公式 LINE から、回答者のプロフィール（アイコン画像など）を取る。
 * 取れないとき（local・トークン無し・友だちでない・時間切れ）は null。例外を投げない
 */
export const loadSurveyLineProfile: SurveyLineProfileLoader = async (storeId, lineUserId) => {
  try {
    if (getAppEnvironment() === 'local') return null;
    const client = createAdminClient();
    if (!client) return null;
    const { data } = await (client as any).from('stores').select('line_channel_access_token').eq('id', storeId).maybeSingle();
    const token = typeof data?.line_channel_access_token === 'string' ? data.line_channel_access_token.trim() : '';
    if (!token) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SURVEY_PROFILE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([fetchLineProfile(token, lineUserId), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return null;
  }
};

/** プロフィールから、顧客の空いている LINE の項目に入れる内容（アイコン画像が取れなかったときは {}） */
export function lineProfilePatch(existing: { line_picture_url?: string | null; line_display_name?: string | null; line_status_message?: string | null; line_language?: string | null }, profile: LineProfile | null): Record<string, unknown> {
  if (!profile) return {};
  const patch: Record<string, unknown> = {};
  if (!existing.line_picture_url && profile.pictureUrl) patch.line_picture_url = profile.pictureUrl;
  if (!existing.line_display_name && profile.displayName) patch.line_display_name = profile.displayName;
  if (!existing.line_status_message && profile.statusMessage) patch.line_status_message = profile.statusMessage;
  if (!existing.line_language && profile.language) patch.line_language = profile.language;
  return patch;
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
  /** テスト用の差し替え */
  loadProfile?: SurveyLineProfileLoader;
}): Promise<ApplySurveyCustomerFieldsResult> {
  const { storeId, surveyFormId, responses, lineUserId } = params;
  if (!lineUserId) return { customerId: null, created: false, fields: [], reason: 'no_line_user' };

  const config = await loadSurveyConfig(surveyFormId);
  if (!config) return { customerId: null, created: false, fields: [], reason: 'form_not_found' };

  const collected = collectSurveyCustomerFieldValues(config, responses, params.now ?? new Date());
  if (collected.length === 0) return { customerId: null, created: false, fields: [], reason: 'no_values' };

  const loadProfile = params.loadProfile ?? loadSurveyLineProfile;
  let customer = await findCustomerByLineOrPhone(storeId, lineUserId, null);
  // アイコン画像がまだ無いとき（これから作る顧客を含む）だけ、LINE に問い合わせる
  const profile = !customer || !customer.line_picture_url ? await loadProfile(storeId, lineUserId).catch(() => null) : null;

  if (!customer) {
    const values = await dropTakenPhone(storeId, null, collected);
    const displayName = params.lineDisplayName?.trim() || profile?.displayName || null;
    const base = buildCustomerRowFromSurvey({ storeId, lineUserId, lineDisplayName: displayName, lineFriend: params.lineFriend, values });
    const row = { ...base, ...lineProfilePatch({ line_display_name: displayName }, profile) };
    try {
      const created = await createCustomer(row as unknown as CustomerInsert);
      const skip = new Set(['store_id', 'line_user_id', 'name', 'line_display_name', 'line_friend_flag', 'customer_type', 'tags', 'line_picture_url', 'line_status_message', 'line_language']);
      const fields = Object.keys(row).filter((k) => !skip.has(k));
      if (values.some((v) => v.target === 'name')) fields.unshift('name');
      return { customerId: created.id, created: true, fields };
    } catch (e) {
      // 同時に届いた別の処理（友だち追加の通知など）が先に顧客を作ったときは、その顧客に入れる
      customer = await findCustomerByLineOrPhone(storeId, lineUserId, null);
      if (!customer) return { customerId: null, created: false, fields: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  const values = await dropTakenPhone(storeId, customer.id, collected);
  const fieldPatch = buildCustomerFieldPatch(customer as unknown as Parameters<typeof buildCustomerFieldPatch>[0], values);
  const fields = Object.keys(fieldPatch).filter((k) => k !== 'line_friend_only');
  const patch = { ...fieldPatch, ...lineProfilePatch(customer, profile) };
  if (Object.keys(patch).length === 0) return { customerId: customer.id, created: false, fields: [], reason: 'no_change' };
  await updateCustomer(customer.id, patch as CustomerUpdate);
  return fields.length > 0 ? { customerId: customer.id, created: false, fields } : { customerId: customer.id, created: false, fields: [], reason: 'no_change' };
}
