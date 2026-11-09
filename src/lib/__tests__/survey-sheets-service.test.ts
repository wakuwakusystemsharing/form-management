import { describe, expect, it, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { appendResponsesToSheet, describeSheetsError } from '@/lib/survey-sheets-service';
import { SURVEY_SHEET_FIXED_COLUMNS } from '@/lib/survey-sheets';

/** 偽の Google Sheets クライアント（spreadsheets.get / batchUpdate / values.get / update / append だけ） */
function fakeSheets(initial: { tabs: string[]; header: string[] }) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const state = { tabs: [...initial.tabs], header: [...initial.header] };
  const client = {
    spreadsheets: {
      get: vi.fn(async (args: unknown) => {
        calls.push({ name: 'get', args });
        return { data: { properties: { title: 'テスト台帳' }, sheets: state.tabs.map((t, i) => ({ properties: { title: t, sheetId: i } })) } };
      }),
      batchUpdate: vi.fn(async (args: { requestBody: { requests: Array<{ addSheet?: { properties: { title: string } } }> } }) => {
        calls.push({ name: 'batchUpdate', args });
        for (const r of args.requestBody.requests) if (r.addSheet) state.tabs.push(r.addSheet.properties.title);
        return { data: {} };
      }),
      values: {
        get: vi.fn(async (args: unknown) => {
          calls.push({ name: 'values.get', args });
          return { data: { values: state.header.length ? [state.header] : undefined } };
        }),
        update: vi.fn(async (args: { requestBody: { values: string[][] } }) => {
          calls.push({ name: 'values.update', args });
          state.header = args.requestBody.values[0];
          return { data: {} };
        }),
        append: vi.fn(async (args: unknown) => {
          calls.push({ name: 'values.append', args });
          return { data: {} };
        }),
      },
    },
  };
  return { client: client as unknown as sheets_v4.Sheets, calls, state };
}

const r1 = { id: 'sr_1', submitted_at: '2026-11-09T01:00:00.000Z', line_user_id: 'U1', line_display_name: '太郎', responses: { 'お名前': '山田', '満足度': '5' } };
const r2 = { id: 'sr_2', submitted_at: '2026-11-09T02:00:00.000Z', line_user_id: null, line_display_name: null, responses: { '満足度': '3', 'ご意見': '=cmd' } };

describe('appendResponsesToSheet', () => {
  it('見出しが無いシートには固定列 + 質問の見出しを書いてから行を追記する（1 枚目のタブ）', async () => {
    const { client, calls, state } = fakeSheets({ tabs: ['シート1', 'メモ'], header: [] });
    const n = await appendResponsesToSheet(client, { spreadsheetId: 'SS', sheetName: null }, [r1, r2]);
    expect(n).toBe(2);
    expect(state.header).toEqual([...SURVEY_SHEET_FIXED_COLUMNS, 'お名前', '満足度', 'ご意見']);
    const update = calls.find((c) => c.name === 'values.update')!.args as { range: string };
    expect(update.range).toBe("'シート1'!A1");
    const append = calls.find((c) => c.name === 'values.append')!.args as { range: string; valueInputOption: string; insertDataOption: string; requestBody: { values: string[][] } };
    expect(append.range).toBe("'シート1'!A1");
    expect(append.valueInputOption).toBe('RAW');
    expect(append.insertDataOption).toBe('INSERT_ROWS');
    expect(append.requestBody.values).toEqual([
      ['2026/11/09 10:00:00', '太郎', 'U1', 'sr_1', '山田', '5', ''],
      ['2026/11/09 11:00:00', '', '', 'sr_2', '', '3', "'=cmd"],
    ]);
    expect(calls.some((c) => c.name === 'batchUpdate')).toBe(false);
  });

  it('指定したタブが無ければ作る。既存の見出しに無いキーだけ右端に足し、既存の列順は保つ', async () => {
    const { client, calls, state } = fakeSheets({ tabs: ['シート1'], header: ['満足度', '回答日時'] });
    await appendResponsesToSheet(client, { spreadsheetId: 'SS', sheetName: '回答' }, [r1]);
    const add = calls.find((c) => c.name === 'batchUpdate')!.args as { requestBody: { requests: Array<{ addSheet: { properties: { title: string } } }> } };
    expect(add.requestBody.requests[0].addSheet.properties.title).toBe('回答');
    expect(state.tabs).toContain('回答');
    expect(state.header).toEqual(['満足度', '回答日時', 'お名前']);
    const append = calls.find((c) => c.name === 'values.append')!.args as { range: string; requestBody: { values: string[][] } };
    expect(append.range).toBe("'回答'!A1");
    expect(append.requestBody.values).toEqual([['5', '2026/11/09 10:00:00', '山田']]);
  });

  it('見出しに変更が無ければ update しない。回答 0 件なら何もしない', async () => {
    const full = fakeSheets({ tabs: ['シート1'], header: [...SURVEY_SHEET_FIXED_COLUMNS, 'お名前', '満足度'] });
    await appendResponsesToSheet(full.client, { spreadsheetId: 'SS', sheetName: null }, [r1]);
    expect(full.calls.some((c) => c.name === 'values.update')).toBe(false);
    expect(full.calls.filter((c) => c.name === 'values.append')).toHaveLength(1);

    const empty = fakeSheets({ tabs: ['シート1'], header: [] });
    expect(await appendResponsesToSheet(empty.client, { spreadsheetId: 'SS', sheetName: null }, [])).toBe(0);
    expect(empty.calls).toHaveLength(0);
  });

  it('201 件以上は 200 件ずつ分けて追記する', async () => {
    const { client, calls } = fakeSheets({ tabs: ['シート1'], header: [] });
    const many = Array.from({ length: 450 }, (_, i) => ({ ...r1, id: `sr_${i}` }));
    expect(await appendResponsesToSheet(client, { spreadsheetId: 'SS', sheetName: null }, many)).toBe(450);
    const appends = calls.filter((c) => c.name === 'values.append').map((c) => (c.args as { requestBody: { values: string[][] } }).requestBody.values.length);
    expect(appends).toEqual([200, 200, 50]);
  });
});

describe('describeSheetsError', () => {
  it('403 は共有の案内、404 は ID の確認、それ以外は生のメッセージ', () => {
    expect(describeSheetsError({ code: 403 }, 'sa@example.iam.gserviceaccount.com')).toContain('「sa@example.iam.gserviceaccount.com」を「編集者」として共有');
    expect(describeSheetsError({ code: 404 })).toContain('見つかりません');
    expect(describeSheetsError({ code: 400, message: 'Unable to parse range: x' })).toContain('シート名（タブ）');
    expect(describeSheetsError(new Error('boom'))).toContain('boom');
  });
});
