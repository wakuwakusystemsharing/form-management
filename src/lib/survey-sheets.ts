/**
 * アンケート回答の Google スプレッドシート自動転記（純粋ロジック。DB / Google API 非依存）
 *
 * - 設定は SurveyConfig.basic_info.google_sheets（spreadsheet_id + sheet_name）
 * - 1 行目は見出し。先頭に固定列（回答日時 / LINE表示名 / LINEユーザーID / 回答ID）、以降は質問の文言
 *   （responses のキー）。新しいキーが出たら右端に列を足し、既存の列はそのまま。列は見出し名で対応させる
 */
import type { SurveyConfig } from '@/types/survey';

export const SURVEY_SHEET_FIXED_COLUMNS = ['回答日時', 'LINE表示名', 'LINEユーザーID', '回答ID'] as const;
export const SURVEY_SHEET_NAME_MAX = 100;

export interface SurveySheetResponse {
  id: string;
  submitted_at: string | null | undefined;
  line_user_id?: string | null;
  line_display_name?: string | null;
  responses: Record<string, unknown> | null | undefined;
}

export interface ResolvedSurveySheetsSettings {
  spreadsheetId: string;
  sheetName: string | null; // null = 1 枚目のタブ
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

/** 設定を正規化。連携しない（ID が空 / 不正）なら null */
export function resolveSurveySheetsSettings(config: SurveyConfig | null | undefined): ResolvedSurveySheetsSettings | null {
  const raw = config?.basic_info?.google_sheets;
  if (!raw) return null;
  const spreadsheetId = parseSpreadsheetId(raw.spreadsheet_id);
  if (!spreadsheetId) return null;
  return { spreadsheetId, sheetName: normalizeSheetName(raw.sheet_name) };
}

/** 見出し行をマージ。空なら固定列から始め、responses に出てきた新しいキーを右端に足す */
export function mergeSurveySheetHeader(
  existing: ReadonlyArray<string> | null | undefined,
  responsesList: ReadonlyArray<Record<string, unknown> | null | undefined>
): { header: string[]; added: string[] } {
  const header: string[] = (existing ?? []).map((h) => String(h ?? ''));
  const added: string[] = [];
  const has = (name: string) => header.some((h) => h.trim() === name);
  if (header.every((h) => h.trim() === '')) {
    header.length = 0;
    for (const col of SURVEY_SHEET_FIXED_COLUMNS) {
      header.push(col);
      added.push(col);
    }
  }
  for (const responses of responsesList) {
    if (!responses || typeof responses !== 'object') continue;
    for (const key of Object.keys(responses)) {
      const name = key.trim();
      if (!name || has(name)) continue;
      header.push(name);
      added.push(name);
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

/** 見出し行に合わせて 1 回答を 1 行（文字列配列）にする */
export function buildSurveySheetRow(response: SurveySheetResponse, header: ReadonlyArray<string>): string[] {
  const responses = response.responses && typeof response.responses === 'object' ? response.responses : {};
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(responses)) byKey.set(k.trim(), v);
  return header.map((h) => {
    const name = String(h ?? '').trim();
    switch (name) {
      case SURVEY_SHEET_FIXED_COLUMNS[0]:
        return formatSheetDateTimeJst(response.submitted_at);
      case SURVEY_SHEET_FIXED_COLUMNS[1]:
        return sanitizeSheetCell(response.line_display_name ?? '');
      case SURVEY_SHEET_FIXED_COLUMNS[2]:
        return response.line_user_id ?? '';
      case SURVEY_SHEET_FIXED_COLUMNS[3]:
        return response.id;
      default:
        return byKey.has(name) ? sanitizeSheetCell(cellValue(byKey.get(name))) : '';
    }
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
