import { describe, expect, it } from 'vitest';
import {
  buildSurveySheetRow,
  columnLetter,
  formatSheetDateTimeJst,
  isSurveySheetsEnabled,
  mergeSurveySheetHeader,
  parseSpreadsheetGid,
  parseSpreadsheetId,
  quoteSheetName,
  resolveSurveySheetsSettings,
  sanitizeSheetCell,
  SURVEY_SHEET_FIXED_COLUMNS,
} from '@/lib/survey-sheets';
import type { SurveyConfig } from '@/types/survey';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';

describe('parseSpreadsheetId', () => {
  it('URL から ID を取り出す（/u/0/ 付き・gid 付きも）', () => {
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/u/0/d/${ID}/edit?gid=12#gid=12`)).toBe(ID);
  });
  it('ID をそのまま受け付け、空・短すぎる・不正文字は null', () => {
    expect(parseSpreadsheetId(`  ${ID} `)).toBe(ID);
    expect(parseSpreadsheetId('')).toBeNull();
    expect(parseSpreadsheetId('abc')).toBeNull();
    expect(parseSpreadsheetId('https://example.com/not-a-sheet')).toBeNull();
  });
  it('gid を取り出す', () => {
    expect(parseSpreadsheetGid(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=345`)).toBe(345);
    expect(parseSpreadsheetGid(ID)).toBeNull();
  });
});

describe('resolveSurveySheetsSettings', () => {
  const base = {
    basic_info: { title: 't', liff_id: '', theme_color: '#000' },
    questions: [],
    ui_settings: { submit_button_text: '送信', theme_color: '#000' },
  } as unknown as SurveyConfig;
  const withSheets = (google_sheets: { enabled?: boolean; spreadsheet_id: string; sheet_name?: string }): SurveyConfig =>
    ({ ...base, basic_info: { ...base.basic_info, google_sheets } }) as SurveyConfig;

  it('未設定 / ID 空 / ID 不正は null', () => {
    expect(resolveSurveySheetsSettings(base)).toBeNull();
    expect(resolveSurveySheetsSettings(withSheets({ spreadsheet_id: '' }))).toBeNull();
    expect(resolveSurveySheetsSettings(withSheets({ spreadsheet_id: 'x' }))).toBeNull();
  });
  it('enabled: false なら ID があっても null。enabled 未設定（旧データ）は ID があれば ON、true は通常どおり', () => {
    expect(resolveSurveySheetsSettings(withSheets({ enabled: false, spreadsheet_id: ID }))).toBeNull();
    expect(resolveSurveySheetsSettings(withSheets({ spreadsheet_id: ID }))?.spreadsheetId).toBe(ID);
    expect(resolveSurveySheetsSettings(withSheets({ enabled: true, spreadsheet_id: ID }))?.spreadsheetId).toBe(ID);
    expect(isSurveySheetsEnabled(undefined)).toBe(false);
    expect(isSurveySheetsEnabled({ spreadsheet_id: '' })).toBe(false);
    expect(isSurveySheetsEnabled({ enabled: true, spreadsheet_id: '' })).toBe(true);
  });
  it('URL を ID に変換し、タブ名は trim（空は null）', () => {
    expect(resolveSurveySheetsSettings(withSheets({ spreadsheet_id: `https://docs.google.com/spreadsheets/d/${ID}/edit`, sheet_name: ' 回答 ' })))
      .toEqual({ spreadsheetId: ID, sheetName: '回答' });
    expect(resolveSurveySheetsSettings(withSheets({ spreadsheet_id: ID, sheet_name: '  ' }))?.sheetName).toBeNull();
  });
});

describe('mergeSurveySheetHeader', () => {
  it('空の見出しなら固定列 + 質問の順で作る', () => {
    const { header, added } = mergeSurveySheetHeader([], [{ 'お名前': 'a', '満足度': '5' }]);
    expect(header).toEqual([...SURVEY_SHEET_FIXED_COLUMNS, 'お名前', '満足度']);
    expect(added).toEqual(header);
  });
  it('既存の列は動かさず、新しいキーだけ右端に足す（空白だけの見出しは「空」扱い）', () => {
    const existing = ['回答日時', 'LINE表示名', 'LINEユーザーID', '回答ID', '満足度', 'メモ'];
    const { header, added } = mergeSurveySheetHeader(existing, [{ 'お名前': 'a', '満足度': '5' }, { 'ご意見': 'x' }]);
    expect(header).toEqual([...existing, 'お名前', 'ご意見']);
    expect(added).toEqual(['お名前', 'ご意見']);
    expect(mergeSurveySheetHeader(['', ' '], [{}]).header).toEqual([...SURVEY_SHEET_FIXED_COLUMNS]);
  });
  it('店舗が並べ替えた見出しもそのまま使う', () => {
    expect(mergeSurveySheetHeader(['満足度', '回答日時'], [{ '満足度': '5' }]).header).toEqual(['満足度', '回答日時']);
  });
});

describe('buildSurveySheetRow', () => {
  const response = {
    id: 'sr_1',
    submitted_at: '2026-11-09T05:04:03.000Z',
    line_user_id: 'U123',
    line_display_name: '山田 太郎',
    responses: { 'お名前': '山田', '満足度': '5', '複数': ['a', 'b'], '追加質問（はい）': '理由' },
  };
  it('見出しの順に値を並べ、無い列は空文字', () => {
    const header = ['回答日時', 'LINE表示名', 'LINEユーザーID', '回答ID', '満足度', '存在しない', 'お名前', '複数', '追加質問（はい）'];
    expect(buildSurveySheetRow(response, header)).toEqual([
      '2026/11/09 14:04:03', '山田 太郎', 'U123', 'sr_1', '5', '', '山田', 'a, b', '理由',
    ]);
  });
  it('表示名・ユーザー ID が無ければ空文字。先頭が = などの値は数式にならないよう無害化', () => {
    const row = buildSurveySheetRow(
      { ...response, line_user_id: null, line_display_name: null, responses: { '式': '=SUM(A1)' } },
      ['LINE表示名', 'LINEユーザーID', '式']
    );
    expect(row).toEqual(['', '', "'=SUM(A1)"]);
    expect(sanitizeSheetCell('+1')).toBe("'+1");
    expect(sanitizeSheetCell('普通')).toBe('普通');
  });
  it('日時は JST。不正な日時は元の文字列', () => {
    expect(formatSheetDateTimeJst('2026-01-01T00:00:00+09:00')).toBe('2026/01/01 00:00:00');
    expect(formatSheetDateTimeJst('abc')).toBe('abc');
    expect(formatSheetDateTimeJst(null)).toBe('');
  });
});

describe('A1 記法ヘルパー', () => {
  it('quoteSheetName / columnLetter', () => {
    expect(quoteSheetName("回答'2")).toBe("'回答''2'");
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
  });
});
