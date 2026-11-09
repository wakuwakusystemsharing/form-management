/**
 * アンケート回答の Google スプレッドシート自動転記（サーバー専用。Google Sheets API / DB に依存）
 *
 * - 認証はマスター管理に登録したサービスアカウント（カレンダー作成と同じもの）。
 *   店舗（弊社）はスプレッドシートをサービスアカウントのメールアドレスに「編集者」で共有する
 * - 回答が届くたびに syncSurveyResponseToSheet() で 1 行追記。失敗しても回答の保存は成功扱い（ログのみ）
 * - 「過去の回答を書き出す」は exportUnsyncedSurveyResponses()（sheet_synced_at が空の回答だけ）
 * - 純粋ロジック（見出しのマージ・行の組み立て）は src/lib/survey-sheets.ts
 */
import fs from 'fs';
import path from 'path';
import { google, type sheets_v4 } from 'googleapis';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { getServiceAccountCredentials } from '@/lib/google-service-account';
import { loadSurveyConfig } from '@/lib/survey-tags-apply';
import {
  buildSurveySheetRow,
  mergeSurveySheetHeader,
  quoteSheetName,
  resolveSurveySheetsSettings,
  type ResolvedSurveySheetsSettings,
  type SurveySheetResponse,
} from '@/lib/survey-sheets';

const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const DATA_DIR = path.join(process.cwd(), 'data');
const SURVEY_RESPONSES_FILE = path.join(DATA_DIR, 'survey_responses.json');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

/** 1 回の「過去の回答を書き出す」で処理する上限（超えた分は remaining で返し、もう一度押してもらう） */
export const SURVEY_SHEET_EXPORT_MAX = 1000;
const APPEND_CHUNK = 200;

export const SERVICE_ACCOUNT_MISSING_MESSAGE = 'Google サービスアカウントが設定されていません（マスター管理 → 設定）';

export interface SheetSyncResult {
  ok: boolean;
  appended: number;
  error?: string;
}

export interface SheetConnectionInfo {
  ok: true;
  title: string;
  sheetTitles: string[];
  sheetExists: boolean; // 指定したタブがあるか（未指定なら true）
  url: string;
}

export interface SheetConnectionError {
  ok: false;
  error: string;
}

type SheetsClient = sheets_v4.Sheets;

async function getSheetsClient(): Promise<SheetsClient | null> {
  const creds = await getServiceAccountCredentials();
  if (!creds) return null;
  const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: SHEETS_SCOPES });
  return google.sheets({ version: 'v4', auth });
}

/** Google API のエラーを店舗向けの日本語に */
export function describeSheetsError(error: unknown, serviceAccountEmail?: string | null): string {
  const e = error as { code?: number | string; status?: number; message?: string; errors?: Array<{ message?: string }> };
  const code = Number(e?.code ?? e?.status ?? 0);
  const raw = e?.errors?.[0]?.message || e?.message || String(error);
  if (code === 403) {
    return `スプレッドシートへのアクセス権がありません。${serviceAccountEmail ? `「${serviceAccountEmail}」` : 'サービスアカウント'}を「編集者」として共有してください`;
  }
  if (code === 404) return 'スプレッドシートが見つかりません。ID（URL）を確認してください';
  if (code === 400 && /Unable to parse range/i.test(raw)) return '指定したシート名（タブ）が見つかりません';
  if (code === 429) return 'Google の API 利用上限に達しました。しばらくしてからお試しください';
  return `スプレッドシートへの書き込みに失敗しました: ${raw}`;
}

async function getSpreadsheetMeta(sheets: SheetsClient, spreadsheetId: string) {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties(title,sheetId)' });
  const sheetTitles = (res.data.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean);
  return { title: res.data.properties?.title ?? '', sheetTitles };
}

/** 接続確認（ID と共有が正しいか、タブがあるか） */
export async function testSurveySheetConnection(settings: ResolvedSurveySheetsSettings): Promise<SheetConnectionInfo | SheetConnectionError> {
  const creds = await getServiceAccountCredentials();
  if (!creds) return { ok: false, error: SERVICE_ACCOUNT_MISSING_MESSAGE };
  const sheets = await getSheetsClient();
  if (!sheets) return { ok: false, error: SERVICE_ACCOUNT_MISSING_MESSAGE };
  try {
    const meta = await getSpreadsheetMeta(sheets, settings.spreadsheetId);
    return {
      ok: true,
      title: meta.title,
      sheetTitles: meta.sheetTitles,
      sheetExists: settings.sheetName ? meta.sheetTitles.includes(settings.sheetName) : true,
      url: `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`,
    };
  } catch (error) {
    return { ok: false, error: describeSheetsError(error, creds.client_email) };
  }
}

/**
 * 回答を末尾に追記する（見出し行の作成・列の追加・タブの自動作成を含む）
 * 呼び出し側で try/catch すること。Vitest から偽の Sheets クライアントで検証するため export
 */
