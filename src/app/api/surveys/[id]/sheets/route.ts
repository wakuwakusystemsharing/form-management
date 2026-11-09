import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getServiceAccountEmail } from '@/lib/google-service-account';
import { countUnsyncedSurveyResponses, getSurveyFormStoreId } from '@/lib/survey-sheets-service';

// GET /api/surveys/[id]/sheets - Google スプレッドシート連携の状態
//   { service_account_email, unsynced_count }
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const storeId = await getSurveyFormStoreId(id);
    if (!storeId) return NextResponse.json({ error: 'アンケートフォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const [serviceAccountEmail, unsyncedCount] = await Promise.all([
      getServiceAccountEmail(),
      countUnsyncedSurveyResponses(id, storeId),
    ]);
    return NextResponse.json({ service_account_email: serviceAccountEmail, unsynced_count: unsyncedCount });
  } catch (error) {
    console.error('[API] survey sheets status error:', error);
    return NextResponse.json({ error: '連携状態の取得に失敗しました' }, { status: 500 });
  }
}
