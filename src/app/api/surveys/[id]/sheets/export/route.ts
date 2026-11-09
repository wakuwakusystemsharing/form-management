import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { buildSurveySheetColumnPlan, normalizeSheetName, parseSpreadsheetId } from '@/lib/survey-sheets';
import { exportUnsyncedSurveyResponses, getSurveyFormStoreId } from '@/lib/survey-sheets-service';
import { loadSurveyConfig } from '@/lib/survey-tags-apply';

// POST /api/surveys/[id]/sheets/export - まだ転記していない過去の回答をまとめて書き出す
//   body: { spreadsheet_id: string（URL 可）, sheet_name?: string, columns?: SurveySheetColumn[], include_unlisted?: boolean }
//   → { exported, remaining }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const storeId = await getSurveyFormStoreId(id);
    if (!storeId) return NextResponse.json({ error: 'アンケートフォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => ({}));
    const spreadsheetId = parseSpreadsheetId(body?.spreadsheet_id);
    if (!spreadsheetId) {
      return NextResponse.json({ error: 'スプレッドシートの ID（または URL）を正しく入力してください' }, { status: 400 });
    }
    // 列のカスタマイズは編集中の値（body）を優先し、質問一覧は保存済みの config から
    const config = await loadSurveyConfig(id);
    const plan = buildSurveySheetColumnPlan(
      { columns: Array.isArray(body?.columns) ? body.columns : config?.basic_info?.google_sheets?.columns, include_unlisted: typeof body?.include_unlisted === 'boolean' ? body.include_unlisted : config?.basic_info?.google_sheets?.include_unlisted },
      config?.questions
    );
    const result = await exportUnsyncedSurveyResponses({
      surveyFormId: id,
      storeId,
      settings: { spreadsheetId, sheetName: normalizeSheetName(body?.sheet_name), plan },
    });
    if (!result.ok) return NextResponse.json({ error: result.error, exported: result.exported, remaining: result.remaining }, { status: 400 });
    return NextResponse.json({ exported: result.exported, remaining: result.remaining });
  } catch (error) {
    console.error('[API] survey sheets export error:', error);
    return NextResponse.json({ error: '過去の回答の書き出しに失敗しました' }, { status: 500 });
  }
}
