/**
 * アンケート回答の送信時に、選ばれた選択肢のタグを回答者の顧客レコードへ付与する（サーバー専用）
 * - 顧客は LINE ユーザー ID で店舗内を検索。見つからない場合は何もしない（顧客の自動作成はしない）
 * - 失敗しても回答の保存は成功扱いにするため、呼び出し側で try/catch すること
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { findCustomerByLineOrPhone, updateCustomer } from '@/lib/customer-utils';
import { collectSurveyOptionTags, mergeCustomerTags } from '@/lib/survey-tags';
import type { SurveyConfig, SurveyForm } from '@/types/survey';

const DATA_DIR = path.join(process.cwd(), 'data');

async function loadSurveyConfig(surveyFormId: string): Promise<SurveyConfig | null> {
  if (getAppEnvironment() === 'local') {
    if (!fs.existsSync(DATA_DIR)) return null;
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('surveys_') && f.endsWith('.json'));
    for (const file of files) {
      const forms = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as SurveyForm[];
      const form = forms.find((f) => f.id === surveyFormId);
      if (form) return form.config ?? null;
    }
    return null;
  }
  const adminClient = createAdminClient();
  if (!adminClient) return null;
  const { data, error } = await adminClient.from('survey_forms').select('config').eq('id', surveyFormId).maybeSingle();
  if (error || !data) return null;
  const raw = (data as { config: unknown }).config;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SurveyConfig;
    } catch {
      return null;
    }
  }
  return (raw as SurveyConfig) ?? null;
}

export interface ApplySurveyTagsResult {
  applied: string[];
  customerId: string | null;
  reason?: 'no_line_user' | 'no_tags' | 'customer_not_found' | 'form_not_found';
}

export async function applySurveyTagsToCustomer(params: {
  storeId: string;
  surveyFormId: string;
  responses: Record<string, unknown>;
  lineUserId: string | null | undefined;
}): Promise<ApplySurveyTagsResult> {
  const { storeId, surveyFormId, responses, lineUserId } = params;
  if (!lineUserId) return { applied: [], customerId: null, reason: 'no_line_user' };

  const config = await loadSurveyConfig(surveyFormId);
  if (!config) return { applied: [], customerId: null, reason: 'form_not_found' };

  const tags = collectSurveyOptionTags(config, responses);
  if (tags.length === 0) return { applied: [], customerId: null, reason: 'no_tags' };

  const customer = await findCustomerByLineOrPhone(storeId, lineUserId, null);
  if (!customer) return { applied: tags, customerId: null, reason: 'customer_not_found' };

  const merged = mergeCustomerTags(customer.tags, tags);
  const before = Array.isArray(customer.tags) ? customer.tags : [];
  const changed = merged.length !== before.length || merged.some((t, i) => before[i] !== t);
  if (changed) {
    await updateCustomer(customer.id, { tags: merged });
  }
  return { applied: tags, customerId: customer.id };
}
