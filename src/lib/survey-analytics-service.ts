/**
 * アンケートの分析に使うデータの読み込み（サーバー専用。local = data/*.json / それ以外 = Supabase）
 * 回答・フォーム・顧客は 1000 件ずつ全件を読む（件数が欠けないように）
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/supabase-fetch-all';
import type { SurveyAnalyticsForm, SurveyAnalyticsResponse, SurveyStatCustomer } from '@/lib/survey-analytics';
import type { SurveyQuestion } from '@/types/survey';

 

function readJsonArray(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseConfig(raw: unknown): any {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function toForm(row: any): SurveyAnalyticsForm {
  const config = parseConfig(row?.config);
  const questions = Array.isArray(config?.questions) ? (config.questions as SurveyQuestion[]) : [];
  const name = String(config?.basic_info?.title || row?.name || 'アンケート');
  return { id: String(row.id), name, questions };
}

function toResponse(row: any): SurveyAnalyticsResponse {
  const raw = row?.answers ?? row?.responses ?? {};
  const answers = parseConfig(raw);
  return {
    id: String(row.id),
    survey_form_id: String(row.survey_form_id ?? ''),
    line_user_id: typeof row.line_user_id === 'string' && row.line_user_id ? row.line_user_id : null,
    submitted_at: String(row.submitted_at ?? row.created_at ?? ''),
    answers: answers && !Array.isArray(answers) ? answers : {},
  };
}

function client(): any {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c;
}

/** その店舗のアンケートフォーム（新しい順）と、すべての回答 */
export async function loadSurveyAnalyticsSource(storeId: string): Promise<{ forms: SurveyAnalyticsForm[]; responses: SurveyAnalyticsResponse[] }> {
  if (getAppEnvironment() === 'local') {
    const dir = path.join(process.cwd(), 'data');
    const forms = readJsonArray(path.join(dir, `surveys_${storeId}.json`)).filter((f) => f && typeof f.id === 'string').map(toForm);
    const responses = readJsonArray(path.join(dir, 'survey_responses.json')).filter((r) => r && r.store_id === storeId).map(toResponse);
    return { forms, responses };
  }
  const c = client();
  const formRows = await fetchAllRows<any>((from, to) => c.from('survey_forms').select('id, name, config, created_at').eq('store_id', storeId).order('created_at', { ascending: false }).range(from, to));
  const responseRows = await fetchAllRows<any>((from, to) =>
    c.from('surveys').select('id, survey_form_id, line_user_id, submitted_at, answers').eq('store_id', storeId).order('submitted_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  );
  return { forms: formRows.map(toForm), responses: responseRows.map(toResponse) };
}

/** その店舗の顧客（友だちだけの顧客は除く = 顧客一覧・顧客分析と同じ） */
export async function loadSurveyStatCustomers(storeId: string): Promise<SurveyStatCustomer[]> {
  const pick = (c: any): SurveyStatCustomer => ({
    id: String(c.id),
    line_user_id: c.line_user_id ?? null,
    total_visits: c.total_visits ?? 0,
    total_spent: c.total_spent ?? 0,
    first_visit_date: c.first_visit_date ?? null,
    last_visit_date: c.last_visit_date ?? null,
  });
  if (getAppEnvironment() === 'local') {
    return readJsonArray(path.join(process.cwd(), 'data', 'customers.json'))
      .filter((c) => c && c.store_id === storeId && c.line_friend_only !== true)
      .map(pick);
  }
  const c = client();
  const base = 'id, line_user_id, total_visits, total_spent, first_visit_date, last_visit_date';
  const load = (columns: string) => fetchAllRows<any>((from, to) => c.from('customers').select(columns).eq('store_id', storeId).order('id', { ascending: true }).range(from, to));
  let rows: any[];
  try {
    rows = await load(`${base}, line_friend_only`);
  } catch {
    // line_friend_only 列が無い環境では、絞り込みなしで読む
    rows = await load(base);
  }
  return rows.filter((r) => r.line_friend_only !== true).map(pick);
}
