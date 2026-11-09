/**
 * アンケート回答の Google スプレッドシート自動転記（純粋ロジック。DB / Google API 非依存）
 *
 * - 設定は SurveyConfig.basic_info.google_sheets（enabled / spreadsheet_id / sheet_name / columns / include_unlisted）
 * - 1 行目は見出し。既定は固定列（回答日時 / LINE表示名 / LINEユーザーID / 回答ID）+ 質問の文言（responses のキー）。
 *   「列をカスタマイズ」で 列の ON/OFF・並び順・見出し名 を変えられる（columns）。一覧に無いキー（追加質問など）は
 *   include_unlisted（既定 true）なら右端に自動で足す。既存の列は見出し名で対応させるので店舗が並べ替えても壊れない
 */
import type { SurveyConfig, SurveyGoogleSheetsSettings, SurveySheetColumn } from '@/types/survey';

export const SURVEY_SHEET_FIXED_COLUMNS = ['回答日時', 'LINE表示名', 'LINEユーザーID', '回答ID'] as const;
export const SURVEY_SHEET_NAME_MAX = 100;
export const SURVEY_SHEET_LABEL_MAX = 60;

/** 固定列のキーと既定の見出し */
export const SURVEY_SHEET_FIXED_DEFS = [
  { key: 'submitted_at', label: SURVEY_SHEET_FIXED_COLUMNS[0] },
  { key: 'line_display_name', label: SURVEY_SHEET_FIXED_COLUMNS[1] },
  { key: 'line_user_id', label: SURVEY_SHEET_FIXED_COLUMNS[2] },
  { key: 'response_id', label: SURVEY_SHEET_FIXED_COLUMNS[3] },
] as const;
export type SurveySheetFixedKey = (typeof SURVEY_SHEET_FIXED_DEFS)[number]['key'];
const FIXED_KEYS: readonly string[] = SURVEY_SHEET_FIXED_DEFS.map((d) => d.key);

/** 質問の列キー（responses のキー = 質問の文言） */
export function questionColumnKey(title: string): string {
  return `q:${title.trim()}`;
}
export function isQuestionColumnKey(key: string): boolean {
  return key.startsWith('q:');
}
export function questionTitleFromKey(key: string): string {
  return key.slice(2);
}

export interface SurveySheetResponse {
  id: string;
  submitted_at: string | null | undefined;
  line_user_id?: string | null;
  line_display_name?: string | null;
  responses: Record<string, unknown> | null | undefined;
}

/** 見出し → 値の取り出し方（列プラン） */
export interface SurveySheetColumnPlan {
  columns: Array<{ key: string; header: string }>;
  /** プランに無い回答キー（追加質問など）を右端に自動で足すか */
  includeUnlisted: boolean;
  /** 明示的に OFF にした質問キー（自動追加の対象外） */
  excludedKeys: string[];
}

export interface ResolvedSurveySheetsSettings {
  spreadsheetId: string;
  sheetName: string | null; // null = 1 枚目のタブ
  plan?: SurveySheetColumnPlan;
}

/** スプレッドシートの URL または ID から ID を取り出す。判定できなければ null */
export function parseSpreadsheetId(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const fromUrl = raw.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw;
  return null;
}

