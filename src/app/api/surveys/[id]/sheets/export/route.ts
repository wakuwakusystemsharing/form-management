import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { normalizeSheetName, parseSpreadsheetId } from '@/lib/survey-sheets';
import { exportUnsyncedSurveyResponses, getSurveyFormStoreId } from '@/lib/survey-sheets-service';

// POST /api/surveys/[id]/sheets/export - まだ転記していない過去の回答をまとめて書き出す
//   body: { spreadsheet_id: string（URL 可）, sheet_name?: string }
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
    const result = await exportUnsyncedSurveyResponses({
      surveyFormId: id,
      storeId,
      settings: { spreadsheetId, sheetName: normalizeSheetName(body?.sheet_name) },
    });
    if (!result.ok) return NextResponse.json({ error: result.error, exported: result.exported, remaining: result.remaining }, { status: 400 });
    return NextResponse.json({ exported: result.exported, remaining: result.remaining });
  } catch (error) {
    console.error('[API] survey sheets export error:', error);
    return NextResponse.json({ error: '過去の回答の書き出しに失敗しました' }, { status: 500 });
  }
}