export async function appendResponsesToSheet(sheets: SheetsClient, settings: ResolvedSurveySheetsSettings, responses: SurveySheetResponse[]): Promise<number> {
  if (responses.length === 0) return 0;
  const meta = await getSpreadsheetMeta(sheets, settings.spreadsheetId);
  let tabTitle = settings.sheetName ?? meta.sheetTitles[0] ?? 'シート1';
  if (settings.sheetName && !meta.sheetTitles.includes(settings.sheetName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: settings.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: settings.sheetName } } }] },
    });
    tabTitle = settings.sheetName;
  }
  const quoted = quoteSheetName(tabTitle);

  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: settings.spreadsheetId, range: `${quoted}!1:1` });
  const existingHeader = (headerRes.data.values?.[0] ?? []).map((v) => String(v ?? ''));
  const { header, added } = mergeSurveySheetHeader(existingHeader, responses.map((r) => r.responses), settings.plan);
  if (added.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: settings.spreadsheetId,
      range: `${quoted}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });
  }

  let appended = 0;
  for (let i = 0; i < responses.length; i += APPEND_CHUNK) {
    const chunk = responses.slice(i, i + APPEND_CHUNK);
    await sheets.spreadsheets.values.append({
      spreadsheetId: settings.spreadsheetId,
      range: `${quoted}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: chunk.map((r) => buildSurveySheetRow(r, header, settings.plan)) },
    });
    appended += chunk.length;
  }
  return appended;
}

// ---------------------------------------------------------------------------
// 回答の読み書き（local = JSON / staging・production = Supabase `surveys`）
// ---------------------------------------------------------------------------

interface StoredResponseRow {
  id: string;
  survey_form_id: string;
  store_id: string;
  responses?: Record<string, unknown> | null;
  answers?: Record<string, unknown> | null;
  line_user_id?: string | null;
  line_display_name?: string | null;
  submitted_at?: string | null;
  sheet_synced_at?: string | null;
}

function toSheetResponse(row: StoredResponseRow): SurveySheetResponse {
  return {
    id: row.id,
    submitted_at: row.submitted_at,
    line_user_id: row.line_user_id ?? null,
    line_display_name: row.line_display_name ?? null,
    responses: row.answers ?? row.responses ?? {},
  };
}

function readLocalResponses(): StoredResponseRow[] {
  if (!fs.existsSync(SURVEY_RESPONSES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SURVEY_RESPONSES_FILE, 'utf-8')) as StoredResponseRow[];
  } catch {
    return [];
  }
}

async function loadUnsyncedResponses(surveyFormId: string, storeId: string, limit: number): Promise<{ rows: StoredResponseRow[]; error?: string }> {
  if (getAppEnvironment() === 'local') {
    const rows = readLocalResponses()
      .filter((r) => r.survey_form_id === surveyFormId && r.store_id === storeId && !r.sheet_synced_at)
      .sort((a, b) => new Date(a.submitted_at ?? 0).getTime() - new Date(b.submitted_at ?? 0).getTime());
    return { rows: rows.slice(0, limit) };
  }
  const adminClient = createAdminClient();
  if (!adminClient) return { rows: [], error: 'Supabase 接続エラー' };
  const { data, error } = await (adminClient as any)
    .from('surveys')
    .select('*')
    .eq('survey_form_id', surveyFormId)
    .eq('store_id', storeId)
    .is('sheet_synced_at', null)
    .order('submitted_at', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('[SurveySheets] 未転記の回答の取得に失敗:', error);
    return { rows: [], error: `回答の取得に失敗しました: ${error.message}` };
  }
  return { rows: (data ?? []) as StoredResponseRow[] };
}

export async function countUnsyncedSurveyResponses(surveyFormId: string, storeId: string): Promise<number | null> {
  if (getAppEnvironment() === 'local') {
    return readLocalResponses().filter((r) => r.survey_form_id === surveyFormId && r.store_id === storeId && !r.sheet_synced_at).length;
  }
  const adminClient = createAdminClient();
  if (!adminClient) return null;
  const { count, error } = await (adminClient as any)
    .from('surveys')
    .select('id', { count: 'exact', head: true })
    .eq('survey_form_id', surveyFormId)
    .eq('store_id', storeId)
    .is('sheet_synced_at', null);
  if (error) {
    console.error('[SurveySheets] 未転記件数の取得に失敗:', error);
    return null;
  }
  return count ?? 0;
}

async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  if (getAppEnvironment() === 'local') {
    const rows = readLocalResponses();
    const set = new Set(ids);
    for (const r of rows) if (set.has(r.id)) r.sheet_synced_at = now;
    fs.writeFileSync(SURVEY_RESPONSES_FILE, JSON.stringify(rows, null, 2));
    return;
  }
  const adminClient = createAdminClient();
  if (!adminClient) return;
  const { error } = await (adminClient as any).from('surveys').update({ sheet_synced_at: now }).in('id', ids);
  if (error) {
    // 列が無い（マイグレーション未適用）などは転記自体には影響しないのでログのみ
    console.error('[SurveySheets] sheet_synced_at の更新に失敗:', error);
  }
}

