import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { normalizeSheetName, parseSpreadsheetId } from '@/lib/survey-sheets';
import { getSurveyFormStoreId, testSurveySheetConnection } from '@/lib/survey-sheets-service';

// POST /api/surveys/[id]/sheets/test - スプレッドシートへの接続確認
//   body: { spreadsheet_id: string（URL 可）, sheet_name?: string }
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
    const result = await testSurveySheetConnection({ spreadsheetId, sheetName: normalizeSheetName(body?.sheet_name) });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({
      spreadsheet_id: spreadsheetId,
      title: result.title,
      sheet_titles: result.sheetTitles,
      sheet_exists: result.sheetExists,
      url: result.url,
    });
  } catch (error) {
    console.error('[API] survey sheets test error:', error);
    return NextResponse.json({ error: '接続確認に失敗しました' }, { status: 500 });
  }
}