/** シート URL の `#gid=` や `?gid=` からタブ ID を取り出す（タブ名の補助。無ければ null） */
export function parseSpreadsheetGid(input: string | null | undefined): number | null {
  const raw = (input ?? '').trim();
  const m = raw.match(/[#?&]gid=(\d+)/);
  return m ? Number(m[1]) : null;
}

export function normalizeSheetName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().slice(0, SURVEY_SHEET_NAME_MAX);
  return trimmed || null;
}

/** 連携の ON/OFF。enabled 未設定（旧データ）は ID が入っていれば ON 扱い */
export function isSurveySheetsEnabled(raw: SurveyGoogleSheetsSettings | null | undefined): boolean {
  if (!raw) return false;
  if (typeof raw.enabled === 'boolean') return raw.enabled;
  return !!parseSpreadsheetId(raw.spreadsheet_id);
}

// ---------------------------------------------------------------------------
// 列のカスタマイズ
// ---------------------------------------------------------------------------

type QuestionLike = { title?: string | null } | null | undefined;

/** おすすめ（既定）の列: 固定 4 列 + 質問の順 */
export function defaultSurveySheetColumns(questions: ReadonlyArray<QuestionLike> | null | undefined): SurveySheetColumn[] {
  const cols: SurveySheetColumn[] = SURVEY_SHEET_FIXED_DEFS.map((d) => ({ key: d.key, enabled: true }));
  const seen = new Set<string>();
  for (const q of questions ?? []) {
    const title = (q?.title ?? '').trim();
    if (!title) continue;
    const key = questionColumnKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    cols.push({ key, enabled: true });
  }
  return cols;
}

/** 列の既定の見出し（固定列はその名前、質問は文言） */
export function defaultSurveySheetColumnLabel(key: string): string {
  const fixed = SURVEY_SHEET_FIXED_DEFS.find((d) => d.key === key);
  if (fixed) return fixed.label;
  return isQuestionColumnKey(key) ? questionTitleFromKey(key) : key;
}

/**
 * 保存された columns を正規化し、現在の質問一覧に合わせる。
 * - 不正な行は捨てる。固定列・質問の重複は最初の 1 件
 * - 一覧に無い質問（あとから追加した質問）は末尾に ON で足す
 * - 質問から消えた列はそのまま残す（過去の回答の列として使えるように。編集画面側で「削除された質問」と表示）
 */
export function normalizeSurveySheetColumns(
  raw: ReadonlyArray<SurveySheetColumn> | null | undefined,
  questions: ReadonlyArray<QuestionLike> | null | undefined
): SurveySheetColumn[] {
  const out: SurveySheetColumn[] = [];
  const seen = new Set<string>();
  for (const c of raw ?? []) {
    if (!c || typeof c.key !== 'string') continue;
    const key = c.key.trim();
    if (!key || seen.has(key)) continue;
    if (!FIXED_KEYS.includes(key) && !isQuestionColumnKey(key)) continue;
    if (isQuestionColumnKey(key) && !questionTitleFromKey(key).trim()) continue;
    seen.add(key);
    const label = typeof c.label === 'string' ? c.label.trim().slice(0, SURVEY_SHEET_LABEL_MAX) : '';
    out.push({ key, enabled: c.enabled !== false, ...(label ? { label } : {}) });
  }
  for (const d of defaultSurveySheetColumns(questions)) {
    if (!seen.has(d.key)) {
      seen.add(d.key);
      out.push(d);
    }
  }
  return out;
}

/** 設定と質問一覧から「見出し → キー」の列プランを作る */
export function buildSurveySheetColumnPlan(
  settings: Pick<SurveyGoogleSheetsSettings, 'columns' | 'include_unlisted'> | null | undefined,
  questions: ReadonlyArray<QuestionLike> | null | undefined
): SurveySheetColumnPlan {
  const columns = normalizeSurveySheetColumns(settings?.columns, questions);
  const usedHeaders = new Set<string>();
  const planned: Array<{ key: string; header: string }> = [];
  const excludedKeys: string[] = [];
  for (const c of columns) {
    if (c.enabled === false) {
      excludedKeys.push(c.key);
      continue;
    }
    let header = (c.label ?? '').trim() || defaultSurveySheetColumnLabel(c.key);
    if (usedHeaders.has(header)) {
      let n = 2;
      while (usedHeaders.has(`${header} ${n}`)) n += 1;
      header = `${header} ${n}`;
    }
    usedHeaders.add(header);
    planned.push({ key: c.key, header });
  }
  return { columns: planned, includeUnlisted: settings?.include_unlisted !== false, excludedKeys };
}

/** 設定を正規化。連携しない（OFF / ID が空 / 不正）なら null */
export function resolveSurveySheetsSettings(config: SurveyConfig | null | undefined): ResolvedSurveySheetsSettings | null {
  const raw = config?.basic_info?.google_sheets;
  if (!raw || !isSurveySheetsEnabled(raw)) return null;
  const spreadsheetId = parseSpreadsheetId(raw.spreadsheet_id);
  if (!spreadsheetId) return null;
  return {
    spreadsheetId,
    sheetName: normalizeSheetName(raw.sheet_name),
    plan: buildSurveySheetColumnPlan(raw, config?.questions),
  };
}

// ---------------------------------------------------------------------------
// 見出し行と行の組み立て
// ---------------------------------------------------------------------------

/**
 * 見出し行をマージ。
 * - 空なら プラン（無ければ固定列）から始める
 * - responses に出てきた新しいキーは右端に足す（プランがあるときは includeUnlisted の場合だけ。明示的に OFF の質問は足さない）
 */
export function mergeSurveySheetHeader(
  existing: ReadonlyArray<string> | null | undefined,
  responsesList: ReadonlyArray<Record<string, unknown> | null | undefined>,
  plan?: SurveySheetColumnPlan | null
): { header: string[]; added: string[] } {
  const header: string[] = (existing ?? []).map((h) => String(h ?? ''));
  const added: string[] = [];
  const has = (name: string) => header.some((h) => h.trim() === name);
  const push = (name: string) => {
    header.push(name);
    added.push(name);
  };
  if (header.every((h) => h.trim() === '')) {
    header.length = 0;
    if (plan) {
      for (const c of plan.columns) push(c.header);
    } else {
      for (const col of SURVEY_SHEET_FIXED_COLUMNS) push(col);
    }
  }
  if (plan && !plan.includeUnlisted) return { header, added };
  const plannedKeys = new Set(plan?.columns.map((c) => c.key) ?? []);
  const excluded = new Set(plan?.excludedKeys ?? []);
  for (const responses of responsesList) {
    if (!responses || typeof responses !== 'object') continue;
    for (const key of Object.keys(responses)) {
      const name = key.trim();
      if (!name) continue;
      const qKey = questionColumnKey(name);
      if (plan && (plannedKeys.has(qKey) || excluded.has(qKey))) continue; // プランで扱い済み
      if (has(name)) continue;
      push(name);
    }
  }
  return { header, added };
}

/** ISO 日時 → `2026/11/09 14:05:30`（JST）。不正なら元の文字列 */
export function formatSheetDateTimeJst(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}/${p(jst.getUTCMonth() + 1)}/${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}:${p(jst.getUTCSeconds())}`;
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => cellValue(v)).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 数式として解釈されないよう先頭の = + - @ を無害化（スプレッドシート・インジェクション対策） */
export function sanitizeSheetCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function valueForKey(key: string, response: SurveySheetResponse, byKey: Map<string, unknown>): string {
  switch (key) {
    case 'submitted_at':
      return formatSheetDateTimeJst(response.submitted_at);
    case 'line_display_name':
      return sanitizeSheetCell(response.line_display_name ?? '');
    case 'line_user_id':
      return response.line_user_id ?? '';
    case 'response_id':
      return response.id;
    default: {
      const name = isQuestionColumnKey(key) ? questionTitleFromKey(key) : key;
      return byKey.has(name) ? sanitizeSheetCell(cellValue(byKey.get(name))) : '';
    }
  }
}

/** 見出し行に合わせて 1 回答を 1 行（文字列配列）にする。プランがあれば見出し → キーの対応を優先 */
export function buildSurveySheetRow(response: SurveySheetResponse, header: ReadonlyArray<string>, plan?: SurveySheetColumnPlan | null): string[] {
  const responses = response.responses && typeof response.responses === 'object' ? response.responses : {};
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(responses)) byKey.set(k.trim(), v);
  const headerToKey = new Map<string, string>();
  for (const c of plan?.columns ?? []) headerToKey.set(c.header, c.key);
  for (const d of SURVEY_SHEET_FIXED_DEFS) if (!headerToKey.has(d.label)) headerToKey.set(d.label, d.key);
  return header.map((h) => {
    const name = String(h ?? '').trim();
    const key = headerToKey.get(name) ?? name;
    return valueForKey(key, response, byKey);
  });
}

/** A1 記法のシート名（タブ名にシングルクォートを含んでも壊れないように） */
export function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

/** 0 始まりの列番号 → A, B, …, Z, AA … */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