/** 表示名が無い回答は、LINE ユーザー ID で顧客台帳の名前を補う */
async function fillDisplayNames(storeId: string, responses: SurveySheetResponse[]): Promise<void> {
  const missing = responses.filter((r) => !r.line_display_name && r.line_user_id);
  if (missing.length === 0) return;
  const ids = Array.from(new Set(missing.map((r) => r.line_user_id as string)));
  const names = new Map<string, string>();
  try {
    if (getAppEnvironment() === 'local') {
      if (fs.existsSync(CUSTOMERS_FILE)) {
        const customers = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf-8')) as Array<{ store_id: string; line_user_id?: string | null; name?: string | null }>;
        for (const c of customers) {
          if (c.store_id === storeId && c.line_user_id && c.name && ids.includes(c.line_user_id)) names.set(c.line_user_id, c.name);
        }
      }
    } else {
      const adminClient = createAdminClient();
      if (adminClient) {
        const { data } = await (adminClient as any).from('customers').select('line_user_id, name').eq('store_id', storeId).in('line_user_id', ids);
        for (const c of (data ?? []) as Array<{ line_user_id: string; name: string | null }>) {
          if (c.line_user_id && c.name) names.set(c.line_user_id, c.name);
        }
      }
    }
  } catch (e) {
    console.warn('[SurveySheets] 顧客名の補完に失敗:', e);
  }
  for (const r of missing) {
    const name = names.get(r.line_user_id as string);
    if (name) r.line_display_name = name;
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** 回答 1 件を転記（送信 API から呼ぶ。設定が無ければ何もしない） */
export async function syncSurveyResponseToSheet(params: {
  surveyFormId: string;
  storeId: string;
  response: SurveySheetResponse;
}): Promise<SheetSyncResult & { skipped?: boolean }> {
  const config = await loadSurveyConfig(params.surveyFormId);
  const settings = resolveSurveySheetsSettings(config);
  if (!settings) return { ok: true, appended: 0, skipped: true };

  const creds = await getServiceAccountCredentials();
  const sheets = await getSheetsClient();
  if (!creds || !sheets) return { ok: false, appended: 0, error: SERVICE_ACCOUNT_MISSING_MESSAGE };

  const response: SurveySheetResponse = { ...params.response };
  await fillDisplayNames(params.storeId, [response]);
  try {
    const appended = await appendResponsesToSheet(sheets, settings, [response]);
    await markSynced([response.id]);
    return { ok: true, appended };
  } catch (error) {
    const message = describeSheetsError(error, creds.client_email);
    console.error('[SurveySheets] 回答の転記に失敗:', message, { surveyFormId: params.surveyFormId, responseId: response.id });
    return { ok: false, appended: 0, error: message };
  }
}

export interface ExportResult {
  ok: boolean;
  exported: number;
  remaining: number;
  error?: string;
}

/** まだ転記していない過去の回答をまとめて書き出す（編集画面の「過去の回答を書き出す」） */
export async function exportUnsyncedSurveyResponses(params: {
  surveyFormId: string;
  storeId: string;
  settings: ResolvedSurveySheetsSettings;
}): Promise<ExportResult> {
  const creds = await getServiceAccountCredentials();
  const sheets = await getSheetsClient();
  if (!creds || !sheets) return { ok: false, exported: 0, remaining: 0, error: SERVICE_ACCOUNT_MISSING_MESSAGE };

  const { rows, error } = await loadUnsyncedResponses(params.surveyFormId, params.storeId, SURVEY_SHEET_EXPORT_MAX);
  if (error) return { ok: false, exported: 0, remaining: 0, error };
  if (rows.length === 0) return { ok: true, exported: 0, remaining: 0 };

  const responses = rows.map(toSheetResponse);
  await fillDisplayNames(params.storeId, responses);
  try {
    const exported = await appendResponsesToSheet(sheets, params.settings, responses);
    await markSynced(responses.map((r) => r.id));
    const remaining = (await countUnsyncedSurveyResponses(params.surveyFormId, params.storeId)) ?? 0;
    return { ok: true, exported, remaining };
  } catch (err) {
    const message = describeSheetsError(err, creds.client_email);
    console.error('[SurveySheets] 過去の回答の書き出しに失敗:', message, { surveyFormId: params.surveyFormId });
    return { ok: false, exported: 0, remaining: rows.length, error: message };
  }
}

// ---------------------------------------------------------------------------
// フォームの所属店舗（API の認可用）
// ---------------------------------------------------------------------------

/** アンケートフォームの店舗 ID を取得（無ければ null） */
export async function getSurveyFormStoreId(surveyFormId: string): Promise<string | null> {
  if (getAppEnvironment() === 'local') {
    if (!fs.existsSync(DATA_DIR)) return null;
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('surveys_') && f.endsWith('.json'));
    for (const file of files) {
      const forms = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as Array<{ id: string; store_id: string }>;
      const form = forms.find((f) => f.id === surveyFormId);
      if (form) return form.store_id;
    }
    return null;
  }
  const adminClient = createAdminClient();
  if (!adminClient) return null;
  const { data, error } = await (adminClient as any).from('survey_forms').select('store_id').eq('id', surveyFormId).maybeSingle();
  if (error || !data) return null;
  return (data as { store_id: string }).store_id ?? null;
}
